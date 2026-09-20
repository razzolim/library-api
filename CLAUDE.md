# CLAUDE.md

Guidance for coding agents working in this repository.

## Project context

This is the backend for `library-portal` (a Vue 3 frontend). The API contract this service
implements lives in `documents/backend-api-specification.md`. Architectural decisions live in
`documents/adr/decisions.md` — read it before touching auth, the schema, or making any
architectural change; most "why is this so minimal" or "why isn't this just X" questions are
answered there.

## Stack (do not swap without a new ADR)

- Node.js 20, plain JavaScript (ES Modules) — no TypeScript.
- Express for HTTP, Prisma Client + PostgreSQL for persistence (local dev via
  `docker-compose.yml`), Liquibase for schema migrations, `jsonwebtoken` + `bcryptjs` for auth.
- npm as the package manager. Vitest + Supertest for tests.

If a change would swap any of these (e.g. Postgres → another database, Liquibase → another
migration tool, JS → TypeScript, Express → something else), write a new ADR explaining why before
making the change. Several of these swaps are anticipated in ADR-0001's, ADR-0003's, and
ADR-0004's "Consequences" sections as natural next steps — but the decision to actually make the
jump belongs in a new ADR, not a silent dependency bump.

## Conventions

- Layering: `routes/` → `controllers/` → `services/` → `lib/` (Prisma/JWT clients). Keep
  controllers thin (HTTP concerns: parse request, set status, shape response); business logic and
  Prisma calls belong in `services/`.
- All modules use ESM `import`/`export` (`package.json` has `"type": "module"`).
- Never return the `password` field from any endpoint. Only the public profile shape (`id`,
  `username`, `fullName`, `role`) leaves the API — see `auth.service.js` for the mapping.
- `src/middleware/auth.js` is the single source of truth for bearer-token validation, including
  the revoked-token (logout) check. Protected routes must use it rather than re-implementing token
  checks inline.
- Every token gets a `jti` claim from `signToken` (`src/lib/jwt.js`) — don't call `jwt.sign`
  directly elsewhere, or logout won't be able to target that token.
- Keep `prisma/seed.js` idempotent (`upsert`, not `create`) — it runs on every container start via
  the Dockerfile `CMD`, not just once at provisioning time.
- Never hardcode credentials in source, including seed/demo data — `prisma/seed.js` sources the
  demo user from `DEMO_USER_USERNAME` / `DEMO_USER_PASSWORD` / `DEMO_USER_FULL_NAME` /
  `DEMO_USER_ROLE` (via `requireEnv`, no in-code fallback) rather than a literal object. `.env` /
  `.env.example` hold the values (the Dockerfile also bakes in the same non-secret `reader`/`reader`
  defaults as `ENV` so the image seeds out of the box). If you add more seed data with a
  credential-shaped field, follow the same pattern instead of writing the value into the script.
- Match the response shapes in `documents/backend-api-specification.md` exactly, including
  error bodies (e.g. `{ success: false, errorKey: 'login.invalidCredentials' }`) — the frontend is
  already built against these exact shapes and does not tolerate drift.
- **Naming convention: snake_case in the database, camelCase everywhere else.** Table and column
  names are snake_case in SQL (`user`, `book`, `revoked_token`, `full_name`, `cover_color`,
  `expires_at`, `created_at`, etc.), mapped via `@@map`/`@map` in `prisma/schema.prisma`. Prisma
  model and field names stay camelCase (`fullName`, `coverColor`, ...) to match idiomatic JS and
  the JSON API contract — the frontend has always received (and must keep receiving) camelCase
  fields regardless of how the database stores them. When adding a model/field: give the Prisma
  side a normal camelCase name with the matching snake_case `@map`/`@@map`, **and** add the
  matching column/table DDL to the relevant `liquibase/changesets/*.sql` file (snake_case there
  too) — since ADR-0004, Prisma no longer generates migrations from `schema.prisma`, so these two
  files only stay in sync if you edit both by hand. Don't write raw SQL elsewhere that assumes one
  casing without checking `schema.prisma` first.

## Running things

- `npm run dev` — start with file-watch reload.
- `npm test` — run the Vitest suite against a disposable `library_test` PostgreSQL database
  (requires `docker compose up -d db`; see `docker-compose.yml` / `docker/init-test-db.sh`),
  reset fresh on every run by `tests/global-setup.js`. Tests hit the real Express app and a real
  database through Prisma; don't add mocking of Prisma or the database into these tests.
- `npm run db:migrate` — applies the Liquibase changelog (`liquibase/changelog-master.yaml` →
  `liquibase/changesets/*.sql`) to the `library` database via the `liquibase` Docker service
  (`docker compose run --rm liquibase update`; requires `docker compose up -d db` first, and
  Docker generally — there is no local/JVM Liquibase install in this project, see ADR-0004). After
  changing schema, also run `npx prisma generate` so the Prisma Client picks up the corresponding
  `prisma/schema.prisma` edit.
- **This project has not shipped/deployed yet — there is only one set of changesets**
  (`liquibase/changesets/00N-*.sql`, one file per table). Until that changes, don't add new
  changeset files for a schema tweak: edit the relevant existing file directly (and
  `prisma/schema.prisma` to match), then rebuild both local databases from scratch rather than
  trying to layer a change on top — Liquibase checksums an already-applied changeset and will
  refuse to reapply it if its SQL changed. For `library_test`, `scripts/migrate-test-db.sh` (used
  by `tests/global-setup.js`) already does this (`liquibase drop-all --force && liquibase
  update`) on every test run. For `library`, run the same two commands by hand against it (or just
  drop/recreate the `library` database via `psql` and rerun `npm run db:migrate`). Only start
  appending new changeset files once this has a real deployment history that an edit-in-place
  would need to rewrite.
- `npm run db:studio` — inspect local data via Prisma Studio.

## Adding endpoints

- Follow the existing `/books` pattern: the route file wires path + `authenticate` middleware, the
  controller parses the request and formats the response, the service talks to Prisma.
- Check Section 9 of `documents/backend-api-specification.md` before inventing new response
  shapes — several near-future endpoints (book CRUD, borrow/return, `/me`, `/refresh`) are already
  specified there and should be implemented to match, not redesigned.
- `GET /books` and `GET /books/:id` intentionally return different field sets: the list endpoint
  uses `LIST_FIELDS` in `src/services/books.service.js` to omit `summary` (kept light for the
  catalog grid), while the detail endpoint returns the full row. If you add another "heavy" Book
  field meant for the detail view only, add it to the Prisma model but leave it out of
  `LIST_FIELDS` rather than defaulting to returning everything everywhere.

## Git workflow

- Always work directly on the branch the user currently has checked out. Do not create worktrees, switch branches, or check out a different branch unless the user explicitly asks for it.
- Never commit or push changes to origin unless the user explicitly requests it. Make edits to the working tree and let the user decide when to stage, commit, and push.

## Things to avoid

- Don't add a validation library, alternate ORM, or auth framework "for later" — the current scope
  is intentionally minimal per ADR-0001's rejected-alternatives section. Raise it with the user
  before introducing a new category of dependency.
- Don't commit `.env` — already gitignored. The Postgres data directory lives in a Docker-managed
  named volume (`db-data` in `docker-compose.yml`), not a bind-mounted project path, so there's
  nothing database-related to gitignore anymore.
- Don't change the bearer-token / `Authorization` header auth model to cookies or sessions — the
  frontend's HTTP client is already built around reading a token from `localStorage` and sending it
  as `Authorization: Bearer <token>` on every request.
