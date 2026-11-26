def test_frontend_and_static_assets_are_served(client):
    page = client.get("/")
    assert page.status_code == 200
    assert "MedCore HMS" in page.text
    assert "/assets/app.css" in page.text
    assert page.headers["x-content-type-options"] == "nosniff"

    css = client.get("/assets/app.css")
    script = client.get("/assets/app.js")
    assert css.status_code == script.status_code == 200
    assert "--navy" in css.text
    assert "renderDashboard" in script.text
