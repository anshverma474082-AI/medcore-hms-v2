# MedCore HMS (FastAPI edition)

Multi-tenant Hospital Management System API built with Python, FastAPI, SQLAlchemy and PostgreSQL.

## Progress
- [x] **Stage 1:** project setup, 9 roles, hospital tenancy, JWT + refresh-token rotation, email OTP, departments, staff and doctors, audit log, standard API envelope
- [ ] Stage 2: doctor availability, appointments (conflict-safe), EMR, prescriptions
- [ ] Stage 3: lab, pharmacy (FIFO, expiry), invoices, payments webhook, notifications
- [ ] Stage 4: web frontend, dashboards, deployment, diagrams, report

## Run locally (SQLite, no Docker)
```
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API docs: http://127.0.0.1:8000/api/docs

## Run with Docker (PostgreSQL + Redis)
```
cp .env.example .env     # then edit the values
docker compose up --build
```

## First steps
1. Log in as super admin (`POST /auth/login`, defaults in `.env.example`; change them).
2. `POST /hospitals` to create a hospital and its admin, then `POST /hospitals/{id}/verify`.
3. Hospital admin logs in, creates departments (`POST /departments`) and staff (`POST /users`).
4. Patients register with the hospital code (`POST /auth/register`) and verify the emailed OTP.

## Tests
```
pytest --cov=app --cov-report=term-missing
```
Stage 1 coverage: 94%. Includes tenancy isolation, RBAC, refresh-token reuse detection.

## Design notes
- **Multi-tenancy:** row-level. Every tenant table carries `hospital_id`; queries are filtered by the caller's hospital. Cross-tenant lookups return 404 so other hospitals' IDs are not revealed.
- **Refresh tokens:** httpOnly SameSite=Strict cookie, rotated on every use. Reusing an old token revokes all of that user's sessions.
- **Passwords:** bcrypt (cost 12 by default). OTPs are stored hashed and never logged.

## Known gaps in Stage 1
Redis is not used yet (refresh tokens live in the database). No rate limiting, forgot-password, phone/SMS verification or real email delivery yet; email OTPs are held in memory outside production.
