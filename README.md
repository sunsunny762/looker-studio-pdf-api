# Looker Studio PDF API

Standalone API for generating the Blue Award Looker Studio merged PDF.

## Endpoint

```text
GET /report/looker-studio/blue-award/merged-download
```

Query parameters:

- `submissionId` or `p_submission_id`: optional positive integer. Defaults to `12659`.
- `companyName`: optional filter value.
- `reportUrl`: optional single Looker Studio page URL. If omitted, all pages from `config/blue-award-report.json` are merged.
- `fileName`: optional download filename.

Example:

```bash
curl -L "http://localhost:8080/report/looker-studio/blue-award/merged-download?submissionId=123&companyName=Example%20Ltd" --output blue-award.pdf
```

Default submission example:

```bash
curl -L "http://localhost:8080/report/looker-studio/blue-award/merged-download" --output blue-award.pdf
```

## Local Run

```bash
npm install
npm run build
npm start
```

For visible browser debugging:

```bash
LOOKER_PUPPETEER_HEADLESS=false npm run start:dev
```

## Docker

```bash
docker build -t looker-studio-pdf-api .
docker run --rm -p 8080:8080 looker-studio-pdf-api
```

## Google Cloud Run

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/looker-studio-pdf-api
gcloud run deploy looker-studio-pdf-api \
  --image gcr.io/PROJECT_ID/looker-studio-pdf-api \
  --platform managed \
  --region europe-west2 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars LOOKER_PUPPETEER_HEADLESS=true,LOOKER_PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

Replace `PROJECT_ID` and region as needed.

Or deploy using the included Cloud Build config:

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions _REGION=europe-west2,_SERVICE_NAME=looker-studio-pdf-api
```
