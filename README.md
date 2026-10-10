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
  "username": "demo.user",
  "password": "demo.user"
}
```

**Success — 200:**

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "demo.user",
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
  "pdfUrl": null,
  "status": "available"
}
```

Required: `title`, `author`, `status` (`available`/`borrowed`). Everything else is optional (`null` when empty); `coverColor` defaults to `#4a5568`. Full field rules: `documents/backend-api-specification.md` §3.1.

**Success — 201:** `{ "success": true, "book": { ...all fields incl. uploadedBy, uploadedAt } }`.

**Error — 400** (validation, with per-field codes):

```json
{ "success": false, "errorKey": "admin.books.invalidFields", "fields": { "year": "out_of_range" } }
```

**Error — 409** (ISBN already in use, ignoring hyphens):

```json
{ "success": false, "errorKey": "admin.books.duplicateIsbn" }
```

**Errors:** standard 401; 403 `{ "success": false, "errorKey": "admin.forbidden" }`.

---

### POST /api/books/import

Bulk-creates books from a CSV file. **Admin only.** The import is **all-or-nothing**: if any row is invalid (or any ISBN already exists), nothing is inserted and every offending row is reported.

- **Endpoint**: `POST /api/books/import`
- **Authentication**: Required. Admin role required (`403` + `admin.forbidden` otherwise).
- **Rate limit**: 10 requests/minute per admin (`429` + `admin.rateLimited`).
- **Request**: the CSV document is sent as the **raw request body** with `Content-Type: text/csv` (not `multipart/form-data`, not JSON). Max **1 MB** and **500 data rows**.
- **Template**: [`documents/templates/books-import-template.csv`](documents/templates/books-import-template.csv)

#### CSV format

UTF-8 (BOM allowed), comma-separated, CRLF or LF line endings, RFC 4180 quoting (wrap a cell in `"` if it contains commas, quotes or line breaks; escape `"` as `""`). The first row is a **header** with exact, case-sensitive column names, in any order. Blank lines are ignored. An empty cell means "not provided".

| Column | Required | Rules (identical to `POST /books`) |
|---|---|---|
| `title` | Yes | 1–255 chars. |
| `author` | Yes | 1–255 chars. |
| `status` | Yes | `available` or `borrowed`. |
| `genre` | No | ≤ 100 chars. |
| `year` | No | Integer, `0` ≤ year ≤ current year + 1. |
| `isbn` | No | 10 or 13 digits after removing hyphens (ISBN-10 may end in `X`). Must be unique in the file and in the catalog, ignoring hyphens. |
| `pdfUrl` | No | Absolute `http`/`https` URL, ≤ 2048 chars. |
| `summary` | No | ≤ 2000 chars. |
| `coverColor` | No | `#RRGGBB`. Defaults to `#4a5568`. |

Only `title`, `author` and `status` must appear in the header; the optional columns may be omitted entirely. Unknown or duplicated column names are rejected. `uploadedBy` is set from the bearer token and `uploadedAt` by the database.

#### Example request

```bash
curl -X POST http://localhost:3000/api/books/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/csv" \
  --data-binary @documents/templates/books-import-template.csv
```

From the browser: `fetch('/api/books/import', { method: 'POST', headers: { Authorization: ..., 'Content-Type': 'text/csv' }, body: file })`.

#### Success Response (HTTP 201)

```json
{ "success": true, "imported": 3 }
```

#### Error Responses

| HTTP Status | `errorKey` | Description |
|---|---|---|
| 400 | `admin.books.import.invalidFile` | Body is empty, has a header but no data rows, or has an unterminated quote. |
| 400 | `admin.books.import.invalidHeader` | Missing required / unknown / duplicated columns; body includes `missing`, `unknown`, `duplicated` arrays. |
| 400 | `admin.books.import.tooManyRows` | More than 500 data rows; body includes `maxRows`. |
| 400 | `admin.books.import.invalidRows` | One or more rows failed validation; body includes `errors`. |
| 401 | — | Standard (Section 6). |
| 403 | `admin.forbidden` | Caller is not an admin. |
| 409 | `admin.books.import.duplicateIsbn` | ISBN(s) already in the catalog; body includes `errors`. |
| 413 | `admin.books.import.fileTooLarge` | Body exceeds 1 MB; body includes `maxBytes`. |
| 415 | `admin.books.import.unsupportedMediaType` | `Content-Type` is not `text/csv`. |
| 429 | `admin.rateLimited` | Rate limit exceeded. |

`errors` is an array of `{ "line": <1-based line in the file>, "fields": { <column>: <code> } }`. Field codes are the same as `POST /books` (`required`, `too_long`, `invalid`, `invalid_type`, `out_of_range`), plus `duplicate_in_file` and `duplicate` (ISBN already in the catalog) for `isbn`, and `{ "row": "column_count_mismatch" }` when a row has a different number of cells than the header.

```json
{
  "success": false,
  "errorKey": "admin.books.import.invalidRows",
  "errors": [
    { "line": 3, "fields": { "title": "required" } },
    { "line": 5, "fields": { "year": "invalid_type", "status": "invalid" } }
  ]
}
```

One audit-log entry (`book.import`, `metadata: { count }`) is written in the same transaction as the inserts.

Full contract: `documents/backend-api-specification.md` §3.4.

---

### GET / PATCH / DELETE /api/admin/users

Admin-only user management: `GET /admin/users?page=&pageSize=&query=` (paginated, searchable), `PATCH /admin/users/:username` (`{ email }` and/or `{ enabled }`), `DELETE /admin/users/:username`. Contract and error keys: `documents/backend-api-specification.md` §5.3.

---

### PATCH /api/admin/users/:username/password

Admin-only. Body `{ "newPassword": "<≥ 8 chars>" }` → `200 { "success": true, "username": "..." }`. Signs the target user out everywhere. Errors: 400 `admin.resetPassword.weakPassword` / `admin.resetPassword.useAccountPage`, 403 `admin.forbidden`, 404 `admin.resetPassword.userNotFound`, 429 `admin.rateLimited` (20/min per admin). See `documents/backend-api-specification.md` §5.2.

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
  "currentPassword": "oldSecurePass123",
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
| `admin.forbidden` | `/admin/*`, `POST /books`, `POST /books/import` | Caller is not an admin (403). |
| `admin.books.invalidFields` | `POST /books` | One or more fields fail validation (see `fields`). |
| `admin.books.duplicateIsbn` | `POST /books` | A book with the given ISBN already exists. |
| `admin.books.import.*` | `POST /books/import` | `invalidFile`, `invalidHeader`, `tooManyRows`, `invalidRows`, `duplicateIsbn`, `fileTooLarge`, `unsupportedMediaType`. See spec §3.4. |
| `admin.users.*` | `/admin/users` | `notFound`, `invalidEmail`, `invalidFields`, `duplicateEmail`, `cannotModifySelf`, `lastAdmin`. See spec §5.3. |
| `login.accountDisabled` | `POST /auth/login` | Correct credentials but the account is disabled (403). |
| `admin.resetPassword.*` | `PATCH /admin/users/:username/password` | `weakPassword`, `userNotFound`, `useAccountPage`. |
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
username: demo.user
password: demo.user
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

Tests run against a disposable `library_test` database. `tests/global-setup.js` applies any pending Liquibase changesets on every run and keeps the data as the last run left it. Use `npm run test:fresh` (or `scripts/ensure-test-db.sh --teardown`) to drop and recreate `library_test` first, so the run starts from an empty schema. Nothing is mocked — tests exercise the real Express app and the real database through Prisma.

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
    global-setup.js           # applies pending Liquibase changesets to the test DB before each run
    auth.test.js
    books.test.js
    changelog.test.js
    users.test.js
  scripts/
    migrate-test-db.sh        # liquibase update against library_test
    ensure-test-db.sh         # starts the db container / creates library_test; --teardown drops it first
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
