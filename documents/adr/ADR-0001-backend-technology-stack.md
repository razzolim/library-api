# ADR-0001: Backend Technology Stack for Library API (MVP)

## Status

Accepted — 2026-08-09. The "Database" choice (SQLite) was superseded by
[ADR-0003](ADR-0003-database-postgresql-migration.md) on 2026-08-15; the rest of this ADR still
stands.

## Context

`library-portal` is an existing Vue 3 + Vite frontend (plain JavaScript, no TypeScript) that currently runs against a mocked API layer (`src/api/books.js`, `src/api/client.js`). The document `backend-api-specification.md` defines the contract the real backend must satisfy so the frontend can swap its three mock functions (`authenticate`, `fetchBooks`, `fetchBookById`) for real HTTP calls with no other changes.

The MVP surface is intentionally tiny:

- `POST /login` — credential check, returns `{ success, user, token }` or `{ success, errorKey }`.
- `GET /books` — protected, returns the full book catalog (client does its own filtering/sorting/pagination).
- `GET /books/:id` — protected, returns a single book or `null`/404.
- Bearer-token auth middleware on protected routes.
- CORS enabled for the Vite dev origin.
- One seeded demo user (`reader` / `reader`, password stored hashed) and 12 seeded demo books.

Section 9 of the spec lists near-future endpoints (book CRUD, borrow/return, `/me`, `/refresh`) that are explicitly **not** required for the MVP but should not be architecturally painful to add afterward. This ADR chooses the stack for the MVP while keeping that evolution path open, and records what was considered and rejected so the reasoning doesn't have to be reconstructed later.

## Decision

Build the backend as a **Node.js 20 LTS** service using:

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | JavaScript (ES Modules), no TypeScript |
| Web framework | Express 4 |
| Database | SQLite (single file) |
| ORM / migrations / seeding | Prisma |
| Password hashing | bcryptjs |
| Token issuing/verification | jsonwebtoken (HS256) |
| CORS | `cors` middleware |
| Env config | `dotenv` |
| Test runner | Vitest + Supertest |
| Package manager | npm |
| Dev reload | Node's built-in `--watch` |

### Why this combination

- **Single-language stack.** The frontend is plain JS with no build-time type checking. Using JavaScript (not TypeScript) on the backend means one language, one mental model, and no tooling asymmetry for what is currently a 3-endpoint service. `package-lock.json` in `library-portal` confirms npm as the existing package manager, so the backend follows suit for consistency across the two repos.
- **Express** is the most direct route from "read the spec" to "working endpoints." It has no opinionated project structure to fight, first-class middleware for exactly the two cross-cutting needs here (CORS, bearer-token auth), and is the framework every JS developer already knows — minimizing ramp-up for whoever implements this next.
- **SQLite** gives real persistence (durable across restarts, real SQL constraints like the unique ISBN) without requiring a database server, Docker, or any local infra setup — the entire spec's data (1 user, 12 books) fits comfortably in a single file. It removes the "works on my machine only because Postgres happened to be running" class of setup friction for an MVP.
- **Prisma** on top of SQLite gives declarative schema, migrations, and a type-safe-ish query API even in plain JS, plus a trivial seed script (`prisma/seed.js`) that maps directly to the "Seed Data Reference" section of the spec. Critically, switching the datasource from `sqlite` to `postgresql` later is a one-line change in `schema.prisma` plus a connection string — the ORM boundary is what makes the future Postgres migration cheap, which is the main reason SQLite is safe to pick now instead of feeling like a dead end.
- **bcryptjs + jsonwebtoken** directly implement the spec's explicit requirements: passwords hashed at rest, bearer token issued on login and validated via `Authorization: Bearer <token>` middleware, 401 on missing/invalid token.
- **Vitest + Supertest** mirror the frontend's existing test runner (`vitest` is already a `library-portal` devDependency), so anyone moving between the two repos doesn't need to context-switch test tooling, and CI configuration patterns can be shared.

## Alternatives Considered

### Language: TypeScript vs. JavaScript

TypeScript was considered for compile-time safety on the `Book`/`User` shapes. Rejected for the MVP because the frontend it serves is plain JS with zero TypeScript tooling — introducing TS on the backend only would add a build step, `tsconfig`, and type-definition overhead that buys little for a 3-route service and creates stack asymmetry. **Revisit when** the backend grows past the MVP endpoints (Section 9's CRUD/borrow/return/`/me`/`/refresh`) and the cost of runtime-only type errors starts to outweigh the setup cost.

### Framework: Fastify, NestJS, Koa, Hapi

- **Fastify** — faster and has built-in JSON-schema request validation, which is attractive, but it's a less universal default than Express and its schema-first ergonomics are overkill for two request bodies (`login`, and no body at all on the `GET` routes).
- **NestJS** — its DI container, decorators, and module system solve organizational problems that only appear once a codebase has many resources and cross-cutting services. For 3 endpoints it's pure ceremony: more files, more boilerplate, steeper onboarding, with no corresponding benefit yet.
- **Koa** — thinner core than Express, which means CORS/auth/error-handling middleware has to be hand-assembled from smaller pieces instead of used off the shelf. No advantage here over Express's larger, more battle-tested middleware ecosystem.

Dropped in favor of Express because none of their differentiators (schema validation, DI, minimalism) pay for themselves at this scope, and Express is the lowest-friction, most widely understood choice.

### Database: PostgreSQL, MongoDB, in-memory array, lowdb/JSON file

- **PostgreSQL** — the natural "production" choice, but it requires a running database server (local install or Docker) purely to serve 1 user and 12 books. That's infrastructure overhead the MVP doesn't need yet, and it's explicitly deferred rather than discarded: Prisma's datasource abstraction makes this a low-cost future migration once real multi-user concurrency or hosting constraints demand it.
- **MongoDB** — the data is small, flat, and relational in nature (`Book`, `User` with fixed fields and an enum status). A document store adds operational overhead (separate server/Atlas account) and schema flexibility that isn't needed here; SQL fits the shape of the data better.
- **Plain in-memory JS array** — the simplest possible option, but data resets on every server restart, which conflicts with the spec's explicit requirement to have a hashed password persisted for the demo user and undermines any manual testing/demo workflow where a restart would silently wipe borrowed/available book state once Section 9's borrow/return endpoints land.
- **lowdb / flat JSON file** — closer to a real database than an in-memory array, but it has no migration story, no constraint enforcement (e.g. unique ISBN), and no query engine — every filter would be hand-rolled JS. Since the near-future roadmap already includes writes (create/update/delete book, borrow/return), a real embedded database with proper migrations (SQLite + Prisma) was judged worth the marginal extra setup now rather than doing a data-layer rewrite in the next iteration.

### ORM: Drizzle, raw `better-sqlite3`, Sequelize

- **Drizzle** — lightweight and fast, but its DX and documentation are optimized around TypeScript; using it from plain JS gives up most of its advantage over Prisma while still requiring a schema file and migration workflow to learn.
- **Raw `better-sqlite3`** — no abstraction overhead, but every migration and seed script would be hand-written SQL with manual bookkeeping of what's been applied. Prisma's `migrate` + `seed` commands solve exactly this for negligible extra dependency weight.
- **Sequelize** — mature and capable, but its API (model classes, lifecycle hooks, verbose config) is heavier and more dated than Prisma's schema-first workflow, with no offsetting benefit for this project's needs.

### Auth: Passport.js, cookie/session-based auth

- **Passport.js** — a strategy-plugin framework for authentication is designed for apps juggling multiple auth methods (OAuth, SAML, local, etc.). This spec has exactly one strategy (username/password → JWT), so Passport would be an abstraction layer around a single `if` statement.
- **Session/cookie-based auth** — the frontend spec is explicit and already implemented against: the client stores a bearer token in `localStorage` under `library_portal_auth` and sends `Authorization: Bearer <token>` on every request. Cookie/session auth would require changing the already-built frontend contract for no benefit; JWT bearer tokens are what the spec (and the existing frontend code) require.

### Test runner: Jest vs. Vitest

Jest was considered as the more established Node testing tool, but Vitest was chosen to match the test runner already used in `library-portal`, keeping tooling (config shape, watch mode, assertion API) consistent for anyone working across both repositories.

## Consequences

**Positive**

- One language (JS) and one package manager (npm) across frontend and backend.
- Zero external infrastructure to run the MVP locally — `npm install && npx prisma migrate dev && npm run dev` is the entire setup.
- Real persistence and real SQL constraints (unique ISBN, non-null fields) instead of a fragile hand-rolled data layer.
- Clear, low-cost upgrade paths already built into the choices: SQLite → PostgreSQL is a Prisma datasource change; JS → TypeScript is an incremental, file-by-file migration if/when justified; adding the Section 9 endpoints (book CRUD, borrow/return, `/me`, `/refresh`, admin role checks) fits the existing Express + Prisma + JWT structure without a rearchitecture.

**Negative / trade-offs accepted**

- No compile-time type safety; schema/shape mistakes surface at runtime or in tests instead of at edit time.
- SQLite is not suited for high-concurrency multi-writer production workloads — acceptable for an MVP demo but a real migration to PostgreSQL will be needed before any serious concurrent-write usage (e.g., many readers borrowing/returning books simultaneously).
- Express's minimalism means request validation, error formatting, and auth middleware are hand-written rather than provided by a framework convention — an accepted trade-off for the current 3-endpoint scope, worth revisiting if the route count grows significantly.

## References

- `library-portal/documents/backend-api-specification.md` — the API contract this stack must implement.
- `library-portal/package.json` — confirms the frontend's existing JS/npm/Vitest toolchain used as the consistency baseline for this decision.
