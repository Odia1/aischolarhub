# AI Scholar Hub Admin UI — corrected institution/role hierarchy

This deliverable replaces the current `admin-ui/server.js` and `admin-ui/public/index.html`.

## Implemented rules

- Superadmin is the designated account `ppatra@seedsnet.org` with `superAdmin: true`.
- Platform Admin is below Superadmin and may create/disable institutions.
- Platform Admin cannot modify Superadmin or another Platform Admin.
- Institution Admin is scoped to exactly one `tenantId` and cannot access another institution.
- Institution Admin may manage only USER/Instructor accounts in its institution.
- Higher-level administrators are displayed separately from institution members.
- Institution users are grouped as Institution -> email domain -> users.
- The institution dashboard does not interpret email domains as separate institutions.
- Institution Admin login is denied when its institution is disabled.
- Platform/Superadmin-created institution-scoped users require a valid institution.
- Institution Admin assignment requires an enabled institution.
- Password-reset/send-link operations are authorization checked.
- Permanent institution deletion remains Superadmin-only.
- The UI no longer exposes the legacy ADMIN role as a role that can be created.

## Important data step

The UI assumes the MongoDB `institutions` collection has the canonical institution records.
For the current deployment, consolidate the existing two domain-derived institution records into
one `SEEDS` institution and set both domains' users to `tenantId: "seeds"` (or whatever canonical
SEEDS institution `_id` you choose). Do not use email domains as institution IDs.

This package intentionally does not modify Git history, `.env`, credentials, or the main LibreChat source tree.
