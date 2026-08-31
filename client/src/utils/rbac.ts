import { SystemRoles } from 'librechat-data-provider';

type UserLike = {
  role?: string | null;
  tenantId?: string | null;
};

const normalize = (role?: string | null): string =>
  typeof role === 'string' ? role.toUpperCase() : '';

export const isSuperadmin = (user?: UserLike | null): boolean =>
  normalize(user?.role) === SystemRoles.SUPERADMIN;

export const isPlatformAdmin = (user?: UserLike | null): boolean => {
  const role = normalize(user?.role);

  return (
    role === SystemRoles.ADMIN ||
    role === SystemRoles.PLATFORM_ADMIN ||
    role === SystemRoles.SUPERADMIN
  );
};

export const isInstitutionAdmin = (user?: UserLike | null): boolean =>
  normalize(user?.role) === SystemRoles.INSTITUTION_ADMIN;

export const isPrivilegedAdmin = (user?: UserLike | null): boolean =>
  isPlatformAdmin(user) || isInstitutionAdmin(user);

export const canManageInstitutions = (user?: UserLike | null): boolean =>
  isPlatformAdmin(user);

export const canPermanentlyDeleteInstitution = (
  user?: UserLike | null,
): boolean => isSuperadmin(user);

export const canManageInstitutionUsers = (
  user?: UserLike | null,
): boolean => isPrivilegedAdmin(user);

export const canManagePlatformUsers = (
  user?: UserLike | null,
): boolean => isPlatformAdmin(user);

export const canManageRoles = (user?: UserLike | null): boolean =>
  isPrivilegedAdmin(user);

export const canManagePlatformRoles = (user?: UserLike | null): boolean =>
  isPlatformAdmin(user);

export const canManageAdminConfiguration = (
  user?: UserLike | null,
): boolean => isPrivilegedAdmin(user);

export const canUseAdminSettings = (user?: UserLike | null): boolean =>
  isPrivilegedAdmin(user);

export const isUserInSameInstitution = (
  user?: UserLike | null,
  tenantId?: string | null,
): boolean =>
  Boolean(user?.tenantId && tenantId && user.tenantId === tenantId);
