# ContentX Platform Security & Authentication Architecture

## 1. Overview
ContentX is an enterprise AI content transformation platform that converts source material into 7 verified formats (Executive Summary, Threat Advisory, LinkedIn, Twitter/X, Presentation, Infographic, and Video Scripts) grounded against a canonical Fact Registry.

This document outlines the Phase 1 Critical Security & Authentication Hardening implementation.

---

## 2. Server-Side Policy & Privilege Escalation Protection (CRIT-02)

### Registration Policy
- **Public Registration Enforcement**: The public registration endpoint (`POST /api/auth/register`) enforces a strict server-side policy.
- **Client-Provided Role Ignored**: Any client-provided `role` field in the request body is explicitly discarded by the backend.
- **Least-Privilege Default**: Every public registration automatically assigns the `Viewer` role.
- **Privileged Role Assignment**: `Admin` and `Editor` roles CANNOT be created through public endpoints. They must be created by an authenticated `Admin` or via the secure deployment bootstrap process.

### Role-Based Access Control (RBAC)
- **`Admin`**: Full system access, administrator bootstrap, provider settings mutation, user management, and document transformation.
- **`Editor`**: Ingestion, document upload, chunking, Fact Registry extraction, output generation, and content edits.
- **`Viewer`**: Read-only access to documents, facts, outputs, provenance records, and public verification endpoints. Prohibited from uploading, transforming, generating, editing, or altering settings.

---

## 3. Cryptographic Password Hashing (CRIT-04 / SEC-03)

- **Algorithm**: `scrypt` via Node.js native `crypto.scryptSync`.
- **Per-Account Salt**: Hardcoded global salts have been completely removed. Every user account generates a unique 16-byte cryptographically random salt (`crypto.randomBytes(16).toString('hex')`).
- **Hash Storage**: `password_hash` (64-character hex string) and `password_salt` are stored separately.
- **Timing-Safe Verification**: Password comparison uses `crypto.timingSafeEqual` between hex buffers to prevent timing side-channel attacks.
- **Confidentiality**: Password hashes and salts are stripped from all user objects before returning data over APIs or issuing session tokens.

---

## 4. JWT & Session Token Security (CRIT-04 / SEC-05 / SEC-06)

- **Structure**: Encoded base64url signed token containing user ID, email, role, expiration timestamp, and SHA-256 HMAC signature.
- **Secret Requirement**: In `production` mode, the application requires `JWT_SECRET` via environment configuration with a minimum length of 32 characters. If `JWT_SECRET` is missing, empty, or default, startup is aborted immediately.
- **Fallback Prohibition**: Insecure fallback defaults like `JWT_SECRET || "default"` are strictly forbidden in production.
- **Session Expiration**: Tokens carry an explicit millisecond timestamp (`expiresAt`). Expired tokens are rejected with HTTP 401 (`SESSION_EXPIRED`).
- **Session Revocation**: Logouts invoke `dbStore.revokeToken(token)` to immediately add the token to an in-memory revocation set and remove active session state.

---

## 5. Development vs. Production Separation & Demo Credentials

- **Environment Modes**: `development`, `test`, `production`.
- **Demo Mode**:
  - Controlled by `CONTENTX_DEMO_MODE`.
  - Automatically disabled (`CONTENTX_DEMO_MODE=false`) in `production`.
  - Quick-fill evaluation credentials and instant role login shortcuts in the UI are wrapped with `import.meta.env.DEV` and are completely excluded from production build bundles.
- **Admin Bootstrap**:
  - In production, initial `Admin` accounts are provisioned idempotently via secure environment variables (`CONTENTX_ADMIN_EMAIL` and `CONTENTX_ADMIN_PASSWORD`).
  - Plaintext passwords are never logged or stored.

---

## 6. Rate Limiting, Security Headers & CORS

- **Rate Limiting**: Auth endpoints (`POST /api/auth/login`, `POST /api/auth/register`) are protected by an in-process rate limiter (15 attempts/minute/IP) returning HTTP 429 when exceeded.
- **Security Headers**: Minimal secure HTTP headers applied to all responses:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **CORS Configuration**: Restricts origins using `config.corsOrigin`. Wildcard origins (`*`) are disallowed for authenticated production APIs.

---

## 7. Audit Logging & Confidentiality

- Security events (`USER_REGISTER`, `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `AUTHORIZATION_DENIED`, `ADMIN_BOOTSTRAP`, `SETTINGS_UPDATE`) are logged with ISO-8601 timestamps, user email, role, action, and resource ID.
- Plaintext passwords, password salts, JWT secrets, and bearer session tokens are NEVER written to audit logs or console output.
