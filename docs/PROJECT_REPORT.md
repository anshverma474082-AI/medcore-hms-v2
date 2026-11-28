# MedCore HMS - Final Project Report

| Field | Details |
|---|---|
| Prepared by | Ansh Verma |
| Project | MedCore Hospital Management System |
| Report date | 26 November 2026 |
| Stack | NestJS, Prisma, PostgreSQL, Redis, Next.js, React, TypeScript |
| Repository | https://github.com/anshverma474082-AI/medcore-hms-v2 |

## 1. Executive summary

MedCore HMS is a multi-hospital management system that brings together identity and hospital administration, appointment scheduling, encrypted clinical records and attachments, patient profiles, electronic sign-off, laboratory review, pharmacy inventory, multi-line billing, search, role-specific dashboards, and notifications. It follows the project brief's NestJS, Prisma, and Next.js stack. PostgreSQL stores application data; Redis supports session and job state.

This is an academic demonstration, not a certified medical product. The included demo data is fictional. Do not enter real patient information or use the application to make treatment decisions.

## 2. Objectives and scope

The system provides separate hospital workspaces; nine user roles; hospital registration and verification; staff and patient workflows; appointment booking; encrypted clinical notes and file attachments; patient profile management; electronically attested prescriptions; lab result review; pharmacy stock and dispensing; itemized invoices; role-specific dashboards; workspace search and paging; and in-app notifications. The source includes a Render deployment blueprint and Docker configuration for review and future hosting.

## 3. Technology and architecture

The Next.js web application sends same-origin requests to a NestJS REST API. NestJS validates requests and applies authentication, role, and hospital-scope rules. Prisma maps application records to PostgreSQL. Redis stores session state and rate-limit counters and supports notification jobs. Socket.IO carries real-time notification updates.

Architecture source: `docs/architecture.mmd`. Entity relationship diagram source: `docs/er-diagram.mmd`.

### Main data entities

Hospitals own users, departments, doctors, patients, appointments, clinical records, prescriptions, lab orders, invoices, medicines, inventory batches, notifications, and audit events. An appointment connects a patient and doctor and may have related clinical and billing records. Prescriptions contain items; pharmacy dispense records connect prescription items to inventory batches.

## 4. Implemented workflows

### Identity and hospital administration

The application defines super administrator, hospital administrator, doctor, nurse, receptionist, lab technician, pharmacist, accountant, and patient roles. Patient accounts can verify email during registration and verify a phone number separately with an expiring SMS code. Password recovery uses a one-use email code. Accounts use bcrypt password hashes. Access tokens and Redis-backed refresh-token rotation support signed-in sessions. The API uses role guards, hospital-scoped queries, CSRF protection, authentication rate limits, and audit events.

### Appointments and clinical care

Patients can book appointments with doctors who publish availability. The API rejects overlapping or invalid bookings. Staff can create emergency bookings outside normal availability while still checking for conflicts; doctors, administrators, and receptionists can mark confirmed appointments as no-shows. Normal appointments receive queued 24-hour and 1-hour reminders, which are suppressed if the appointment is cancelled or closed. The appointment, medical-record, prescription, laboratory, invoice, medicine, and notification workspace lists support validated server-side search and paging, with hospital and role ownership preserved. Invoice and laboratory lists also accept status filters; pharmacy can page only prescriptions awaiting dispensing. Clinical search uses names and identifiers rather than encrypted note text. Doctors can create visit records and prescriptions for authorized appointments. Clinical notes, encounter histories, prescription instructions, patient profile details, and attachment bytes are encrypted with AES-256-GCM at rest. Patient profiles include date of birth, sex, blood group, emergency contact, and address. Visit records include core vitals, height, weight, calculated BMI, and medical, family, surgical, and vaccination history. Medical records and prescriptions receive an electronic sign-off timestamp and HMAC integrity reference. This is an application attestation, not a regulated certificate-based signature. Prescriptions can be downloaded as PDFs.

Doctors can attach PDF, PNG, or JPEG supporting files up to 5 MB to medical records. The API checks file signatures, encrypts bytes before database storage, and restricts download to authorized staff or the patient associated with the record. Prescription entry supports up to three medicine lines, while invoices support up to three separately priced charge lines. Workspace list pages load server-paged results, up to 100 per request. Dashboard summaries and global quick search continue to use compatibility list endpoints capped at 100 rows per resource.

### Laboratory and pharmacy

Doctors can create lab orders. Lab technicians enter results, and authorized clinicians or hospital administrators approve them. Patient access follows the approval state. Pharmacy staff manage medicines and dated stock batches. Dispensing excludes expired stock, allocates eligible batches FIFO, records allocations, and checks stock before updating it.

### Billing and notifications

Authorized staff create invoices linked to appointments. A signed test-payment flow verifies event signatures and prevents duplicate event processing. It demonstrates payment-state handling; it does not charge a card. In-app notification records, Socket.IO updates, and BullMQ jobs support notification workflows. Resend, Twilio, and Razorpay adapters are present, but no provider credentials were supplied and no live email, SMS, or payment transaction was made.

## 5. Security and privacy

- Passwords are stored as bcrypt hashes.
- Clinical free-text fields, patient profile details, and attachment bytes use AES-256-GCM encryption with a stable environment-provided key.
- Refresh-token rotation uses Redis; replaying a rotated token invalidates its session family.
- Role guards and hospital-scoped queries enforce access boundaries.
- Authentication and general API routes use rate limits.
- Password recovery uses hashed, expiring one-time codes, a per-email cooldown, an attempt limit, and session revocation after a successful reset.
- State-changing browser requests use CSRF protection, and production cookies are configured securely.
- Seeded records are fictional. The application has not undergone a formal penetration, privacy, or clinical-safety review.

## 6. Verification and release status

The following checks were performed against the local working tree and demo environment:

| Area | Result |
|---|---|
| TypeScript type checks and lint | Passed for API and web workspaces. |
| Backend unit tests | 100 tests passed across 21 suites, including page query validation, scoped search/paging, controller adapters, authentication and security, billing webhook idempotency, clinical data, and pharmacy operations. |
| Backend line coverage | 82.37% measured across the API source, above the brief's 70% target. |
| Production build | NestJS API and optimized Next.js production build passed after the current code changes. |
| Prisma schema and client | Updated Prisma Client generated successfully; the latest profile/attachment migration was applied to local PostgreSQL. |
| PostgreSQL and API health | The API started on port 3101 and `/health` returned HTTP 200 while connected to local PostgreSQL and Redis. Seeded admin sign-in succeeded through the browser. |
| Database-backed flow checks | A temporary PDF attachment uploaded, listed, decrypted on download, and was denied to an unauthorized doctor; the test row was removed. A temporary invoice was created and read back with the expected two-line total, then removed. No payment was initiated. |
| Redis | The local API started with Redis-backed wiring. This check did not independently verify every queue or rate-limit workflow. |
| Authenticated API workflows | Sign-in, current-user, appointment, record, prescription, invoice, and related API reads checked. |
| Prescription PDF | Local endpoint returned a PDF successfully. |
| Refresh-token behavior | Rotation succeeded; replay of the old token was rejected and the newer session was revoked. |
| Browser review | A desktop browser smoke check confirmed seeded sign-in, dashboard, 28 seeded appointments across three pages, page navigation, search for appointment ID 42, and billing screen rendering. |
| Automated browser test | Not passed: the Playwright web server started, but headless Chromium exited with a macOS Mach port permission error before the sign-in test ran. |
| Docker | Not run: Docker is unavailable in the local environment. |
| Render | The public frontend is deployed at [medcore-hms-web.onrender.com](https://medcore-hms-web.onrender.com) and loads the sign-in page. A Valkey service is available. A separate free Neon PostgreSQL project was created in Oregon; its connection URL still needs to be entered as a Render secret and the blueprint synced before the API can deploy. Sign-in and database-backed hosted workflows are not yet available. The existing AI DJ Render database is untouched. |
| External providers | Adapter code is present. Provider credentials and live-provider checks are outstanding. |
| Walkthrough video | Not recorded; the presenter needs to capture it. |
| GitHub update | The current source and report are published on `main` at the repository link below. |

The 100 automated backend tests measure 82.37% API line coverage. The unit tests do not replace full provider-backed, Docker, or end-to-end verification. Workspace lists use server-side search and paging; dashboard summaries and global quick search use compatibility endpoints capped at 100 rows per resource. The local review is not a load test or production readiness assessment.

## 7. API and data model reference

The API is organized into authentication, hospitals, users and doctors, patient profile, appointments, medical records and attachments, prescriptions, laboratory operations, pharmacy, billing, and notifications. Server-paged list routes are `/appointments/page`, `/records/page`, `/prescriptions/page`, `/lab-orders/page`, `/billing/invoices/page`, `/medicines/page`, and `/notifications/me/page`; administrators also have `/notifications/hospital/page`. The local Swagger interface is available at `http://localhost:3001/api/docs` when the API is running. Resource authorization is role-based and scoped to the caller's hospital and ownership relationship.

The complete entity relationships are maintained in [er-diagram.mmd](er-diagram.mmd), and the Prisma source of truth is `backend/prisma/schema.prisma`. Hospitals scope users and core records; appointments connect doctors and patients; visits may produce records, prescriptions, lab orders, and invoices; attachments belong to medical records; invoices and prescriptions retain their line items and related events.

## 8. Local demo and reviewer guide

Use Node.js 22.13+ or 24.x, pnpm 11, and PostgreSQL plus Redis. From the repository root, run `pnpm install`, `pnpm setup:local`, start PostgreSQL and Redis, then run `pnpm db:migrate`, `pnpm db:seed`, and `pnpm dev`. Open the app at `http://localhost:3000`; API documentation is at `http://localhost:3001/api/docs`.

Seeded examples include `admin@city.example`, `doctor1@city.example`, `patient01@city.example`, and `pharmacy@city.example`. The public Render review demo uses the deliberately shared password `DemoPass123!` so reviewers can sign in. Seeded records are fictional. Never enter real patient information; replace the shared password and hide demo credentials before any production use.

Suggested recording path: sign in as a patient and show appointment booking; switch to a doctor to show the queue, clinical note, prescription, and attachment controls; then demonstrate patient access to approved records and PDF prescriptions, and briefly show lab, pharmacy, invoice, dashboard, and API documentation views. Validate each interactive flow on the current environment before recording; this is a walkthrough suggestion, not a claim that every sequence has been end-to-end tested.

## 9. Challenges and decisions

The initial project source used FastAPI, while the brief specified NestJS, Prisma, and Next.js. The current application uses the specified TypeScript stack. The earlier implementation is retained under `legacy/fastapi` for reference.

Key engineering challenges included consistently enforcing hospital boundaries, preventing overlapping appointments, protecting refresh sessions from replay, encrypting clinical text while allowing authorized access, and updating pharmacy stock safely. The implementation uses tenant-scoped queries, input and state validation, Redis-backed session controls, authenticated encryption, and transaction-based inventory operations to address these concerns. Recent work also added password recovery, scheduled appointment reminders, emergency/no-show handling, and encrypted patient history with BMI support.

## 10. Deployment and next steps

The `render.yaml` blueprint created the frontend and Valkey service, and the frontend sign-in page is available at [https://medcore-hms-web.onrender.com](https://medcore-hms-web.onrender.com). Because the Render account already has an active free PostgreSQL database, a separate Neon PostgreSQL project was created in Oregon and its URL was configured in Render. The API has not passed its health check: prior startup logs reported Prisma `P1001` while connecting to Neon, and the public API health route still returns Render's application-loading page. The latest published blueprint enables deploys on commits and sets a demo password matching the sign-in page, but its sync and a successful API deploy still need confirmation in Render. The public URL is therefore a frontend preview, not a working end-to-end demo. Email, SMS, and payment credentials remain separate provider setup tasks. Record a short walkthrough after the hosted workflows are usable.

Current verification on 28 November 2026: lint, type-check, production build, and all 100 backend unit tests pass; API line coverage is 82.37%. Safari confirmed the public sign-in page renders. Playwright could not launch Chromium because macOS denied the browser process's Mach port. The local `.env` points to PostgreSQL on `127.0.0.1:55432`, where no server is running, so database-backed and local API checks could not run in this session. Docker is unavailable. Before a complete public review, sync and verify the Render services and Neon connection, rerun the Playwright suite in CI or a compatible browser environment, validate the Docker stack, configure provider credentials if required, export the ER diagram if required by the submission, and record the presenter-led walkthrough. Workspace list routes provide server-side search and paging; summary cards and global quick search use the 100-row compatibility reads. Pharmacy inventory flags stock at or below reorder level and reports expired quantities separately; dispensing excludes expired stock. Email and phone delivery adapters are implemented, but live provider delivery has not been verified because provider credentials were not supplied. Before any real-world use, add operational backups and monitoring, complete a security and privacy review, test recovery procedures, and have qualified reviewers validate clinical workflows.

Repository: https://github.com/anshverma474082-AI/medcore-hms-v2

## 11. Conclusion

MedCore HMS implements the requested NestJS, Prisma, and Next.js workflows, including encrypted patient profiles and attachments, electronic sign-off metadata, server-paged workspace lists, role-specific dashboards, and multi-line prescriptions and invoices. Current checks confirm lint, type-check, production builds, 100 backend unit tests, and 82.37% API line coverage; Safari also confirms the public sign-in view loads. The Render frontend is live, but the API has not passed its health check because it cannot currently connect to Neon. This release is not yet a working end-to-end hosted demo. Docker validation, database-backed local verification, automated browser execution, live provider checks, and a presenter-recorded walkthrough remain incomplete.
