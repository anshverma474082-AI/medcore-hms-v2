from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from .. import models
from ..audit import audit
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..mail import send_otp_email
from ..responses import ApiError, ok
from ..roles import Role
from ..security import (hash_password, verify_password, make_access, make_refresh,
                        rotate_refresh, new_otp, check_otp, decode)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8)
    phone: str = ""
    hospital_code: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class VerifyIn(BaseModel):
    email: EmailStr
    otp: str


def set_cookie(resp: Response, token: str):
    resp.set_cookie("refresh_token", token, httponly=True, samesite="strict", secure=settings.COOKIE_SECURE,
                    max_age=settings.REFRESH_DAYS * 86400, path="/")


def user_out(u: models.User):
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "hospitalId": u.hospital_id}


@router.post("/register", status_code=201)
def register(d: RegisterIn, request: Request, db: Session = Depends(get_db)):
    h = db.query(models.Hospital).filter_by(code=d.hospital_code, verified=True).first()
    if not h:
        raise ApiError(404, "HOSPITAL_NOT_FOUND", "Unknown or unverified hospital code")
    email = d.email.lower()
    if db.query(models.User).filter_by(email=email).first():
        raise ApiError(400, "EMAIL_TAKEN", "Email already registered")
    u = models.User(name=d.name, email=email, password_hash=hash_password(d.password),
                    role=Role.PATIENT.value, hospital_id=h.id)
    db.add(u)
    db.flush()
    db.add(models.Patient(user_id=u.id, hospital_id=h.id, phone=d.phone))
    code = new_otp(db, u)
    audit(db, u, "REGISTER", "User", u.id, request)
    db.commit()
    send_otp_email(u.email, code)
    return ok({"id": u.id, "email": u.email}, "Verification code sent")


@router.post("/verify-email")
def verify_email(d: VerifyIn, db: Session = Depends(get_db)):
    u = db.query(models.User).filter_by(email=d.email.lower()).first()
    if not u or not check_otp(db, u, d.otp):
        raise ApiError(400, "INVALID_OTP", "Invalid or expired code")
    u.email_verified = True
    db.commit()
    return ok(None, "Email verified")


@router.post("/login")
def login(d: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    u = db.query(models.User).filter_by(email=d.email.lower(), deleted_at=None).first()
    if not u or not u.is_active or not verify_password(d.password, u.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS", "Wrong email or password")
    if not u.email_verified:
        raise ApiError(403, "EMAIL_NOT_VERIFIED", "Verify your email first")
    refresh = make_refresh(u, db)
    audit(db, u, "LOGIN", "User", u.id, request)
    db.commit()
    set_cookie(response, refresh)
    return ok({"accessToken": make_access(u), "user": user_out(u)})


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token:
        raise ApiError(401, "NO_REFRESH_TOKEN", "Login required")
    user, new_refresh = rotate_refresh(db, token)
    db.commit()
    set_cookie(response, new_refresh)
    return ok({"accessToken": make_access(user)})


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if token:
        try:
            jti = decode(token, "refresh")["jti"]
            db.query(models.RefreshToken).filter_by(jti=jti).update({"revoked": True})
            db.commit()
        except ApiError:
            pass
    response.delete_cookie("refresh_token", path="/")
    return ok(None, "Logged out")


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return ok(user_out(user))
