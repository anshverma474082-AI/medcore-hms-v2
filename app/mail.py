"""Email stub. Real delivery (Resend) is added in the notifications stage.
OTP codes are never logged; in dev/test they are kept in memory so tests can read them."""
import logging
from .config import settings

log = logging.getLogger("medcore.mail")
outbox: list = []


def send_otp_email(to: str, code: str):
    log.info("OTP email queued for %s", to)
    if settings.ENV != "prod":
        outbox.append({"to": to, "code": code})
