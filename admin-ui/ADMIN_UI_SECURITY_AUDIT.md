# AI Scholar Hub Admin UI — Security, Audit & Verification

**Project:** `/opt/aischolarhub`
**Service:** `aischolarhub-admin-ui`
**Admin UI:** `http://127.0.0.1:3090`
**Database:** MongoDB `LibreChat` database
**Audit collection:** `adminAudit`

## 1. What was implemented

The Admin UI was hardened and instrumented so administrator activity is auditable without logging passwords or other secrets.

### Authentication

- Administrator login accepts only users with `role: "ADMIN"` and a valid password.
- Successful logins generate a random server-side session token.
- The session token is stored in the in-memory `sessions` map.
- The browser receives the session as an `HttpOnly` cookie.
- The cookie is `SameSite=Lax`, `Path=/`, and is marked `Secure` when the request is HTTPS (including an HTTPS reverse-proxy deployment).
- Failed administrator logins are recorded as `LOGIN_FAILED`.
- Successful administrator logins are recorded as `LOGIN_SUCCESS`.
- Logout is recorded as `LOGOUT` when a valid session exists.

### Superadmin protection

- The designated Superadmin is identified by the existing `SUPERADMIN_ID` protection.
- The Superadmin account cannot be deleted.
- The Superadmin account cannot be demoted from `ADMIN`.
- The Superadmin designation cannot be removed from the protected account.
- Other administrators cannot grant themselves or another account `superAdmin: true`.
- Promoting a user to `ADMIN`, demoting an administrator, and creating administrator accounts are restricted to the Superadmin as implemented in the Admin UI.
- Unauthorized Superadmin endpoint access is recorded as `SUPERADMIN_ACCESS_DENIED`.

### User-management audit events

The following administrative operations are audited:

| Event | Meaning |
|---|---|
| `USER_CREATED` | A user account was created |
| `USER_SETUP_EMAIL_SENT` | The password setup/reset request for a newly created user was accepted by LibreChat |
| `USER_UPDATED` | An existing user was changed |
| `PASSWORD_RESET_SENT` | An administrator explicitly requested a password setup/reset email for a user |
| `USER_DELETED` | A user account was deleted |
| `USERS_BULK_CREATED` | A bulk user-creation operation completed |

The audit record includes the acting administrator, target user where applicable, action, result, timestamp, source, IP address, user agent, and a deliberately limited `details` object.

**Passwords, session tokens, bootstrap passwords, reset tokens, and API keys must never be placed in `details`.**

## 2. Audit storage

Audit events are stored in:

```text
LibreChat.adminAudit
```

Indexes currently configured:

```text
_id_
audit_timestamp_desc       { timestamp: -1 }
audit_action_timestamp      { action: 1, timestamp: -1 }
audit_actor_timestamp       { actorEmail: 1, timestamp: -1 }
audit_target_timestamp      { targetEmail: 1, timestamp: -1 }
audit_retention_2y          { timestamp: 1 }, expireAfterSeconds: 63072000
```

The `audit_retention_2y` TTL index automatically expires events after approximately two years. This keeps the collection bounded without requiring a scheduled cleanup job.

## 3. Audit API

Superadmin-only endpoints:

```text
GET /api/superadmin/audit
GET /api/superadmin/audit/actions
```

Examples:

```bash
curl -sS -b /tmp/aischolarhub-admin.cookies \
  'http://127.0.0.1:3090/api/superadmin/audit?limit=20'

curl -sS -b /tmp/aischolarhub-admin.cookies \
  http://127.0.0.1:3090/api/superadmin/audit/actions
```

The audit query supports the existing filters exposed by the route, including action, actor, and target, plus a bounded result limit.

## 4. Why ordinary-user password resets are not audited individually

Routine end-user password-reset activity should remain primarily in LibreChat's normal authentication/security logging rather than being copied into the Admin UI audit collection.

The Admin UI audit trail is intended to answer:

> Which administrator changed what, when, and to whom?

Therefore `PASSWORD_RESET_SENT` is appropriate when an administrator explicitly sends a reset/setup message from the Admin UI. Ordinary users initiating their own password reset should not generate an Admin UI audit event.

This keeps the audit collection small and focused while still providing accountability for privileged administrative actions.

## 5. Verification already completed

The following checks have been successfully demonstrated:

1. Admin login succeeded and produced a usable session.
2. `/api/me` returned the authenticated administrator and `superAdmin: true`.
3. Superadmin audit retrieval returned HTTP 200.
4. The first successful login audit events appeared as `LOGIN_SUCCESS`.
5. A test user using the permitted `@seedsnet.in` domain was created successfully.
6. Creation produced `USER_CREATED` and `USER_SETUP_EMAIL_SENT` audit events.
7. Updating the test user's username produced `USER_UPDATED` with changed-field details.
8. Deleting the test user produced `USER_DELETED`.
9. MongoDB verification confirmed the test user no longer existed.
10. The audit collection contained the complete test sequence.
11. Audit indexes, including the two-year TTL retention index, were created successfully.
12. Container health returned:

```json
{"ok":true,"service":"AI Scholar Hub User Management"}
```

13. `node --check /app/server.js` succeeded inside the Admin UI container after the audit changes.
14. The Secure cookie behavior was corrected for the local HTTP/proxy testing environment; the observed response cookie no longer incorrectly required `Secure` on plain HTTP localhost testing.

## 6. Operational recommendations

- Keep the audit collection in MongoDB rather than writing every event to application log files.
- Retain the two-year TTL policy unless organizational/legal requirements call for a different period.
- Do not audit every ordinary user action; audit privileged administrative actions.
- Do not record passwords, reset tokens, cookies, authorization headers, API keys, or other credentials.
- Periodically verify the TTL index remains present after MongoDB maintenance or migrations.
- Back up `admin-ui/server.js` before future security changes, but remove one-off development backups after the change has been verified and committed.
- For production, ensure the Admin UI is reached through HTTPS and the reverse proxy forwards the correct `X-Forwarded-Proto` value.
- The current session store is in memory; restarting the Admin UI invalidates active sessions. This is acceptable for the current single-instance design but should be revisited if the service is later scaled horizontally.

## 7. Files changed

Primary implementation:

```text
/opt/aischolarhub/admin-ui/server.js
```

The implementation includes the audit helper, Superadmin audit endpoints, authentication auditing, and user-management audit calls.

A repeatable verification script is provided separately as:

```text
admin-ui/test-admin-ui.sh
```

## 8. Final expected audit action set

After the implementation is exercised, the action list should contain some or all of:

```text
LOGIN_FAILED
LOGIN_SUCCESS
LOGOUT
SUPERADMIN_ACCESS_DENIED
USER_CREATED
USER_SETUP_EMAIL_SENT
USER_UPDATED
PASSWORD_RESET_SENT
USER_DELETED
USERS_BULK_CREATED
```

Only actions that have actually occurred will appear in `/api/superadmin/audit/actions`.
