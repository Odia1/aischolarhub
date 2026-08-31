import { SystemRoles } from 'librechat-data-provider';

/**
 * Central frontend role/capability model.
 *
 * IMPORTANT:
 * These helpers control presentation only.
 * The API remains authoritative for authorization.
 */

export type RbacUser = {
  role?: string | null;
  tenantId?: string | null;
};

const normalize = (role?: string | null): string =>
  typeof role === 'string' ? role.trim().toUpperCase() : '';

export const isSuperAdmin = (user?: RbacUser | null): boolean =>
  normalize(user?.role) === SystemRoles.SUPERADMIN;

export const isPlatformAdmin = (user?: RbacUser | null): boolean =>
  normalize(user?.role) === SystemRoles.PLATFORM_ADMIN ||
  normalize(user?.role) === SystemRoles.SUPERADMIN;

export const isInstitutionAdmin = (user?: RbacUser | null): boolean =>
  normalize(user?.role) === SystemRoles.INSTITUTION_ADMIN;

export const isLegacyAdmin = (user?: RbacUser | null): boolean =>
  normalize(user?.role) === SystemRoles.ADMIN;

export const isAnyAdmin = (user?: RbacUser | null): boolean => {
  const role = normalize(user?.role);

  return (
    role === SystemRoles.ADMIN ||
    role === SystemRoles.PLATFORM_ADMIN ||
    role === SystemRoles.INSTITUTION_ADMIN ||
    role === SystemRoles.SUPERADMIN
  );
};

/**
 * Administrators who can manage users.
 *
 * Institution admins are intentionally included here because their
 * management scope is restricted by tenant on the server.
 */
export const canManageUsers = (user?: RbacUser | null): boolean =>
  isAnyAdmin(user);

/**
 * Platform-wide institution administration.
 */
export const canManageInstitutions = (user?: RbacUser | null): boolean =>
  isPlatformAdmin(user);

/**
 * Permanent deletion is deliberately narrower than ordinary administration.
 */
export const canPermanentlyDeleteInstitution = (
  user?: RbacUser | null,
): boolean => isSuperAdmin(user);

/**
 * Disabling an institution is a platform-level operation, but does not
 * grant permission to permanently destroy its data.
 */
export const canDisableInstitution = (user?: RbacUser | null): boolean =>
  isPlatformAdmin(user);

/**
 * Institution administrators can administer resources only within their
 * assigned institution. The actual tenant boundary must be enforced by
 * the backend.
 */
export const canManageInstitutionResources = (
  user?: RbacUser | null,
): boolean => isInstitutionAdmin(user) || isPlatformAdmin(user);
