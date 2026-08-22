# Security Best Practices Review

## Executive summary

This review covers the repository's Next.js 16.2.10, React 19, TypeScript/JavaScript, Prisma, authentication, payment, referral, upload, and deployment code. It is primarily a static review, supplemented by a user-authorized, privacy-minimized inspection of the local `prisma/dev.db` for test-data classification and a user-authorized production build that loaded `.env` without printing its values. No production logs, backup contents, uploaded-file contents, production records, or live third-party APIs were inspected, and no raw personal values were reported.

After the SEC-002 administrator-login remediation, SEC-003 test-data confirmation, SEC-004 upload hardening, SEC-005 administrator-session remediation, SEC-006 user-cookie hardening, SEC-007 trusted-origin remediation, SEC-008 browser-header remediation, and SEC-009 public-authentication remediation, the review has **1 low-severity** and **1 informational accepted-risk** item. No confirmed critical, high, or open medium-severity vulnerability remains. The most urgent open item is:

1. Process-local public-authentication throttles and easily inflated public counters still need shared or edge-backed abuse controls.

The payment path has several strong controls: provider responses and callbacks are signed and validated, merchant/order/amount values are checked, payment URLs require HTTPS, order ownership is checked, and fulfillment is transactionally idempotent.

## Accepted temporary product decision

### SEC-001 — Contact details are temporarily public by product decision

- **Rule ID:** NEXT-AUTH-001, REACT-AUTHZ-001
- **Severity:** Informational (accepted temporary privacy risk)
- **Location:** `prisma/schema.prisma:26-30`; `src/lib/membership.ts:4-9`; `src/lib/teachers.ts:423-427`; `src/app/teacher/[id]/page.tsx:183-219`
- **Evidence:** The public detail page intentionally renders address, phone, WeChat, QQ, and other contact fields to every visitor. The user confirmed on 2026-08-14 that this is a temporary product decision. The schema comments and membership copy still describe these fields as member-only.
- **Impact:** Public visitors and crawlers can collect the contact details and addresses during the temporary-open period. This is accepted behavior rather than an authentication bypass, but it still carries privacy, scraping, and spam risk.
- **Future change:** When access is restricted again, split teacher data into explicit public and member DTOs. Verify active membership on the server and avoid fetching or serializing restricted fields for non-members; do not rely on UI hiding.
- **Mitigation:** Confirm that every listed person has consented to public display, publish only the minimum necessary fields, and record an owner and review date for ending the temporary-open period.
- **Status notes:** No code change is required while the temporary public-access decision remains active. Update the schema comments and membership product copy if the public period is expected to continue, so the repository does not communicate conflicting access rules.

## Resolved findings

### SEC-002 — Administrator deployment credential and login throttling hardened

- **Rule ID:** NEXT-AUTH-001, NEXT-DOS-001
- **Severity:** Resolved (formerly High)
- **Location:** `deploy-server.sh`; `src/app/adminzhangzhang/actions.ts`; `src/lib/admin-login-limit.ts`; `src/lib/admin-login-limit-token.ts`; `prisma/schema.prisma`; `prisma/migrations/20260815000100_add_admin_login_rate_limits/migration.sql`
- **Resolution:** On 2026-08-14, the tracked deployment script stopped creating or printing `admin888` and began requiring a deployment-supplied password of at least 12 characters. On 2026-08-15, administrator login gained persistent SQLite-backed fixed-window failure throttling and digest-based password comparison.
- **Limits:** Five failed attempts per derived client-IP bucket or 30 failed attempts across the administrator endpoint in 15 minutes block further attempts until the window expires. Successful attempts are not counted.
- **Privacy:** Rate-limit keys are HMAC-derived with the server secret; the database does not store raw IP addresses, passwords, or cookies. Expired counters are deleted opportunistically.
- **Operational note:** A sanitized warning containing only the activated scope is emitted when a threshold is first reached. Production operators should route this signal to their monitoring system and may additionally restrict the route with Nginx, VPN, or an IP allowlist.
- **Verification note:** This repository change does not inspect, replace, or otherwise affect the password already configured in a live environment.


### SEC-003 — Test runtime artifacts removed from current Git tracking

- **Rule ID:** NEXT-SECRETS-001, NEXT-FILES-001
- **Severity:** Resolved (formerly High before data classification)
- **Location:** `origin/main` entries for `prisma/dev.db`, `dev.log`, `dev.err`, and multiple `public/uploads/*` images; `.gitignore:29-44`; `prisma/schema.prisma:26-30,47-57,94-127`
- **Evidence:** The configured GitHub remote-tracking branch `origin/main` contains a SQLite database, runtime logs, and uploaded images. A privacy-minimized local inspection found populated user, teacher, order, and commission tables, but the user confirmed on 2026-08-14 that these artifacts contain test data rather than real user data.
- **Remediation completed:** On 2026-08-14, runtime databases, logs, backups, and uploaded files were added to `.gitignore`; the currently tracked artifacts were removed from the Git index without deleting local files; and `public/uploads/.gitkeep` remains tracked. Future normal commits will no longer include these runtime artifacts.
- **Remaining impact:** Existing GitHub commits retain the synthetic artifacts and add repository size/noise, but the confirmed test-only classification means they are not currently treated as a personal-data exposure.
- **Remaining action:** Commit and push the staged removal. A disruptive Git history rewrite is not required for the confirmed test data. Production uploads and databases must remain outside the source checkout.
- **Reopen condition:** Reclassify this finding immediately if any artifact is later found to contain real user data, real credentials, or production payment information.

### SEC-004 — Image uploads are decoded, bounded, and safely re-encoded

- **Rule ID:** NEXT-FILES-001, REACT-FILE-001
- **Severity:** Resolved (formerly Medium)
- **Location:** `src/lib/image-upload.ts:6-97`; `src/lib/image-upload.test.ts:10-53`; `src/app/adminzhangzhang/actions.ts:68-74,131,155`; `src/app/adminzhangzhang/TeacherForm.tsx:335-356`; `next.config.ts:30-34`
- **Resolution:** The server now enforces at most 8 files, 5 MB per file, and 12 MB total before decoding. Sharp validates actual JPEG/PNG/WebP content, rejects malformed or oversized-pixel input, decodes sequentially to limit memory pressure, applies orientation and size bounds, strips original metadata, flattens transparency, and re-encodes every accepted image as a generated UUID `.jpg`. Partial writes are cleaned up, and uploaded-file deletion now rejects unsafe filenames. The browser file chooser advertises the same supported formats and limits.
- **Remaining impact:** Files remain intentionally public under the application origin, but accepted content is normalized JPEG rather than attacker-selected active content. Global `X-Content-Type-Options: nosniff` is now enforced under SEC-008.
- **Verification:** Targeted ESLint, `tsc --noEmit`, and the Next.js production build passed. Four focused tests passed for valid-image re-encoding, forged image rejection, per-file size rejection, and file-count rejection. The production build loaded the existing `.env` under explicit user authorization without printing its values.
- **Reopen condition:** Re-evaluate if new formats are allowed without decoder support, the limits are raised substantially, or uploads move to a different serving path without equivalent content-type controls.

### SEC-005 — Administrator sessions use revocable opaque tokens

- **Rule ID:** NEXT-SESS-002
- **Severity:** Resolved (formerly Medium)
- **Location:** `src/lib/admin-session-token.ts:3-21`; `src/lib/admin-session.ts:11-48`; `src/app/adminzhangzhang/actions.ts:29-57`; `src/lib/auth.ts:8-12`; `src/proxy.ts:13-22`; `prisma/schema.prisma:14-20`; `prisma/migrations/20260814000200_add_admin_sessions/migration.sql:1-7`
- **Resolution:** Each login now creates an independent 256-bit random token. The browser receives only that opaque token, while SQLite stores only its SHA-256 hash and expiry. Sessions expire after 24 hours, use `HttpOnly`, production-only `Secure`, `SameSite=Strict`, high priority, and a backend-only cookie path. Logout deletes the matching database record and expires the cookie. Proxy performs only an optimistic cookie-presence check; every protected page and Server Action still performs authoritative database validation through `requireAdmin()`.
- **Operational note:** Existing administrator cookies intentionally become invalid and require one new login. `ADMIN_SESSION_SECRET` is no longer used by tracked application or deployment code; an old value may remain harmlessly in an existing `.env` until the operator removes it.
- **Verification:** Prisma validation/client generation passed, all migrations are applied to the local test database, and a create/find/revoke database integration test passed with cleanup. Three token generation/hash/validation tests, targeted ESLint, `tsc --noEmit`, Bash syntax validation, and the Next.js production build all passed.
- **Manual check:** Log in once through `/adminzhangzhang/login`, log out, and confirm the browser cannot revisit a protected admin page without entering the password again.

### SEC-006 — User authentication cookies are Secure in production

- **Rule ID:** NEXT-SESS-001
- **Severity:** Resolved (formerly Medium)
- **Location:** `src/lib/user-session-cookie.ts:1-11`; `src/lib/user-auth.ts:10,242-244,271-273`; `src/lib/user-session-cookie.test.ts:1-20`
- **Resolution:** Login and session refresh now share one cookie-options helper. It preserves `HttpOnly`, `SameSite=Lax`, root path, and the seven-day lifetime, while setting `Secure` only when `NODE_ENV === "production"` so local HTTP development remains usable.
- **Verification:** Two focused tests passed for production and non-production behavior. Targeted ESLint, `tsc --noEmit`, and the Next.js production build passed; the restarted local login page returned HTTP 200.
- **Reopen condition:** Re-evaluate if session cookies are set from another code path or production is intentionally served without HTTPS.

### SEC-007 — Referral redirects and share links use a trusted origin

- **Rule ID:** NEXT-HOST-001, NEXT-REDIRECT-001
- **Severity:** Resolved (formerly Medium)
- **Location:** `src/lib/site-config.ts:1-8`; `src/lib/referral.ts:5,50-53,87,94`; `src/app/promote/page.tsx:4-16,39`; `src/lib/site-config.test.ts:1-14`
- **Resolution:** Production redirects, share links, and referral-cookie HTTPS decisions now use the repository's canonical `https://fenglou1.com` origin. Non-production uses fixed `http://localhost:3000`. No security-sensitive URL is built from request `Host` or proxy headers, and referral codes are encoded before display in share links.
- **Verification:** Two focused origin tests, targeted ESLint, `tsc --noEmit`, and the Next.js production build passed. A local request with `Host: evil.example` returned `307` with `Location: http://localhost:3000/`, confirming the supplied Host was ignored.
- **Defense in depth:** The repository-managed Nginx script already redirects alternate production domains to the canonical host. A default server that rejects all unknown hosts remains useful infrastructure hardening but is no longer required to prevent this application-level redirect poisoning path.
- **Reopen condition:** Re-evaluate if another route constructs absolute URLs from request Host/proxy headers or if the canonical production domain changes.

### SEC-008 — Baseline browser security headers are enforced centrally

- **Rule ID:** NEXT-HEADERS-001, NEXT-CSP-001, REACT-HEADERS-001
- **Severity:** Resolved (formerly Medium)
- **Location:** `next.config.ts:3,22-29`; `src/lib/security-headers.ts:1-19`; `src/lib/security-headers.test.ts:1-32`
- **Resolution:** All application responses now receive `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive camera/microphone/geolocation `Permissions-Policy`. CSP enforces `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and `form-action 'self'`; production also enables `upgrade-insecure-requests`.
- **CSP scope:** The enforced policy intentionally omits `script-src` for now because the application has inline JSON-LD and retains static rendering. A nonce policy would require dynamic rendering, while adding `unsafe-inline` would weaken the intended protection. Strict script CSP remains optional defense-in-depth work rather than an open baseline-header vulnerability.
- **Verification:** Two focused tests, targeted ESLint, `tsc --noEmit`, and the Next.js production build passed. A live local homepage request returned HTTP 200 with all five configured headers, and its development CSP correctly omitted HTTPS upgrading. On 2026-08-22, the deployed `8df3aca` production homepage returned HTTP 200 with the enforced CSP, `nosniff`, `DENY`, referrer, and permissions headers.
- **Remaining hardening:** If strict script CSP becomes a requirement, implement and benchmark a nonce-based dynamic-rendering design or wait for a stable hash/SRI approach; do not enable `unsafe-inline` as a shortcut.
- **Reopen condition:** Re-evaluate if pages must be embeddable, cross-origin forms are introduced, or infrastructure overrides these headers with weaker values.

## Resolved finding with deferred hardening

### SEC-009 — Public authentication inputs are bounded and failures are generic

- **Rule ID:** NEXT-INPUT-001
- **Severity:** Resolved for public authentication (formerly Medium); administrator-only teacher-field bounds remain deferred.
- **Location:** `src/lib/user-auth-input.ts`; `src/lib/user-auth-input.test.ts`; `src/app/user-actions.ts`; `src/lib/user-auth.ts`; `src/app/login/page.tsx`; `src/app/register/page.tsx`
- **Resolution:** Registration now uses centralized runtime validation: usernames are NFKC-normalized, restricted to 2–32 Unicode letters/numbers plus `.`, `_`, and `-`, and new passwords require at least 8 characters while remaining within bcrypt's 72-byte input boundary. Login identifiers are capped at 254 characters and passwords at 72 UTF-8 bytes. Existing accounts with shorter legacy passwords remain able to log in.
- **Enumeration resistance:** Unknown, banned, and wrong-password accounts return the same generic message. A missing account is checked against a fixed dummy bcrypt hash so the response does not skip the expensive comparison. Unexpected registration exceptions are replaced with a generic failure rather than exposing database or implementation details.
- **Browser alignment:** Login and registration fields expose matching `minLength`/`maxLength` and `autocomplete` attributes for usability; server validation remains authoritative.
- **Verification:** Five focused input-validation tests, targeted ESLint, `tsc --noEmit`, and the Next.js production build passed.
- **Deferred hardening:** The user chose to defer length schemas for administrator-managed teacher profile fields. These fields remain protected by administrator authorization but can still store oversized values if a privileged administrator submits them.
- **Reopen condition:** Re-evaluate if another public registration/login entry point is added, email registration becomes user-facing, bcrypt is replaced, or the password byte limit changes.
- **False positive notes:** Prisma parameterizes these writes and React escapes normal JSX output, so this finding is not evidence of SQL injection or direct XSS.

## Low severity

### SEC-010 — Abuse controls are process-local and public counters are easily inflated

- **Rule ID:** NEXT-DOS-001
- **Severity:** Low
- **Location:** `src/lib/rate-limit.ts:1-33`; `src/app/user-actions.ts:11-16,52-57`; `src/lib/request-ip.ts:22-30`; `src/app/api/visits/route.ts:43-67`; `src/app/api/teachers/[id]/view/route.ts:23-48`
- **Evidence:** Login/registration throttles live only in an in-memory `Map`, reset on restart/deployment, and are skipped when the client IP is unknown. Site and teacher counters accept unlimited same-origin-looking requests and perform database writes for each accepted call.
- **Impact:** Attackers can distribute or spoof traffic, wait for restarts, or directly script requests to inflate analytics and generate unnecessary database work. This is mainly an integrity and availability concern, not an authorization bypass.
- **Fix:** Put coarse rate/body limits at Nginx and use a shared rate-limit store for security-sensitive endpoints. Rate-limit or batch public analytics writes, and treat browser headers as weak anti-abuse signals rather than authentication.
- **Mitigation:** Add database/write monitoring and conservative per-IP/per-visitor caps.
- **False positive notes:** A WAF or Nginx rate-limit policy may already reduce the risk; it is not visible here.

## Positive controls observed

- Environment files are ignored while `.env.example` is intentionally allowed (`.gitignore:33-35`).
- User passwords use bcrypt rather than plaintext storage (`src/lib/user-auth.ts:38-47`).
- User JWTs are HttpOnly and SameSite=Lax, and current user/member state is re-read from the database (`src/lib/user-auth.ts:88-108,245-250`).
- Administrator mutations re-check authorization inside each Server Action rather than relying only on `proxy.ts`.
- Payment callbacks verify signatures, merchant identifiers, order numbers, amounts, and success state; fulfillment uses a transaction and conditional update to prevent duplicate credit (`src/lib/qianhe-payment.ts:307-323`; `src/lib/payment.ts:38-101`).
- Order pages and status refreshes enforce user ownership (`src/app/vip/pay/[id]/page.tsx:29-41`; `src/app/vip/actions.ts:142-170`).
- Prisma APIs are used for database access; no SQL-string concatenation was found.
- JSON-LD output replaces `<` before using `dangerouslySetInnerHTML`, reducing script-breakout risk (`src/app/teacher/[id]/page.tsx:25-26,96-104`).

## Review limitations

- No `.env` values, production database records, production logs, backup contents, or uploaded-file contents were inspected.
- No production Nginx, CDN, or WAF configuration was read; only public HTTP status codes and response headers were queried.
- No live payment/provider request was made.
- No online dependency/advisory lookup or `npm audit` request was performed.
- Git history was not scanned for historical secrets or deleted data.
