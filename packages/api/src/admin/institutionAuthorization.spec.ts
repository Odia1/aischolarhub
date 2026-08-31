import { SystemRoles } from 'librechat-data-provider';
import {
  canAssignRole,
  canDeleteInstitution,
  canManageInstitution,
  canManageUser,
  canChangeInstitution,
} from './institutionAuthorization';

describe('institution authorization matrix', () => {
  const nistAdmin = { role: SystemRoles.INSTITUTION_ADMIN, tenantId: 'nist', id: 'n-admin' };
  const platform = { role: SystemRoles.PLATFORM_ADMIN, id: 'p-admin' };
  const superadmin = { role: SystemRoles.SUPERADMIN, id: 's-admin' };

  it('allows platform/superadmin institution administration, but not institution admins', () => {
    expect(canManageInstitution(platform)).toBe(true);
    expect(canManageInstitution(superadmin)).toBe(true);
    expect(canManageInstitution(nistAdmin)).toBe(false);
  });

  it('reserves permanent institution deletion for superadmin', () => {
    expect(canDeleteInstitution(superadmin)).toBe(true);
    expect(canDeleteInstitution(platform)).toBe(false);
    expect(canDeleteInstitution(nistAdmin)).toBe(false);
  });

  it('restricts institution admins to ordinary users/instructors in their own tenant', () => {
    expect(canManageUser(nistAdmin, { tenantId: 'nist', role: SystemRoles.USER })).toBe(true);
    expect(canManageUser(nistAdmin, { tenantId: 'nist', role: SystemRoles.INSTRUCTOR })).toBe(true);
    expect(canManageUser(nistAdmin, { tenantId: 'umass', role: SystemRoles.USER })).toBe(false);
    expect(canManageUser(nistAdmin, { tenantId: 'nist', role: SystemRoles.PLATFORM_ADMIN })).toBe(false);
    expect(canManageUser(nistAdmin, { tenantId: 'nist', role: SystemRoles.INSTITUTION_ADMIN })).toBe(false);
  });

  it('allows platform admins to assign institution admins but not platform/superadmin', () => {
    expect(canAssignRole(platform, SystemRoles.INSTITUTION_ADMIN, 'nist', 'u1')).toBe(true);
    expect(canAssignRole(platform, SystemRoles.PLATFORM_ADMIN, undefined, 'u1')).toBe(false);
    expect(canAssignRole(platform, SystemRoles.SUPERADMIN, undefined, 'u1')).toBe(false);
  });

  it('allows only superadmin to assign platform and superadmin roles', () => {
    expect(canAssignRole(superadmin, SystemRoles.PLATFORM_ADMIN, undefined, 'u1')).toBe(true);
    expect(canAssignRole(superadmin, SystemRoles.SUPERADMIN, undefined, 'u1')).toBe(true);
  });

  it('prevents institution-admin self escalation and cross-tenant assignment', () => {
    expect(canAssignRole(nistAdmin, SystemRoles.INSTITUTION_ADMIN, 'nist', 'n-admin')).toBe(false);
    expect(canAssignRole(nistAdmin, SystemRoles.INSTRUCTOR, 'umass', 'u1')).toBe(false);
    expect(canAssignRole(nistAdmin, SystemRoles.USER, 'nist', 'u1')).toBe(true);
  });

  it('does not allow any non-platform actor to move an institution', () => {
    expect(canChangeInstitution(nistAdmin, 'nist', 'umass')).toBe(false);
    expect(canChangeInstitution(platform, 'nist', 'umass')).toBe(true);
  });
});
