# CampusFix Local Account Security Summary

## Delivered account experience

CampusFix now presents an account gateway before the existing support homepage. A visitor chooses either **Existing user** or **New to CampusFix**; the next form enters with a restrained zoom-and-fade transition. Successful authentication reveals the unchanged support workspace inside an authenticated shell with **Dashboard**, **Profile**, and **Sign out** navigation.

## Implemented controls

| Area | Implemented control |
| --- | --- |
| Account identity | Usernames are normalized, constrained to 3–32 safe characters, and backed by a unique database record. |
| Password storage | Passwords are never stored in plaintext. CampusFix creates a random salt and stores an `scrypt` digest; verification uses a timing-safe comparison. |
| Credential validation | Passwords must be 12–128 characters, byte-length is bounded, and malformed input is rejected before database access. |
| SQL injection resistance | Drizzle ORM constructs parameterized queries; the username allowlist additionally rejects quote-based and other injection-like input. |
| Sessions | A 256-bit opaque session token is placed in an `httpOnly`, `SameSite=Lax` cookie. Only its SHA-256 digest is persisted, with a 30-day expiry. |
| Session lifecycle | Logout removes the presented server-side session. A password change requires the old password, deletes all active sessions, and issues a new session for the current device. |
| Access control | Profile reading, profile updates, and password changes require the CampusFix local session specifically—not merely an unrelated platform session. |
| Brute-force friction | Repeated failed local credential attempts are limited per client address in a 15-minute window. |
| Data exposure | Registration and login responses return only safe user fields; password hashes and opaque session values are never returned in API data. |

## Automated verification

The regression suite contains **45 passing tests** and one intentional skip. Account coverage includes successful registration and login, password hashing, injection-like username rejection, opaque-session lookup, logout, invalid-password rejection, rate limiting, protected profile access and update rejection, profile persistence, old-password enforcement, session invalidation, and successful re-login with a rotated password.

## Integration boundary

No configured MCP service is needed to store credentials, create sessions, or update profiles. Existing OpenRouter usage remains limited to the post-login diagnostic agent. ElevenLabs is intentionally excluded from this account enhancement.

## Production hardening note

These controls materially reduce common credential, session, and injection risks, but no web application can honestly be described as invulnerable. Before a public production launch, retain HTTPS and secure production cookie settings, move rate-limit state to a shared store if the app scales across instances, add security monitoring and account-recovery policy, and obtain an independent penetration test.
