# Question Wizard

A Node.js website with a three-step wizard: enter any domain, enter a subdomain,
then generate and answer a multiple-choice question with four choices and an explanation.
Use **Suggest domains with AI** for domain ideas. Continuing to the subdomain
step automatically suggests related subdomains; **Suggest subdomains with AI**
refreshes them. Click a suggestion to fill the field, or type any topic yourself.
Suggestions use the same server-side OpenAI key and model as question generation.
No npm dependencies required. Requires Node.js 24 or newer.

## Run

Install Node.js 24 or newer. Copy the configuration template:

```sh
cp .env.example .env
```

Add your API key to `.env`, then run:

```sh
npm start
```

Open http://localhost:3000 to use the wizard.

The server automatically loads `.env` from the app directory. Set
`OPENAI_API_KEY` there before starting the app. Existing environment variables
take precedence over `.env` values. The key
stays on the server; never put it in browser code or commit it. Generation uses
the OpenAI Responses API and defaults to `gpt-4o-mini`. Set `OPENAI_MODEL` to
use another model supporting Structured Outputs. Without a key, the wizard
loads but generation displays a configuration error. AI-generated questions
may need review for factual accuracy.

To use a different port:

```sh
PORT=8080 npm start
```

## Docker and Cloud Run

Build and run the container locally:

```sh
docker build --platform linux/amd64 -t hello-world-app .
docker run --rm --env-file .env -e PORT=8080 -p 8080:8080 hello-world-app
```

Open http://localhost:8080. The container runs as a non-root user and listens
on `0.0.0.0` using Cloud Run's `PORT` environment variable (default: 8080).

Deploy from this directory using the Google Cloud CLI, replacing the project
and region placeholders:

```sh
gcloud run deploy hello-world-app --source . --project YOUR_PROJECT_ID --region YOUR_REGION
```

The source deployment builds the image using the Dockerfile. Follow the CLI
prompts to choose whether the website allows unauthenticated access.

Configure `OPENAI_API_KEY` as a Cloud Run secret-backed environment variable
before generating questions. The service account needs access to that secret.
The local `.env` is excluded from Git and Docker builds. Cloud Run environment
variables work without a `.env` file in the container.

## xAPI learning activity tracking

Fill in these `.env` settings and restart the server:

```dotenv
XAPI_ENABLED=true
XAPI_LRS_URL=https://lrs.example.com/xapi/
XAPI_USERNAME=your-lrs-key
XAPI_PASSWORD=your-lrs-secret
XAPI_AUTH_TOKEN=
XAPI_ACTIVITY_BASE_URL=https://your-service.run.app/
XAPI_SIGNING_SECRET=replace-with-a-random-secret-of-at-least-32-characters
```

`XAPI_LRS_URL` accepts an xAPI base endpoint or the full `/statements` URL.
Use your LRS's Basic authentication key/secret as the username/password, or
set `XAPI_AUTH_TOKEN` for bearer authentication instead. Generate a signing
secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Keep this secret the same across Cloud Run instances and deployments.
Keep the activity base URL stable so learner and question identifiers use the
same namespace. Cloud Run needs these settings as environment variables or
secret-backed environment variables; the local `.env` is not uploaded.

The browser sends activity events to the app server, which builds xAPI 1.0.3
statements and sends them to the LRS. LRS credentials never reach the browser.
Tracking begins on page load, before any question is generated. Events include
every click (including non-button areas), double-click, context-menu action,
field input/change, focus/blur, keydown, wizard navigation, invalid form input,
generation started/succeeded/failed, page open/exit, visibility changes, and
AI suggestion requests/results and selected suggestions, plus
scroll position after scrolling stops for 250 ms. Keyboard activity records
navigation keys or the category `character`; it does not collect raw typed keys
or clipboard contents. Domain/subdomain field values are recorded on edits.
Click details identify the element tag/ID, button label, or choice index.

Learning events include question viewed (`experienced`), choice selected (`interacted`),
answer submitted (`answered`), and leaving an unanswered question (`terminated`).
Records contain the question, choices, domain/subdomain, selected answer,
elapsed time since the question appeared, and submission correctness/score.
Question data is signed so the server computes correctness from the generated
question rather than a client-supplied score. Question tokens expire after 24 hours.

An anonymous learner UUID persists in local storage; a session UUID in session
storage groups activity using xAPI `context.registration`. These are browser
identifiers, not authenticated user identities. Clearing storage starts a new
learner identity. If storage is unavailable, identifiers last only for the page.
Elapsed time includes idle/background time; it is not a measure of active attention.

Tracking defaults to disabled until configured. A visible notice appears when
tracking is enabled. LRS failures display a save warning without blocking the
quiz. The browser keeps pending records in session storage and sends batches,
retrying failures while the page is open and when connectivity returns. Pending
records survive reloads in the same tab, subject to browser storage availability.
The server retries temporary failures up to three times with the same
statement UUID using PUT. Original event timestamps are retained across retries.
Expired/invalid records are isolated so they cannot block newer events.
Page-exit events use a beacon as well as keepalive delivery, but closing a tab,
clearing storage, or a long outage can still lose events. Repeated answer
submissions are recorded as separate attempts. This tracks actions on this
website; it cannot observe actions in other browser tabs or outside the page.

Run `npm test` to check question generation and xAPI statement construction,
input validation, authentication headers, retries, and LRS failure handling.
