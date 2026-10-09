# QualiCore QMS — Quality, Compliance, Risk & Management Platform

A real, full-stack enterprise QMS: Node.js/Express API, SQLite database (WAL), JWT auth,
role-based permissions for 14 roles, workflow engine with human approvals, audit trail on
every change, secure file storage, notifications, automation scheduler, reports with CSV
export, external integration API — and a relationship-aware **AI Brain** grounded strictly
in live authorized data.

## Run it

```bash
npm install                 # server deps (root)
cd client && npm install    # client deps
cd client && npm run build  # build frontend into client/dist
cd .. && npm start          # serve API + UI on http://localhost:4000
```

Re-seed demo data at any time: `npm run seed` (adds `--reseed`).

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Administrator | admin@qms.io | Admin123! |
| Quality Manager | qm@qms.io | Qm12345! |
| Executive Management | management@qms.io | Exec12345! |
| Risk / Compliance / Doc / Competency / Supplier / Equipment Mgrs | risk@ · compliance@ · docs@ · competency@ · supplier@ · equipment@qms.io | Risk12345! / Comp12345! / Docs12345! / Comp12345! / Supp12345! / Equip123! |
| Investigator / Auditor | investigator@ / auditor@qms.io | Invest123! / Audit123! |
| Line Manager / Standard User | ops.manager@ / employee@qms.io | Mgr12345! / Emp12345! |

## Modules

Policies · Objectives/KPIs (with measurement series) · Risk Register (5×5 inherent/residual) ·
Suppliers (qualification, evaluations, incidents) · People · Competencies & assessments ·
Training · Records (retention, confidentiality classes) · Documents (versions, approvals,
review dates) · Design Reviews (requirements, findings) · Equipment (IQ/OQ/PQ, calibration) ·
NC & Incidents & CAPA (investigation → verification → closure) · Audits (findings → actions) ·
Compliance register · Management Review · centralized Actions Hub.

Every record has: **Related Information** (cross-module graph), linked actions, comments,
secure attachments, approval history and a per-record audit trail.

## Human control model

AI recommends → human reviews → human approves → system records.
The AI never silently approves documents, closes NCs, changes official risk ratings,
approves suppliers or deletes records. Its proposals land in *Administration → System &
AI Decisions* where authorized humans approve/reject them; execution is audited with the
human's identity. Formal workflow transitions (`approved`, `closed`, `issued`) are restricted
to approver roles and recorded in an immutable approvals log.

## AI Brain

`POST /api/ai/ask` — natural-language Q&A over live data with intents:
needs-attention, worsening risks, repeat supplier problems, documents needing review,
overdue items, expirations, compliance gaps, missing information, trend analysis,
record summaries, related-entity graphs, management-review drafts.

Answers are structured as **Facts / Evidence / Possible findings / Recommendations** with
cited entity codes. An optional LLM phrasing layer activates only if `OPENAI_API_KEY` is set
and is instructed to use only provided facts; without a key everything still works via the
deterministic engine. Endpoints also include `/api/ai/insights`, `/api/ai/related/:type/:code`,
`/api/ai/management-review-draft`.

## Automation

Scheduler sweeps every 180 min (configurable): overdue actions → reminders → escalations to
management after N days; expiring certifications/calibrations/document & policy/risk/compliance
reviews → targeted notifications (deduplicated daily); recurring actions respawn on completion;
audit findings marked major auto-create tracked actions; supplier evaluations below threshold
notify quality leadership.

## Security

- **Email verification bot** — every new account must verify ownership via an emailed link before sign-in (`require_email_verification` setting). The bot rejects malformed addresses, disposable/temp domains (blacklist), and — when DNS is available — live-checks MX records so fake domains can't be used. Without SMTP configured, admins get a copyable activation link instead.
- **Two-factor authentication (TOTP)** — self-service enablement at *My Security* (user menu): works with Google/Microsoft Authenticator & Authy, ±1 time-step drift tolerance, plus 8 one-time backup codes (stored hashed, single use). Disabling requires password confirmation.
- **Encryption at rest** — all uploaded attachments are encrypted with AES-256-GCM using a managed master key (`server/data/file.key`, created automatically, keep it safe + backed up); downloads decrypt transparently. Legacy plaintext files are auto-encrypted on boot.
- **File content validation** — binary uploads are verified by magic bytes against their extension (a renamed `.exe` pretending to be a `.pdf` is rejected).
- **Encrypted database backups** — daily automated backup (`server/data/backups/*.db.enc`, AES-256-GCM, last 14 kept) + on-demand from Administration; restore with `node server/restore-backup.js <file> [output]` (stop the server first).
- **Security Monitor** — Administration → Security Monitor: failed logins today, currently locked accounts, pending verifications, and a live feed of sign-ins/lockouts/rate-limits/credential changes.
- **Brute-force protection** — account lockout after 6 failed logins (15 min) + login rate limiting (per IP), with admin unlock and automatic owner notification; general API rate limiting (400 req/min/IP) returns 429 with `X-RateLimit-*` headers.
- **Token revocation** — changing/resetting a password or disabling/changing a role bumps the user's token version, instantly invalidating all existing JWTs (sessions expire after 8h).
- **Password policy** — minimum 8 characters with upper + lower case and a digit, enforced on create/reset/change.
- **Security headers** — CSP (`default-src 'self'`, no framing), nosniff, Referrer-Policy, Permissions-Policy, COOP; JSON body capped at 256 kB; forced attachment downloads.
- **Data protection** — bcrypt password hashes, hashed API keys (plaintext shown once), restricted-record confidentiality classes enforced row-level, parameterized SQL everywhere, full audit trail (logins, failed logins, lockouts, exports, AI decisions).
- **Verification** — re-run `node server/security-test.js` (33 checks incl. 2FA flow, encryption-at-rest proof, backup creation) and `node server/smoke.js` (36 checks) any time.

### SMTP (optional)

Set env vars to deliver real emails: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_URL` (public base URL used in links).

## External API

```
curl -H "X-API-Key: <key>" http://localhost:4000/api/v1/risks?limit=100
```

## Architecture

```
server/
  db.js            schema + realistic seed data
  modules.js       registry: fields, permissions, workflows, children (drives API + UI)
  ai/brain.js      collectors, analyzers, knowledge graph, intent engine, LLM layer
  routes/          auth, crud+workflow engine, actions, dashboard, search, files,
                   ai, reports, calendar, admin/integrations, notifications
  jobs.js          automation sweeps
client/            React (Vite) SPA — generic registry-driven pages + AI assistant
```
