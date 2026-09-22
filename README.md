# Library API

Backend service for the `library-portal` Vue 3 frontend. Implements the API contract in [`documents/backend-api-specification.md`](documents/backend-api-specification.md). Architecture decisions are in [`documents/adr/decisions.md`](documents/adr/decisions.md).

---

## API Reference

> **For frontend integrators.** Everything below is what a UI client needs to call this service — base URL, auth conventions, every endpoint, all response shapes, and every error key.

### Base URL and conventions

- Base URL: `http://localhost:3000/api` (production value configured via `PORT` on the backend and `VITE_API_BASE_URL` on the frontend).
- All request and response bodies are JSON (`Content-Type: application/json`).
- All field names in JSON are **camelCase** regardless of how they're stored in the database.

### Authentication

Bearer-token auth. After a successful login, store the token in `localStorage` under the key `library_portal_auth` and attach it to every protected request:

```
Authorization: Bearer <token>
```

**Standard 401 response** (returned by every protected route when the token is missing, malformed, expired, or has been revoked via logout):

```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid token"
}
```

---

### POST /api/auth/login

Exchanges credentials for a bearer token and the user's public profile.

**Authentication:** none (public endpoint).

**Request body:**

```json
{
  "username": "reader",
  "password": "reader"
}
```

**Success — 200:**

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "reader",
    "fullName": "Demo Reader",
    "role": "reader"
  },
  "token": "<jwt>"
}
```

**Error — 401:**

```json
{
  "success": false,
  "errorKey": "login.invalidCredentials"
}
```

---

### POST /api/auth/logout

Revokes the presented token immediately — even before its `exp` expiry — so it can no longer be used on any protected route.

**Authentication:** required.

**Request body:** none.

**Success — 200:**

```json
{ "success": true }
```

**Errors:** standard 401 (token missing / invalid / already revoked).

---

### POST /api/auth/refresh

Token rotation: revokes the presented token and issues a fresh one with a reset expiry. No credentials needed.

**Authentication:** required.

**Request body:** none.

**Success — 200:**

```json
{
  "success": true,
  "token": "<new-jwt>"
}
```

Store the new token in `localStorage` under `library_portal_auth` and use it for all subsequent requests. The old token is immediately invalid.

**Errors:** standard 401.

---

### POST /api/books

Creates a new book entry. `uploadedBy` is set automatically from the bearer token — do not send it in the body.

**Authentication:** required. **Admin role required** (403 otherwise).

**Request body:**

```json
{
  "title": "Domain-Driven Design",
  "author": "Eric Evans",
  "year": 2003,
  "genre": "Software Architecture",
  "isbn": "978-0321125217",
  "coverColor": "#553c9a",
  "summary": "Tackling complexity in the heart of software.",
  "pdfUrl": null
}
```

Required fields: `title`, `author`, `year`, `genre`, `isbn`, `coverColor`, `summary`. `pdfUrl` and `status` are optional (`status` defaults to `"available"`).

**Success — 201:** the created book record (all fields including `uploadedBy`, `uploadedAt`, `summary`, `pdfUrl`).

**Error — 400** (missing required field):

```json
{ "success": false, "errorKey": "books.create.missingFields" }
```

**Error — 409** (ISBN already in use):

```json
{ "success": false, "errorKey": "books.create.isbnConflict" }
```

**Errors:** standard 401, 403.

---

### GET /api/books

Returns the complete book catalog.

**Authentication:** required.

**Success — 200** (array, stable order):

```json
[
  {
    "id": 1,
    "title": "The Pragmatic Programmer",
    "author": "Andrew Hunt & David Thomas",
    "year": 1999,
    "genre": "Software Engineering",
    "status": "available",
    "isbn": "978-0201616224",
    "coverColor": "#4a5568",
    "uploadedBy": "lib-admin",
    "uploadedAt": "2026-09-22T10:00:00.000Z"
  }
]
```

`status` is either `"available"` or `"borrowed"`. `coverColor` is a hex string. `summary` and `pdfUrl` are intentionally omitted here — see `GET /api/books/:id`.

**Errors:** standard 401.

---

### GET /api/books/:id

Returns a single book with the full detail fields.

**Authentication:** required.

**Success — 200:**

```json
{
  "id": 1,
  "title": "The Pragmatic Programmer",
  "author": "Andrew Hunt & David Thomas",
  "year": 1999,
  "genre": "Software Engineering",
  "status": "available",
  "isbn": "978-0201616224",
  "coverColor": "#4a5568",
  "summary": "A catalog of practical, tool-agnostic habits...",
  "pdfUrl": "https://drive.google.com/file/d/...",
  "uploadedBy": "lib-admin",
  "uploadedAt": "2026-09-22T10:00:00.000Z"
}
```

`pdfUrl` is `string | null` — `null` means no online copy; hide any "Read online" action in that case.

**Error — 404:** empty body (no JSON). Treat any `404` status as "book not found".

**Errors:** standard 401.

---

### GET /api/changelog

Returns the portal's release history, newest first.

**Authentication:** required.

**Success — 200** (array ordered by `date` descending):

```json
[
  {
    "id": 4,
    "version": "1.3.0",
    "date": "2026-08-15",
    "title": "Profile menu and account page",
    "description": "## What's new\n\n- ..."
  }
]
```

`description` is Markdown-formatted. Render it as sanitized HTML.

**Errors:** standard 401.

---

### PATCH /api/users/me/password

Changes the authenticated user's own password.

**Authentication:** required (user identity comes from the bearer token — not the request body).

**Request body:**

```json
{
  "currentPassword": "reader",
  "newPassword": "newSecurePass123"
}
```

Both fields are required.

**Success — 200:**

```json
{ "success": true }
```

The existing token remains valid after the change. To also invalidate the session, call `POST /api/auth/logout` separately.

**Error — 400** (missing field):

```json
{
  "success": false,
  "errorKey": "users.changePassword.missingFields"
}
```

**Error — 401** (wrong current password):

```json
{
  "success": false,
  "errorKey": "users.changePassword.wrongCurrentPassword"
}
```

**Errors:** standard 401 (bad/missing token).

---

### Error key reference

All structured error responses carry an `errorKey` for frontend i18n:

| `errorKey` | Endpoint | Meaning |
|---|---|---|
| `login.invalidCredentials` | `POST /auth/login` | Username not found or password mismatch. |
| `books.create.missingFields` | `POST /books` | One or more required book fields are absent. |
| `books.create.isbnConflict` | `POST /books` | A book with the given ISBN already exists. |
| `users.changePassword.missingFields` | `PATCH /users/me/password` | `currentPassword` or `newPassword` is absent. |
| `users.changePassword.wrongCurrentPassword` | `PATCH /users/me/password` | `currentPassword` does not match the stored hash. |

---

## Stack

- Node.js 20 (JavaScript, ES Modules — no TypeScript)
- Express 4
- PostgreSQL 16 + Prisma Client (queries) + Liquibase (schema migrations)
- `jsonwebtoken` (HS256) + `bcryptjs` for auth
- Vitest + Supertest for tests

**Naming convention:** database tables/columns are `snake_case`; everything above the ORM (Prisma model/field names, JSON bodies) is `camelCase`. The mapping lives in `prisma/schema.prisma` (`@@map`/`@map`); DDL lives in `liquibase/changesets/`.

Architecture decisions and rejected alternatives are documented in [`documents/adr/decisions.md`](documents/adr/decisions.md).

---

## Local development setup

### Prerequisites

- Node.js 20+
- npm
- Docker (for Postgres and Liquibase — no local installs needed beyond these)

### Steps

```bash
npm install
cp .env.example .env        # edit JWT_SECRET at minimum
docker compose up -d db     # starts Postgres on localhost:5432
npm run db:migrate          # applies the Liquibase changelog
npx prisma generate         # (re)generates the Prisma Client from schema.prisma
npm run db:seed             # inserts demo user, 12 books, 4 changelog entries
npm run dev                 # starts the server with file-watch reload
```

The server listens on `http://localhost:3000`; all routes are mounted under `/api`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on. |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string, e.g. `postgresql://library:library@localhost:5432/library`. |
| `POSTGRES_USER` | `library` | Superuser for the `db` Docker service. |
| `POSTGRES_PASSWORD` | `library` | Password for `POSTGRES_USER`. Local-dev default only — change for any non-local environment. |
| `POSTGRES_DB` | `library` | Database name; matches the database segment of `DATABASE_URL`. |
| `JWT_SECRET` | *(required)* | Signing secret for bearer tokens. Use a long random string in production. |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime in [`jsonwebtoken`'s `expiresIn` format](https://github.com/auth0/node-jsonwebtoken#usage). |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated list of allowed origins. Set to the frontend's production URL in production. |
| `DEMO_USER_USERNAME` | *(required)* | Username for the seeded demo account. |
| `DEMO_USER_PASSWORD` | *(required)* | Plaintext password for the demo account (hashed before storage). |
| `DEMO_USER_FULL_NAME` | *(required)* | Display name for the demo account. |
| `DEMO_USER_ROLE` | *(required)* | Role for the demo account (e.g. `reader`). |

`prisma/seed.js` reads all four `DEMO_USER_*` variables via `requireEnv` and refuses to start if any are missing — there is no hardcoded fallback.

### Demo credentials

`.env.example` ships with the well-known demo credentials (see API spec Section 8.1):

```
username: reader
password: reader
```

Seeded by `npm run db:seed` / `node prisma/seed.js`, alongside 12 demo books and 4 changelog entries. Seeding is idempotent and safe to re-run.

---

## Testing

| Command | What it runs | Needs Docker |
|---|---|---|
| `npm test` | Integration tests (`tests/`) — real Express app + real PostgreSQL | Yes |
| `npm run test:integration` | Same as above | Yes |
| `npm run test:unit` | Unit tests (`src/**/*.unit.test.js`) — all deps mocked | No |

### Integration tests

```bash
docker compose up -d db
npm test
```

Tests run against a disposable `library_test` database. `tests/global-setup.js` rebuilds it from the Liquibase changelog on every run (`liquibase drop-all` + `update`), so each run starts from a clean schema. Nothing is mocked — tests exercise the real Express app and the real database through Prisma.

### Unit tests

```bash
npm run test:unit
```

No database or Docker needed. Dependencies are mocked with `vi.mock`. Unit tests live next to source files (`*.unit.test.js`) and cover:

- `src/lib/jwt.js` — token signing, verification, missing-secret errors
- `src/middleware/auth.js` — all auth failure paths + happy path
- `src/services/auth.service.js` — login logic, token revocation, denylist lookup
- `src/services/books.service.js` — field selection, non-integer id guard, book creation
- `src/services/changelog.service.js` — ordering
- `src/services/users.service.js` — password verification, hash update
- `src/controllers/auth.controller.js` — HTTP response shaping, error forwarding
- `src/controllers/books.controller.js` — HTTP response shaping, 404 handling, create validation and conflict errors
- `src/controllers/changelog.controller.js` — HTTP response shaping
- `src/controllers/users.controller.js` — missing-field guard, wrong-password 401, success path

---

## Running with Docker

```bash
cp .env.example .env        # set JWT_SECRET
docker compose up -d
```

Three services start:
- `db` — PostgreSQL 16 with a named volume (`db-data`) so data persists across restarts.
- `liquibase` — applies the changelog in `liquibase/`, then exits. The `api` service waits for it to complete successfully.
- `api` — built from the Dockerfile. On startup, re-runs the idempotent seed script then starts the server.

`DATABASE_URL` and `JWT_SECRET` have no defaults in the image — they must be supplied explicitly. All other variables fall back to the demo values in `.env.example`.

To run only the database (for a host-run `npm run dev`), use `docker compose up -d db`.

---

## Project structure

```
library-api/
  src/
    app.js                    # Express app (routes, CORS, error handling)
    server.js                 # process entrypoint (PORT binding)
    routes/                   # path + middleware wiring
      auth.routes.js
      books.routes.js
      changelog.routes.js
      users.routes.js
    controllers/              # HTTP-layer: parse request, set status, shape response
      auth.controller.js         auth.controller.unit.test.js
      books.controller.js        books.controller.unit.test.js
      changelog.controller.js    changelog.controller.unit.test.js
      users.controller.js        users.controller.unit.test.js
    services/                 # business logic + Prisma access
      auth.service.js            auth.service.unit.test.js
      books.service.js           books.service.unit.test.js
      changelog.service.js       changelog.service.unit.test.js
      users.service.js           users.service.unit.test.js
    middleware/
      auth.js                 # bearer-token verification + revoked-token check
      auth.unit.test.js
    lib/
      jwt.js                  # signToken / verifyToken wrappers
      jwt.unit.test.js
      prisma.js               # shared PrismaClient singleton
  prisma/
    schema.prisma             # User, Book, RevokedToken, ChangelogEntry models
    seed.js                   # idempotent demo data (upsert-based)
  liquibase/
    changelog-master.yaml     # includeAll of changesets/
    changesets/               # one SQL-formatted changeset file per table
  tests/                      # integration tests (real Express app + real database)
    global-setup.js           # rebuilds the disposable test DB via Liquibase before each run
    auth.test.js
    books.test.js
    changelog.test.js
    users.test.js
  scripts/
    migrate-test-db.sh        # drop-all + update against library_test
  documents/
    backend-api-specification.md   # full API contract (schemas, data model, error keys)
    adr/decisions.md               # architecture decisions and rejected alternatives
    release/v1.0.0.md              # Railway deployment plan for v1.0.0
  docker/
    init-test-db.sh           # provisions library_test in the db container
  Dockerfile
  docker-compose.yml          # db + liquibase + api services
  .env.example
  README.md
  CLAUDE.md
```

---

## Deployment

See [`documents/release/v1.0.0.md`](documents/release/v1.0.0.md) for the step-by-step Railway deployment plan for v1.0.0.

---

## Future endpoints

Not in v1.0.0. See Section 11 of [`documents/backend-api-specification.md`](documents/backend-api-specification.md) for the planned next steps: book update/delete, borrow/return, and `GET /api/users/me`.
