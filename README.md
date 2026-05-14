# 🚂 NCZ Portal Backend

This is the NextJS backend server for the NCZ Portal. It provides RESTful API endpoints for handling requests, integrates with MSSQL for database operations, uses Firebase Admin SDK for authentication and storage, and supports scheduled tasks with cron jobs.

## Features

- RESTful API for core functionality
- Database integration with MSSQL via TypeORM
- Firebase Admin SDK for user authentication and cloud storage
- Scheduled tasks using @nestjs/schedule
- File upload handling with processing (e.g., images via Sharp)
- Environment-based configuration

## Prerequisites

- Node.js (version 18 or higher)
- pnpm (or npm/yarn) package manager
- MSSQL database server
- Firebase project with Admin SDK credentials

## Installation

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the example environment file and configure it:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your specific configurations (e.g., database credentials, Firebase keys, port).

   For Looker Studio export with a public report, no Google auth variables are required.
   - Optional runtime settings:
     - `LOOKER_PUPPETEER_HEADLESS=true`
     - `LOOKER_PUPPETEER_USER_DATA_DIR=./.puppeteer-looker-profile`
     - `LOOKER_PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`

   If report generation runs on a server, make sure the Puppeteer browser is available there as well. Installing the npm package alone is not always enough if browser download is skipped during deploy.
   - Install dependencies with scripts enabled so Puppeteer can download Chromium.
   - Or set `LOOKER_PUPPETEER_EXECUTABLE_PATH` to an existing Chrome/Chromium binary on the server.

   For the external Python/AI service the portal calls, set `PYTHON_API_BASE_URL`. It defaults to `https://ncz-ai-server-179643055854.me-west1.run.app` when not provided.

3. Ensure your MSSQL database is running and the connection string is set in `.env`.

## Running the Project

### Development

Start the development server with hot-reload:

```bash
pnpm run start:dev
```

The app will run on `http://localhost:3001` (or the port specified in `.env`).

### Production

Build and start the production server:

```bash
pnpm run build
pnpm run start:prod
```

For production Looker Studio export configuration, use `.env.production.example` as reference.

### Testing

Run unit tests:

```bash
pnpm run test
```

Run e2e tests:

```bash
pnpm run test:e2e



We need to install Chrome/Chromium on the server. After that, Puppeteer will work properly to generate the PDF
```
