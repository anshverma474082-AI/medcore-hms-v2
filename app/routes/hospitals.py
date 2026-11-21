from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from .. import models
from ..audit import audit
from ..database import get_db
from ..deps import require_roles, get_current_user
from ..responses import ApiError, ok
from ..roles import Role
from ..security import hash_password

router = APIRouter(tags=["hospitals"])


class HospitalIn(BaseModel):
    name: str = Field(min_length=1)
    code: str = Field(pattern=r"^[A-Z0-9-]{3,20}$")
    admin_name: str
    admin_email: EmailStr
    admin_password: str = Field(min_length=8)


class DeptIn(BaseModel):
    name: str = Field(min_length=1)


def h_out(h):
    return {"id": h.id, "name": h.name, "code": h.code, "verified": h.verified}


@router.post("/hospitals", status_code=201)
def create_hospital(d: HospitalIn, request: Request, db: Session = Depends(get_db),
                    sa=Depends(require_roles(Role.SUPER_ADMIN))):
    if db.query(models.Hospital).filter_by(code=d.code).first():
        raise ApiError(400, "CODE_TAKEN", "Hospital code already used")
    if db.query(models.User).filter_by(email=d.admin_email.lower()).first():
        raise ApiError(400, "EMAIL_TAKEN", "Admin email already registered")
    h = models.Hospital(name=d.name, code=d.code)
    db.add(h)
    db.flush()
    admin = models.User(name=d.admin_name, email=d.admin_email.lower(), password_hash=hash_password(d.admin_password),
                        role=Role.HOSPITAL_ADMIN.value, hospital_id=h.id, email_verified=True)
    db.add(admin)
    audit(db, sa, "CREATE", "Hospital", h.id, request, hospital_id=h.id)
    db.commit()
    return ok(h_out(h), "Hospital created; verify it to open registration")


@router.post("/hospitals/{hid}/verify")
def verify_hospital(hid: int, request: Request, db: Session = Depends(get_db),
                    sa=Depends(require_roles(Role.SUPER_ADMIN))):
    h = db.get(models.Hospital, hid)
    if not h:
        raise ApiError(404, "NOT_FOUND", "Hospital not found")
    h.verified = True
    audit(db, sa, "VERIFY", "Hospital", h.id, request, hospital_id=h.id)
    db.commit()
    return ok(h_out(h), "Hospital verified")


@router.get("/hospitals")
def list_hospitals(db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Hospital)
    if user.role != Role.SUPER_ADMIN.value:
        q = q.filter_by(id=user.hospital_id)
    return ok([h_out(h) for h in q.all()])


@router.get("/hospitals/{hid}/departments")
def list_departments(hid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.role != Role.SUPER_ADMIN.value and user.hospital_id != hid:
        raise ApiError(404, "NOT_FOUND", "Hospital not found")  # 404, not 403: do not reveal other tenants
    rows = db.query(models.Department).filter_by(hospital_id=hid).all()
    return ok([{"id": x.id, "name": x.name} for x in rows])


@router.post("/departments", status_code=201)
def create_department(d: DeptIn, request: Request, db: Session = Depends(get_db),
                      admin=Depends(require_roles(Role.HOSPITAL_ADMIN))):
    if db.query(models.Department).filter_by(hospital_id=admin.hospital_id, name=d.name).first():
        raise ApiError(400, "DEPARTMENT_EXISTS", "Department already exists")
    dep = models.Department(hospital_id=admin.hospital_id, name=d.name)
    db.add(dep)
    db.flush()
    audit(db, admin, "CREATE", "Department", dep.id, request)
    db.commit()
    return ok({"id": dep.id, "name": dep.name})
