from datetime import datetime, timezone
from sqlalchemy import (Column, Integer, String, ForeignKey, DateTime, Boolean,
                        UniqueConstraint, Index, Time, Numeric, Text, Date)
from .database import Base


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Hospital(Base):
    __tablename__ = "hospitals"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, nullable=False)
    verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("hospital_id", "name"),)
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    name = Column(String, nullable=False)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=True)  # null = super admin
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, index=True)
    email_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    deleted_at = Column(DateTime, nullable=True)  # soft delete
    created_at = Column(DateTime, default=utcnow)


class Doctor(Base):
    __tablename__ = "doctors"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    specialisation = Column(String, default="General", index=True)
    deleted_at = Column(DateTime, nullable=True)


class Patient(Base):
    __tablename__ = "patients"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    phone = Column(String, default="")
    deleted_at = Column(DateTime, nullable=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    jti = Column(String, unique=True, index=True)
    revoked = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)


class EmailOtp(Base):
    __tablename__ = "email_otps"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    code_hash = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=True)
    hospital_id = Column(Integer, nullable=True, index=True)
    action = Column(String, nullable=False)
    entity = Column(String, nullable=False)
    entity_id = Column(Integer, nullable=True)
    ip = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)


class DoctorAvailability(Base):
    __tablename__ = "doctor_availabilities"
    __table_args__ = (UniqueConstraint("doctor_id", "weekday", "start_time", "end_time"),)
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    weekday = Column(Integer, nullable=False)  # Monday=0 through Sunday=6
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    slot_minutes = Column(Integer, default=30, nullable=False)
    active = Column(Boolean, default=True, nullable=False)


class Appointment(Base):
    __tablename__ = "appointments"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    starts_at = Column(DateTime, index=True, nullable=False)  # stored as UTC, without tzinfo
    ends_at = Column(DateTime, nullable=False)
    status = Column(String, default="pending", index=True, nullable=False)
    reason = Column(String(500), default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


# Unique partial indexes make booking races safe and release cancelled slots for reuse.
Index("uq_appointment_doctor_active_start", Appointment.doctor_id, Appointment.starts_at,
      unique=True, sqlite_where=Appointment.status != "cancelled",
      postgresql_where=Appointment.status != "cancelled")
Index("uq_appointment_patient_active_start", Appointment.patient_id, Appointment.starts_at,
      unique=True, sqlite_where=Appointment.status != "cancelled",
      postgresql_where=Appointment.status != "cancelled")


class MedicalRecord(Base):
    __tablename__ = "medical_records"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), unique=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    chief_complaint = Column(String(500), default="", nullable=False)
    symptoms = Column(Text, default="", nullable=False)
    diagnosis = Column(Text, nullable=False)
    treatment_plan = Column(Text, default="", nullable=False)
    allergies = Column(Text, default="", nullable=False)
    blood_pressure = Column(String(32), default="", nullable=False)
    pulse_bpm = Column(Integer, nullable=True)
    temperature_c = Column(Numeric(4, 1), nullable=True)
    spo2_percent = Column(Integer, nullable=True)
    weight_kg = Column(Numeric(5, 2), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Prescription(Base):
    __tablename__ = "prescriptions"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), unique=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    instructions = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class PrescriptionItem(Base):
    __tablename__ = "prescription_items"
    id = Column(Integer, primary_key=True)
    prescription_id = Column(Integer, ForeignKey("prescriptions.id", ondelete="CASCADE"), index=True, nullable=False)
    medicine_name = Column(String(200), nullable=False)
    dosage = Column(String(120), nullable=False)
    frequency = Column(String(120), nullable=False)
    duration = Column(String(120), nullable=False)
    instructions = Column(String(500), default="", nullable=False)


class Bill(Base):
    __tablename__ = "bills"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), unique=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), default="INR", nullable=False)
    description = Column(String(500), default="Consultation", nullable=False)
    status = Column(String(16), default="unpaid", index=True, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    paid_at = Column(DateTime, nullable=True)


class LabOrder(Base):
    __tablename__ = "lab_orders"
    __table_args__ = (UniqueConstraint("appointment_id", "test_name"),)
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), index=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    test_name = Column(String(200), nullable=False)
    notes = Column(Text, default="", nullable=False)
    result_text = Column(Text, default="", nullable=False)
    status = Column(String(20), default="ordered", index=True, nullable=False)
    ordered_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    result_uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    result_uploaded_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)


class Medicine(Base):
    __tablename__ = "medicines"
    __table_args__ = (UniqueConstraint("hospital_id", "sku"),
                      UniqueConstraint("hospital_id", "name"))
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    name = Column(String(200), nullable=False)
    sku = Column(String(80), nullable=False)
    category = Column(String(120), default="General", nullable=False)
    unit = Column(String(40), default="unit", nullable=False)
    reorder_level = Column(Integer, default=0, nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class InventoryBatch(Base):
    __tablename__ = "inventory_batches"
    __table_args__ = (UniqueConstraint("medicine_id", "batch_number"),)
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), index=True, nullable=False)
    batch_number = Column(String(100), nullable=False)
    expiry_date = Column(Date, index=True, nullable=False)
    quantity_received = Column(Integer, nullable=False)
    quantity_remaining = Column(Integer, nullable=False)
    unit_cost = Column(Numeric(10, 2), nullable=False)
    received_at = Column(DateTime, default=utcnow, nullable=False)


class Dispense(Base):
    __tablename__ = "dispenses"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    prescription_id = Column(Integer, ForeignKey("prescriptions.id"), unique=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=False)
    dispensed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class DispensedItem(Base):
    __tablename__ = "dispensed_items"
    id = Column(Integer, primary_key=True)
    dispense_id = Column(Integer, ForeignKey("dispenses.id", ondelete="CASCADE"), index=True, nullable=False)
    prescription_item_id = Column(Integer, ForeignKey("prescription_items.id"), nullable=False)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), index=True, nullable=False)
    inventory_batch_id = Column(Integer, ForeignKey("inventory_batches.id"), nullable=False)
    quantity = Column(Integer, nullable=False)


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    __table_args__ = (UniqueConstraint("provider", "external_event_id"),)
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    bill_id = Column(Integer, ForeignKey("bills.id"), index=True, nullable=False)
    provider = Column(String(40), default="test", nullable=False)
    external_event_id = Column(String(200), nullable=False)
    outcome = Column(String(20), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), nullable=False)
    received_at = Column(DateTime, default=utcnow, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    hospital_id = Column(Integer, ForeignKey("hospitals.id"), index=True, nullable=False)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    category = Column(String(40), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(String(1000), default="", nullable=False)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
