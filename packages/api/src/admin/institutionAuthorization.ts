import { SystemRoles } from 'librechat-data-provider';

export type InstitutionAdminActor = {
  role?: string | null;
  tenantId?: string | null;
  id?: string | null;
};

export type InstitutionTarget = {
  tenantId?: string | null;
  role?: string | null;
  id?: string | null;
};

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

export const isSuperadminRole = (role?: string | null): boolean =>
  normalize(role) === SystemRoles.SUPERADMIN;

export const isPlatformAdminRole = (role?: string | null): boolean =>
  normalize(role) === SystemRoles.PLATFORM_ADMIN || normalize(role) === SystemRoles.ADMIN;

export const isInstitutionAdminRole = (role?: string | null): boolean =>
  normalize(role) === SystemRoles.INSTITUTION_ADMIN;

export const isInstitutionScopedRole = (role?: string | null): boolean =>
  normalize(role) === SystemRoles.INSTITUTION_ADMIN ||
  normalize(role) === SystemRoles.INSTRUCTOR ||
  normalize(role) === SystemRoles.USER;

/**
 * Institution-admin operations are intentionally narrow: an institution admin
 * can manage ordinary users/instructors in its own tenant, but cannot create,
 * assign, or remove an administrative role. Platform admins can manage
 * institution admins, while only superadmin can grant platform/superadmin.
 */
export function canManageUser(actor: InstitutionAdminActor, target: InstitutionTarget): boolean {
  if (isSuperadminRole(actor.role)) return true;
  if (isPlatformAdminRole(actor.role)) {
    const targetRole = normalize(target.role);
    return targetRole !== SystemRoles.SUPERADMIN && targetRole !== SystemRoles.PLATFORM_ADMIN;
  }
  if (!isInstitutionAdminRole(actor.role)) return false;
  const targetRole = normalize(target.role);
  return Boolean(
    actor.tenantId &&
    target.tenantId &&
    actor.tenantId === target.tenantId &&
    (targetRole === SystemRoles.USER || targetRole === SystemRoles.INSTRUCTOR),
  );
}

export function canAssignRole(
  actor: InstitutionAdminActor,
  requestedRole: string,
  targetTenantId?: string | null,
  targetUserId?: string | null,
): boolean {
  const role = normalize(requestedRole);
  const actorRole = normalize(actor.role);

  // Nobody can use an ordinary user-management path to grant SUPERADMIN.
  if (role === SystemRoles.SUPERADMIN) return isSuperadminRole(actor.role);

  // PLATFORM_ADMIN is a superadmin-only grant.
  if (role === SystemRoles.PLATFORM_ADMIN) return isSuperadminRole(actor.role);

  // Legacy ADMIN remains a platform role; do not allow it to be assigned through
  // the institutional user-management surface.
  if (role === SystemRoles.ADMIN) return isSuperadminRole(actor.role);

  if (isSuperadminRole(actor.role) || isPlatformAdminRole(actor.role)) {
    return true;
  }

  if (!isInstitutionAdminRole(actor.role)) return false;
  if (!actor.tenantId || actor.tenantId !== targetTenantId) return false;
  if (targetUserId && actor.id && targetUserId === actor.id) return false;

  return role === SystemRoles.USER || role === SystemRoles.INSTRUCTOR;
}

export function canChangeInstitution(
  actor: InstitutionAdminActor,
  fromTenantId: string | null | undefined,
  toTenantId: string | null | undefined,
): boolean {
  if (isSuperadminRole(actor.role) || isPlatformAdminRole(actor.role)) return true;
  return false;
}

export function canDeleteInstitution(actor: InstitutionAdminActor): boolean {
  return isSuperadminRole(actor.role);
}

export function canManageInstitution(actor: InstitutionAdminActor): boolean {
  return isSuperadminRole(actor.role) || isPlatformAdminRole(actor.role);
}

export function resolveRequiredTenant(actor: InstitutionAdminActor): string | null {
  if (isInstitutionAdminRole(actor.role)) return actor.tenantId?.trim() || null;
  return null;
}
