import { SystemRoles } from 'librechat-data-provider';
import { createRequireEnabledInstitution } from './institution';

import type { InstitutionStatus } from '@librechat/data-schemas';
describe('requireEnabledInstitution', () => {
  const response = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { status, json };
  };

  it('allows enabled tenant users', async () => {
    const next = jest.fn();
    const res = response();
    const middleware = createRequireEnabledInstitution(async () => ({ status: 'enabled' }));
    await middleware({ user: { role: SystemRoles.USER, tenantId: 'nist' } } as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects disabled and unknown tenants', async () => {
    for (const result of [{ status: 'disabled' as InstitutionStatus }, null]) {
      const next = jest.fn();
      const res = response();
      const middleware = createRequireEnabledInstitution(async () => result);
      await middleware({ user: { role: SystemRoles.USER, tenantId: 'nist' } } as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('fails closed if the institution registry is unavailable', async () => {
    const next = jest.fn();
    const res = response();
    const middleware = createRequireEnabledInstitution(async () => {
      throw new Error('db unavailable');
    });
    await middleware({ user: { role: SystemRoles.USER, tenantId: 'nist' } } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not block platform registry operators', async () => {
    const resolver = jest.fn();
    const next = jest.fn();
    const res = response();
    const middleware = createRequireEnabledInstitution(resolver);
    await middleware({ user: { role: SystemRoles.PLATFORM_ADMIN } } as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(resolver).not.toHaveBeenCalled();
  });
});
