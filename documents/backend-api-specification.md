# Library Portal Backend API Specification

> This document describes the implemented API for library-api v1.0.0 — the backend service for the `library-portal` Vue 3 frontend.

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

### 2.3 Refresh Token

Issues a fresh bearer token in exchange for a still-valid one, resetting the expiry window without requiring the user to re-enter credentials.

- **Endpoint**: `POST /auth/refresh`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Validates the presented token exactly as any protected route does (signature, expiry, revocation check). On success, revokes the old token by recording its `jti` in the denylist — the same mechanism as `POST /auth/logout` — and signs and returns a brand-new token with a fresh `exp` and a new `jti`. The client must store the new token and use it on all subsequent requests; the old token is immediately invalid.

#### Request Body

None.

#### Success Response (HTTP 200)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success. |
| `token` | string | The new bearer token to use on all subsequent requests. |

**Example Response:**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Error Responses

| HTTP Status | Description |
|---|---|
| 401 Unauthorized | Missing, malformed, expired, or already-revoked token (standard Section 6 response). |
| 500 Internal Server Error | Generic server error. |

#### Backend Requirements

- The endpoint must be protected by the authentication middleware — a token that has already expired or been revoked must be rejected before refresh logic runs, with the standard 401 (Section 6). There is no "grace period" beyond `exp`.
- On success, revoke the incoming token's `jti` (via the same `revokeToken` path used by `POST /auth/logout`) before signing the new one, so concurrent calls with the same old token cannot each produce a valid new token.
- The new token must be signed with `signToken` (`src/lib/jwt.js`) so it receives a fresh `jti`, the same TTL as a freshly-issued login token, and all claims (`id`, `username`, `role`) copied from the validated incoming token — no database read of the `User` row is needed.
- The response carries only `token`; the user profile is unchanged and does not need to be re-sent.
- The client must replace the token stored in `localStorage` under `library_portal_auth` with the new value and resume sending it as `Authorization: Bearer <new-token>` on all subsequent requests.
- See `ADR-0002-jwt-logout-invalidation-strategy.md` for the rationale behind the `jti` denylist that this endpoint reuses, and the note that short-lived tokens and `/refresh` are complementary — if the token TTL is shortened, refresh calls simply become more frequent, not architecturally different.

---

## 3. Books

### 3.1 List All Books

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

Note: `summary` (see Section 3.2) is intentionally **not** included here — the list endpoint stays
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

### 3.2 Get Book by ID

Returns a single book record.

- **Endpoint**: `GET /books/:id`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Looks up a book by its numeric identifier. Returns HTTP 404 with no body if the book does not exist (or if `id` is not a valid number). The frontend currently does not render a dedicated detail page, but the API is already consumed and expected to exist.

#### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | number | The unique identifier of the book. |

#### Success Response (HTTP 200)

Returns a single `Book` object with every field from the `List All Books` schema (Section 3.1),
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

## 4. Change Log

### 4.1 List Changelog

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

## 5. Users

### 5.1 Change Password

Updates the password of the currently authenticated user.

- **Endpoint**: `PATCH /users/me/password`
- **Authentication**: Required (`Authorization: Bearer <token>`).
- **Description**: Verifies the provided `currentPassword` against the stored hash, then replaces it with a bcrypt hash of `newPassword`. The user's existing token remains valid after the change — this endpoint does not revoke any sessions.

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `currentPassword` | string | Yes | The user's current password (plain text). |
| `newPassword` | string | Yes | The desired new password (plain text). |

**Example Request:**

```json
{
  "currentPassword": "reader",
  "newPassword": "newSecurePass123"
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

| HTTP Status | `success` | `errorKey` | Description |
|---|---|---|---|
| 400 Bad Request | `false` | `users.changePassword.missingFields` | `currentPassword` or `newPassword` is absent from the request body. |
| 401 Unauthorized | `false` | `users.changePassword.wrongCurrentPassword` | `currentPassword` does not match the stored password. |
| 401 Unauthorized | (standard, see Section 6) | — | Missing, invalid, expired, or revoked bearer token. |
| 500 Internal Server Error | `false` | omitted | Generic server error. |

**Example Error Response (wrong current password):**

```json
{
  "success": false,
  "errorKey": "users.changePassword.wrongCurrentPassword"
}
```

**Example Error Response (missing fields):**

```json
{
  "success": false,
  "errorKey": "users.changePassword.missingFields"
}
```

#### Backend Requirements

- The endpoint must be protected by the authentication middleware — the user's identity comes from the validated bearer token (`req.user.sub`), not from the request body.
- `currentPassword` must be verified against the user's stored bcrypt hash before the update is applied; a mismatch returns 401, not 403.
- `newPassword` must be hashed with bcrypt before storage (same cost factor as `POST /auth/login`).
- The user's active token is **not** revoked after the change — callers that need immediate session invalidation should also call `POST /auth/logout`.

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
| `summary` | string | Required, non-empty. Descriptive blurb. Only returned by `GET /books/:id` — omitted from `GET /books` (Section 3.1). |
| `pdfUrl` | string \| null | Optional. Embeddable PDF URL. Only returned by `GET /books/:id` — omitted from `GET /books` (Section 3.1). |

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

---

## 9. CORS and Local Development

Because the frontend development server runs on a different port than the backend (usually `http://localhost:5173`), the backend must enable CORS for the frontend origin.

Allowed headers should include:

- `Content-Type`
- `Authorization`

---

## 10. Migration Notes from Mock to Real API

These are the changes the frontend needed when switching from the in-repo mocks to this backend (delivered in v1.0.0).

1. `authenticate({ username, password })` → `POST /auth/login`
2. `fetchBooks()` → `GET /books`
3. `fetchBookById(id)` → `GET /books/:id`
4. `fetchChangelog()` → `GET /changelog`

No changes were required in the views, components, store, or router, as long as the backend matches the schemas and authentication behavior described in this document — **with one exception**: `fetchBookById`'s not-found handling (see Section 3.2) must change from "inspect the body for `null`" to "treat HTTP 404 as not found," since the implemented backend returns 404 with no body instead of the mock's `null` + 200.

> **Logout is new.** The mocked frontend never had a logout call to migrate, so wiring up `POST /auth/logout` (Section 2.2) — clearing the stored token from `localStorage` and calling the endpoint — is net-new frontend work, not a swap of an existing mock function.

---

## 11. Future Endpoints (Not yet in v1.0.0)

The following endpoints are not consumed by the current frontend but are natural next steps:

| Endpoint | Method | Description |
|---|---|---|
| `/books` | `POST` | Create a new book (admin role). |
| `/books/:id` | `PUT` | Update a book (admin role). |
| `/books/:id` | `DELETE` | Delete a book (admin role). |
| `/books/:id/borrow` | `POST` | Mark a book as borrowed (reader). |
| `/books/:id/return` | `POST` | Mark a book as available (reader). |
| `/users/me` | `GET` | Return the current user's public profile. |

---

## 12. Quick Checklist for Backend Implementation

- [x] `POST /auth/login` returns `{ success, user, token }` or `{ success, errorKey }`.
- [x] `POST /auth/logout` is protected, revokes the presented token, and returns `{ success: true }`.
- [x] `POST /auth/refresh` is protected, revokes the old token, issues a new one with a fresh `jti` and `exp`, and returns `{ success: true, token }`.
- [x] `GET /books` is protected and returns an array of `Book` objects (without `summary`/`pdfUrl`).
- [x] `GET /books/:id` is protected and returns a `Book` object including `summary` and `pdfUrl`, or HTTP 404 with no body if it doesn't exist.
- [x] `GET /changelog` is protected and returns an array of `ChangelogEntry` objects, newest first.
- [x] `PATCH /users/me/password` is protected, verifies `currentPassword`, hashes and stores `newPassword`, and returns `{ success: true }`.
- [x] `Authorization: Bearer <token>` is validated on protected routes, including rejecting tokens revoked via logout.
- [x] Passwords are stored hashed.
- [x] CORS is configured for the frontend origin.
- [x] The demo user `reader / reader` exists in the database.
- [x] The demo book catalog is seeded.
- [x] The demo changelog is seeded.
