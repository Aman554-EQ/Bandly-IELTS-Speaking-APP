# Bandly: IELTS Speaking Practice

Bandly is an IELTS Speaking practice app with a realistic examiner that **listens, analyses and responds**. It runs the full three-part test with a voiced examiner, transcribes your answers and gives band scores with feedback.

**Live demo:** [bandlytest.vercel.app](https://bandlytest.vercel.app)

## Features

- **Real exam flow:** Part 1 (interview), Part 2 (cue card with 1 minute of preparation and a 2-minute talk) and Part 3 (discussion), with official timings.
- **Voiced examiners:** a female examiner (Emma) and a male examiner (James), using pre-rendered British voices.
- **Live listening:** speech-to-text after every answer, so the examiner reacts to what you said (follow-ups, "could you say a bit more?").
- **Band scores:** the four IELTS criteria (fluency and coherence, vocabulary, grammar, pronunciation), with feedback for each part.
- **Question library:** Cambridge IELTS tests by part, and cue cards by topic.
- **Admin panel:** create, edit and organise tests, questions and cue cards, with role-based permissions (user, admin, superadmin).
- **Extras:** a band score calculator, a resources page, light and dark themes, and responsive design from phones to desktop.

## Tech stack

| Area           | Tools                                                                |
| -------------- | -------------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Cache Components), React 19                  |
| Language       | TypeScript                                                           |
| Styling        | Tailwind CSS v4                                                      |
| Database       | PostgreSQL 17, Drizzle ORM (Docker locally, Neon in production)      |
| Authentication | Clerk                                                                |
| AI             | Groq: Whisper (speech-to-text) and an LLM (scoring)                  |
| Examiner voice | Kokoro TTS (pre-rendered clips, Python tool)                         |
| Testing        | Vitest (unit and database), Playwright (end-to-end, fake microphone) |
| Hosting        | Vercel                                                               |

## Requirements

- **Node.js 24** (any version 22 or later works; see `.nvmrc`)
- **pnpm 11**: `npm install -g pnpm`, or `corepack enable`
- **Docker Desktop**, for the local PostgreSQL database
- **Git**
- Optional: **Python 3.13**, only to re-render examiner voices

## Quick start

```bash
# 1. Get the code
git clone https://github.com/Aman554-EQ/Bandly-IELTS-Speaking-APP.git
cd Bandly-IELTS-Speaking-APP

# 2. Install dependencies
pnpm install

# 3. Create your settings file, then fill in the keys (see "Configuration")
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local

# 4. Start PostgreSQL in Docker, create the tables and load the starter content
pnpm db:setup                     # = pnpm db:up && pnpm db:migrate && pnpm db:seed

# 5. Run the app
pnpm dev                          # http://localhost:3000
```

Open http://localhost:3000, sign up, and start a practice test. **Allow microphone access** when the browser asks.

### Make yourself an admin (optional)

1. Set `BOOTSTRAP_SUPERADMIN_EMAIL` (and optionally `BOOTSTRAP_ADMIN_EMAIL`) in `.env.local`.
2. Run:

   ```bash
   pnpm bootstrap:admins
   ```

3. Sign in with that email. If you don't have a password yet, use "Forgot password?" or an email code to set one. You then get the **Admin** and **Superadmin** pages.

## Configuration

All settings live in **one file**: `.env.local` locally, or your host's environment variables in production. To change a key, change that one value and restart the app (or redeploy). `.env.example` lists every variable with comments. Never commit `.env.local`.

| Variable                                              | Required | What it is / where to get it                                                                                   |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `GROQ_API_KEY`                                        | Yes      | Speech-to-text and scoring. Free key at [console.groq.com/keys](https://console.groq.com/keys).                |
| `GROQ_STT_MODEL`, `GROQ_STT_FALLBACK_MODEL`           | No       | Whisper models (defaults are set).                                                                             |
| `GROQ_LLM_MODELS`, `GROQ_FAST_MODELS`                 | No       | Comma-separated model fallback chains, strongest first. Check the models your account has at console.groq.com. |
| `GROQ_TIMEOUT_MS`                                     | No       | Timeout for each Groq request in milliseconds (default 30000).                                                 |
| `DATABASE_URL`                                        | Yes      | PostgreSQL connection string. The value in `.env.example` works with the Docker database.                      |
| `DATABASE_URL_UNPOOLED`                               | Yes      | Direct (non-pooled) connection, used for migrations. Same as above locally.                                    |
| `DATABASE_URL_TEST`                                   | Tests    | Separate database for `pnpm test:db` (the Docker container creates it automatically).                          |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                   | Yes      | [dashboard.clerk.com](https://dashboard.clerk.com): create an application → **API keys**.                      |
| `CLERK_SECRET_KEY`                                    | Yes      | Same page as above.                                                                                            |
| `CLERK_WEBHOOK_SIGNING_SECRET`                        | No       | Only for Clerk webhooks (endpoint `/api/webhooks/clerk`). Users are also synced on first sign-in without it.   |
| `BOOTSTRAP_SUPERADMIN_EMAIL`, `BOOTSTRAP_ADMIN_EMAIL` | No       | Used only by `pnpm bootstrap:admins`.                                                                          |
| `E2E_CLERK_USER_EMAIL`                                | Tests    | A Clerk test address for Playwright (e.g. `you+clerk_test@example.com`).                                       |

### Using a hosted database instead of Docker

Any PostgreSQL 15+ works. For example, [Neon](https://neon.tech) has a free tier:

1. Create a project.
2. Put the **pooled** connection string in `DATABASE_URL` and the **direct** one in `DATABASE_URL_UNPOOLED`. Both end with `?sslmode=require`.
3. Run `pnpm db:migrate && pnpm db:seed`.

## Commands

| Command                                  | What it does                                                      |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                               | Start the development server (http://localhost:3000)              |
| `pnpm build` / `pnpm start`              | Production build / run it                                         |
| `pnpm check`                             | Typecheck, lint and unit tests                                    |
| `pnpm test`                              | Unit tests                                                        |
| `pnpm test:db`                           | Database tests (needs `pnpm db:up`)                               |
| `pnpm test:e2e`                          | End-to-end browser tests (Playwright, fake microphone)            |
| `pnpm test:live`                         | Live Groq listening test (needs `GROQ_LIVE=1` and the dev server) |
| `pnpm db:up` / `pnpm db:down`            | Start / stop the PostgreSQL container (data is kept)              |
| `pnpm db:migrate`                        | Apply database migrations                                         |
| `pnpm db:seed`                           | Load roles, modules and starter content (safe to re-run)          |
| `pnpm db:studio`                         | Browse the database in Drizzle Studio                             |
| `pnpm db:backup`                         | Dump the database to `backups/`                                   |
| `pnpm bootstrap:admins`                  | Create the first superadmin and admin                             |
| `pnpm voice:setup` / `pnpm voice:render` | Download the Kokoro voice models / render missing examiner lines  |
| `pnpm format`                            | Format the code with Prettier                                     |

Before the end-to-end tests run for the first time, install the browser: `pnpm exec playwright install chromium`.

## Examiner voices (optional)

The rendered voice clips are already in `public/voice/`, so the app works without Python. If you add or reword questions in the admin panel, render the new lines:

```bash
python -m venv .venv
# macOS/Linux: source .venv/bin/activate    Windows: .venv\Scripts\activate
pip install -r tools/voice/requirements.txt
pnpm voice:setup      # downloads the Kokoro models (~340 MB, once)
pnpm voice:render     # renders only the lines that are missing
```

Until a line is rendered, the app uses a browser voice of the same gender as the examiner.

## Project structure

```
src/
  app/          pages and API routes (Next.js App Router)
  components/   UI (exam room, admin, homepage, shared UI)
  engine/       exam engine: pure TypeScript, no React or network
  audio/        microphone capture and examiner voice playback
  server/       database (Drizzle), auth and roles, Groq client, settings
  content/      static content (band table, resources, question types)
drizzle/        database migrations
public/voice/   pre-rendered examiner voice clips
scripts/        database, admin and voice scripts
tools/voice/    Kokoro voice renderer (Python)
tests/          database, end-to-end and live tests
```

## Troubleshooting

| Problem                                | Fix                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm db:up` fails                     | Start Docker Desktop first. Port 5433 must be free (it's used so it won't clash with a local PostgreSQL on 5432). |
| "GROQ_API_KEY is missing"              | Add your key to `.env.local` and restart `pnpm dev`.                                                              |
| Sign-in page errors                    | Check both Clerk keys come from the same Clerk application.                                                       |
| The examiner doesn't hear you          | Allow microphone access in the browser (the address bar icon) and pick the right input device.                    |
| Database errors after pulling new code | Run `pnpm db:migrate`.                                                                                            |

## License

© Aman554-EQ. All rights reserved. Shared for learning and portfolio purposes.
