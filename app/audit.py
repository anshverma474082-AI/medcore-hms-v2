from fastapi import Request
from sqlalchemy.orm import Session
from . import models


def audit(db: Session, actor, action: str, entity: str, entity_id, request: Request, hospital_id=None):
    db.add(models.AuditLog(
        user_id=getattr(actor, "id", None),
        hospital_id=hospital_id if hospital_id is not None else getattr(actor, "hospital_id", None),
        action=action, entity=entity, entity_id=entity_id,
        ip=request.client.host if request.client else "",
    ))
