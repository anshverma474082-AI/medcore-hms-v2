from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .responses import ApiError
from .roles import Role
from .security import decode

bearer = HTTPBearer(auto_error=False)


def get_current_user(cred: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)) -> models.User:
    if not cred:
        raise ApiError(401, "UNAUTHORIZED", "Login required")
    data = decode(cred.credentials, "access")
    user = db.get(models.User, int(data["sub"]))
    if not user or not user.is_active or user.deleted_at:
        raise ApiError(401, "UNAUTHORIZED", "User not available")
    return user


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    def checker(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in allowed:
            raise ApiError(403, "FORBIDDEN", "You do not have permission")
        return user
    return checker


def tenant_id(user: models.User, hospital_id=None) -> int:
    """The hospital this request may touch. Only the super admin may choose one."""
    if user.role == Role.SUPER_ADMIN.value:
        if hospital_id is None:
            raise ApiError(400, "HOSPITAL_REQUIRED", "hospital_id is required for super admin")
        return hospital_id
    return user.hospital_id
