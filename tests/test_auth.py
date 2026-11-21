from app import mail
from tests.conftest import login, make_hospital


def test_envelope_and_validation(client):
    r = client.get("/auth/me")
    assert r.status_code == 401 and r.json()["success"] is False and r.json()["error"]["code"] == "UNAUTHORIZED"
    r = client.post("/auth/login", json={"email": "not-an-email", "password": "x"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get("/health").json()["success"] is True


def test_register_requires_otp_then_login(client):
    make_hospital(client, "CITY-1", "a@city.com")
    r = client.post("/auth/register", json={"name": "Pat", "email": "pat@x.com", "password": "password123",
                                            "hospital_code": "CITY-1"})
    assert r.status_code == 201
    login_try = client.post("/auth/login", json={"email": "pat@x.com", "password": "password123"})
    assert login_try.status_code == 403 and login_try.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"
    assert client.post("/auth/verify-email", json={"email": "pat@x.com", "otp": "000000"}).status_code == 400
    code = mail.outbox[-1]["code"]
    assert client.post("/auth/verify-email", json={"email": "pat@x.com", "otp": code}).status_code == 200
    h = login(client, "pat@x.com", "password123")
    me = client.get("/auth/me", headers=h).json()["data"]
    assert me["role"] == "patient"
    assert client.post("/auth/register", json={"name": "Pat", "email": "pat@x.com", "password": "password123",
                                               "hospital_code": "NOPE"}).status_code == 404


def test_refresh_token_rotation_and_reuse(client):
    make_hospital(client, "CITY-1", "a@city.com")
    login(client, "a@city.com", "password123")
    old = client.cookies.get("refresh_token")
    assert client.post("/auth/refresh").status_code == 200
    new = client.cookies.get("refresh_token")
    assert new != old
    client.cookies.set("refresh_token", old)           # replay the old token
    r = client.post("/auth/refresh")
    assert r.status_code == 401 and r.json()["error"]["code"] == "TOKEN_REUSED"
    client.cookies.set("refresh_token", new)           # whole session family is revoked
    assert client.post("/auth/refresh").status_code == 401


def test_logout_revokes_refresh(client):
    make_hospital(client, "CITY-1", "a@city.com")
    login(client, "a@city.com", "password123")
    tok = client.cookies.get("refresh_token")
    assert client.post("/auth/logout").status_code == 200
    client.cookies.set("refresh_token", tok)
    assert client.post("/auth/refresh").status_code == 401
