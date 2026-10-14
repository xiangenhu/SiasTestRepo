# Hello World Node.js App

A simple website using Node.js's built-in HTTP server. No dependencies required.

## Run

Install Node.js, then run:

```sh
npm start
```

Open http://localhost:3000 to see **hello world**.

To use a different port:

```sh
PORT=8080 npm start
```

## Docker and Cloud Run

Build and run the container locally:

```sh
docker build --platform linux/amd64 -t hello-world-app .
docker run --rm -p 8080:8080 hello-world-app
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
