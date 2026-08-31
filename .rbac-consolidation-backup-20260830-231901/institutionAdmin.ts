/**
 * Institution RBAC middleware.
 *
 * The authoritative implementation lives in ./admin.
 *
 * This compatibility module exists so existing imports continue to work.
 */
export {
  isSuperadmin,
  isPlatformAdmin,
  isInstitutionAdmin,
  requirePlatformAdmin,
  requireInstitutionAdmin,
  requireInstitutionContext,
  requireInstitutionScope,
  requireInstitutionDeletion,
} from './admin';
