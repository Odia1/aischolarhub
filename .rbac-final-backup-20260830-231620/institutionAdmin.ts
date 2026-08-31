import { logger } from '@librechat/data-schemas';
import {
  SystemRoles,
} from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

const normalized = (value: unknown): string =>
  typeof value === 'string' ? value.toUpperCase() : '';

export const isSuperadmin = (req: ServerRequest): boolean =>
  normalized(req.user?.role) === normalized(SystemRoles.SUPERADMIN);

export const isPlatformAdmin = (req: ServerRequest): boolean => {
  const role = normalized(req.user?.role);
  return (
    role === normalized(SystemRoles.ADMIN) ||
    role === normalized(SystemRoles.PLATFORM_ADMIN) ||
    role === normalized(SystemRoles.SUPERADMIN)
  );
};

export const isInstitutionAdmin = (req: ServerRequest): boolean =>
  normalized(req.user?.role) === normalized(SystemRoles.INSTITUTION_ADMIN);

export const requirePlatformAdmin = (
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): Response | undefined => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      error_code: 'AUTHENTICATION_REQUIRED',
    });
  }

  if (!isPlatformAdmin(req)) {
    logger.debug('[requirePlatformAdmin] denied', {
      user: req.user.email,
      role: req.user.role,
    });

    return res.status(403).json({
      error: 'Platform administrator privileges required',
      error_code: 'PLATFORM_ADMIN_REQUIRED',
    });
  }

  next();
};

export const requireSuperadmin = (
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): Response | undefined => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      error_code: 'AUTHENTICATION_REQUIRED',
    });
  }

  if (!isSuperadmin(req)) {
    logger.warn('[requireSuperadmin] denied', {
      user: req.user.email,
      role: req.user.role,
    });

    return res.status(403).json({
      error: 'Superadmin privileges required',
      error_code: 'SUPERADMIN_REQUIRED',
    });
  }

  next();
};

/**
 * Allows PLATFORM_ADMIN/SUPERADMIN to operate platform-wide.
 * Allows INSTITUTION_ADMIN only when the target institution matches
 * the authenticated user's tenantId.
 */
export function requireInstitutionScope(
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): Response | undefined {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      error_code: 'AUTHENTICATION_REQUIRED',
    });
  }

  if (isPlatformAdmin(req)) {
    next();
    return;
  }

  const userTenantId = req.user.tenantId;
  const targetTenantId =
    (req.params as Record<string, string | undefined>).tenantId ??
    (req.params as Record<string, string | undefined>).institutionId ??
    req.body?.tenantId ??
    req.body?.institutionId;

  if (
    isInstitutionAdmin(req) &&
    userTenantId &&
    targetTenantId &&
    userTenantId === targetTenantId
  ) {
    next();
    return;
  }

  logger.warn('[requireInstitutionScope] denied', {
    user: req.user.email,
    role: req.user.role,
    userTenantId,
    targetTenantId,
  });

  return res.status(403).json({
    error: 'Institution scope violation',
    error_code: 'INSTITUTION_SCOPE_REQUIRED',
  });
}
