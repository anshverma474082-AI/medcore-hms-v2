from typing import Optional
from fastapi import APIRouter, Depends, Request, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from .. import models
from ..audit import audit
from ..database import get_db
from ..deps import require_roles, get_current_user, tenant_id
from ..responses import ApiError, ok, page_meta
from ..roles import Role, STAFF_ROLES
from ..security import hash_password
from .auth_routes import user_out

router = APIRouter(tags=["users"])


class StaffIn(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8)
    role: Role
    department_id: Optional[int] = None
    specialisation: str = "General"


@router.post("/users", status_code=201)
def create_staff(d: StaffIn, request: Request, db: Session = Depends(get_db),
                 admin=Depends(require_roles(Role.HOSPITAL_ADMIN))):
    if d.role not in STAFF_ROLES:
        raise ApiError(400, "INVALID_ROLE", "Role must be a staff role")
    if db.query(models.User).filter_by(email=d.email.lower()).first():
        raise ApiError(400, "EMAIL_TAKEN", "Email already registered")
    if d.department_id and not db.query(models.Department).filter_by(id=d.department_id, hospital_id=admin.hospital_id).first():
        raise ApiError(404, "NOT_FOUND", "Department not found")
    u = models.User(name=d.name, email=d.email.lower(), password_hash=hash_password(d.password),
                    role=d.role.value, hospital_id=admin.hospital_id, email_verified=True)
    db.add(u)
    db.flush()
    if d.role == Role.DOCTOR:
        db.add(models.Doctor(user_id=u.id, hospital_id=admin.hospital_id,
                             department_id=d.department_id, specialisation=d.specialisation))
    audit(db, admin, "CREATE", "User", u.id, request)
    db.commit()
    return ok(user_out(u), "Staff member created")


@router.get("/users")
def list_users(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
               hospital_id: Optional[int] = None, db: Session = Depends(get_db),
               user=Depends(require_roles(Role.HOSPITAL_ADMIN, Role.SUPER_ADMIN))):
    q = db.query(models.User).filter(models.User.hospital_id == tenant_id(user, hospital_id),
                                     models.User.deleted_at.is_(None))
    total = q.count()
    rows = q.order_by(models.User.id).offset((page - 1) * limit).limit(limit).all()
    return ok([user_out(u) for u in rows], meta=page_meta(page, limit, total))


@router.get("/users/{uid}")
def get_user(uid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.User).filter(models.User.id == uid, models.User.deleted_at.is_(None))
    if user.role != Role.SUPER_ADMIN.value:
        q = q.filter(models.User.hospital_id == user.hospital_id)  # tenancy
    target = q.first()
    if not target or (user.id != target.id and user.role not in (Role.HOSPITAL_ADMIN.value, Role.SUPER_ADMIN.value)):
        raise ApiError(404, "NOT_FOUND", "User not found")
    return ok(user_out(target))


@router.get("/doctors")
def list_doctors(specialisation: Optional[str] = None, hospital_id: Optional[int] = None,
                 db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Doctor).filter(models.Doctor.hospital_id == tenant_id(user, hospital_id),
                                       models.Doctor.deleted_at.is_(None))
    if specialisation:
        q = q.filter(models.Doctor.specialisation == specialisation)
    out = []
    for dr in q.all():
        u = db.get(models.User, dr.user_id)
        out.append({"id": dr.id, "name": u.name, "specialisation": dr.specialisation, "departmentId": dr.department_id})
    return ok(out)


@router.get("/doctors/me")
def get_my_doctor_profile(db: Session = Depends(get_db),
                          doctor_user=Depends(require_roles(Role.DOCTOR))):
    doctor = db.query(models.Doctor).filter_by(user_id=doctor_user.id,
                                                hospital_id=doctor_user.hospital_id,
                                                deleted_at=None).first()
    if not doctor:
        raise ApiError(404, "NOT_FOUND", "Doctor profile not found")
    return ok({"id": doctor.id, "userId": doctor.user_id, "hospitalId": doctor.hospital_id,
               "name": doctor_user.name, "specialisation": doctor.specialisation,
               "departmentId": doctor.department_id})
