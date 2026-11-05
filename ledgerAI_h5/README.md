# LedgerAI (mobile-first H5)

AI personal finance tracker: snap a receipt → Gemini extracts the data → review → dashboards, reports and AI insights.

```
ledgerAI_H5/
  web/                React + Vite + Tailwind + Recharts (mobile-first SPA)
  api/                Node.js (Express 5) API, Postgres schema, Gemini integration, tests
  deploy/, docker-compose.yml, web/Dockerfile  earlier single-host Docker setup (superseded by ../ledgerAI_terraform)
```

## Run locally

Requires Node 22+. No Docker needed (an embedded Postgres is used for dev).

```bash
# 1) database  (terminal 1)
cd api && npm install && npm run dev:db

# 2) API       (terminal 2)  – copy .env.example to .env and set GEMINI_API_KEY
#              or use MOCK_AI=true to develop without a key
cd api && MOCK_AI=true npm run dev          # http://localhost:4000

# 3) web       (terminal 3)
cd web && npm install && npm run dev        # http://localhost:5173 (proxies /api)
```

Open the Vite URL on your phone (same network) — note that mobile browsers only allow camera capture over HTTPS,
so for on-device camera tests use the gallery button, or tunnel with HTTPS.

Tests: `cd api && npm test` (spins up a temporary Postgres, runs the integration tests with mock AI).

Demo data: with the DB running, `cd api && npm run seed` creates/reset `demo@example.com` / `password123` with ~16 months of
sample receipts (including a duplicate charge and a large purchase to trigger the AI anomaly insights). Safe to re-run; refuses to run in production.

## What's implemented

| PRD feature | Where |
|---|---|
| Camera / gallery capture, client-side compression (max 1600px JPEG) | `web/src/pages/Home.jsx`, `web/src/utils.js` |
| Gemini vision parse with enforced JSON schema, category enum | `api/src/services/gemini.js` |
| Review/edit screen (receipt image + pre-filled form) | `web/src/components/ReviewModal.jsx` |
| Daily / Monthly (donut, top merchants, budget) / Yearly (area chart, category change) | `web/src/pages/Analytics.jsx`, `api/src/routes/analytics.js` |
| CSV export (date range + category filter, formula-injection safe) | `api/src/routes/receipts.js` |
| AI insights: anomalies, trends, tips (Gemini, with rule-based fallback) | `api/src/services/insights.js` |
| Likely recurring charges (at least three recent similar payments) | `api/src/services/recurring.js`, Analytics |
| Account: name, export all data, delete account. Country → currency (overridable) is chosen at sign-up and then locked (the API rejects changes) | `web/src/pages/Account.jsx`, `api/src/routes/profile.js`, `api/src/countries.js` |
| Admin dashboard at `/admin` (users, growth, AI usage/failures, system) — aggregates only, limited to `ADMIN_EMAILS` | `web/src/pages/Admin.jsx`, `api/src/routes/admin.js` |
| Schema | `api/src/schema.sql` |

Schema deviations from the PRD: `users.password_hash` (email+password auth), `receipts.image_key` (S3 key instead of a
URL, served via short-lived signed URLs), `receipts.image_hash` (duplicate detection), plus `budgets` and `insights` tables.

## Deploy to AWS

Infrastructure and deployment live in the sibling project `../ledgerAI_terraform` (Terraform, us-east-1):
CloudFront serves the web app (S3) and `/api/*` (EC2 running the API + Postgres), with Amazon Cognito for sign-up,
email verification and password reset. See `../ledgerAI_terraform/README.md`; deploy with `./scripts/deploy.sh`.

Auth modes: `AUTH_MODE=local` (default; built-in email/password for development and tests) or `AUTH_MODE=cognito`
(production; requires `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`). The web app uses Cognito when built with
`VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID` (the deploy script sets them).

## Notes / next steps
- Amounts from different currencies are summed as-is in analytics; the app assumes one primary currency per user.
- Receipts abandoned in the review screen are deleted by the client; add an S3 lifecycle rule as a safety net.
