from datetime import datetime, time, timedelta, timezone

from app import mail
from tests.conftest import login, make_hospital


def setup_clinic(client, suffix="a"):
    hospital_id = make_hospital(client, f"HOSP-{suffix.upper()}", f"admin@{suffix}.example")
    admin = login(client, f"admin@{suffix}.example", "password123")
    department = client.post("/departments", headers=admin, json={"name": "General Medicine"})
    assert department.status_code == 201, department.text
    staff = client.post("/users", headers=admin, json={
        "name": "Dr Smith", "email": f"doctor@{suffix}.example", "password": "password123",
        "role": "doctor", "department_id": department.json()["data"]["id"],
        "specialisation": "General Medicine",
    })
    assert staff.status_code == 201, staff.text
    doctor = client.get("/doctors", headers=admin).json()["data"][0]
    appointment_date = datetime.now(timezone.utc).date() + timedelta(days=2)
    available = client.post(f"/doctors/{doctor['id']}/availability", headers=admin, json={
        "weekday": appointment_date.weekday(), "start_time": "09:00", "end_time": "12:00",
        "slot_minutes": 30,
    })
    assert available.status_code == 201, available.text
    registered = client.post("/auth/register", json={
        "name": "Pat Example", "email": f"patient@{suffix}.example", "password": "password123",
        "hospital_code": f"HOSP-{suffix.upper()}",
    })
    assert registered.status_code == 201, registered.text
    verified = client.post("/auth/verify-email", json={
        "email": f"patient@{suffix}.example", "otp": mail.outbox[-1]["code"],
    })
    assert verified.status_code == 200, verified.text
    patient = login(client, f"patient@{suffix}.example", "password123")
    doctor_headers = login(client, f"doctor@{suffix}.example", "password123")
    starts_at = datetime.combine(appointment_date, time(9, 0), tzinfo=timezone.utc)
    return hospital_id, admin, doctor, doctor_headers, patient, starts_at


def book(client, doctor, patient, starts_at):
    return client.post("/appointments", headers=patient, json={
        "doctor_id": doctor["id"], "scheduled_at": starts_at.isoformat(),
        "reason": "Routine checkup",
    })


def test_patient_to_doctor_to_bill_workflow(client):
    _, admin, doctor, doctor_headers, patient, starts_at = setup_clinic(client)

    profile = client.get("/doctors/me", headers=doctor_headers)
    assert profile.status_code == 200 and profile.json()["data"]["id"] == doctor["id"]

    booked = book(client, doctor, patient, starts_at)
    assert booked.status_code == 201, booked.text
    appointment = booked.json()["data"]
    assert appointment["status"] == "pending"
    assert client.get("/appointments", headers=patient).json()["data"][0]["id"] == appointment["id"]
    assert book(client, doctor, patient, starts_at).status_code == 409  # no double booking

    confirmed = client.patch(f"/appointments/{appointment['id']}/status", headers=admin,
                             json={"status": "confirmed"})
    assert confirmed.status_code == 200 and confirmed.json()["data"]["status"] == "confirmed"
    started = client.patch(f"/appointments/{appointment['id']}/status", headers=doctor_headers,
                           json={"status": "in_progress"})
    assert started.status_code == 200 and started.json()["data"]["status"] == "in_progress"

    record_response = client.post(f"/appointments/{appointment['id']}/records", headers=doctor_headers,
                                  json={"chief_complaint": "Headache", "symptoms": "Mild headache",
                                        "diagnosis": "Tension headache", "treatment_plan": "Rest and fluids",
                                        "allergies": "None", "pulse_bpm": 72, "spo2_percent": 98})
    assert record_response.status_code == 201, record_response.text
    record = record_response.json()["data"]
    assert record["diagnosis"] == "Tension headache"
    assert client.get(f"/records/{record['id']}", headers=patient).status_code == 200
    assert client.post(f"/appointments/{appointment['id']}/records", headers=doctor_headers,
                       json={"diagnosis": "Duplicate"}).status_code == 409

    rx_response = client.post(f"/appointments/{appointment['id']}/prescriptions", headers=doctor_headers,
                              json={"instructions": "Take after food", "items": [{
                                  "medicine_name": "Example medicine", "dosage": "1 tablet",
                                  "frequency": "Twice daily", "duration": "5 days",
                              }]})
    assert rx_response.status_code == 201, rx_response.text
    rx = rx_response.json()["data"]
    assert client.get(f"/prescriptions/{rx['id']}", headers=patient).json()["data"]["items"][0]["medicineName"] == "Example medicine"

    invoice = client.post(f"/appointments/{appointment['id']}/bill", headers=admin,
                          json={"amount": "1250.00", "currency": "INR", "description": "Consultation"})
    assert invoice.status_code == 201, invoice.text
    bill = invoice.json()["data"]
    assert bill["status"] == "unpaid"
    assert client.get("/bills", headers=patient).json()["data"][0]["id"] == bill["id"]
    paid = client.patch(f"/bills/{bill['id']}/status", headers=admin, json={"status": "paid"})
    assert paid.status_code == 200 and paid.json()["data"]["status"] == "paid"
    assert paid.json()["data"]["paidAt"]


def test_tenant_cannot_read_another_hospitals_clinical_data(client):
    _, _, doctor_a, _, patient_a, starts_at = setup_clinic(client, "a")
    appointment = book(client, doctor_a, patient_a, starts_at).json()["data"]
    _, _, _, _, patient_b, _ = setup_clinic(client, "b")
    assert client.get(f"/appointments/{appointment['id']}", headers=patient_b).status_code == 404
    assert client.get("/records", headers=patient_b).json()["data"] == []
    assert client.get("/bills", headers=patient_b).json()["data"] == []


def test_patient_cannot_create_records_or_change_appointment_status(client):
    _, _, doctor, _, patient, starts_at = setup_clinic(client)
    appointment = book(client, doctor, patient, starts_at).json()["data"]
    assert client.patch(f"/appointments/{appointment['id']}/status", headers=patient,
                        json={"status": "confirmed"}).status_code == 403
    assert client.post(f"/appointments/{appointment['id']}/records", headers=patient,
                       json={"diagnosis": "Not allowed"}).status_code == 403
    assert client.get("/doctors/me", headers=patient).status_code == 403


def test_cancelled_appointment_releases_doctor_slot(client):
    _, _, doctor, _, patient, starts_at = setup_clinic(client)
    first = book(client, doctor, patient, starts_at)
    assert first.status_code == 201, first.text
    cancelled = client.patch(f"/appointments/{first.json()['data']['id']}/cancel", headers=patient)
    assert cancelled.status_code == 200 and cancelled.json()["data"]["status"] == "cancelled"
    second = book(client, doctor, patient, starts_at)
    assert second.status_code == 201, second.text
