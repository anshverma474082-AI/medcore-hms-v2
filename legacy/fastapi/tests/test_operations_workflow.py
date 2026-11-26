import hashlib
import hmac
import json
from datetime import date, timedelta

from app import models
from app.config import settings
from app.database import SessionLocal
from tests.conftest import login
from tests.test_clinical_workflow import book, setup_clinic


def test_lab_order_result_review_and_notifications(client):
    _, admin, doctor, doctor_headers, patient, starts_at = setup_clinic(client, "lab")
    lab_user = client.post("/users", headers=admin, json={
        "name": "Lab Tech", "email": "labtech@lab.example", "password": "password123",
        "role": "lab_technician",
    })
    assert lab_user.status_code == 201, lab_user.text
    lab = login(client, "labtech@lab.example", "password123")
    appointment = book(client, doctor, patient, starts_at).json()["data"]
    assert client.patch(f"/appointments/{appointment['id']}/status", headers=admin,
                        json={"status": "confirmed"}).status_code == 200

    created = client.post(f"/appointments/{appointment['id']}/lab-orders", headers=doctor_headers,
                          json={"test_name": "Complete blood count", "notes": "Routine"})
    assert created.status_code == 201, created.text
    order = created.json()["data"]
    lab_notices = client.get("/notifications/me", headers=lab).json()["data"]
    assert lab_notices[0]["category"] == "lab_order"
    assert client.patch(f"/lab-orders/{order['id']}/result", headers=patient,
                        json={"result_text": "Normal"}).status_code == 403

    uploaded = client.patch(f"/lab-orders/{order['id']}/result", headers=lab,
                             json={"result_text": "Haemoglobin within expected range"})
    assert uploaded.status_code == 200 and uploaded.json()["data"]["status"] == "result_ready"
    assert client.get(f"/lab-orders/{order['id']}", headers=patient).json()["data"]["resultText"] == ""
    approved = client.patch(f"/lab-orders/{order['id']}/approve", headers=doctor_headers)
    assert approved.status_code == 200 and approved.json()["data"]["status"] == "approved"
    visible = client.get(f"/lab-orders/{order['id']}", headers=patient).json()["data"]
    assert visible["resultText"] == "Haemoglobin within expected range"
    patient_notices = client.get("/notifications/me", headers=patient).json()["data"]
    assert {item["category"] for item in patient_notices} == {"lab_result"}
    notice_id = patient_notices[0]["id"]
    assert client.patch(f"/notifications/{notice_id}/read", headers=patient).status_code == 200
    assert client.patch(f"/notifications/{notice_id}/read", headers=lab).status_code == 404


def _prescription_for_pharmacy(client, suffix="pharm"):
    _, admin, doctor, doctor_headers, patient, starts_at = setup_clinic(client, suffix)
    appointment = book(client, doctor, patient, starts_at).json()["data"]
    assert client.patch(f"/appointments/{appointment['id']}/status", headers=admin,
                        json={"status": "confirmed"}).status_code == 200
    record = client.post(f"/appointments/{appointment['id']}/records", headers=doctor_headers,
                         json={"diagnosis": "Seasonal fever"})
    assert record.status_code == 201, record.text
    rx_response = client.post(f"/appointments/{appointment['id']}/prescriptions", headers=doctor_headers,
                              json={"items": [{"medicine_name": "Paracetamol", "dosage": "1 tablet",
                                  "frequency": "Twice daily", "duration": "3 days"}]})
    assert rx_response.status_code == 201, rx_response.text
    staff = client.post("/users", headers=admin, json={
        "name": "Pharmacist", "email": f"pharmacist@{suffix}.example", "password": "password123",
        "role": "pharmacist",
    })
    assert staff.status_code == 201, staff.text
    pharmacy = login(client, f"pharmacist@{suffix}.example", "password123")
    return admin, patient, rx_response.json()["data"], pharmacy


def test_pharmacy_dispenses_fifo_skips_expired_and_prevents_partial_sale(client):
    _, patient, rx, pharmacy = _prescription_for_pharmacy(client)
    pharmacy_rx = client.get("/prescriptions", headers=pharmacy)
    assert pharmacy_rx.status_code == 200 and pharmacy_rx.json()["data"][0]["id"] == rx["id"]
    medicine = client.post("/medicines", headers=pharmacy, json={
        "name": "Paracetamol", "sku": "PARA-500", "unit": "tablet", "reorder_level": 2,
    })
    assert medicine.status_code == 201, medicine.text
    medicine_id = medicine.json()["data"]["id"]
    first = client.post(f"/medicines/{medicine_id}/batches", headers=pharmacy, json={
        "batch_number": "OLD", "expiry_date": (date.today() + timedelta(days=10)).isoformat(),
        "quantity": 3, "unit_cost": "1.00",
    })
    second = client.post(f"/medicines/{medicine_id}/batches", headers=pharmacy, json={
        "batch_number": "NEW", "expiry_date": (date.today() + timedelta(days=40)).isoformat(),
        "quantity": 10, "unit_cost": "1.10",
    })
    assert first.status_code == second.status_code == 201

    # Seed a historical expired batch to prove that old stock is never dispensed.
    db = SessionLocal()
    try:
        db.add(models.InventoryBatch(hospital_id=rx["hospitalId"], medicine_id=medicine_id,
            batch_number="EXPIRED", expiry_date=date.today() - timedelta(days=1),
            quantity_received=50, quantity_remaining=50, unit_cost=1))
        db.commit()
    finally:
        db.close()

    line_id = rx["items"][0]["id"]
    too_many = client.post(f"/prescriptions/{rx['id']}/dispense", headers=pharmacy,
                           json={"items": [{"prescription_item_id": line_id, "quantity": 14}]})
    assert too_many.status_code == 409
    stock = client.get("/medicines", headers=pharmacy).json()["data"][0]
    assert stock["availableStock"] == 13  # 3 + 10; expired 50 is excluded

    dispensed = client.post(f"/prescriptions/{rx['id']}/dispense", headers=pharmacy,
                            json={"items": [{"prescription_item_id": line_id, "quantity": 6}]})
    assert dispensed.status_code == 201, dispensed.text
    allocations = dispensed.json()["data"]["items"]
    assert [(i["batchNumber"], i["quantity"]) for i in allocations] == [("OLD", 3), ("NEW", 3)]
    assert client.get("/medicines", headers=pharmacy).json()["data"][0]["availableStock"] == 7
    assert client.post(f"/prescriptions/{rx['id']}/dispense", headers=pharmacy,
                       json={"items": [{"prescription_item_id": line_id, "quantity": 1}]}).status_code == 409
    assert client.get("/notifications/me", headers=patient).json()["data"][0]["category"] == "pharmacy"


def _signed_event(payload):
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(settings.PAYMENT_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, {"Content-Type": "application/json", "X-Payment-Signature": "sha256=" + signature}


def test_test_payment_webhook_signature_amount_and_idempotency(client):
    _, admin, doctor, _, patient, starts_at = setup_clinic(client, "pay")
    appointment = book(client, doctor, patient, starts_at).json()["data"]
    bill_response = client.post(f"/appointments/{appointment['id']}/bill", headers=admin,
                                json={"amount": "900.00", "currency": "INR"})
    assert bill_response.status_code == 201, bill_response.text
    bill = bill_response.json()["data"]
    endpoint = "/payments/webhook/test"

    payload = {"event_id": "evt-invalid", "bill_id": bill["id"], "status": "paid",
               "amount": "900.00", "currency": "INR"}
    body, headers = _signed_event(payload)
    assert client.post(endpoint, content=body, headers={"Content-Type": "application/json",
        "X-Payment-Signature": "sha256=invalid"}).status_code == 401
    payload["amount"] = "901.00"
    body, headers = _signed_event(payload)
    assert client.post(endpoint, content=body, headers=headers).status_code == 422

    payload.update(event_id="evt-paid", amount="900.00")
    body, headers = _signed_event(payload)
    first = client.post(endpoint, content=body, headers=headers)
    replay = client.post(endpoint, content=body, headers=headers)
    assert first.status_code == 200 and first.json()["data"]["status"] == "paid"
    assert replay.status_code == 200 and "already processed" in replay.json()["message"].lower()
    assert client.get("/bills", headers=patient).json()["data"][0]["status"] == "paid"
    assert client.get("/notifications/me", headers=patient).json()["data"][0]["category"] == "payment"

    changed_payload = dict(payload, amount="899.00")
    body, headers = _signed_event(changed_payload)
    assert client.post(endpoint, content=body, headers=headers).status_code == 409
    conflict = dict(payload, status="failed")
    body, headers = _signed_event(conflict)
    assert client.post(endpoint, content=body, headers=headers).status_code == 409


def test_test_payment_webhook_is_off_in_production(client, monkeypatch):
    monkeypatch.setattr(settings, "ENV", "prod")
    try:
        assert client.post("/payments/webhook/test", content=b"{}",
                           headers={"X-Payment-Signature": "anything"}).status_code == 404
    finally:
        monkeypatch.setattr(settings, "ENV", "test")
