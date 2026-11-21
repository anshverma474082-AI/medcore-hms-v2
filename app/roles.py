from enum import Enum


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    HOSPITAL_ADMIN = "hospital_admin"
    DOCTOR = "doctor"
    NURSE = "nurse"
    RECEPTIONIST = "receptionist"
    LAB_TECHNICIAN = "lab_technician"
    PHARMACIST = "pharmacist"
    ACCOUNTANT = "accountant"
    PATIENT = "patient"


# Roles a hospital admin may create
STAFF_ROLES = {Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST, Role.LAB_TECHNICIAN, Role.PHARMACIST, Role.ACCOUNTANT}
