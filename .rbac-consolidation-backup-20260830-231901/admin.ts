import { logger } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

const normalizeRole = (role: unknown): string =>
  typeof role === 'string' ? role.toUpperCase() : '';

export const isSuperadmin = (req: ServerRequest): boolean =>
  normalizeRole(req.user?.role) === SystemRoles.SUPERADMIN;

export const isPlatformAdmin = (req: ServerRequest): boolean => {
  const role = normalizeRole(req.user?.role);

  return (
    role === SystemRoles.ADMIN ||
    role === SystemRoles.PLATFORM_ADMIN ||
    role === SystemRoles.SUPERADMIN
  );
};

export const isInstitutionAdmin = (req: ServerRequest): boolean =>
  normalizeRole(req.user?.role) === SystemRoles.INSTITUTION_ADMIN;

/**
 * Legacy/general administrator access.
 *
 * ADMIN, PLATFORM_ADMIN and INSTITUTION_ADMIN are accepted for backward
 * compatibility with existing LibreChat admin routes.
 */
export const requireAdmin = (
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): Response | undefined => {
  if (!req.user) {
    logger.warn('[requireAdmin] No user found in request');

    return res.status(401).json({
      error: 'Authentication required',
      error_code: 'AUTHENTICATION_REQUIRED',
    });
  }

  if (!isPlatformAdmin(req) && !isInstitutionAdmin(req)) {
    logger.debug('[requireAdmin] Access denied', {
      user: req.user.email,
      role: req.user.role,
    });

    return res.status(403).json({
      error: 'Access denied: administrator privileges required',
      error_code: 'ADMIN_REQUIRED',
    });
  }

  next();
};

/**
 * Platform-wide administration.
 *
 * ADMIN is retained for backward compatibility.
 * PLATFORM_ADMIN and SUPERADMIN are platform-scoped.
 *
 * This middleware does NOT authorize permanent institution deletion.
 */
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
    logger.debug('[requirePlatformAdmin] Access denied', {
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

/**
 * Institution administration.
 *
 * INSTITUTION_ADMIN is limited to its own institution.
 * PLATFORM_ADMIN and SUPERADMIN may administer institutions platform-wide.
 * ADMIN remains accepted for backward compatibility.
 */
export const requireInstitutionAdmin = (
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

  if (!isInstitutionAdmin(req) && !isPlatformAdmin(req)) {
    logger.debug('[requireInstitutionAdmin] Access denied', {
      user: req.user.email,
      role: req.user.role,
    });

    return res.status(403).json({
      error: 'Institution administrator privileges required',
      error_code: 'INSTITUTION_ADMIN_REQUIRED',
    });
  }

  next();
};

/**
 * Require an authenticated user with institution context.
 *
 * Platform-scoped administrators may operate without tenantId.
 */
export const requireInstitutionContext = (
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

  if (isPlatformAdmin(req)) {
    next();
    return;
  }

  if (!req.user.tenantId) {
    return res.status(403).json({
      error: 'Institution context required',
      error_code: 'INSTITUTION_CONTEXT_REQUIRED',
    });
  }

  next();
};

/**
 * Allows platform administrators to operate across institutions.
 *
 * INSTITUTION_ADMIN may operate only against its own tenantId.
 */
export const requireInstitutionScope = (
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

  if (isPlatformAdmin(req)) {
    next();
    return;
  }

  const userTenantId = req.user.tenantId;

  const params = req.params as Record<string, string | undefined>;

  const targetTenantId =
    params.tenantId ??
    params.institutionId ??
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

  logger.warn('[requireInstitutionScope] Access denied', {
    user: req.user.email,
    role: req.user.role,
    userTenantId,
    targetTenantId,
  });

  return res.status(403).json({
    error: 'Institution scope violation',
    error_code: 'INSTITUTION_SCOPE_REQUIRED',
  });
};

/**
 * Permanent institution/data deletion.
 *
 * SUPERADMIN ONLY.
 *
 * PLATFORM_ADMIN must never be allowed through this middleware.
 */
export const requireInstitutionDeletion = (
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
    logger.warn('[requireInstitutionDeletion] Access denied', {
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
