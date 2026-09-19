# Library Portal Backend API Specification

> Derived from the mocked frontend API calls in `src/api/books.js` and the HTTP client in `src/api/client.js`.
> This document is intended to be used as the blueprint for implementing the real backend.

---

## 1. General Conventions

- **Base URL**: `http://localhost:3000/api` (configurable via the `VITE_API_BASE_URL` environment variable).
- **Request/Response Format**: JSON.
- **Default Request Headers**: `Content-Type: application/json`.
- **Timeout**: The frontend expects responses within 10 seconds.
- **Authentication**: The frontend stores a JWT-like token in `localStorage` under the key `library_portal_auth`. The token is sent on every request in the `Authorization: Bearer <token>` header.

---

## 2. Authentication

### 2.1 Login

Exchanges user credentials for an authentication token and a public user profile.

- **Endpoint**: `POST /auth/login`
- **Authentication**: None (public endpoint).
- **Description**: Validates the provided username and password. On success, returns a token and a subset of the user's profile. On failure, returns a translation key so the frontend can show the correct localized error message.

> **MFA note:** if the account has multi-factor authentication enabled (Section 3), a successful
> credential check does **not** end here — this endpoint withholds `user`/`token` and instead
> returns `mfaRequired: true` plus a short-lived `mfaToken`. See Section 3.4 for the full response
> shape and the follow-up call that completes login.

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | Yes | The user's login name. |
| `password` | string | Yes | The user's password (plain text). |

**Example Request:**

```json
{
  "username": "reader",
  "password": "reader"
}
```

#### Success Response (HTTP 200)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success. |
| `user` | object | Public user profile (see below). |
| `token` | string | Bearer token to be used in subsequent requests. |

**Public User Profile (`user`):**

| Field | Type | Description |
|---|---|---|
| `id` | number | Unique numeric identifier. |
| `username` | string | User's login name. |
| `fullName` | string | Display name. |
| `role` | string | User role (e.g., `reader`). |

**Example Response:**

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "reader",
    "fullName": "Demo Reader",
    "role": "reader"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Error Responses

| HTTP Status | `success` | `errorKey` | Frontend Behavior |
|---|---|---|---|
| 401 Unauthorized | `false` | `login.invalidCredentials` | Displays localized invalid-credentials message. |
| 500 Internal Server Error | `false` | omitted or generic | Frontend falls back to `login.unexpectedError`. |

**Example Error Response:**

```json
{
  "success": false,
  "errorKey": "login.invalidCredentials"
}
```

#### Backend Requirements

- The backend must verify the credentials against a user store.
- Never return the password or any other sensitive field in the `user` object.
- The token must be a string that can be validated on protected routes.
- If the account has MFA enabled, do not issue a bearer token from this endpoint — issue an
  `mfaToken` challenge instead (Section 3.4).

---

### 2.2 Logout

Invalidates the bearer token that was used to make the request, so it can no longer be used on any protected route — even though it has not yet reached its `exp` expiry.

- **Endpoint**: `POST /auth/logout`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Marks the presented token as revoked. Any subsequent request using that same token must be rejected by the authentication middleware with the standard 401 response (Section 6), even though the token's signature and expiry are still otherwise valid. Logging out does not affect any *other* token the same user may hold (e.g. a session open in a second browser tab).

#### Request Body

None.

#### Success Response (HTTP 200)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success. |

**Example Response:**

```json
{
  "success": true
}
```

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing, invalid, expired, or already-revoked token. |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware (a token is required in order to know which token to revoke).
- The revocation must take effect immediately: the very next request made with the same token must be rejected.
- Calling logout twice with the same token is not an error case to special-case in the response — the second call simply fails authentication (401), since the token is already revoked by the first call.
- See `ADR-0002-jwt-logout-invalidation-strategy.md` for the rationale behind how revocation is implemented server-side (a `jti` claim plus a denylist), and the alternatives that were considered instead.

---

## 3. Multi-Factor Authentication (TOTP)

Adds an opt-in second factor (RFC 6238 Time-based One-Time Password) on top of the existing
username/password login, plus a step-up requirement on other sensitive account actions once a
user has enrolled. MFA is per-user and off by default — enrolling is a deliberate action the user
takes from account settings; nothing here changes behavior for a user who hasn't enrolled.

> **New dependency required.** None of the endpoints below can be implemented without adding a
> TOTP library (e.g. `otplib`) to `package.json` — a new dependency category outside the current
> stack. Per this project's own "Things to avoid" convention (`CLAUDE.md`), raise that with the
> user before implementation, or capture it in a new ADR alongside `ADR-0002` (the closest
> precedent, since it's also an auth-adjacent, token-lifecycle decision).

### 3.1 Enroll in MFA (Start Setup)

Generates a new TOTP secret for the authenticated user and hands back what's needed to scan it
into an authenticator app. Does **not** enable MFA yet — see Section 3.2.

- **Endpoint**: `POST /auth/mfa/setup`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Generates a cryptographically random TOTP secret and stores it server-side in a
  *pending* state, distinct from any already-*active* secret. Returns the secret and an
  `otpauth://` URI the frontend renders as a QR code. Calling this again before confirming
  (Section 3.2) simply overwrites the pending secret — there is no accumulation of unconfirmed
  secrets to clean up.

#### Request Body

None.

#### Success Response (HTTP 200)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success. |
| `secret` | string | Base32-encoded TOTP secret, for manual entry as a fallback to scanning the QR code. |
| `otpauthUrl` | string | `otpauth://totp/...` URI the frontend encodes as a QR code. |

**Example Response:**

```json
{
  "success": true,
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauthUrl": "otpauth://totp/LibraryPortal:reader?secret=JBSWY3DPEHPK3PXP&issuer=LibraryPortal"
}
```

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing or invalid `Authorization` header. |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware.
- The secret must come from a CSPRNG, at least 160 bits (20 bytes) before base32 encoding, per RFC
  4226 §4 / RFC 6238 recommendations.
- The secret is stored encrypted at rest (see Section 3.6's "why not plaintext" note) as
  `pendingSecret`, separate from the `secret` column that only ever holds an *active*, confirmed
  secret (Section 7.6).
- Does not touch `enabled` — a user is not protected by MFA until Section 3.2 completes.

---

### 3.2 Confirm / Activate MFA

Confirms the user actually captured the pending secret correctly, then turns MFA on.

- **Endpoint**: `POST /auth/mfa/verify`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Validates a TOTP code against the *pending* secret from Section 3.1. On
  success, promotes `pendingSecret` to `secret` and sets `enabled: true`; the pending value is
  cleared either way.

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `code` | string | Yes | 6-digit TOTP code from the authenticator app. |

**Example Request:**

```json
{
  "code": "482913"
}
```

#### Success Response (HTTP 200)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success. |

**Example Response:**

```json
{
  "success": true
}
```

#### Error Responses

| HTTP Status | `errorKey` | Description |
|---|---|---|
| 400 Bad Request | `mfa.setupNotStarted` | No pending secret for this user — call Section 3.1 first. |
| 401 Unauthorized | `mfa.invalidCode` | Missing/invalid `Authorization` header, or the code didn't match the pending secret. |
| 500 Internal Server Error | — | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware.
- Verify with the same ±1 time-step window and replay protection described in Section 3.6.
- A failed attempt must **not** clear the pending secret — the user gets to retry against the same
  QR code instead of re-scanning.

---

### 3.3 Disable MFA

Turns MFA off for the account.

- **Endpoint**: `POST /auth/mfa/disable`
- **Authentication**: Required (`Authorization: Bearer <token>`) **and** a valid TOTP code — this
  route is itself protected by the step-up middleware from Section 3.6, so it can only be called
  by someone who currently holds the authenticator device, not merely a stolen bearer token.

#### Request Body

None.

#### Success Response (HTTP 200)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success. |

**Example Response:**

```json
{
  "success": true
}
```

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing/invalid `Authorization` header, or missing/invalid `X-MFA-Code` (Section 3.6). |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- Clears `secret`, `pendingSecret`, and `lastUsedStep`, and sets `enabled: false`.
- Composes `authenticate` then `requireTotp` (Section 3.6) — do not reimplement the code check
  inline.

---

### 3.4 Complete Login MFA Challenge

The second step of login for an MFA-enabled account — exchanges a short-lived challenge token
plus a TOTP code for the real bearer token.

- **Endpoint**: `POST /auth/login/mfa`
- **Authentication**: None (public endpoint) — the `mfaToken` in the request body carries the
  proof that Section 2.1 already succeeded; a regular bearer token is not required or accepted
  here.
- **Description**: This is what `POST /auth/login` (Section 2.1) hands off to when the account has
  MFA enabled: instead of returning `user`/`token` directly, Section 2.1 returns `mfaRequired: true`
  and a single-purpose `mfaToken`. The frontend prompts for a TOTP code and calls this endpoint to
  finish signing in.

**Login response when MFA is enabled (Section 2.1, amended):**

```json
{
  "success": true,
  "mfaRequired": true,
  "mfaToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `mfaToken` | string | Yes | The token returned by `POST /auth/login`. |
| `code` | string | Yes | 6-digit TOTP code from the authenticator app. |

#### Success Response (HTTP 200)

Identical shape to a successful `POST /auth/login` (Section 2.1) — `{ success, user, token }`.

#### Error Responses

| HTTP Status | `errorKey` | Description |
|---|---|---|
| 401 Unauthorized | `login.mfaTokenExpired` | `mfaToken` missing, malformed, expired, or already used. |
| 401 Unauthorized | `login.invalidMfaCode` | `mfaToken` valid but `code` didn't match. |
| 500 Internal Server Error | — | Generic server error. |

#### Backend Requirements

- `mfaToken` is a JWT signed by `signToken` (`src/lib/jwt.js`) like any other token, but carries a
  `purpose: 'mfa'` claim and a short TTL (e.g. 5 minutes) distinct from the normal login TTL.
- The standard `authenticate` middleware must reject a `purpose: 'mfa'` token on every other
  protected route — it is not a general bearer token, only a receipt for this one exchange.
- On success, revoke the `mfaToken`'s `jti` via the same denylist `POST /auth/logout` and
  `POST /auth/refresh` already use (`ADR-0002`), so it cannot be replayed — the exchange is
  single-use.
- Verify `code` with the same ±1 time-step window and replay protection as Section 3.6.
- Issue the real token the same way `POST /auth/login` does today (full `exp`, fresh `jti`,
  `id`/`username`/`role` claims).

---

### 3.5 Password Change — MFA Gating (endpoint does not exist yet)

**There is currently no password-change endpoint** — not in this specification, not in
`src/routes`/`src/controllers`. This subsection exists only to specify how MFA will gate it
*when* it's added, per request; it is not itself a request to build the endpoint now, and the
route/method/body below are illustrative placeholders, not a commitment.

- **Illustrative endpoint**: `PUT /auth/password`
- **Illustrative auth**: `authenticate` → `requireTotp` (Section 3.6) → controller.
- **Illustrative body**: `{ currentPassword, newPassword }`.

**How MFA applies once this exists:**

- `requireTotp` (Section 3.6) sits between `authenticate` and the controller, exactly like it will
  on `POST /auth/mfa/disable` (Section 3.3).
- For a user **without** MFA enabled, `requireTotp` is a no-op — `currentPassword` verification is
  the only gate, same as any ordinary password-change endpoint.
- For a user **with** MFA enabled, the request additionally needs a valid `X-MFA-Code` header, or
  it never reaches the controller. Changing the password is exactly the kind of sensitive,
  account-takeover-relevant action step-up auth exists for.
- Whenever this endpoint is actually designed, revisit Section 11's endpoint list (`GET /me`,
  book CRUD, etc.) and add it there with its own full spec — this subsection should then just
  become a cross-reference, not the source of truth.

---

### 3.6 MFA Enforcement Middleware

The reusable gate other sensitive routes compose in, mirroring how `authenticate`
(`src/middleware/auth.js`) is already the single source of truth for bearer-token checks
(Section 6). Lives in **`src/middleware/mfa.js`**, exporting `requireTotp(req, res, next)`.

**Contract:**

1. Must run **after** `authenticate` — it depends on `req.user` (id/username/role/jti) already
   being populated, the same layering rule `authenticate` itself follows relative to route
   handlers.
2. Looks up MFA status for `req.user.id` through a service call (`getMfaStatus`, in a new
   `src/services/mfa.service.js`) — never a raw Prisma call inline in the middleware, per the
   `routes → controllers → services → lib` layering in `CLAUDE.md`.
3. **No MFA enrolled** (`enabled: false`): call `next()` immediately. The middleware is a
   *conditional* gate, not a blanket requirement — routes that use it stay reachable by users who
   never opted into MFA, gated only by whatever the route already checks (e.g. current password).
4. **MFA enrolled**: read the code from a dedicated `X-MFA-Code` request header — not the JSON
   body. Keeping it out-of-band means any route can add `requireTotp` without reshaping its own
   request body, the same reason `Authorization` itself is a header rather than a body field.
5. **Header missing** → `401` with the same body shape `authenticate` already uses (Section 6),
   so the frontend's existing 401 handling doesn't need a new code path — only the `message`
   differs:
   ```json
   { "error": "Unauthorized", "message": "A valid authentication code is required for this action." }
   ```
6. **Header present but code invalid/expired** → `401`, same shape, `message: "Invalid or expired authentication code."`
7. Verify against the *active* `secret` only (never `pendingSecret`) with a ±1 time-step window
   (RFC 6238 §5.2) to tolerate clock drift, and reject a code already accepted in the current or
   previous window for this user — persist `lastUsedStep` per user (Section 7.6) and compare, the
   same "already used, reject" shape `RevokedToken` already applies to `jti`s.
8. On success, call `next()`. The middleware does **not** set any request-scoped or
   token-scoped flag (e.g. `req.mfaVerified`) for other routes to trust later — every sensitive
   request re-presents a code. That's the point of step-up auth instead of "verified MFA once at
   login," per the rejected-alternative note below.
9. Errors from the lookup/verification themselves (DB errors, etc.) go to `next(err)`, not
   swallowed — consistent with how `authenticate` already forwards its revocation-check errors.

**Rejected alternatives** (mirrors the "why not the alternatives" format `ADR-0002` already uses):

- *An `mfa: true` claim baked into the bearer token at login (Section 3.4) and trusted from then
  on* — rejected as the sole mechanism: a single leaked/stolen bearer token would carry blanket
  access to every MFA-gated action for the token's entire lifetime, defeating the purpose of
  requiring a second factor on those specific actions. (A short "recent MFA" grace window is a
  legitimate future refinement, but is a separate decision, not this middleware's default.)
- *Checking the code inline in each controller* (`mfaDisable`, the future password-change
  controller, ...) — rejected: duplicates the check per-route and risks drift, the same reasoning
  that already keeps bearer-token validation centralized in `authenticate` instead of
  reimplemented per route.
- *Storing the TOTP secret in plaintext* — rejected: `secret`/`pendingSecret` must be encrypted at
  rest (application-level cipher keyed by a server-held secret, the same posture `JWT_SECRET`
  already has as an env-only value) — never logged or returned in plaintext once confirmed.

---

## 4. Books

### 4.1 List All Books

Returns the complete catalog of books.

- **Endpoint**: `GET /books`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Returns an array of all book records. The frontend performs client-side filtering, pagination, and sorting, so the backend should return the full dataset in a stable format.

#### Request Parameters

None required.

**Optional query parameters the backend may support in the future (not currently required):**

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Search/filter by title or author. |
| `page` | number | Page number (1-based). |
| `pageSize` | number | Number of items per page. |
| `status` | string | Filter by `available` or `borrowed`. |

#### Success Response (HTTP 200)

Returns an array of `Book` objects.

**Book Object Fields:**

| Field | Type | Description |
|---|---|---|
| `id` | number | Unique numeric identifier. |
| `title` | string | Book title. |
| `author` | string | Author name(s). |
| `year` | number | Year of publication. |
| `genre` | string | Genre or category. |
| `status` | string | Current status: `available` or `borrowed`. |
| `isbn` | string | ISBN identifier. |
| `coverColor` | string | Hex color code used by the frontend for placeholder styling. |

Note: `summary` (see Section 4.2) is intentionally **not** included here — the list endpoint stays
light since the frontend renders it as a catalog grid. Fetch `GET /books/:id` for the full detail
including `summary`.

**Example Response (truncated):**

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
    "coverColor": "#4a5568"
  }
]
```

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing or invalid `Authorization` header. |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware.
- The response must be a JSON array.
- The order of books should be stable.
- All fields shown in the table must be present and non-null for the frontend to render correctly.

---

### 4.2 Get Book by ID

Returns a single book record.

- **Endpoint**: `GET /books/:id`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Looks up a book by its numeric identifier. Returns HTTP 404 with no body if the book does not exist (or if `id` is not a valid number). The frontend currently does not render a dedicated detail page, but the API is already consumed and expected to exist.

#### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | number | The unique identifier of the book. |

#### Success Response (HTTP 200)

Returns a single `Book` object with every field from the `List All Books` schema (Section 4.1),
**plus** one additional field only present on this detail endpoint:

| Field | Type | Description |
|---|---|---|
| `summary` | string | Longer descriptive blurb for the book. Only returned here, not by `GET /books`. |
| `pdfUrl` | string \| null | Embeddable URL for the PDF reader (e.g. a Google Drive `/view` link). Only returned here, not by `GET /books`. `null` when the book has no online copy — the frontend hides the "Read online" action in that case. |

**Example Response:**

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
  "summary": "A catalog of practical, tool-agnostic habits for writing adaptable, DRY software, from source control discipline to pragmatic testing.",
  "pdfUrl": "https://drive.google.com/file/d/1cElC7xqVArPo9jZMWDksRHtIwCxSq-qi/view"
}
```

#### Not Found Response (HTTP 404)

The mock originally returned `null` with HTTP 200 when the ID was not found. The implemented backend instead returns the idiomatic response:

- **HTTP 404**, with **no response body** (not even `null` or `{}`).

**Important:** the mock's contract (`null` + 200) is superseded by this. `fetchBookById` in `library-portal/src/api/books.js` currently returns the response body as-is and expects `null` for a miss — it must be updated to treat a 404 status as "not found" instead of inspecting the body, or it will break against this backend.

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing or invalid `Authorization` header. |
| 404 Not Found | Book with the given ID does not exist, or `id` is not a valid number. No response body. |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware.
- The ID must be parsed as a numeric value; a non-numeric `id` is treated the same as "not found" (404, no body), not a 400/validation error.
- On success, return the same fields as the `List All Books` endpoint, plus `summary` and `pdfUrl`.
- On a miss, return HTTP 404 with an empty body — do not send `null`, `{}`, or any JSON payload.

---

## 5. Change Log

### 5.1 List Changelog

Returns the portal's release history, for the in-app changelog page/footer link.

- **Endpoint**: `GET /changelog`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Returns an array of changelog entries, ordered newest first.

#### Request Parameters

None.

#### Success Response (HTTP 200)

Returns an array of `ChangelogEntry` objects.

**ChangelogEntry Object Fields:**

| Field | Type | Description |
|---|---|---|
| `id` | number | Unique identifier. |
| `version` | string | Version or release label (e.g., `"1.3.0"`). |
| `date` | string | Display date, `YYYY-MM-DD`. |
| `title` | string | Short update title. |
| `description` | string | Markdown-formatted description. The frontend renders it as sanitized HTML. |

**Example Response (truncated):**

```json
[
  {
    "id": 4,
    "version": "1.3.0",
    "date": "2026-08-15",
    "title": "Profile menu and account page",
    "description": "## What's new\n\n- The header now shows a **profile icon**..."
  }
]
```

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing or invalid `Authorization` header. |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware.
- The response must be a JSON array ordered with the newest entry first (by `date` descending).

---

## 6. Authentication Middleware

The backend must inspect the `Authorization` header on every protected route.

- Expected format: `Authorization: Bearer <token>`
- If the header is missing, malformed, the token is invalid/expired, **or the token has been revoked via `POST /auth/logout`**, return HTTP 401 with a clear error body.

**Example 401 Response:**

```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid token"
}
```

---

## 7. Data Model Summary

> **Naming note:** field names below (and throughout this document, and in every JSON request/response) are camelCase — that is the wire format the frontend expects and it does not change. The backend's own SQL tables and columns are named in snake_case internally (e.g. `full_name`, `cover_color`) purely as a storage-layer/SQL convention; this is an implementation detail behind the ORM and has no bearing on the API contract described here.

### 7.1 User (Internal)

Used only for authentication. The frontend never sees the `password` field.

| Field | Type | Notes |
|---|---|---|
| `id` | number | Primary key. |
| `username` | string | Unique. |
| `password` | string | Hashed password (never return it in any API response). |
| `fullName` | string | Display name. |
| `role` | string | e.g., `reader`, `admin`. |

### 7.2 User (Public Profile)

Returned by the login endpoint.

| Field | Type |
|---|---|
| `id` | number |
| `username` | string |
| `fullName` | string |
| `role` | string |

### 7.3 Book

| Field | Type | Constraints |
|---|---|---|
| `id` | number | Primary key, auto-increment. |
| `title` | string | Required, non-empty. |
| `author` | string | Required, non-empty. |
| `year` | number | Positive integer. |
| `genre` | string | Required. |
| `status` | string | Enum: `available`, `borrowed`. |
| `isbn` | string | Required, unique, valid ISBN format. |
| `coverColor` | string | Hex color code (e.g., `#4a5568`). |
| `summary` | string | Required, non-empty. Descriptive blurb. Only returned by `GET /books/:id` — omitted from `GET /books` (Section 4.1). |
| `pdfUrl` | string \| null | Optional. Embeddable PDF URL. Only returned by `GET /books/:id` — omitted from `GET /books` (Section 4.1). |

### 7.4 Revoked Token (Internal)

Server-side only — never exposed through any API response. Backs the `POST /auth/logout` endpoint; see `ADR-0002-jwt-logout-invalidation-strategy.md`.

| Field | Type | Notes |
|---|---|---|
| `id` | number | Primary key. |
| `jti` | string | The `jti` claim of the revoked token. Unique. |
| `expiresAt` | datetime | Copied from the token's `exp` claim; used to prune rows once the token would have expired naturally anyway. |
| `createdAt` | datetime | When the logout happened. |

### 7.5 Changelog Entry

| Field | Type | Constraints |
|---|---|---|
| `id` | number | Primary key, auto-increment. |
| `version` | string | Required, unique. |
| `date` | string | Required. Display date, `YYYY-MM-DD`. |
| `title` | string | Required, non-empty. |
| `description` | string | Required, non-empty. Markdown-formatted. |

### 7.6 Mfa (Internal)

Server-side only — never exposed through any API response as a whole object (individual fields
surface only indirectly, e.g. `enabled` is what drives the branching in Section 3). One row per
user, created on first enrollment (Section 3.1).

| Field | Type | Notes |
|---|---|---|
| `id` | number | Primary key. |
| `userId` | number | Foreign key → `User.id`, unique (one MFA record per user). |
| `secret` | string \| null | Active TOTP secret, encrypted at rest. `null` until Section 3.2 confirms enrollment. |
| `pendingSecret` | string \| null | Unconfirmed secret from Section 3.1, encrypted at rest. Cleared on confirm (3.2), disable (3.3), or a fresh 3.1 call. |
| `enabled` | boolean | Whether this account currently requires MFA. Default `false`. |
| `lastUsedStep` | number \| null | The most recently accepted TOTP time-step, for replay protection (Section 3.6). |
| `createdAt` | datetime | When the row was created (first `POST /auth/mfa/setup` call). |
| `updatedAt` | datetime | Last state change (setup, confirm, or disable). |

---

## 8. Seed Data Reference

The frontend currently ships with the following mock data. The backend should provide at least this dataset for parity.

### 8.1 Demo User

```json
{
  "id": 1,
  "username": "reader",
  "password": "reader",
  "fullName": "Demo Reader",
  "role": "reader"
}
```

> Note: Store the password as a hash in the real database; the plaintext value above is only for frontend login testing.

### 8.2 Demo Books

The mock catalog contains 12 books covering the following genres:

- Software Engineering
- Software Architecture
- Programming
- Project Management
- Computer Science
- DevOps

Each book has the fields listed in the `Book` data model above, with `status` being either `available` or `borrowed`, and `pdfUrl` set for roughly half the catalog (the rest are `null`).

### 8.3 Demo Changelog

At least the four entries the frontend mock ships with (versions `1.0.0` through `1.3.0`), so the `/changelog` page has representative content. See `prisma/seed.js` for the exact entries.

### 8.4 Demo MFA State

Not required. The demo user ships with MFA disabled (`enabled: false`, no `Mfa` row or an
un-enrolled one) — enrolling is a manual flow (Section 3.1–3.2) that can't be scripted without
also shipping the corresponding TOTP secret in plaintext somewhere reachable, which Section 3.6
explicitly forbids. Leave demo MFA opt-in for manual QA instead.

---

## 9. CORS and Local Development

Because the frontend development server runs on a different port than the backend (usually `http://localhost:5173`), the backend must enable CORS for the frontend origin.

Allowed headers should include:

- `Content-Type`
- `Authorization`

---

## 10. Migration Notes from Mock to Real API

When the backend is ready, the frontend only needs to change the implementation of these functions in `src/api/books.js` and `src/api/changelog.js`:

1. `authenticate({ username, password })` → `POST /auth/login`
2. `fetchBooks()` → `GET /books`
3. `fetchBookById(id)` → `GET /books/:id`
4. `fetchChangelog()` → `GET /changelog`

No changes are required in the views, components, store, or router, as long as the backend matches the schemas and authentication behavior described in this document — **with one exception**: `fetchBookById`'s not-found handling (see Section 4.2) must change from "inspect the body for `null`" to "treat HTTP 404 as not found," since the implemented backend returns 404 with no body instead of the mock's `null` + 200.

> **Logout is new.** The mocked frontend never had a logout call to migrate, so wiring up `POST /auth/logout` (Section 2.2) — clearing the stored token from `localStorage` and calling the endpoint — is net-new frontend work, not a swap of an existing mock function.

> **MFA is new.** The mocked frontend has no concept of multi-factor authentication at all — no
> enrollment UI, no challenge step, no `mfaRequired` branch in its login handling. Wiring up
> Sections 3.1–3.4 (enrollment, confirmation, disable, and the second login step) is net-new
> frontend work in `library-portal`, not a swap of an existing mock function. The existing
> `authenticate({ username, password })` migration (item 1 above) also needs its caller updated to
> branch on `mfaRequired` in the response before treating login as complete, rather than assuming
> `user`/`token` are always present.

---

## 11. Future Endpoints (Not Required for MVP)

The following endpoints are not consumed by the current frontend but are natural next steps:

| Endpoint | Method | Description |
|---|---|---|
| `/books` | `POST` | Create a new book (admin role). |
| `/books/:id` | `PUT` | Update a book (admin role). |
| `/books/:id` | `DELETE` | Delete a book (admin role). |
| `/books/:id/borrow` | `POST` | Mark a book as borrowed (reader). |
| `/books/:id/return` | `POST` | Mark a book as available (reader). |
| `/me` | `GET` | Return the current user's profile. |
| `/refresh` | `POST` | Refresh an expiring token. |

---

## 12. Quick Checklist for Backend Implementation

- [ ] `POST /auth/login` returns `{ success, user, token }` or `{ success, errorKey }` — or, when the account has MFA enabled, `{ success, mfaRequired: true, mfaToken }` (Section 3.4).
- [ ] `POST /auth/login/mfa` validates the single-use `mfaToken` and TOTP `code`, revokes the `mfaToken`'s `jti`, and issues a normal bearer token.
- [ ] `POST /auth/mfa/setup` is protected and returns a fresh `secret`/`otpauthUrl` pair without enabling MFA.
- [ ] `POST /auth/mfa/verify` is protected, validates against the *pending* secret, and only then sets `enabled: true`.
- [ ] `POST /auth/mfa/disable` is protected by `authenticate` + `requireTotp` and clears all MFA state (`secret`, `pendingSecret`, `lastUsedStep`, `enabled`).
- [ ] `src/middleware/mfa.js` exports `requireTotp`, composed **after** `authenticate`, and is a no-op for users without MFA enabled (Section 3.6).
- [ ] TOTP secrets are encrypted at rest and never logged or returned in plaintext once confirmed.
- [ ] TOTP verification uses a ±1 time-step window and rejects replayed codes via `lastUsedStep`.
- [ ] `POST /auth/logout` is protected, revokes the presented token, and returns `{ success: true }`.
- [ ] `GET /books` is protected and returns an array of `Book` objects (without `summary`/`pdfUrl`).
- [ ] `GET /books/:id` is protected and returns a `Book` object including `summary` and `pdfUrl`, or HTTP 404 with no body if it doesn't exist.
- [ ] `GET /changelog` is protected and returns an array of `ChangelogEntry` objects, newest first.
- [ ] `Authorization: Bearer <token>` is validated on protected routes, including rejecting tokens revoked via logout.
- [ ] Passwords are stored hashed.
- [ ] CORS is configured for the frontend origin.
- [ ] The demo user `reader / reader` exists in the database.
- [ ] The demo book catalog is seeded.
- [ ] The demo changelog is seeded.
