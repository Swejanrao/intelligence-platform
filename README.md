# Assessment Intelligence Platform

A local full-stack assessment engine for technical and psychometric assessments. Admins manage the question bank and publish blueprints; candidates take timed, resumable attempts; the server allocates and snapshots questions and calculates results.

## Tech stack

| Layer | Stack | Logos |
|---|---|---|
| Language | TypeScript | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/typescript/typescript-original.svg" alt="TypeScript" height="32"> |
| Backend | Node.js, Express | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/nodejs/nodejs-original.svg" alt="Node.js" height="32"> <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/express/express-original.svg" alt="Express" height="32"> |
| Frontend | React, Vite | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/react/react-original.svg" alt="React" height="32"> <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/vitejs/vitejs-original.svg" alt="Vite" height="32"> |
| Database | SQLite, Prisma | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/sqlite/sqlite-original.svg" alt="SQLite" height="32"> <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/prisma/prisma-original.svg" alt="Prisma" height="32"> |
| Testing | Vitest | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/vitest/vitest-original.svg" alt="Vitest" height="32"> |

SQLite is used to keep the project easy to run locally. PostgreSQL can be used by switching the Prisma provider and `DATABASE_URL`.

## Run locally

Requires Node.js 20+ and npm. Open two PowerShell terminals from the project root.

### Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
# Set JWT_SECRET in .env to a long, random value before using the app.
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

The API is available at `http://localhost:5000`; `http://localhost:5000/api/health` checks the database connection.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Optional: set `VITE_API_URL` in the frontend environment to use a different API origin. The API CORS origin is configured with `CLIENT_ORIGIN`.

## Demo accounts

Seeded synthetic accounts use the password `Assessment@123`:

| Role | Email |
|---|---|
| Admin | `admin@assessment.local` |
| Candidate | `aarav@assessment.local` |
| Candidate | `mira@assessment.local` |
| Candidate | `dev@assessment.local` |

These are local demo credentials only. Never use them in a public deployment.

## Implemented workflows

- JWT sign-in with admin/candidate route authorization.
- Admin question bank: search/filter, create, edit, confirmation-based archive; technical, Likert and situational-judgment item validation.
- Assessment setup with section and category/difficulty quotas; live availability and publish-time shortage checks.
- Candidate start is idempotent per candidate and assessment. Quotas are assigned without duplicates; question and option order are randomized.
- Attempt question, option, answer-key, mark and psychometric scoring snapshots are persisted. Candidate APIs return only question text and safe options, never answer keys, marks, or scoring rules.
- Answer save, flag, refresh/resume, visible countdown with five-minute warning, review and submit confirmation.
- Server-side objective scoring, optional negative marking, section totals, weighted/reverse-scored dimensions, and idempotent result persistence.
- Reviewer results list and candidate-facing dimension profile marked “Illustrative summary. Not a clinical or diagnostic result.”

## Allocation and scoring decisions

- Allocation uses a randomized bipartite matching pass over quota slots and eligible active questions. This handles overlapping pools (for example, multiple sections drawing from a shared `MIXED` pool) without duplicate questions. Publishing runs the same feasibility check.
- Options are randomized when the attempt is created; their sanitized display order is persisted. Reconnects never reallocate.
- Technical multiple-choice items are scored all-or-nothing. Negative marks are applied only to incorrect answered items when the assessment enables negative marking.
- Likert values use a five-point scale. Situational options carry server-side values from 1–5. Reverse-scored values are inverted (`6 - response`) before a weighted dimension average is calculated.
- A candidate can have one attempt per assessment. Repeated start returns that attempt; repeated submit returns its existing result.
- At expiry, the attempt is submitted automatically. A candidate may also submit early after reviewing answers.

## API outline

All routes are prefixed with `/api`. Except for health and sign-in, send `Authorization: Bearer <token>`.

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/auth/sign-in` | Public | Sign in |
| GET/POST/PATCH | `/questions`, `/questions/:id` | Admin | Manage question bank |
| POST | `/questions/:id/archive` | Admin | Archive after explicit confirmation |
| GET | `/categories`, `/dimensions` | Admin | Load question metadata |
| GET/POST | `/assessments` | Signed in / Admin | List and create assessments |
| GET/PATCH | `/assessments/:id` | Signed in / Admin | View or update draft settings |
| PUT | `/assessments/:id/blueprint` | Admin | Replace draft quotas |
| POST | `/assessments/:id/publish` | Admin | Validate and publish |
| POST | `/assessments/:id/unpublish` | Admin | Return an assessment with no attempts to draft |
| POST | `/assessments/:id/attempts` | Candidate | Start or resume |
| GET | `/attempts/:id` | Candidate owner | Resume a safe attempt snapshot |
| PUT | `/attempts/:id/responses` | Candidate owner | Save an answer |
| PATCH | `/attempts/:id/flag` | Candidate owner | Flag/unflag a question |
| POST | `/attempts/:id/submit` | Candidate owner | Submit and score once |
| GET | `/attempts/:id/result` | Candidate owner | Read own result |
| GET | `/results` | Admin | List completed results |

Errors use `{ "error": { "code": "...", "message": "..." } }`.

## Validation

```powershell
cd backend
npm test
npm run build
```

```powershell
cd frontend
npm run build
```

`npm test` creates an isolated `backend/prisma/test.db`, runs the workflow tests, and removes all test records. Five SQL challenge queries and the data model notes are in [`docs/assessment-queries.sql`](docs/assessment-queries.sql) and [`docs/architecture.md`](docs/architecture.md).

## Scope and limitations

- Synthetic seed data only; no external email, proctoring, or live execution of candidate SQL.
- Authentication is intentionally lightweight for this local assignment: JWT sessions, seeded accounts, and no password reset or production account-management flow.
- Draft assessment settings and quota rows can be edited before candidates start. Section names and assessment type are fixed after creation.
- No production deployment, rate limiting, refresh tokens, audit trail, or clinical validity claims are included.
