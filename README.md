# SafetySignal

Workplace safety regulatory dashboard replacing the Question Wizard. Includes sign-in and account creation, rule type and jurisdiction filters, private saved updates and review decisions, impact details, uncertainty warnings, manual acceptance, flags for expert review, and JSON report export. Responsive and keyboard accessible.

## Run locally

Requires Node.js 24+. Run `npm ci`, then `npm start`, and open http://localhost:3000.

The sign-in screen offers **Explore the sample workspace** immediately. Sample data, source digests, and analyses are clearly labeled; they are not a live regulatory feed or complete legal text. Demo reviews and preferences stay in browser local storage. No AI API is called in demo mode. Use Settings → Show empty state to preview first run. Open Respiratory protection → Generate impact analysis to see the loading state. The heat proposal demonstrates uncertainty and expert review.

## Enable cloud accounts and storage

1. Create a Firebase project and a web app. Enable Authentication → Email/Password and create a Firestore database.
2. Add localhost and your deployment hostname to Authentication's authorized domains.
3. Copy `.env.example` to `.env` **only if you do not already have one**. Merge the new Firebase settings into any existing `.env`; do not overwrite existing secrets. Set `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID` from your web app configuration.
4. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the service account JSON on a single line, or use Google Application Default Credentials. This credential is server-only. Grant the service account only the access it needs to Firestore and token verification.
5. Deploy the checked-in security rules: `npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID` (requires Firebase CLI login).
6. Create an account. A verification email is sent. Verify your email before using the real AI endpoint.

Firestore schema:

- `updates/{id}`: title, text, source, jurisdiction, rule type, stage, publication date, sample label, revision, initial analysis. Authenticated users can read; only the server writes.
- `users/{uid}`: filter preferences and saved update IDs. Private to that account.
- `users/{uid}/reviews/{id}`: accepted/flagged, explicit confirmation, interpretation version, notes, server timestamp.
- `users/{uid}/analyses/{id}`: private server-generated impact analysis and revision. Only the server writes.
- `users/{uid}/usage/{YYYY-MM-DD}`: private daily reserved AI attempt count. Only the server writes.
- `usage/{YYYY-MM-DD}`: server-only app-wide daily attempt count.

Realtime Firestore listeners refresh updates, analyses, review decisions, preferences, and usage. Security rules reject cross-user access, client-written AI usage, and acceptance without confirmation or with a stale interpretation version. Analysis and invalidation of an old review are saved atomically. Accepting records a user's decision; it does not apply compliance changes. Flagging records a request; it does not contact an expert or send an email.

## Ingestion and scheduling

The initial ingestion adapter deliberately imports static sample JSON, as allowed by the brief. It does not pretend to retrieve today's regulatory changes. Set a random `CRON_SECRET` (32+ characters). An authorized GET or POST to `/api/ingest` imports the six sample records with stable IDs and revisions:

```sh
curl -X POST http://localhost:3000/api/ingest -H "Authorization: Bearer $CRON_SECRET"
```

Vercel's configuration schedules this endpoint at 06:00 UTC daily. Add `CRON_SECRET` to the Vercel environment; the scheduler uses its bearer header. Seed once manually after setting up Firebase. Daily sample imports are idempotent and do not call AI. Replace `backend.ingest()` with an official feed adapter to receive actual changes; retain source URLs, full text or explicit digest labels, publication dates, and content revisions. This app has no verified live feed yet.

## AI and cost controls

Set the server-only `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-4o-mini`. The backend uses the [OpenAI Responses API with Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), a 45-second timeout, no automatic retries, `store: false`, a 12,000-character source cap, and at most 900 output tokens. The browser cannot choose the model, prompt, source text, or quota.

Set `AI_DAILY_USER_LIMIT` (default 10; maximum 100) and `AI_DAILY_GLOBAL_LIMIT` (default 100; maximum 1000). A Firestore transaction reserves both counters **before** sending the request, including failed or interrupted attempts. This is shared across processes and serverless instances. Resets use UTC dates. Email verification is required to reduce account abuse. Quota storage failures prevent the provider request. No real AI calls are made by the tests.

The app-wide count, model selection, and token caps bound request volume; they are not a dollar-denominated billing guarantee. Set provider project budgets and monitor actual costs too. Analysis is user-triggered; ingestion never automatically spends AI quota. Confidence labels are model self-assessments, not calibrated probabilities. Every acceptance requires a checked confirmation and a current analysis. Low-confidence results recommend expert review.

## Deploy on Vercel

Import this repository into Vercel as an Other project using the checked-in configuration. It builds the bundled browser app into `public/`, serves the backend through `api/index.js`, and routes `/api/*` requests to that handler. Add all Firebase, OpenAI, quota, and cron variables as Vercel environment variables. Never upload `.env`. Deploy Firestore rules separately and authorize the Vercel hostname in Firebase Auth. Redeploy after environment changes.

The existing container option is also retained: `docker build -t safetysignal .` and `docker run --rm --env-file .env -p 8080:8080 safetysignal`. No deployment has been performed by this repository update.

## Checks

`npm run build` bundles the Firebase client and local icons. `npm test` covers endpoint authentication failures, validation before AI spending, concurrent user/global quota exhaustion, provider failure handling, structured analysis, protected ingestion, and retained helper unit tests. `npm run test:e2e` runs browser tests for filters, empty/loading/uncertain states, confirmation gating, saved reviews, logout, and mobile layout. `npm run test:rules` runs three Firestore emulator tests for user isolation, confirmation requirements, protected quota/analysis records, and stale-review rejection (requires Java 21+). Cloud sign-in, deployed infrastructure, and real provider requests require credentials and are not verified by these local tests.

Before production, connect and validate official feeds, add role-based oversight and expert assignment, durable audit trails, error monitoring, abuse controls, and organizational review procedures. This software supports review; it cannot replace institutional legal review or field inspections.
