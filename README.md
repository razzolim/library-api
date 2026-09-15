# Library API

Backend service for the `library-portal` frontend. It implements the MVP contract defined in
[`documents/backend-api-specification.md`](documents/backend-api-specification.md); the
technology and design decisions behind this implementation, and the alternatives that were
considered and dropped, are documented in `documents/adr/`:

- [`ADR-0001-backend-technology-stack.md`](documents/adr/ADR-0001-backend-technology-stack.md) — stack choice (Node/Express/Prisma/JWT).
- [`ADR-0002-jwt-logout-invalidation-strategy.md`](documents/adr/ADR-0002-jwt-logout-invalidation-strategy.md) — how `POST /auth/logout` actually invalidates a token.
- [`ADR-0003-database-postgresql-migration.md`](documents/adr/ADR-0003-database-postgresql-migration.md) — why the database moved from SQLite to PostgreSQL.
- [`ADR-0004-liquibase-migrations.md`](documents/adr/ADR-0004-liquibase-migrations.md) — why schema migrations moved from Prisma Migrate to Liquibase changelogs/changesets.

## Stack

- Node.js 20 (JavaScript, ES Modules — no TypeScript)
- Express
- PostgreSQL + Prisma (client/queries) + Liquibase (schema migrations)
- JWT (`jsonwebtoken`) + `bcryptjs` for password hashing
- Vitest + Supertest for tests

**Naming convention:** database tables/columns are snake_case (`user`, `full_name`,
`cover_color`, ...); everything above the ORM — Prisma model/field names, JSON request/response
bodies — stays camelCase, matching the API contract in `documents/backend-api-specification.md`.
The mapping lives in `prisma/schema.prisma` (`@@map`/`@map`); the actual DDL that creates those
snake_case tables/columns lives in `liquibase/changesets/` — the two are kept in sync by hand (see
ADR-0004).

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
docker compose up -d db     # starts Postgres, published on localhost:5432
npm run db:migrate          # applies the Liquibase changelog
npx prisma generate         # (re)generates the Prisma Client from schema.prisma
npm run db:seed
npm run dev
```

The server listens on `http://localhost:3000` by default; all routes are mounted under `/api`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on. |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string (Prisma), e.g. `postgresql://library:library@localhost:5432/library`. |
| `POSTGRES_USER` | `library` | Superuser created by the `db` service in `docker-compose.yml`. |
| `POSTGRES_PASSWORD` | `library` | Password for `POSTGRES_USER`. Non-secret local-dev default — change it for anything beyond local dev. |
| `POSTGRES_DB` | `library` | Database name created by the `db` service; matches the database segment of `DATABASE_URL`. |
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
docker compose up -d db     # if not already running
npm test
```

Runs the Vitest suite against a disposable `library_test` Postgres database (provisioned
alongside the main `library` database by `docker/init-test-db.sh` the first time the `db`
container initializes its volume). `tests/global-setup.js` rebuilds it from the Liquibase
changelog on every run via `scripts/migrate-test-db.sh` (`liquibase drop-all` + `update`), so each
run starts from a known-empty schema regardless of what a previous run left behind. Tests exercise
the real Express app and a real database through Prisma — nothing is mocked.

## Running with Docker

```bash
cp .env.example .env        # edit JWT_SECRET at minimum
docker compose up -d
```

`docker compose up -d` starts three services: `db` (Postgres, with a named volume so data
persists across restarts), `liquibase` (applies the changelog in `liquibase/`, then exits), and
`api` (built from the `Dockerfile`, waiting on `liquibase` to complete successfully before it
starts). On startup the `api` container re-runs the (idempotent) seed script and then starts the
server on the port from `.env` (`3000` by default).

Both services read their configuration from `.env` via `docker-compose.yml` (see the
[environment variables](#environment-variables) table above). The image bakes in the same
non-secret `reader`/`reader` demo defaults as `.env.example` for the four `DEMO_USER_*`
variables, so the container seeds successfully without extra flags; override them in `.env` for a
different demo account. `DATABASE_URL` and `JWT_SECRET` have no defaults in the image on purpose
— `docker-compose.yml` requires `JWT_SECRET` to be set in `.env` and constructs `DATABASE_URL`
itself from the `POSTGRES_*` variables.

To run just the database (e.g. for local `npm run dev` / `npm test` against a host-run API), use
`docker compose up -d db` instead — see [Setup](#setup) and [Testing](#testing) above.

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
  liquibase/
    changelog-master.yaml   # includeAll of changesets/ — the actual DDL source of truth
    changesets/              # one SQL-formatted changeset file per table
  tests/
    global-setup.js       # rebuilds the disposable test Postgres db (library_test) via Liquibase
    auth.test.js
    books.test.js
  scripts/
    migrate-test-db.sh     # drop-all + update against library_test, used by global-setup.js
  documents/
    backend-api-specification.md   # source API contract
    adr/                            # architecture decision records
  docker/
    init-test-db.sh        # provisions the library_test database in the db container
  Dockerfile
  docker-compose.yml       # db (Postgres) + liquibase (migrations) + api services
  README.md
  CLAUDE.md
```

## Future endpoints

Not implemented in this MVP. Section 9 of `documents/backend-api-specification.md` lists the
planned next steps: book CRUD (`POST`/`PUT`/`DELETE /books`), borrow/return, `GET /me`, and
`POST /refresh`.
