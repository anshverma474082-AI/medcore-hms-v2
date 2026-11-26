# MedCore HMS

MedCore HMS is a multi-hospital management system with a NestJS API, Prisma data layer, PostgreSQL database, Redis-backed sessions and queues, and a Next.js web interface.

**Repository:** https://github.com/anshverma474082-AI/medcore-hms-v2

**Current state:** the source and release materials are published on the `main` branch. The Render frontend is live; a separate Neon PostgreSQL project has been created, but its connection is not yet configured on the Render API.

**Frontend URL:** https://medcore-hms-web.onrender.com

**Deployment note:** the sign-in page loads, but sign-in and data-backed workflows are unavailable until the API is deployed with the Neon database connection. The existing AI DJ Render database has not been changed.

## Features

- Nine roles: super administrator, hospital administrator, doctor, nurse, receptionist, lab technician, pharmacist, accountant, and patient.
- Hospital registration and verification, user management, email OTP verification, secure sessions, role checks, CSRF protection, rate limits, and audit events.
- Patient appointment booking, clinician availability, status changes, and overlap checks.
- Clinical notes, patient profile fields, and prescription instructions encrypted with AES-256-GCM; prescription PDF downloads.
- Doctors can upload encrypted PDF, PNG, and JPEG clinical attachments to an authorized record; records and prescriptions include an application-level electronic sign-off and integrity reference.
- Laboratory orders, result upload, clinician approval, and patient-scoped result access.
- Pharmacy catalogue and inventory batches, expiry checks, FIFO dispensing, and stock transaction records.
- Invoice creation and Razorpay Checkout/webhook integration points.
- In-app notifications, Socket.IO updates, BullMQ jobs, and Resend/Twilio delivery adapters.
- Role-aware Next.js dashboards and server-side search/pagination for appointments, clinical records, prescriptions, lab orders, invoices, medicines, and notifications. Multi-line prescription and invoice forms support the main workflows.

Workspace list pages fetch results in pages (up to 100 rows per request). Search is scoped to the signed-in role and hospital. Dashboard summaries and the global quick-search cache still use the compatibility list endpoints, so their counts and quick-search coverage reflect the most recent 100 rows returned by those endpoints.

The corresponding API routes are `/appointments/page`, `/records/page`, `/prescriptions/page`, `/lab-orders/page`, `/billing/invoices/page`, `/medicines/page`, `/notifications/me/page`, and the administrator feed `/notifications/hospital/page`. List queries accept `page`, `pageSize`, and `q`; invoices and lab orders also accept `status`, while prescriptions accept `dispensed`.

All external services need their own credentials. No real payment, email, or SMS provider call has been made from this project.

## Local setup

Install Node.js 22.12+ (22.x) or 24.x, pnpm 11, Docker Desktop, and Docker Compose. From the project root:

1. Run **pnpm install**.
2. Run **pnpm setup:local** to create a private .env file with local secrets.
3. Run **docker compose up --build -d postgres redis** to start PostgreSQL and Redis.
4. Run **pnpm db:migrate** and **pnpm db:seed**.
5. Run **pnpm dev** and open **http://localhost:3000**.

The API runs on port 3001 and its OpenAPI documentation is at http://localhost:3001/api/docs. The web application proxies API requests through the same-origin /api route.

The seed creates two demo hospitals, eight doctors, thirty patients, and demo workflow data. Demo users use the DEMO_PASSWORD from .env (the local default is DemoPass123!). Change it before sharing the demo. Seed data is fictional.

## Useful checks

- **pnpm typecheck** checks TypeScript types.
- **pnpm lint** runs the API and web lint checks.
- **pnpm test:api** runs backend unit tests.
- **pnpm test:e2e** runs the browser test suite.
- **pnpm build** builds the API and web application.
- **pnpm db:migrate** applies Prisma migrations.
- **pnpm db:seed** creates or refreshes demo records.

## Deployment and release

The public frontend is deployed at https://medcore-hms-web.onrender.com. The Render Key Value service is available. A separate free Neon PostgreSQL project named `medcore-hms-demo` has been created in Oregon, and the Render blueprint now accepts its connection URL as a secret. The API still needs the Neon URL added in Render and a blueprint sync before sign-in or data-backed workflows can work. The existing AI DJ Render database has not been changed. Do not enter real patient information. Razorpay, Resend, and Twilio remain unconfigured because no provider credentials were supplied. The latest published source is on `main` in the repository linked above.

## Project materials

- Final project report: docs/PROJECT_REPORT.md
- Architecture diagram source: docs/architecture.mmd
- Entity relationship diagram source: docs/er-diagram.mmd
- PDF report: output/pdf/MedCore_HMS_Project_Report.pdf

This is an academic demonstration. It is not a certified clinical product; use fictional data only.
