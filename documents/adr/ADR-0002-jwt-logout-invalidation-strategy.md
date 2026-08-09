# ADR-0002: JWT Logout / Token Invalidation Strategy

## Status

Accepted — 2026-08-09

## Context

[ADR-0001](ADR-0001-backend-technology-stack.md) established a fully stateless JWT bearer-token
scheme: `POST /auth/login` signs a token, and `authenticate` middleware verifies it purely by
signature and expiry — no database lookup, no server-side session state.

The API now needs a `POST /auth/logout` endpoint (see Section 2.2 of
[`backend-api-specification.md`](../backend-api-specification.md)) whose job is to invalidate the
specific token that was used to call it, immediately — not just let it expire on its own. A
self-contained JWT cannot be "revoked" by definition: any party holding the secret can verify it
as valid until its `exp` claim passes, regardless of what the server "wants." Making logout actually
invalidate the token therefore requires introducing some server-side state, which is a real
departure from the stateless design ADR-0001 chose. This ADR records what that state is, why this
particular shape was chosen, and what was rejected instead.

## Decision

- Every signed token now carries a `jti` (JWT ID) claim — a random UUID generated per token in
  `src/lib/jwt.js`.
- A `RevokedToken` table (`jti` unique, `expiresAt`, `createdAt`) was added to the existing Prisma
  schema, backed by the same SQLite database everything else already uses.
- `POST /auth/logout` (itself a protected route, so `authenticate` has already verified the token
  and populated `req.user` with its claims) upserts the token's `jti` + `exp` into `RevokedToken`.
- `authenticate` middleware, after verifying signature and expiry, does one additional check:
  is this `jti` present in `RevokedToken`? If so, treat it exactly like an invalid token (401).
- `revokeToken` opportunistically deletes rows whose `expiresAt` has already passed, on every call,
  so the table doesn't grow without bound (see Consequences).

## Alternatives Considered

### Client-only logout (no server state at all)

Simplest possible option: the frontend just deletes the token from `localStorage` and stops
sending it. Rejected — this doesn't invalidate the JWT, it just stops one client from *using* it.
The token itself remains fully valid until `exp`; anyone who captured it earlier (XSS, a proxy log,
a shared machine) can keep using it after the user "logged out." That fails the actual requirement
("it should invalidate the JWT"), not just a nice-to-have.

### Short-lived access tokens + a `/refresh` endpoint

Shrink the token TTL (e.g. minutes instead of an hour) and pair it with the `/refresh` endpoint
already listed as a future endpoint in the API spec, so that even without explicit revocation, a
stolen/logged-out token stops working soon. Rejected as a replacement for logout specifically: it
lowers the *blast radius* of not having revocation, but it's a fundamentally different mechanism
(session rotation, not immediate revocation) and is a materially larger change (refresh-token
issuance, storage, and rotation logic) than what the spec is asking for right now. This remains a
good idea to revisit when `/refresh` itself gets implemented — the two are complementary, not
substitutes for one another.

### Redis-backed blocklist

The conventional production shape for a revocation list: O(1) lookups, and TTL-based auto-eviction
that would make the manual pruning in `revokeToken` unnecessary. Rejected for the same reason
ADR-0001 rejected PostgreSQL/MongoDB/Redis-shaped infrastructure for the MVP: it means running and
operating a second service to hold, at this scale, a handful of rows that a single indexed SQLite
table already looks up in constant-ish time. If request volume or table size ever make SQLite
lookups a measurable bottleneck, revisit — the `isTokenRevoked`/`revokeToken` functions in
`src/services/auth.service.js` are the only places that would need to change.

### `tokenVersion` claim on the `User` row

Instead of tracking individual revoked tokens, store an integer `tokenVersion` on each `User` row,
embed its current value in every token issued to that user, and bump it on logout — any token
carrying a stale version fails authentication. This invalidates *every* session belonging to that
user in one write, with no growing revocation table at all. Rejected for the MVP because it's
coarser than what was asked: it logs a user out of every device/tab, not just the session that
called `/auth/logout`. That's a legitimate feature ("log out everywhere") but a different one from
single-session logout — worth adding *alongside* the `jti` denylist later (e.g. as a `POST
/auth/logout-all`) rather than replacing it.

## Consequences

- Auth is no longer fully stateless: `authenticate` now does a database read on every protected
  request (an indexed lookup by unique `jti`). At MVP scale this is negligible; it's the main thing
  to reconsider if request volume grows enough to matter.
- `RevokedToken` rows are pruned opportunistically inside `revokeToken` (delete-where-expired, run
  before every insert) rather than via a dedicated cleanup job — acceptable because logout is the
  only thing that ever writes to this table, so it's also a natural place to sweep it.
- No change to the stack chosen in ADR-0001 (Node/Express/SQLite/Prisma/JWT) — this is an additive
  change to the data model and to `authenticate`, not a technology swap.
- `POST /auth/login`'s path changed from `/login` to `/auth/login` (and the spec now documents
  `/auth/logout` alongside it) so both authentication endpoints live under a consistent `/auth`
  prefix.

## References

- [ADR-0001-backend-technology-stack.md](ADR-0001-backend-technology-stack.md)
- [`backend-api-specification.md`](../backend-api-specification.md), Section 2.2 (Logout) and
  Section 5.4 (Revoked Token data model)
- `src/lib/jwt.js`, `src/middleware/auth.js`, `src/services/auth.service.js`,
  `prisma/schema.prisma` (`RevokedToken` model)
