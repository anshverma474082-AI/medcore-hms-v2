from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..audit import audit
from ..database import get_db
from ..deps import get_current_user, require_roles
from ..responses import ApiError, ok, page_meta
from ..roles import Role

router = APIRouter(tags=["clinical care"])

APPOINTMENT_VIEW_ROLES = (Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN, Role.DOCTOR,
                          Role.NURSE, Role.RECEPTIONIST, Role.PATIENT)
BILL_STAFF_ROLES = (Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN, Role.RECEPTIONIST, Role.ACCOUNTANT)
ACTIVE_APPOINTMENT_STATUSES = ("pending", "confirmed", "in_progress")


class AvailabilityIn(BaseModel):
    weekday: int = Field(ge=0, le=6, description="UTC weekday; Monday=0 through Sunday=6")
    start_time: time = Field(description="UTC start time")
    end_time: time = Field(description="UTC end time")
    slot_minutes: int = Field(default=30, ge=10, le=180)


class AppointmentStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class AppointmentIn(BaseModel):
    doctor_id: int = Field(gt=0)
    scheduled_at: datetime = Field(description="ISO-8601 time; naive values are interpreted as UTC")
    reason: str = Field(default="", max_length=500)
    patient_id: Optional[int] = Field(default=None, gt=0)


class AppointmentStatusIn(BaseModel):
    status: AppointmentStatus


class MedicalRecordIn(BaseModel):
    chief_complaint: str = Field(default="", max_length=500)
    symptoms: str = Field(default="", max_length=5000)
    diagnosis: str = Field(min_length=1, max_length=5000)
    treatment_plan: str = Field(default="", max_length=5000)
    allergies: str = Field(default="", max_length=2000)
    blood_pressure: str = Field(default="", max_length=32)
    pulse_bpm: Optional[int] = Field(default=None, ge=20, le=250)
    temperature_c: Optional[Decimal] = Field(default=None, ge=25, le=45)
    spo2_percent: Optional[int] = Field(default=None, ge=50, le=100)
    weight_kg: Optional[Decimal] = Field(default=None, gt=0, le=500)


class PrescriptionItemIn(BaseModel):
    medicine_name: str = Field(min_length=1, max_length=200)
    dosage: str = Field(min_length=1, max_length=120)
    frequency: str = Field(min_length=1, max_length=120)
    duration: str = Field(min_length=1, max_length=120)
    instructions: str = Field(default="", max_length=500)


class PrescriptionIn(BaseModel):
    instructions: str = Field(default="", max_length=2000)
    items: list[PrescriptionItemIn] = Field(min_length=1, max_length=20)


class BillIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")
    description: str = Field(default="Consultation", min_length=1, max_length=500)


class BillStatusIn(BaseModel):
    status: str = Field(pattern=r"^(paid|unpaid)$")


def _patient_for_user(db: Session, user: models.User) -> models.Patient:
    patient = db.query(models.Patient).filter_by(user_id=user.id, hospital_id=user.hospital_id,
                                                  deleted_at=None).first()
    if not patient:
        raise ApiError(404, "NOT_FOUND", "Patient profile not found")
    return patient


def _doctor_for_user(db: Session, user: models.User) -> models.Doctor:
    doctor = db.query(models.Doctor).filter_by(user_id=user.id, hospital_id=user.hospital_id,
                                                deleted_at=None).first()
    if not doctor:
        raise ApiError(404, "NOT_FOUND", "Doctor profile not found")
    return doctor


def _tenant_for_query(user: models.User, hospital_id: Optional[int]) -> int:
    if user.role == Role.SUPER_ADMIN.value:
        if hospital_id is None:
            raise ApiError(400, "HOSPITAL_REQUIRED", "hospital_id is required for super admin")
        return hospital_id
    return user.hospital_id


def _appointment_for_user(db: Session, appointment_id: int, user: models.User) -> models.Appointment:
    appointment = db.get(models.Appointment, appointment_id)
    if not appointment:
        raise ApiError(404, "NOT_FOUND", "Appointment not found")
    if user.role == Role.SUPER_ADMIN.value:
        return appointment
    if appointment.hospital_id != user.hospital_id:
        raise ApiError(404, "NOT_FOUND", "Appointment not found")
    if user.role == Role.PATIENT.value and appointment.patient_id != _patient_for_user(db, user).id:
        raise ApiError(404, "NOT_FOUND", "Appointment not found")
    if user.role == Role.DOCTOR.value and appointment.doctor_id != _doctor_for_user(db, user).id:
        raise ApiError(404, "NOT_FOUND", "Appointment not found")
    return appointment


def _availability_out(row: models.DoctorAvailability) -> dict:
    return {"id": row.id, "doctorId": row.doctor_id, "weekday": row.weekday,
            "startTime": row.start_time.isoformat(), "endTime": row.end_time.isoformat(),
            "slotMinutes": row.slot_minutes, "active": row.active}


def _appointment_out(row: models.Appointment) -> dict:
    return {"id": row.id, "hospitalId": row.hospital_id, "patientId": row.patient_id,
            "doctorId": row.doctor_id, "scheduledAt": row.starts_at.isoformat() + "Z",
            "endsAt": row.ends_at.isoformat() + "Z", "status": row.status,
            "reason": row.reason, "createdAt": row.created_at.isoformat() + "Z"}


def _record_out(row: models.MedicalRecord) -> dict:
    return {"id": row.id, "appointmentId": row.appointment_id, "hospitalId": row.hospital_id,
            "patientId": row.patient_id, "doctorId": row.doctor_id,
            "chiefComplaint": row.chief_complaint, "symptoms": row.symptoms,
            "diagnosis": row.diagnosis, "treatmentPlan": row.treatment_plan,
            "allergies": row.allergies, "bloodPressure": row.blood_pressure,
            "pulseBpm": row.pulse_bpm,
            "temperatureC": float(row.temperature_c) if row.temperature_c is not None else None,
            "spo2Percent": row.spo2_percent,
            "weightKg": float(row.weight_kg) if row.weight_kg is not None else None,
            "createdAt": row.created_at.isoformat() + "Z"}


def _bill_out(row: models.Bill) -> dict:
    return {"id": row.id, "hospitalId": row.hospital_id, "appointmentId": row.appointment_id,
            "patientId": row.patient_id, "amount": format(row.amount, ".2f"),
            "currency": row.currency, "description": row.description, "status": row.status,
            "createdAt": row.created_at.isoformat() + "Z",
            "paidAt": row.paid_at.isoformat() + "Z" if row.paid_at else None}


def _prescription_out(db: Session, row: models.Prescription) -> dict:
    items = (db.query(models.PrescriptionItem).filter_by(prescription_id=row.id)
             .order_by(models.PrescriptionItem.id).all())
    return {"id": row.id, "hospitalId": row.hospital_id, "appointmentId": row.appointment_id,
            "patientId": row.patient_id,
            "doctorId": row.doctor_id, "instructions": row.instructions,
            "items": [{"id": item.id, "medicineName": item.medicine_name, "dosage": item.dosage,
                       "frequency": item.frequency, "duration": item.duration,
                       "instructions": item.instructions} for item in items],
            "createdAt": row.created_at.isoformat() + "Z"}


@router.post("/doctors/{doctor_id}/availability", status_code=201)
def create_availability(doctor_id: int, d: AvailabilityIn, request: Request,
                        db: Session = Depends(get_db),
                        user: models.User = Depends(require_roles(Role.HOSPITAL_ADMIN, Role.DOCTOR))):
    if d.start_time >= d.end_time:
        raise ApiError(422, "INVALID_AVAILABILITY", "end_time must be later than start_time")
    if user.role == Role.DOCTOR.value:
        doctor = _doctor_for_user(db, user)
        if doctor.id != doctor_id:
            raise ApiError(404, "NOT_FOUND", "Doctor not found")
    else:
        doctor = db.query(models.Doctor).filter_by(id=doctor_id, hospital_id=user.hospital_id,
                                                    deleted_at=None).first()
        if not doctor:
            raise ApiError(404, "NOT_FOUND", "Doctor not found")
    blocks = db.query(models.DoctorAvailability).filter_by(
        doctor_id=doctor.id, weekday=d.weekday, active=True).all()
    if any(block.start_time < d.end_time and block.end_time > d.start_time for block in blocks):
        raise ApiError(409, "AVAILABILITY_OVERLAP", "Availability blocks cannot overlap")
    row = models.DoctorAvailability(hospital_id=doctor.hospital_id, doctor_id=doctor.id,
                                    weekday=d.weekday, start_time=d.start_time,
                                    end_time=d.end_time, slot_minutes=d.slot_minutes)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "AVAILABILITY_OVERLAP", "Availability block already exists")
    audit(db, user, "CREATE", "DoctorAvailability", row.id, request)
    db.commit()
    return ok(_availability_out(row), "Availability created")


@router.get("/doctors/{doctor_id}/availability")
def list_availability(doctor_id: int, db: Session = Depends(get_db),
                      user: models.User = Depends(get_current_user)):
    doctor = db.query(models.Doctor).filter_by(id=doctor_id, deleted_at=None).first()
    if not doctor or (user.role != Role.SUPER_ADMIN.value and doctor.hospital_id != user.hospital_id):
        raise ApiError(404, "NOT_FOUND", "Doctor not found")
    rows = (db.query(models.DoctorAvailability).filter_by(doctor_id=doctor_id, active=True)
            .order_by(models.DoctorAvailability.weekday, models.DoctorAvailability.start_time).all())
    return ok([_availability_out(row) for row in rows])


@router.post("/appointments", status_code=201)
def create_appointment(d: AppointmentIn, request: Request, db: Session = Depends(get_db),
                       user: models.User = Depends(require_roles(Role.PATIENT, Role.HOSPITAL_ADMIN,
                                                                  Role.RECEPTIONIST))):
    if user.role == Role.PATIENT.value:
        patient = _patient_for_user(db, user)
    else:
        if d.patient_id is None:
            raise ApiError(422, "PATIENT_REQUIRED", "patient_id is required for staff booking")
        patient = db.query(models.Patient).filter_by(id=d.patient_id, hospital_id=user.hospital_id,
                                                     deleted_at=None).first()
        if not patient:
            raise ApiError(404, "NOT_FOUND", "Patient not found")
    doctor = db.query(models.Doctor).filter_by(id=d.doctor_id, hospital_id=patient.hospital_id,
                                                deleted_at=None).first()
    if not doctor:
        raise ApiError(404, "NOT_FOUND", "Doctor not found")
    doctor_user = db.get(models.User, doctor.user_id)
    if not doctor_user or not doctor_user.is_active or doctor_user.deleted_at:
        raise ApiError(404, "NOT_FOUND", "Doctor not found")
    starts_at = d.scheduled_at
    if starts_at.tzinfo:
        starts_at = starts_at.astimezone(timezone.utc).replace(tzinfo=None)
    if starts_at <= models.utcnow() or starts_at.second or starts_at.microsecond:
        raise ApiError(422, "INVALID_TIME", "Appointment must be a future minute-aligned time")
    day_blocks = db.query(models.DoctorAvailability).filter_by(
        doctor_id=doctor.id, weekday=starts_at.weekday(), active=True).all()
    time_blocks = [block for block in day_blocks
                   if block.start_time <= starts_at.time() < block.end_time]
    if not time_blocks:
        raise ApiError(409, "SLOT_UNAVAILABLE", "Doctor is not available at this time")
    block = time_blocks[0]
    offset = (starts_at.hour * 60 + starts_at.minute) - (block.start_time.hour * 60 + block.start_time.minute)
    if offset < 0 or offset % block.slot_minutes:
        raise ApiError(409, "SLOT_UNAVAILABLE", "Time does not match an available appointment slot")
    ends_at = starts_at + timedelta(minutes=block.slot_minutes)
    block_end = datetime.combine(starts_at.date(), block.end_time)
    if ends_at > block_end:
        raise ApiError(409, "SLOT_UNAVAILABLE", "Appointment would extend beyond availability")
    collision = db.query(models.Appointment).filter(
        models.Appointment.status != "cancelled",
        models.Appointment.starts_at < ends_at,
        models.Appointment.ends_at > starts_at,
        or_(models.Appointment.doctor_id == doctor.id,
            models.Appointment.patient_id == patient.id)).first()
    if collision:
        raise ApiError(409, "SLOT_TAKEN", "Doctor or patient already has an appointment at this time")
    row = models.Appointment(hospital_id=patient.hospital_id, patient_id=patient.id,
                             doctor_id=doctor.id, starts_at=starts_at, ends_at=ends_at,
                             status="pending" if user.role == Role.PATIENT.value else "confirmed",
                             reason=d.reason)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "SLOT_TAKEN", "Doctor or patient already has an appointment at this time")
    audit(db, user, "CREATE", "Appointment", row.id, request, hospital_id=row.hospital_id)
    db.commit()
    return ok(_appointment_out(row), "Appointment booked")


@router.get("/appointments")
def list_appointments(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                      hospital_id: Optional[int] = None, db: Session = Depends(get_db),
                      user: models.User = Depends(require_roles(*APPOINTMENT_VIEW_ROLES))):
    q = db.query(models.Appointment)
    if user.role == Role.PATIENT.value:
        q = q.filter_by(patient_id=_patient_for_user(db, user).id)
    elif user.role == Role.DOCTOR.value:
        q = q.filter_by(doctor_id=_doctor_for_user(db, user).id)
    else:
        q = q.filter_by(hospital_id=_tenant_for_query(user, hospital_id))
    total = q.count()
    rows = q.order_by(models.Appointment.starts_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return ok([_appointment_out(row) for row in rows], meta=page_meta(page, limit, total))


@router.get("/appointments/{appointment_id}")
def get_appointment(appointment_id: int, db: Session = Depends(get_db),
                    user: models.User = Depends(require_roles(*APPOINTMENT_VIEW_ROLES))):
    return ok(_appointment_out(_appointment_for_user(db, appointment_id, user)))


@router.patch("/appointments/{appointment_id}/cancel")
def cancel_appointment(appointment_id: int, request: Request, db: Session = Depends(get_db),
                       user: models.User = Depends(require_roles(Role.PATIENT, Role.HOSPITAL_ADMIN,
                                                                  Role.RECEPTIONIST))):
    appointment = _appointment_for_user(db, appointment_id, user)
    if appointment.status not in ("pending", "confirmed"):
        raise ApiError(409, "INVALID_TRANSITION", "Only pending or confirmed appointments can be cancelled")
    appointment.status = "cancelled"
    audit(db, user, "CANCEL", "Appointment", appointment.id, request)
    db.commit()
    return ok(_appointment_out(appointment), "Appointment cancelled")


@router.patch("/appointments/{appointment_id}/status")
def update_appointment_status(appointment_id: int, d: AppointmentStatusIn, request: Request,
                             db: Session = Depends(get_db),
                             user: models.User = Depends(require_roles(Role.HOSPITAL_ADMIN,
                                                                        Role.RECEPTIONIST, Role.DOCTOR))):
    appointment = _appointment_for_user(db, appointment_id, user)
    transitions = {
        "pending": {"confirmed", "cancelled"},
        "confirmed": {"in_progress", "cancelled"},
        "in_progress": {"completed"},
        "completed": set(),
        "cancelled": set(),
    }
    if d.status.value not in transitions[appointment.status]:
        raise ApiError(409, "INVALID_TRANSITION", f"Cannot change {appointment.status} to {d.status.value}")
    if user.role == Role.DOCTOR.value and d.status.value not in ("in_progress", "completed"):
        raise ApiError(403, "FORBIDDEN", "Doctors may only start or complete their appointments")
    appointment.status = d.status.value
    audit(db, user, "STATUS_CHANGE", "Appointment", appointment.id, request)
    db.commit()
    return ok(_appointment_out(appointment), "Appointment status updated")


@router.post("/appointments/{appointment_id}/records", status_code=201)
def create_medical_record(appointment_id: int, d: MedicalRecordIn, request: Request,
                          db: Session = Depends(get_db),
                          doctor_user: models.User = Depends(require_roles(Role.DOCTOR))):
    appointment = _appointment_for_user(db, appointment_id, doctor_user)
    if appointment.status not in ("confirmed", "in_progress", "completed"):
        raise ApiError(409, "APPOINTMENT_NOT_READY", "Confirm the appointment before recording the visit")
    if db.query(models.MedicalRecord).filter_by(appointment_id=appointment.id).first():
        raise ApiError(409, "RECORD_EXISTS", "A medical record already exists for this appointment")
    row = models.MedicalRecord(hospital_id=appointment.hospital_id, appointment_id=appointment.id,
                               patient_id=appointment.patient_id, doctor_id=appointment.doctor_id, **d.model_dump())
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "RECORD_EXISTS", "A medical record already exists for this appointment")
    audit(db, doctor_user, "CREATE", "MedicalRecord", row.id, request)
    db.commit()
    return ok(_record_out(row), "Medical record created")


@router.get("/records")
def list_records(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                 hospital_id: Optional[int] = None, db: Session = Depends(get_db),
                 user: models.User = Depends(require_roles(*APPOINTMENT_VIEW_ROLES))):
    q = db.query(models.MedicalRecord)
    if user.role == Role.PATIENT.value:
        q = q.filter_by(patient_id=_patient_for_user(db, user).id)
    elif user.role == Role.DOCTOR.value:
        q = q.filter_by(doctor_id=_doctor_for_user(db, user).id)
    else:
        q = q.filter_by(hospital_id=_tenant_for_query(user, hospital_id))
    total = q.count()
    rows = q.order_by(models.MedicalRecord.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return ok([_record_out(row) for row in rows], meta=page_meta(page, limit, total))


@router.get("/records/{record_id}")
def get_medical_record(record_id: int, db: Session = Depends(get_db),
                       user: models.User = Depends(require_roles(*APPOINTMENT_VIEW_ROLES))):
    row = db.get(models.MedicalRecord, record_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Medical record not found")
    _appointment_for_user(db, row.appointment_id, user)
    return ok(_record_out(row))


@router.post("/appointments/{appointment_id}/prescriptions", status_code=201)
def create_prescription(appointment_id: int, d: PrescriptionIn, request: Request,
                        db: Session = Depends(get_db),
                        doctor_user: models.User = Depends(require_roles(Role.DOCTOR))):
    appointment = _appointment_for_user(db, appointment_id, doctor_user)
    if not db.query(models.MedicalRecord).filter_by(appointment_id=appointment.id).first():
        raise ApiError(409, "RECORD_REQUIRED", "Create the medical record before the prescription")
    if db.query(models.Prescription).filter_by(appointment_id=appointment.id).first():
        raise ApiError(409, "PRESCRIPTION_EXISTS", "A prescription already exists for this appointment")
    row = models.Prescription(hospital_id=appointment.hospital_id, appointment_id=appointment.id,
                              patient_id=appointment.patient_id, doctor_id=appointment.doctor_id,
                              instructions=d.instructions)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "PRESCRIPTION_EXISTS", "A prescription already exists for this appointment")
    items = [models.PrescriptionItem(prescription_id=row.id, **item.model_dump()) for item in d.items]
    db.add_all(items)
    audit(db, doctor_user, "CREATE", "Prescription", row.id, request)
    db.commit()
    return ok(_prescription_out(db, row), "Prescription created")


@router.get("/prescriptions/{prescription_id}")
def get_prescription(prescription_id: int, db: Session = Depends(get_db),
                     user: models.User = Depends(require_roles(*APPOINTMENT_VIEW_ROLES))):
    row = db.get(models.Prescription, prescription_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Prescription not found")
    _appointment_for_user(db, row.appointment_id, user)
    return ok(_prescription_out(db, row))


@router.get("/prescriptions")
def list_prescriptions(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                       hospital_id: Optional[int] = None, db: Session = Depends(get_db),
                       user: models.User = Depends(require_roles(Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN,
                           Role.DOCTOR, Role.PATIENT, Role.PHARMACIST))):
    q = db.query(models.Prescription)
    if user.role == Role.PATIENT.value:
        q = q.filter_by(patient_id=_patient_for_user(db, user).id)
    elif user.role == Role.DOCTOR.value:
        q = q.filter_by(doctor_id=_doctor_for_user(db, user).id)
    else:
        q = q.filter_by(hospital_id=_tenant_for_query(user, hospital_id))
    total = q.count()
    rows = q.order_by(models.Prescription.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return ok([_prescription_out(db, row) for row in rows], meta=page_meta(page, limit, total))


@router.post("/appointments/{appointment_id}/bill", status_code=201)
def create_bill(appointment_id: int, d: BillIn, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(require_roles(*BILL_STAFF_ROLES))):
    appointment = _appointment_for_user(db, appointment_id, user)
    if db.query(models.Bill).filter_by(appointment_id=appointment.id).first():
        raise ApiError(409, "BILL_EXISTS", "A bill already exists for this appointment")
    row = models.Bill(hospital_id=appointment.hospital_id, appointment_id=appointment.id,
                      patient_id=appointment.patient_id, amount=d.amount, currency=d.currency,
                      description=d.description)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "BILL_EXISTS", "A bill already exists for this appointment")
    audit(db, user, "CREATE", "Bill", row.id, request)
    db.commit()
    return ok(_bill_out(row), "Bill created")


@router.get("/bills")
def list_bills(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
               hospital_id: Optional[int] = None, db: Session = Depends(get_db),
               user: models.User = Depends(require_roles(Role.PATIENT, *BILL_STAFF_ROLES))):
    q = db.query(models.Bill)
    if user.role == Role.PATIENT.value:
        q = q.filter_by(patient_id=_patient_for_user(db, user).id)
    else:
        q = q.filter_by(hospital_id=_tenant_for_query(user, hospital_id))
    total = q.count()
    rows = q.order_by(models.Bill.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return ok([_bill_out(row) for row in rows], meta=page_meta(page, limit, total))


@router.patch("/bills/{bill_id}/status")
def update_bill_status(bill_id: int, d: BillStatusIn, request: Request, db: Session = Depends(get_db),
                       user: models.User = Depends(require_roles(*BILL_STAFF_ROLES))):
    bill = db.query(models.Bill).filter_by(id=bill_id).first()
    if not bill or (user.role != Role.SUPER_ADMIN.value and bill.hospital_id != user.hospital_id):
        raise ApiError(404, "NOT_FOUND", "Bill not found")
    bill.status = d.status
    bill.paid_at = models.utcnow() if d.status == "paid" else None
    audit(db, user, "STATUS_CHANGE", "Bill", bill.id, request)
    db.commit()
    return ok(_bill_out(bill), "Bill status updated")
