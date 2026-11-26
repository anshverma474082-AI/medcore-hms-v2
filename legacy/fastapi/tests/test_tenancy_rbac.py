from tests.conftest import login, make_hospital


def two_hospitals(c):
    a, b = make_hospital(c, "AAA-1", "admin@a.com"), make_hospital(c, "BBB-1", "admin@b.com")
    return a, b, login(c, "admin@a.com", "password123"), login(c, "admin@b.com", "password123")


def test_tenancy_isolation(client):
    a_id, b_id, ha, hb = two_hospitals(client)
    dep = client.post("/departments", headers=ha, json={"name": "Cardiology"}).json()["data"]
    doc = client.post("/users", headers=ha, json={"name": "Dr A", "email": "dra@a.com", "password": "password123",
                                                  "role": "doctor", "department_id": dep["id"],
                                                  "specialisation": "Heart"}).json()["data"]
    # Hospital B cannot see hospital A's data, even by guessing IDs
    assert client.get(f"/users/{doc['id']}", headers=hb).status_code == 404
    assert client.get(f"/hospitals/{a_id}/departments", headers=hb).status_code == 404
    assert [u["email"] for u in client.get("/users", headers=hb).json()["data"]] == ["admin@b.com"]
    assert client.get("/doctors", headers=hb).json()["data"] == []
    assert len(client.get("/doctors", headers=ha).json()["data"]) == 1
    # Hospital B cannot attach staff to hospital A's department
    r = client.post("/users", headers=hb, json={"name": "X", "email": "x@b.com", "password": "password123",
                                                "role": "doctor", "department_id": dep["id"]})
    assert r.status_code == 404


def test_rbac(client):
    _, _, ha, _ = two_hospitals(client)
    client.post("/auth/register", json={"name": "Pat", "email": "pat@a.com", "password": "password123", "hospital_code": "AAA-1"})
    from app import mail
    client.post("/auth/verify-email", json={"email": "pat@a.com", "otp": mail.outbox[-1]["code"]})
    hp = login(client, "pat@a.com", "password123")
    body = {"name": "N", "email": "n@a.com", "password": "password123", "role": "nurse"}
    assert client.post("/users", headers=hp, json=body).status_code == 403          # patient cannot create staff
    assert client.post("/departments", headers=hp, json={"name": "X"}).status_code == 403
    assert client.post("/hospitals", headers=ha, json={}).status_code == 403          # only super admin
    assert client.post("/users", headers=ha, json={**body, "role": "super_admin"}).status_code == 400
    assert client.post("/users", headers=ha, json=body).status_code == 201
    assert client.get("/users", headers=hp).status_code == 403
    pat_id = client.get("/auth/me", headers=hp).json()["data"]["id"]
    nurse_id = client.get("/users", headers=ha).json()["data"][-1]["id"]
    assert client.get(f"/users/{pat_id}", headers=hp).status_code == 200              # own profile
    assert client.get(f"/users/{nurse_id}", headers=hp).status_code == 404            # someone else's


def test_pagination_and_departments(client):
    _, _, ha, _ = two_hospitals(client)
    for i in range(3):
        client.post("/users", headers=ha, json={"name": f"N{i}", "email": f"n{i}@a.com", "password": "password123", "role": "nurse"})
    r = client.get("/users?page=1&limit=2", headers=ha).json()
    assert len(r["data"]) == 2 and r["meta"]["total"] == 4 and r["meta"]["totalPages"] == 2
    assert client.post("/departments", headers=ha, json={"name": "ENT"}).status_code == 201
    assert client.post("/departments", headers=ha, json={"name": "ENT"}).status_code == 400
