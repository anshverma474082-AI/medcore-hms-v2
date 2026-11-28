from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "MedCore_HMS_Project_Report.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#14324A")
TEAL = colors.HexColor("#087E8B")
MINT = colors.HexColor("#E6F4F2")
INK = colors.HexColor("#223747")
MUTED = colors.HexColor("#687D8D")
LINE = colors.HexColor("#DCE6EB")
PALE = colors.HexColor("#F4F7F9")
GREEN = colors.HexColor("#176B50")
AMBER = colors.HexColor("#895B05")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=8.5, leading=12, textColor=TEAL, spaceAfter=11,
))
styles.add(ParagraphStyle(
    name="CoverTitleMed", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=30, leading=35, textColor=NAVY, alignment=TA_LEFT, spaceAfter=9,
))
styles.add(ParagraphStyle(
    name="CoverSubMed", parent=styles["Normal"], fontSize=12, leading=17,
    textColor=MUTED, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="SectionMed", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=17, leading=21, textColor=NAVY, spaceBefore=2, spaceAfter=9,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="SubsectionMed", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=10.5, leading=13, textColor=TEAL, spaceBefore=7, spaceAfter=4,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyMed", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.5, leading=12.2, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="SmallMed", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.2, leading=9.4, textColor=MUTED, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="BulletMed", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.2, leading=11.5, textColor=INK, leftIndent=12,
    firstLineIndent=-8, bulletIndent=0, spaceAfter=3.2,
))
styles.add(ParagraphStyle(
    name="TableHeadMed", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.2, leading=9, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="TableCellMed", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.2, leading=9.4, textColor=INK,
))
styles.add(ParagraphStyle(
    name="CalloutMed", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8, leading=11.5, textColor=NAVY,
))


def p(text, style="BodyMed"):
    return Paragraph(text, styles[style])


def bullets(items):
    return [p("&#8226; " + item, "BulletMed") for item in items]


def make_table(rows, widths, header=True):
    converted = []
    for index, row in enumerate(rows):
        cell_style = "TableHeadMed" if header and index == 0 else "TableCellMed"
        converted.append([
            cell if isinstance(cell, Paragraph) else p(str(cell), cell_style)
            for cell in row
        ])
    table = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), .4, LINE),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY if header else colors.white),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
    ]))
    return table


class ArchitectureDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width, self.height = 490, 145

    def draw(self):
        c = self.canv
        boxes = [
            (7, 125, "Next.js web", "React and TypeScript"),
            (181, 128, "NestJS API", "JWT, roles, tenant rules"),
            (359, 124, "PostgreSQL", "Prisma data access"),
        ]
        for x, width, title, subtitle in boxes:
            c.setFillColor(MINT if title == "Next.js web" else PALE)
            c.setStrokeColor(LINE)
            c.roundRect(x, 82, width, 49, 7, fill=1, stroke=1)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 8.5)
            c.drawCentredString(x + width / 2, 111, title)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.7)
            c.drawCentredString(x + width / 2, 96, subtitle)
        self.arrow(c, 136, 106, 176)
        self.arrow(c, 313, 106, 354)
        c.setFillColor(PALE)
        c.setStrokeColor(LINE)
        c.roundRect(42, 12, 148, 45, 7, fill=1, stroke=1)
        c.roundRect(300, 12, 148, 45, 7, fill=1, stroke=1)
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(116, 39, "Redis")
        c.drawCentredString(374, 39, "Render Blueprint")
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.6)
        c.drawCentredString(116, 25, "sessions, limits, queue jobs")
        c.drawCentredString(374, 25, "deployment configuration")
        c.setStrokeColor(TEAL)
        c.setLineWidth(1)
        c.line(244, 82, 244, 68)
        c.line(116, 68, 374, 68)
        c.line(116, 68, 116, 58)
        c.line(374, 68, 374, 58)

    @staticmethod
    def arrow(canvas, x1, y, x2):
        canvas.setStrokeColor(TEAL)
        canvas.setFillColor(TEAL)
        canvas.setLineWidth(1.4)
        canvas.line(x1, y, x2 - 5, y)
        canvas.drawString(x2 - 4, y - 3, ">")


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.line(19 * mm, height - 15 * mm, width - 19 * mm, height - 15 * mm)
        canvas.setFont("Helvetica-Bold", 7)
        canvas.setFillColor(TEAL)
        canvas.drawString(19 * mm, height - 12 * mm, "MEDCORE HMS")
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 19 * mm, height - 12 * mm, "FINAL PROJECT REPORT")
    canvas.setStrokeColor(LINE)
    canvas.line(19 * mm, 14 * mm, width - 19 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(19 * mm, 9 * mm, "MedCore HMS | Academic demonstration")
    canvas.drawRightString(width - 19 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


doc = BaseDocTemplate(
    str(OUT), pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm,
    topMargin=22 * mm, bottomMargin=21 * mm,
    title="MedCore Hospital Management System - Final Project Report",
    author="Ansh Verma", subject="MedCore HMS project report",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="report", frames=frame, onPage=header_footer)])

repo_url = "https://github.com/anshverma474082-AI/medcore-hms-v2"
repo_link = f'<link href="{repo_url}" color="#087E8B">github.com/anshverma474082-AI/medcore-hms-v2</link>'

story = [
    Spacer(1, 15 * mm),
    p("HOSPITAL MANAGEMENT SYSTEM  /  FINAL PROJECT REPORT", "CoverKicker"),
    p("MedCore HMS", "CoverTitleMed"),
    p("A multi-hospital workspace for appointments, care records, and operations.", "CoverSubMed"),
    Spacer(1, 5 * mm),
]
metadata = [
    [p("PREPARED BY", "TableHeadMed"), p("PROJECT REPOSITORY", "TableHeadMed")],
    [p("Ansh Verma", "TableCellMed"), p(repo_link, "TableCellMed")],
    [p("REPORT DATE", "TableHeadMed"), p("APPLICATION STACK", "TableHeadMed")],
    [p("28 November 2026", "TableCellMed"), p("NestJS, Prisma, PostgreSQL, Redis, Next.js, React, TypeScript", "TableCellMed")],
]
meta = Table(metadata, colWidths=[62 * mm, 104 * mm])
meta.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("BACKGROUND", (0, 2), (-1, 2), NAVY),
    ("BACKGROUND", (0, 1), (-1, 1), PALE),
    ("BACKGROUND", (0, 3), (-1, 3), PALE),
    ("BOX", (0, 0), (-1, -1), .5, LINE),
    ("INNERGRID", (0, 0), (-1, -1), .4, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story += [
    meta, Spacer(1, 9 * mm), p("PROJECT SUMMARY", "CoverKicker"),
    p("MedCore HMS brings together hospital onboarding, role-based access, appointments, encrypted clinical records and attachments, patient profiles, electronically signed prescriptions, laboratory review, pharmacy inventory, multi-line billing, search, role-aware dashboards, and notifications. The implementation follows the project brief's NestJS, Prisma, and Next.js stack, with PostgreSQL for persistent data and Redis for session and queue support.", "BodyMed"),
]
handoff = Table([[
    p("REVIEW STATUS  |  The Render frontend is live at medcore-hms-web.onrender.com. The Neon DATABASE_URL is configured, but the API has not passed /health; earlier startup logs showed Prisma P1001, and the public API health route still shows Render's application-loading page. The existing AI DJ database is untouched. Latest source and report updates are published on GitHub main.", "CalloutMed")
]], colWidths=[166 * mm])
handoff.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), MINT),
    ("BOX", (0, 0), (-1, -1), .6, colors.HexColor("#C5E3DE")),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story += [
    Spacer(1, 4 * mm), handoff, Spacer(1, 7 * mm),
    p("Project purpose", "SubsectionMed"),
    p("The project demonstrates common hospital administration and patient-care workflows for academic review. All seeded records are fictional. The system is not clinically certified and is not intended for real patient data or treatment decisions.", "BodyMed"),
    PageBreak(),
]

story += [
    p("1. Scope and system design", "SectionMed"),
    p("The web client uses same-origin API routes to communicate with the NestJS application. The API validates requests, enforces roles and hospital ownership, and accesses PostgreSQL through Prisma. Redis supports short-lived session state, rate-limit counters, and background notification jobs.", "BodyMed"),
    ArchitectureDiagram(), p("Figure 1. MedCore HMS application and supporting services.", "SmallMed"),
    p("User roles", "SubsectionMed"),
    make_table([
        ["Role", "Main responsibilities"],
        ["Super administrator", "Create and verify hospital workspaces."],
        ["Hospital administrator", "Manage hospital users, departments, and operational records."],
        ["Doctor / nurse", "Review appointments and use authorized clinical workflows."],
        ["Receptionist / accountant", "Schedule visits and manage billing records."],
        ["Lab technician / pharmacist", "Process lab orders or manage medicine inventory and dispensing."],
        ["Patient", "Register, book visits, and view personal care and billing information."],
    ], [43 * mm, 123 * mm]),
    p("Main workflows", "SubsectionMed"),
    *bullets([
        "Hospital onboarding, verification, account sign-in, refresh-token rotation, role checks, and hospital-scoped access.",
        "Appointment booking with clinician availability and overlap validation; staff can book emergencies outside normal availability while preventing conflicts, authorized staff can mark no-shows, and the list supports server-side search, status filters, and paging.",
        "Normal appointments queue 24-hour and 1-hour reminders and cancel them when visits are cancelled or closed.",
        "Encrypted encounter notes include medical, family, surgical, and vaccination history, core vitals, height, weight, and calculated BMI.",
        "Patients can maintain a basic profile with encrypted date of birth, sex, blood group, emergency contact, and address fields.",
        "Doctors can attach validated PDF, PNG, or JPEG documents up to 5 MB to a medical record; attachment bytes are encrypted at rest and access follows the record's hospital and patient/doctor scope.",
        "Medical notes and prescriptions receive an electronic sign-off timestamp and an HMAC integrity reference. This is an application audit attestation, not a regulated certificate-based digital signature.",
        "Workspace lists load server-paged results for appointments, medical records, prescriptions, labs, invoices, medicines, and notifications. Search remains scoped to the signed-in role and hospital, and does not query encrypted clinical notes. Dashboard summaries and global quick search use compatibility reads capped at 100 rows per resource.",
        "Prescription entry supports up to three medicine lines; invoice entry supports up to three separately priced charge lines.",
        "Pharmacy inventory flags low stock and expired quantities; dispensing excludes expired batches, and prescription forms suggest medicines from the catalogue.",
        "Lab staff enter results for clinician review; patient access to results follows the approval state.",
        "Pharmacy staff maintain medicine batches and dispense against prescriptions using expiry-aware FIFO stock allocation.",
        "Staff create appointment invoices; a signed test-payment flow records payment state without charging a real card.",
        "In-app notifications and real-time updates support the main operational events.",
    ]),
]

story += [
    p("2. Security and verification", "SectionMed"),
    p("Security controls", "SubsectionMed"),
    *bullets([
        "Passwords are stored as bcrypt hashes. Clinical free-text fields, patient profile data, and attachment bytes are encrypted with AES-256-GCM using a stable environment-provided key.",
        "Patients verify email during registration and verify phone separately with an expiring SMS code; password recovery uses a hashed one-time email code and revokes active sessions after reset.",
        "Short-lived access tokens and Redis-backed refresh-token rotation protect signed-in sessions; replaying a rotated token invalidates the session family.",
        "Role guards and hospital-scoped queries restrict access. Patient and clinician routes apply additional ownership checks.",
        "Rate limits protect authentication and general API routes. Browser requests use CSRF protection and secure cookie settings in production.",
        "Prescription instructions can be downloaded as a PDF. This is a demonstration workflow and does not replace clinical review.",
    ]),
    p("Verification performed", "SubsectionMed"),
    make_table([
        ["Check", "Observed result"],
        ["TypeScript type checks and lint", "Passed for API and web workspaces."],
        ["Backend unit tests", "100 tests passed across 21 suites, including page-query validation, scoped search/paging, controller adapters, authentication and security, billing webhook idempotency, clinical data, and pharmacy operations."],
        ["Aggregate backend line coverage", "82.37% measured in Jest across API source, above the project's 70% target."],
        ["Production build", "NestJS API and optimized Next.js production build passed after the current changes."],
        ["Prisma schema and client", "Prisma Client generated successfully. Local migration could not be checked because PostgreSQL at 127.0.0.1:55432 refused the connection."],
        ["Local services and API", "No local API or database health check passed in this session: PostgreSQL at 127.0.0.1:55432 was not running, so seeded sign-in could not be checked."],
        ["Database-backed flow checks", "Not verified in this session because the local PostgreSQL service was unavailable. No payment was initiated."],
        ["Security behavior", "Refresh-token rotation and replay rejection were checked earlier. Unit tests now cover encrypted profile/file storage and integrity sign-off helpers."],
        ["Browser review", "Safari confirmed the public Render sign-in page and demo-account guidance render. Authenticated workflows could not be tested because the hosted API did not return a health response."],
        ["Automated browser test", "Not passed: the Playwright web server started, but headless Chromium exited with a macOS Mach port permission error before the sign-in test ran."],
        ["Docker / Render", "Docker is unavailable in this environment. The Render frontend and Valkey service are available. Neon is configured in Render, but previous API startup logs showed Prisma P1001 and the public health route still shows an application-loading page. The latest blueprint sync and a successful API deploy remain unverified."],
    ], [46 * mm, 120 * mm]),
    p("The 100 automated backend unit tests measure 82.37% API line coverage. They do not replace full provider-backed, Docker, or end-to-end verification. Workspace lists use server-side search and paging; dashboard summaries and global quick search use compatibility endpoints capped at 100 rows per resource. The local review is not a penetration test, clinical safety validation, load test, or production operations review.", "SmallMed"),
    PageBreak(),
]

story += [
    p("3. API and data model reference", "SectionMed"),
    p("API surface", "SubsectionMed"),
    p("The NestJS API exposes versioned-by-resource REST routes and validates request payloads before service logic runs. Swagger UI is available locally at <link href='http://localhost:3001/api/docs' color='#087E8B'>http://localhost:3001/api/docs</link> when the API is running.", "BodyMed"),
    make_table([
        ["Route group", "Purpose and typical roles"],
        ["/auth/*", "Registration, verification, sign-in, token refresh, password recovery, and sign-out."],
        ["/hospitals/*", "Hospital creation and verification; platform administration."],
        ["/users/*, /doctors/*", "Staff administration, doctor directory, and doctor profile; role and hospital scoped."],
        ["/patients/me/profile", "Patient reads and updates encrypted profile fields."],
        ["/appointments*", "Availability, patient booking, appointment status, and cancellation."],
        ["/records*, /attachments*", "Clinicians create/read records; authorized patients and staff read; assigned doctors upload attachments."],
        ["/prescriptions*", "Doctor entry, authorized role-scoped reads, PDF download, and pharmacy dispensing."],
        ["/lab-orders*", "Clinicians request tests, lab staff enter results, clinicians approve results."],
        ["/medicines*", "Pharmacy catalogue, stock batches, and prescription dispensing."],
        ["/billing/*", "Invoices, test payment orders, verified payment callbacks, and payment events."],
        ["/notifications*", "Authenticated notification reads, updates, and real-time events."],
    ], [45 * mm, 121 * mm]),
    p("Core data relationships", "SubsectionMed"),
    make_table([
        ["Entity path", "Relationship"],
        ["Hospital → User / Department / Doctor / Patient", "Hospital tenancy scopes users and core clinical/administrative records."],
        ["Doctor + Patient → Appointment", "Appointments belong to one hospital and connect a patient with a clinician."],
        ["Appointment → Record / Prescription / Lab order / Invoice", "A visit may produce a medical record, prescription, lab order, and invoice."],
        ["Medical record → Clinical attachment", "An attachment is encrypted and inherits the record's hospital, patient, and doctor access scope."],
        ["Prescription → Items / Dispense", "Prescriptions contain medicine lines and may have one dispensing event."],
        ["Invoice → Items / Payment events", "Invoices contain priced lines and retain payment event history."],
        ["Hospital → Medicine → Inventory batch", "Batches track expiry and quantities; dispensing links batch allocations to medicines."],
    ], [65 * mm, 101 * mm]),
    p("The full relationship source is maintained in docs/er-diagram.mmd. The source schema is in backend/prisma/schema.prisma; hospital scope is stored on tenant-owned rows to support access checks.", "SmallMed"),
    PageBreak(),
]

story += [
    p("4. Local demo and reviewer guide", "SectionMed"),
    p("Starting the local demo", "SubsectionMed"),
    p("Use Node.js 22.12+ or 24.x, pnpm 11, and PostgreSQL plus Redis. Docker Compose can start local database services. From the repository root, follow the README setup sequence:", "BodyMed"),
    *bullets([
        "Run pnpm install and pnpm setup:local to create local environment settings.",
        "Start PostgreSQL and Redis with docker compose up --build -d postgres redis, or use compatible local services.",
        "Apply the schema with pnpm db:migrate, load fictional examples with pnpm db:seed, then run pnpm dev.",
        "Open the web app at http://localhost:3000. The API and interactive documentation use http://localhost:3001 and /api/docs.",
    ]),
    p("Seeded accounts", "SubsectionMed"),
    make_table([
        ["Role", "Example account"],
        ["Hospital administrator", "admin@city.example"],
        ["Doctor", "doctor1@city.example"],
        ["Patient", "patient01@city.example"],
        ["Pharmacy", "pharmacy@city.example"],
    ], [55 * mm, 111 * mm]),
    p("Seeded users share DEMO_PASSWORD (local default: DemoPass123!). The public review instance intentionally shows this demo password. Accounts and records are fictional. Never enter real patient information; remove the shared password before any production use.", "SmallMed"),
    p("Suggested walkthrough", "SubsectionMed"),
    *bullets([
        "Sign in as a patient and show the appointment list, doctor search, and booking form.",
        "Sign in as a doctor and review the appointment queue, clinical record editor, prescription form, and allowed attachment controls.",
        "Show patient access to an approved record and prescription PDF, then demonstrate lab and pharmacy or invoice views with fictional data.",
        "Briefly show role-specific dashboards and the API documentation. Verify each interactive flow in the current environment before recording; this guide is a suggested review path, not a claim that every sequence was end-to-end tested.",
    ]),
    PageBreak(),
]

story += [
    p("5. Challenges, limitations, and next steps", "SectionMed"),
    p("Challenges addressed", "SubsectionMed"),
    *bullets([
        "The starter project used FastAPI, while the project brief specified NestJS, Prisma, and Next.js. The current implementation uses the specified stack; the earlier source is retained in legacy/fastapi for reference.",
        "Hospital boundaries must apply consistently across related records. The API carries the caller's hospital scope into protected queries and access checks.",
        "Appointment overlap, refresh-token replay, clinical-text privacy, and concurrent pharmacy stock updates required explicit validation and transaction logic.",
        "The API unit tests cover the core rules and authorization behavior. In this session the local PostgreSQL endpoint refused connections, so migrations and database-backed attachment, invoice, and sign-in flows could not be rechecked. Docker was unavailable, so container configuration also needs validation on a Docker-enabled machine.",
    ]),
    p("Items still required for a public review release", "SubsectionMed"),
    make_table([
        ["Item", "Current state / action"],
        ["Render demo URL", "Frontend preview: https://medcore-hms-web.onrender.com. Neon is configured, but the API has not passed /health and prior startup logs reported Prisma P1001. Sign in to Render, inspect current logs, sync the latest blueprint, resolve database connectivity, and verify sign-in before calling this a working demo."],
        ["Provider-backed email, SMS, and payment", "Integration adapters are present. Provider credentials and external verification are still required; live transactions are not claimed."],
        ["Docker validation", "Docker was unavailable here. Build and start the Compose stack on a Docker-enabled machine."],
        ["Walkthrough recording", "A presenter must record the requested project walkthrough."],
        ["GitHub update", "The latest source and report updates are published on the main branch of the repository linked below."],
        ["Search and pagination", "Server-side search and paging are implemented for all workspace lists. Dashboard summaries and global quick search still use role-scoped compatibility arrays capped at 100 rows per resource."],
        ["Submission evidence", "This report is six pages. The ER relationship source is included in the repository; export it as a standalone image if required. Attach coverage evidence and record the requested walkthrough."],
    ], [45 * mm, 121 * mm]),
    p("Before production use", "SubsectionMed"),
    *bullets([
        "Configure and test backups, monitoring, secrets, database migrations, and recovery procedures.",
        "Connect and verify external email, SMS, and payment providers only after keys and test accounts are supplied.",
        "Complete security, privacy, accessibility, and clinical workflow reviews with qualified reviewers.",
        "Use a persistent database plan and review hosting retention limits before storing any sensitive data.",
    ]),
    p("Project repository", "SubsectionMed"),
    p(f'<link href="{repo_url}" color="#087E8B">{repo_url}</link>', "BodyMed"),
    p("Conclusion", "SubsectionMed"),
    p("MedCore HMS implements the requested NestJS, Prisma, and Next.js architecture. Current checks confirm lint, type checks, production builds, 100 backend unit tests, and 82.37% API line coverage; Safari also confirms the public sign-in view renders. The Render frontend is live, but the API has not passed its health check because it cannot currently connect to Neon, so the hosted site is not yet a working end-to-end demo. Local database-backed verification, Docker validation, automated browser execution, live provider checks, and a presenter-recorded walkthrough remain incomplete.", "BodyMed"),
]

doc.build(story)
print(OUT)
