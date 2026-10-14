# Question Wizard

A Node.js website with a three-step wizard: enter any domain, enter a subdomain,
then generate and answer a multiple-choice question with four choices and an explanation.
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
