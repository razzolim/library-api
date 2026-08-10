# CLAUDE.md

Guidance for coding agents working in this repository.

## Project context

This is the backend for `library-portal` (a Vue 3 frontend). The API contract this service
implements lives in `documents/backend-api-specification.md`. Architectural decisions — and the
alternatives rejected in favor of them — live in `documents/adr/`:

- `ADR-0001-backend-technology-stack.md` — why Node/Express/SQLite/Prisma/JWT.
- `ADR-0002-jwt-logout-invalidation-strategy.md` — why `POST /auth/logout` uses a `jti` +
  `RevokedToken` denylist instead of client-only logout, short-lived tokens, Redis, or a
  per-user token-version claim.

Read the relevant ADR before touching auth or making any other architectural change — most "why
is this so minimal" or "why isn't this just X" questions are answered there.

## Stack (do not swap without a new ADR)

- Node.js 20, plain JavaScript (ES Modules) — no TypeScript.
- Express for HTTP, Prisma + SQLite for persistence, `jsonwebtoken` + `bcryptjs` for auth.
- npm as the package manager. Vitest + Supertest for tests.

If a change would swap any of these (e.g. SQLite → PostgreSQL, JS → TypeScript, Express →
something else), write a new ADR explaining why before making the change. Several of these swaps
are anticipated in ADR-0001's "Consequences" section as natural next steps — but the decision to
actually make the jump belongs in a new ADR, not a silent dependency bump.

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
  side a normal camelCase name and add the matching snake_case `@map`/`@@map`; don't let the two
  drift, and don't write raw SQL that assumes one casing without checking `schema.prisma` first.

## Running things

- `npm run dev` — start with file-watch reload.
- `npm test` — run the Vitest suite against a disposable SQLite database created fresh by
  `tests/global-setup.js`. Tests hit the real Express app and a real database through Prisma; don't
  add mocking of Prisma or the database into these tests.
- `npx prisma migrate dev --name <change>` — create and apply a migration after editing
  `prisma/schema.prisma`. This requires an interactive TTY; in a non-interactive shell (e.g. an
  agent session) it fails outright, including with `--create-only`. In that case, hand-write the
  migration folder (`prisma/migrations/<UTC-timestamp>_<name>/migration.sql`, timestamp from
  `date -u +%Y%m%d%H%M%S`) and apply it with `npx prisma migrate deploy` (non-interactive), then
  `npx prisma generate`. For column/table renames specifically, prefer real `ALTER TABLE ... RENAME
  COLUMN`/`RENAME TO` statements over Prisma's default add-new-drop-old diff — the latter loses
  data when the table already has rows, which `migrate dev` will itself refuse to do for that
  reason.
- **This project has not shipped/deployed yet — there is only ever one migration
  (`prisma/migrations/20260809184115_init/`).** Until that changes, don't add a second migration
  folder for a schema tweak: edit `20260809184115_init/migration.sql` directly (and
  `prisma/schema.prisma` to match), then reset the local `dev.db`/`test.db` (both gitignored,
  disposable) and reapply. Only start creating separate incremental migrations once this has a
  real deployment history that a squash would need to rewrite.
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

## Things to avoid

- Don't add a validation library, alternate ORM, or auth framework "for later" — the current scope
  is intentionally minimal per ADR-0001's rejected-alternatives section. Raise it with the user
  before introducing a new category of dependency.
- Don't commit `prisma/dev.db`, `prisma/test.db`, `.env`, or anything under a Docker-mounted
  `data/` directory — all already gitignored.
- Don't change the bearer-token / `Authorization` header auth model to cookies or sessions — the
  frontend's HTTP client is already built around reading a token from `localStorage` and sending it
  as `Authorization: Bearer <token>` on every request.
