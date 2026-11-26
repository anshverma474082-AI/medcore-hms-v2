"""Lab, pharmacy, test-payment and notification workflows for the demo API."""
import hashlib
import hmac
import json
from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..audit import audit
from ..config import settings
from ..database import get_db
from ..deps import get_current_user, require_roles
from ..responses import ApiError, ok, page_meta
from ..roles import Role

router = APIRouter(tags=["hospital operations"])


class LabOrderIn(BaseModel):
    test_name: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=2000)


class LabResultIn(BaseModel):
    result_text: str = Field(min_length=1, max_length=12000)


class MedicineIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sku: str = Field(min_length=1, max_length=80)
    category: str = Field(default="General", max_length=120)
    unit: str = Field(default="unit", min_length=1, max_length=40)
    reorder_level: int = Field(default=0, ge=0, le=1000000)


class BatchIn(BaseModel):
    batch_number: str = Field(min_length=1, max_length=100)
    expiry_date: date
    quantity: int = Field(gt=0, le=10000000)
    unit_cost: Decimal = Field(ge=0, max_digits=10, decimal_places=2)


class DispenseLineIn(BaseModel):
    prescription_item_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=1000000)


class DispenseIn(BaseModel):
    items: list[DispenseLineIn] = Field(min_length=1, max_length=20)


class PaymentEventIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=200)
    bill_id: int = Field(gt=0)
    status: Literal["paid", "failed"]
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


def _hospital_id(user: models.User, hospital_id: Optional[int] = None) -> int:
    if user.role == Role.SUPER_ADMIN.value:
        if hospital_id is None:
            raise ApiError(400, "HOSPITAL_REQUIRED", "hospital_id is required for super admin")
        return hospital_id
    return user.hospital_id


def _notify(db: Session, hospital_id: int, recipient_id: Optional[int], category: str,
            title: str, body: str = "") -> None:
    if recipient_id:
        db.add(models.Notification(hospital_id=hospital_id, recipient_user_id=recipient_id,
                                   category=category, title=title, body=body))


def _patient(db: Session, patient_id: int, hospital_id: int) -> models.Patient:
    row = db.query(models.Patient).filter_by(id=patient_id, hospital_id=hospital_id,
                                             deleted_at=None).first()
    if not row:
        raise ApiError(404, "NOT_FOUND", "Patient not found")
    return row


def _doctor(db: Session, doctor_id: int, hospital_id: int) -> models.Doctor:
    row = db.query(models.Doctor).filter_by(id=doctor_id, hospital_id=hospital_id,
                                            deleted_at=None).first()
    if not row:
        raise ApiError(404, "NOT_FOUND", "Doctor not found")
    return row


def _lab_order(db: Session, order_id: int, user: models.User) -> models.LabOrder:
    row = db.get(models.LabOrder, order_id)
    if not row or (user.role != Role.SUPER_ADMIN.value and row.hospital_id != user.hospital_id):
        raise ApiError(404, "NOT_FOUND", "Lab order not found")
    if user.role == Role.PATIENT.value:
        patient = db.query(models.Patient).filter_by(user_id=user.id, hospital_id=row.hospital_id,
                                                      deleted_at=None).first()
        if not patient or patient.id != row.patient_id:
            raise ApiError(404, "NOT_FOUND", "Lab order not found")
    elif user.role == Role.DOCTOR.value:
        doctor = db.query(models.Doctor).filter_by(user_id=user.id, hospital_id=row.hospital_id,
                                                   deleted_at=None).first()
        if not doctor or doctor.id != row.doctor_id:
            raise ApiError(404, "NOT_FOUND", "Lab order not found")
    return row


def _lab_out(row: models.LabOrder, reveal_unapproved_result: bool = True) -> dict:
    return {"id": row.id, "hospitalId": row.hospital_id, "appointmentId": row.appointment_id,
            "patientId": row.patient_id, "doctorId": row.doctor_id, "testName": row.test_name,
            "notes": row.notes,
            "resultText": row.result_text if reveal_unapproved_result or row.status == "approved" else "",
            "status": row.status,
            "createdAt": row.created_at.isoformat() + "Z",
            "resultUploadedAt": row.result_uploaded_at.isoformat() + "Z" if row.result_uploaded_at else None,
            "approvedAt": row.approved_at.isoformat() + "Z" if row.approved_at else None}


def _medicine_out(row: models.Medicine, stock: int = 0) -> dict:
    return {"id": row.id, "name": row.name, "sku": row.sku, "category": row.category,
            "unit": row.unit, "reorderLevel": row.reorder_level,
            "availableStock": stock, "lowStock": stock <= row.reorder_level, "active": row.active}


def _bill_for_webhook(db: Session, bill_id: int) -> models.Bill:
    bill = db.get(models.Bill, bill_id)
    if not bill:
        raise ApiError(404, "NOT_FOUND", "Bill not found")
    return bill


@router.post("/appointments/{appointment_id}/lab-orders", status_code=201)
def create_lab_order(appointment_id: int, d: LabOrderIn, request: Request,
                     db: Session = Depends(get_db), user: models.User = Depends(require_roles(Role.DOCTOR))):
    doctor = db.query(models.Doctor).filter_by(user_id=user.id, hospital_id=user.hospital_id,
                                                deleted_at=None).first()
    appointment = db.query(models.Appointment).filter_by(id=appointment_id, hospital_id=user.hospital_id,
                                                          doctor_id=doctor.id if doctor else -1).first()
    if not appointment:
        raise ApiError(404, "NOT_FOUND", "Appointment not found")
    if appointment.status not in ("confirmed", "in_progress", "completed"):
        raise ApiError(409, "APPOINTMENT_NOT_READY", "Confirm the appointment before ordering a test")
    row = models.LabOrder(hospital_id=appointment.hospital_id, appointment_id=appointment.id,
                          patient_id=appointment.patient_id, doctor_id=appointment.doctor_id,
                          test_name=d.test_name.strip(), notes=d.notes, ordered_by=user.id)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "LAB_ORDER_EXISTS", "This test is already ordered for the appointment")
    technicians = db.query(models.User.id).filter_by(hospital_id=user.hospital_id,
                    role=Role.LAB_TECHNICIAN.value, is_active=True, deleted_at=None).all()
    for (recipient_id,) in technicians:
        _notify(db, row.hospital_id, recipient_id, "lab_order", "Lab test ordered",
                f"{row.test_name} is ready for processing.")
    audit(db, user, "CREATE", "LabOrder", row.id, request)
    db.commit()
    return ok(_lab_out(row), "Lab test ordered")


@router.get("/lab-orders")
def list_lab_orders(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                    hospital_id: Optional[int] = None, db: Session = Depends(get_db),
                    user: models.User = Depends(require_roles(Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN,
                        Role.DOCTOR, Role.PATIENT, Role.LAB_TECHNICIAN))):
    q = db.query(models.LabOrder)
    if user.role == Role.PATIENT.value:
        patient = db.query(models.Patient).filter_by(user_id=user.id, hospital_id=user.hospital_id,
                                                      deleted_at=None).first()
        q = q.filter_by(patient_id=patient.id if patient else -1)
    elif user.role == Role.DOCTOR.value:
        doctor = db.query(models.Doctor).filter_by(user_id=user.id, hospital_id=user.hospital_id,
                                                   deleted_at=None).first()
        q = q.filter_by(doctor_id=doctor.id if doctor else -1)
    else:
        q = q.filter_by(hospital_id=_hospital_id(user, hospital_id))
    total = q.count()
    rows = q.order_by(models.LabOrder.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return ok([_lab_out(row, user.role != Role.PATIENT.value) for row in rows],
              meta=page_meta(page, limit, total))


@router.get("/lab-orders/{order_id}")
def get_lab_order(order_id: int, db: Session = Depends(get_db),
                  user: models.User = Depends(require_roles(Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN,
                      Role.DOCTOR, Role.PATIENT, Role.LAB_TECHNICIAN))):
    row = _lab_order(db, order_id, user)
    return ok(_lab_out(row, user.role != Role.PATIENT.value))


@router.patch("/lab-orders/{order_id}/result")
def upload_lab_result(order_id: int, d: LabResultIn, request: Request, db: Session = Depends(get_db),
                      user: models.User = Depends(require_roles(Role.LAB_TECHNICIAN))):
    row = _lab_order(db, order_id, user)
    if row.status != "ordered":
        raise ApiError(409, "INVALID_TRANSITION", "A result can only be uploaded to an ordered test")
    row.result_text = d.result_text.strip()
    row.status = "result_ready"
    row.result_uploaded_by = user.id
    row.result_uploaded_at = models.utcnow()
    patient = _patient(db, row.patient_id, row.hospital_id)
    doctor = _doctor(db, row.doctor_id, row.hospital_id)
    _notify(db, row.hospital_id, patient.user_id, "lab_result", "Lab result available",
            f"A result is ready for {row.test_name}; your doctor will review it.")
    _notify(db, row.hospital_id, doctor.user_id, "lab_result", "Lab result ready for review",
            f"A result is ready for {row.test_name}.")
    audit(db, user, "RESULT_UPLOAD", "LabOrder", row.id, request)
    db.commit()
    return ok(_lab_out(row), "Lab result uploaded for review")


@router.patch("/lab-orders/{order_id}/approve")
def approve_lab_result(order_id: int, request: Request, db: Session = Depends(get_db),
                       user: models.User = Depends(require_roles(Role.DOCTOR, Role.HOSPITAL_ADMIN))):
    row = _lab_order(db, order_id, user)
    if row.status != "result_ready":
        raise ApiError(409, "INVALID_TRANSITION", "Only uploaded results can be approved")
    row.status = "approved"
    row.approved_by = user.id
    row.approved_at = models.utcnow()
    patient = _patient(db, row.patient_id, row.hospital_id)
    _notify(db, row.hospital_id, patient.user_id, "lab_result", "Lab result reviewed",
            f"Your doctor reviewed the result for {row.test_name}.")
    audit(db, user, "RESULT_APPROVE", "LabOrder", row.id, request)
    db.commit()
    return ok(_lab_out(row), "Lab result approved")


@router.post("/medicines", status_code=201)
def create_medicine(d: MedicineIn, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(require_roles(Role.HOSPITAL_ADMIN, Role.PHARMACIST))):
    row = models.Medicine(hospital_id=user.hospital_id, name=d.name.strip(), sku=d.sku.strip(),
                          category=d.category, unit=d.unit, reorder_level=d.reorder_level)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "MEDICINE_EXISTS", "Medicine name and SKU must be unique in this hospital")
    audit(db, user, "CREATE", "Medicine", row.id, request)
    db.commit()
    return ok(_medicine_out(row), "Medicine added")


@router.get("/medicines")
def list_medicines(hospital_id: Optional[int] = None, db: Session = Depends(get_db),
                   user: models.User = Depends(require_roles(Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN,
                                                               Role.PHARMACIST, Role.DOCTOR))):
    tenant = _hospital_id(user, hospital_id)
    today = date.today()
    stock_q = (db.query(models.InventoryBatch.medicine_id,
                        func.coalesce(func.sum(models.InventoryBatch.quantity_remaining), 0).label("stock"))
               .filter(models.InventoryBatch.hospital_id == tenant,
                       models.InventoryBatch.expiry_date >= today,
                       models.InventoryBatch.quantity_remaining > 0)
               .group_by(models.InventoryBatch.medicine_id).subquery())
    rows = (db.query(models.Medicine, func.coalesce(stock_q.c.stock, 0))
            .outerjoin(stock_q, stock_q.c.medicine_id == models.Medicine.id)
            .filter(models.Medicine.hospital_id == tenant, models.Medicine.active.is_(True))
            .order_by(models.Medicine.name).all())
    return ok([_medicine_out(medicine, stock) for medicine, stock in rows])


@router.post("/medicines/{medicine_id}/batches", status_code=201)
def receive_batch(medicine_id: int, d: BatchIn, request: Request, db: Session = Depends(get_db),
                  user: models.User = Depends(require_roles(Role.HOSPITAL_ADMIN, Role.PHARMACIST))):
    medicine = db.query(models.Medicine).filter_by(id=medicine_id, hospital_id=user.hospital_id,
                                                    active=True).first()
    if not medicine:
        raise ApiError(404, "NOT_FOUND", "Medicine not found")
    if d.expiry_date < date.today():
        raise ApiError(422, "EXPIRED_BATCH", "Cannot receive an already expired batch")
    row = models.InventoryBatch(hospital_id=user.hospital_id, medicine_id=medicine.id,
                                batch_number=d.batch_number.strip(), expiry_date=d.expiry_date,
                                quantity_received=d.quantity, quantity_remaining=d.quantity,
                                unit_cost=d.unit_cost)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "BATCH_EXISTS", "Batch number already exists for this medicine")
    audit(db, user, "RECEIVE", "InventoryBatch", row.id, request)
    db.commit()
    return ok({"id": row.id, "medicineId": row.medicine_id, "batchNumber": row.batch_number,
               "expiryDate": row.expiry_date.isoformat(), "quantityRemaining": row.quantity_remaining},
              "Inventory batch received")


@router.post("/prescriptions/{prescription_id}/dispense", status_code=201)
def dispense_prescription(prescription_id: int, d: DispenseIn, request: Request,
                          db: Session = Depends(get_db),
                          user: models.User = Depends(require_roles(Role.PHARMACIST))):
    prescription = db.query(models.Prescription).filter_by(id=prescription_id,
                                                            hospital_id=user.hospital_id).first()
    if not prescription:
        raise ApiError(404, "NOT_FOUND", "Prescription not found")
    if db.query(models.Dispense).filter_by(prescription_id=prescription.id).first():
        raise ApiError(409, "ALREADY_DISPENSED", "This prescription has already been dispensed")
    lines = db.query(models.PrescriptionItem).filter_by(prescription_id=prescription.id).order_by(
        models.PrescriptionItem.id).all()
    requested = {line.prescription_item_id: line.quantity for line in d.items}
    if len(requested) != len(d.items) or set(requested) != {line.id for line in lines}:
        raise ApiError(422, "INVALID_DISPENSE_LINES", "Provide one quantity for every prescription item")

    # Plan all allocations before changing stock. Expired batches are never considered.
    plans = []
    planned_remaining = {}
    today = date.today()
    for line in lines:
        medicine = db.query(models.Medicine).filter(
            models.Medicine.hospital_id == user.hospital_id,
            models.Medicine.active.is_(True),
            func.lower(models.Medicine.name) == line.medicine_name.strip().lower()).first()
        if not medicine:
            raise ApiError(409, "MEDICINE_UNAVAILABLE", f"No active catalog medicine matches {line.medicine_name}")
        batches = (db.query(models.InventoryBatch).filter_by(hospital_id=user.hospital_id,
                    medicine_id=medicine.id).filter(models.InventoryBatch.expiry_date >= today,
                    models.InventoryBatch.quantity_remaining > 0)
                   .order_by(models.InventoryBatch.received_at, models.InventoryBatch.id)
                   .with_for_update().all())
        remaining = requested[line.id]
        for batch in batches:
            available = planned_remaining.setdefault(batch.id, batch.quantity_remaining)
            take = min(remaining, available)
            if take:
                plans.append((line, medicine, batch, take))
                planned_remaining[batch.id] -= take
                remaining -= take
            if remaining == 0:
                break
        if remaining:
            raise ApiError(409, "INSUFFICIENT_STOCK", f"Insufficient unexpired stock for {medicine.name}")

    dispense = models.Dispense(hospital_id=user.hospital_id, prescription_id=prescription.id,
                               patient_id=prescription.patient_id, dispensed_by=user.id)
    db.add(dispense)
    db.flush()
    allocations = []
    try:
        for line, medicine, batch, quantity in plans:
            updated = (db.query(models.InventoryBatch).filter_by(id=batch.id, hospital_id=user.hospital_id)
                       .filter(models.InventoryBatch.quantity_remaining >= quantity)
                       .update({models.InventoryBatch.quantity_remaining:
                                models.InventoryBatch.quantity_remaining - quantity},
                               synchronize_session=False))
            if updated != 1:
                raise ApiError(409, "INSUFFICIENT_STOCK", "Inventory changed; retry the dispense")
            db.add(models.DispensedItem(dispense_id=dispense.id, prescription_item_id=line.id,
                       medicine_id=medicine.id, inventory_batch_id=batch.id, quantity=quantity))
            allocations.append({"prescriptionItemId": line.id, "medicineName": medicine.name,
                                "batchNumber": batch.batch_number, "quantity": quantity})
        patient = _patient(db, prescription.patient_id, user.hospital_id)
        _notify(db, user.hospital_id, patient.user_id, "pharmacy", "Prescription dispensed",
                "Your prescription is ready from the hospital pharmacy.")
        audit(db, user, "DISPENSE", "Prescription", prescription.id, request)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ok({"id": dispense.id, "prescriptionId": prescription.id,
               "patientId": prescription.patient_id, "items": allocations,
               "createdAt": dispense.created_at.isoformat() + "Z"}, "Prescription dispensed")


@router.post("/payments/webhook/test")
async def test_payment_webhook(request: Request, db: Session = Depends(get_db)):
    if settings.ENV == "prod":
        raise ApiError(404, "NOT_FOUND", "Test payment endpoint is disabled")
    raw = await request.body()
    supplied = request.headers.get("X-Payment-Signature", "")
    expected = "sha256=" + hmac.new(settings.PAYMENT_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(supplied, expected):
        raise ApiError(401, "INVALID_SIGNATURE", "Payment signature is invalid")
    try:
        event = PaymentEventIn.model_validate(json.loads(raw))
    except (ValueError, ValidationError):
        raise ApiError(422, "INVALID_EVENT", "Payment event payload is invalid")
    existing = db.query(models.PaymentEvent).filter_by(provider="test",
                                                        external_event_id=event.event_id).first()
    if existing:
        if (existing.bill_id != event.bill_id or existing.outcome != event.status
                or existing.amount != event.amount or existing.currency != event.currency):
            raise ApiError(409, "EVENT_ID_CONFLICT", "Event ID was already used for different payment data")
        return ok({"eventId": event.event_id, "billId": existing.bill_id, "status": existing.outcome},
                  "Payment event already processed")
    bill = _bill_for_webhook(db, event.bill_id)
    if bill.amount != event.amount or bill.currency != event.currency:
        raise ApiError(422, "PAYMENT_MISMATCH", "Payment amount or currency does not match the bill")
    if bill.status == "paid" and event.status == "failed":
        raise ApiError(409, "PAYMENT_CONFLICT", "A paid bill cannot be changed to failed")
    now = models.utcnow()
    if event.status == "paid":
        bill.status = "paid"
        bill.paid_at = bill.paid_at or now
    payment = models.PaymentEvent(hospital_id=bill.hospital_id, bill_id=bill.id,
                                  external_event_id=event.event_id, outcome=event.status,
                                  amount=event.amount, currency=event.currency)
    db.add(payment)
    patient = _patient(db, bill.patient_id, bill.hospital_id)
    _notify(db, bill.hospital_id, patient.user_id, "payment", "Payment update",
            "Your bill payment was successful." if event.status == "paid" else "Your bill payment did not complete.")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(models.PaymentEvent).filter_by(provider="test",
                                                            external_event_id=event.event_id).first()
        if (existing and existing.bill_id == event.bill_id and existing.outcome == event.status
                and existing.amount == event.amount and existing.currency == event.currency):
            return ok({"eventId": event.event_id, "billId": existing.bill_id,
                       "status": existing.outcome}, "Payment event already processed")
        raise ApiError(409, "EVENT_ID_CONFLICT", "Event ID was already processed")
    return ok({"eventId": event.event_id, "billId": bill.id, "status": bill.status},
              "Payment event processed")


@router.get("/notifications/me")
def list_notifications(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                       db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    q = db.query(models.Notification).filter_by(recipient_user_id=user.id)
    total = q.count()
    rows = q.order_by(models.Notification.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return ok([{"id": row.id, "category": row.category, "title": row.title, "body": row.body,
                "readAt": row.read_at.isoformat() + "Z" if row.read_at else None,
                "createdAt": row.created_at.isoformat() + "Z"} for row in rows],
              meta=page_meta(page, limit, total))


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, db: Session = Depends(get_db),
                            user: models.User = Depends(get_current_user)):
    row = db.query(models.Notification).filter_by(id=notification_id,
                                                   recipient_user_id=user.id).first()
    if not row:
        raise ApiError(404, "NOT_FOUND", "Notification not found")
    row.read_at = row.read_at or models.utcnow()
    db.commit()
    return ok({"id": row.id, "readAt": row.read_at.isoformat() + "Z"}, "Notification marked as read")
