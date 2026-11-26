import os
os.environ.update({"ENV": "test", "DATABASE_URL": "sqlite:///./test.db", "BCRYPT_ROUNDS": "4"})

import pytest
from fastapi.testclient import TestClient
from app.database import Base, engine
from app.main import app
from app.config import settings
from app import mail


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    mail.outbox.clear()
    with TestClient(app) as c:
        yield c


def login(c, email, password):
    r = c.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["data"]["accessToken"]}


def make_hospital(c, code, admin_email):
    sa = login(c, settings.SUPER_ADMIN_EMAIL, settings.SUPER_ADMIN_PASSWORD)
    r = c.post("/hospitals", headers=sa, json={"name": f"Hospital {code}", "code": code, "admin_name": "Admin",
                                                "admin_email": admin_email, "admin_password": "password123"})
    assert r.status_code == 201, r.text
    assert c.post(f"/hospitals/{r.json()['data']['id']}/verify", headers=sa).status_code == 200
    return r.json()["data"]["id"]
