# MedCore HMS — Current Status and Remaining Work

## Current status

The working tree is a NestJS, Prisma, PostgreSQL, Redis, and Next.js application. It includes role-based hospital workflows, patient profiles, encrypted clinical notes and attachments, electronic sign-off metadata, lab and pharmacy operations, billing, and notifications. Changes are local and have not been committed or pushed.

## Completed locally

- Added validated, tenant-scoped server-side search and paging for appointments, medical records, prescriptions, lab orders, invoices, medicines, and notifications. The corresponding workspace lists use those paged APIs. Prescription dispensing can filter for the unfilled queue.
- Preserved existing role and ownership filters; search avoids encrypted clinical fields.
- Added unit coverage for page bounds, query validation, role scoping, search filters, status filters, and result envelopes.
- The backend suite passes **100 tests across 21 suites** with **82.37% measured line coverage**, above the 70% target.
- API and web type checks, lint, and production builds pass.
- Local PostgreSQL/Redis health, seeded admin sign-in, appointment search/paging, billing rendering, encrypted attachment authorization/decryption, and temporary invoice creation/readback were verified in the previous local review. Temporary test rows were removed; no payment was initiated.
- The Render blueprint, Docker configuration, report source, and ER diagram source are present.

Dashboard summaries and global quick search still use compatibility list endpoints, which are capped at 100 rows per resource. The paged workspace lists can search the full result set.

## Still incomplete

| Work | Current state | Required next step |
|---|---|---|
| Browser automation | Playwright starts its local server, but headless Chromium exits with a macOS Mach port permission error before the test runs. | Run `pnpm test:e2e` in CI or on a compatible machine. The prior manual desktop browser smoke check passed for sign-in, appointments, paging/search, and billing. |
| Docker validation | Docker is unavailable in this environment. | Build and start the Compose stack on a machine with Docker; verify health checks and persistence. |
| Render demo | `render.yaml` and container files are present, but no services or public URL have been provisioned. | Set up the authorized Render services, production secrets, and public health check. |
| Provider checks | Resend, Twilio, and Razorpay adapters exist; no provider credentials or live transaction tests were supplied. | Add sandbox credentials and verify only the required provider workflows. |
| GitHub publication | Repository: https://github.com/anshverma474082-AI/medcore-hms-v2. Changes remain local and uncommitted. | Review the diff and approve the commit/push before publication. |
| Walkthrough evidence | No presenter-recorded walkthrough has been supplied. | Record the reviewer walkthrough from the local or hosted demo. |
| ER diagram export | The Mermaid ER source is available at `docs/er-diagram.mmd`; no standalone image export is included. | Export an SVG or PNG if the submission portal requires it. |

## Important limits

- This is an academic demo, not a certified or production-ready clinical product. Use fictional data only.
- Electronic sign-off is an application attestation, not a regulated certificate signature.
- No load test, formal security/privacy review, backup/restore drill, or clinical safety assessment has been performed.
- Passing unit tests and local smoke checks do not prove every workflow in a hosted environment.

## Release dependencies

A public review URL requires a configured hosting account and production secrets. Provider-backed checks require sandbox credentials. GitHub publication requires approval for the proposed commit and push. The presenter must record the walkthrough. These items are not described as complete in the project report.
