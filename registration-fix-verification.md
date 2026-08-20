# Local Account Registration Repair Verification

## Diagnosis

The reported database insert failure occurred after a prior registration had already created the requested local username. The repeat attempt correctly reached the unique-username constraint, but Drizzle surfaced the MySQL duplicate-key code on the wrapped error's `cause` rather than directly on the outer error. The account layer therefore did not convert that expected conflict into its safe user-facing message.

## Repair

The local registration handler now walks the bounded database error cause chain. An `ER_DUP_ENTRY` at any wrapped level becomes the existing `username_taken` domain error. The API then returns the deliberate, non-sensitive message: “That username is unavailable. Choose another one.” No credential, hash, or database-detail disclosure is returned.

## Evidence

| Verification | Result |
| --- | --- |
| Focused duplicate-error regression | Passed: the handler maps a driver-wrapped `ER_DUP_ENTRY` to `username_taken`. |
| Live duplicate request | Returned HTTP 400 with the safe username-unavailable message, rather than HTTP 500. |
| Full test suite | 46 tests passed, with 1 intentional skip; TypeScript validation passed. |
| Fresh browser account journey | Passed on desktop and mobile with a newly generated username. The flow exercised registration, local session, Profile, blank optional email save, old-password-confirmed password rotation, Dashboard return, mobile navigation, re-login, and sign-out. |
| Desktop visual evidence | The post-fix Profile screen rendered the expected protected fields, old-password gate, active sidebar state, and sign-out control. |
