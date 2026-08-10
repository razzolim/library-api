# Library API

Backend service for the `library-portal` frontend. It implements the MVP contract defined in
[`documents/backend-api-specification.md`](documents/backend-api-specification.md); the
technology and design decisions behind this implementation, and the alternatives that were
considered and dropped, are documented in `documents/adr/`:

- [`ADR-0001-backend-technology-stack.md`](documents/adr/ADR-0001-backend-technology-stack.md) — stack choice (Node/Express/SQLite/Prisma/JWT).
- [`ADR-0002-jwt-logout-invalidation-strategy.md`](documents/adr/ADR-0002-jwt-logout-invalidation-strategy.md) — how `POST /auth/logout` actually invalidates a token.

## Stack

- Node.js 20 (JavaScript, ES Modules — no TypeScript)
- Express
- SQLite + Prisma
- JWT (`jsonwebtoken`) + `bcryptjs` for password hashing
- Vitest + Supertest for tests

**Naming convention:** database tables/columns are snake_case (`user`, `full_name`,
`cover_color`, ...); everything above the ORM — Prisma model/field names, JSON request/response
bodies — stays camelCase, matching the API contract in `documents/backend-api-specification.md`.
The mapping lives entirely in `prisma/schema.prisma` (`@@map`/`@map`).

## Endpoints (MVP)

| Method | Path | Auth required | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | No | Exchanges `{ username, password }` for a bearer token and public user profile. |
| `POST` | `/api/auth/logout` | Yes | Revokes the presented token so it can no longer be used, even before it expires. |
| `GET` | `/api/books` | Yes | Returns the full book catalog as a JSON array. |
| `GET` | `/api/books/:id` | Yes | Returns a single book (including `summary`, which `GET /books` omits), or `404` with no body if the id doesn't exist. |

Protected routes require `Authorization: Bearer <token>`. Missing, invalid, expired, or
logged-out tokens all return `401` with
`{ "error": "Unauthorized", "message": "Missing or invalid token" }`.

Full request/response schemas, error formats, and the data model are documented in
`documents/backend-api-specification.md`.

## Prerequisites

- Node.js 20+
- npm

## Setup

```bash
npm install
cp .env.example .env        # edit JWT_SECRET at minimum
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

The server listens on `http://localhost:3000` by default; all routes are mounted under `/api`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on. |
| `DATABASE_URL` | `file:./dev.db` | SQLite connection string (Prisma), relative to `prisma/`. |
| `JWT_SECRET` | *(required)* | Secret used to sign and verify bearer tokens. |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime, in [`jsonwebtoken`'s `expiresIn` format](https://github.com/auth0/node-jsonwebtoken#usage). |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated list of allowed origins (the Vite dev server by default). |
| `DEMO_USER_USERNAME` | *(required)* | Username seeded for the demo account. |
| `DEMO_USER_PASSWORD` | *(required)* | Plaintext password seeded for the demo account (hashed before storage). |
| `DEMO_USER_FULL_NAME` | *(required)* | Display name seeded for the demo account. |
| `DEMO_USER_ROLE` | *(required)* | Role seeded for the demo account (e.g. `reader`). |

`prisma/seed.js` reads all four `DEMO_USER_*` variables and refuses to run if any are missing —
there is no hardcoded fallback, so the demo account's credentials live only in your `.env` (or
whatever injects environment variables in your deployment), never in source.

## Demo credentials

`.env.example` ships with the well-known demo credentials from
`documents/backend-api-specification.md` (Section 6.1):

```
username: reader
password: reader
```

Seeded automatically by `npm run db:seed` / `node prisma/seed.js` from the `DEMO_USER_*`
environment variables above, alongside a 12-book demo catalog spanning Software Engineering,
Software Architecture, Programming, Project Management, Computer Science, and DevOps. Seeding is
idempotent (upsert-based) and safe to re-run.

## Testing

```bash
npm test
```

Runs the Vitest suite against a disposable SQLite database (`prisma/test.db`), rebuilt from the
Prisma schema on every run via `tests/global-setup.js`. Tests exercise the real Express app and a
real database through Prisma — nothing is mocked.

## Running with Docker

```bash
docker build -t library-api .

docker run --rm -p 3000:3000 \
  -e JWT_SECRET=change-me \
  -e CORS_ORIGIN=http://localhost:5173 \
  -v library-api-data:/app/data \
  library-api
```

On startup the container applies any pending Prisma migrations, re-runs the (idempotent) seed
script, and then starts the server. Mount a volume over `/app/data` — that's where the SQLite
file (`prod.db`) lives — so data persists across container restarts.

The image bakes in the same non-secret `reader`/`reader` demo defaults as `.env.example` for the
four `DEMO_USER_*` variables, so the container seeds successfully without extra flags; override
them with `-e DEMO_USER_USERNAME=...` etc. for a different demo account. `JWT_SECRET` has no
default in the image on purpose — it must always be passed explicitly.

## Project structure

```
library-api/
  src/
    app.js              # Express app (routes, middleware, error handling)
    server.js            # process entrypoint
    routes/               # path + middleware wiring
    controllers/          # HTTP-layer request/response handling
    services/             # business logic + Prisma access
    middleware/            # auth.js — bearer token verification (incl. revoked-token check)
    lib/                   # prisma.js, jwt.js clients
  prisma/
    schema.prisma          # User, Book, RevokedToken models (snake_case DB names via @@map/@map)
    seed.js               # idempotent demo data
  tests/
    global-setup.js       # provisions the disposable test SQLite db
    auth.test.js
    books.test.js
  documents/
    backend-api-specification.md   # source API contract
    adr/                            # architecture decision records
  Dockerfile
  README.md
  CLAUDE.md
```

## Future endpoints

Not implemented in this MVP. Section 9 of `documents/backend-api-specification.md` lists the
planned next steps: book CRUD (`POST`/`PUT`/`DELETE /books`), borrow/return, `GET /me`, and
`POST /refresh`.
