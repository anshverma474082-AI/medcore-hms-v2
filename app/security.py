import hashlib, hmac, secrets, uuid
from datetime import timedelta

import bcrypt
import jwt
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .models import utcnow
from .responses import ApiError

ALGO = "HS256"


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode()


def verify_password(p: str, hashed: str) -> bool:
    return bcrypt.checkpw(p.encode(), hashed.encode())


def _encode(payload: dict, delta: timedelta) -> str:
    return jwt.encode({**payload, "exp": utcnow() + delta}, settings.SECRET_KEY, algorithm=ALGO)


def decode(token: str, kind: str) -> dict:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGO])
    except jwt.PyJWTError:
        raise ApiError(401, "INVALID_TOKEN", "Invalid or expired token")
    if data.get("type") != kind:
        raise ApiError(401, "INVALID_TOKEN", "Wrong token type")
    return data


def make_access(user: models.User) -> str:
    return _encode({"sub": str(user.id), "role": user.role, "hid": user.hospital_id, "type": "access"},
                   timedelta(minutes=settings.ACCESS_MINUTES))


def make_refresh(user: models.User, db: Session) -> str:
    jti = uuid.uuid4().hex
    db.add(models.RefreshToken(user_id=user.id, jti=jti, expires_at=utcnow() + timedelta(days=settings.REFRESH_DAYS)))
    return _encode({"sub": str(user.id), "jti": jti, "type": "refresh"}, timedelta(days=settings.REFRESH_DAYS))


def rotate_refresh(db: Session, token: str):
    """Use a refresh token once. Reusing an old one revokes every session of that user."""
    data = decode(token, "refresh")
    row = db.query(models.RefreshToken).filter_by(jti=data["jti"]).first()
    if not row:
        raise ApiError(401, "INVALID_TOKEN", "Unknown refresh token")
    if row.revoked or row.expires_at < utcnow():
        db.query(models.RefreshToken).filter_by(user_id=row.user_id).update({"revoked": True})
        db.commit()
        raise ApiError(401, "TOKEN_REUSED", "Refresh token already used; please log in again")
    user = db.get(models.User, row.user_id)
    if not user or not user.is_active or user.deleted_at:
        raise ApiError(401, "INVALID_TOKEN", "User not available")
    row.revoked = True
    return user, make_refresh(user, db)


def _hash_otp(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def new_otp(db: Session, user: models.User) -> str:
    code = f"{secrets.randbelow(10**6):06d}"
    db.add(models.EmailOtp(user_id=user.id, code_hash=_hash_otp(code),
                           expires_at=utcnow() + timedelta(minutes=settings.OTP_MINUTES)))
    return code


def check_otp(db: Session, user: models.User, code: str) -> bool:
    row = (db.query(models.EmailOtp).filter_by(user_id=user.id, used=False)
           .order_by(models.EmailOtp.id.desc()).first())
    if not row or row.expires_at < utcnow() or not hmac.compare_digest(row.code_hash, _hash_otp(code)):
        return False
    row.used = True
    return True
