import type { Response, NextFunction } from 'express';
import type { ServerRequest } from '~/types/http';

export type InstitutionStatus = 'enabled' | 'disabled';

export type InstitutionResolver = (tenantId: string) => Promise<{ status?: InstitutionStatus } | null>;

/**
 * Rejects authenticated requests for disabled/non-existent institutions.
 * The tenant id comes only from the authenticated request, never from a body
 * or query parameter. Platform administrators are exempt because they operate
 * the global institution registry and may need to re-enable an institution.
 */
export function createRequireEnabledInstitution(resolver: InstitutionResolver) {
  return async function requireEnabledInstitution(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const role = req.user?.role?.toUpperCase();
    if (role === 'ADMIN' || role === 'PLATFORM_ADMIN' || role === 'SUPERADMIN') {
      next();
      return;
    }

    const tenantId = req.user?.tenantId?.trim();
    if (!tenantId) {
      res.status(403).json({ error: 'Institution context required', error_code: 'INSTITUTION_CONTEXT_REQUIRED' });
      return;
    }

    try {
      const institution = await resolver(tenantId);
      if (!institution || institution.status !== 'enabled') {
        res.status(403).json({ error: 'Institution is disabled', error_code: 'INSTITUTION_DISABLED' });
        return;
      }
      next();
    } catch (_error) {
      // Fail closed: an unavailable institution registry must not accidentally
      // turn into access to a potentially disabled tenant.
      res.status(503).json({ error: 'Institution status unavailable', error_code: 'INSTITUTION_STATUS_UNAVAILABLE' });
    }
  };
}
