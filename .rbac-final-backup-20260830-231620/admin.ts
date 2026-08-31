import { logger } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * Platform/institution RBAC middleware.
 *
 * PLATFORM_ADMIN:
 *   - platform-wide administration
 *   - may manage institutions
 *   - may manage institution admins
 *   - may disable institutions
 *   - must NOT delete institution data
 *
 * INSTITUTION_ADMIN:
 *   - administration inside the authenticated user's institution
 *   - may not manage institutions
 *   - may not manage other institutions
 *
 * ADMIN:
 *   - legacy LibreChat administrator role
 *   - retained for backward compatibility
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

  const role = req.user.role;

  if (
    role !== SystemRoles.ADMIN &&
    role !== SystemRoles.PLATFORM_ADMIN &&
    role !== SystemRoles.INSTITUTION_ADMIN
  ) {
    logger.debug(
      `[requireAdmin] Access denied for user: ${req.user.email}, role: ${String(role)}`,
    );

    return res.status(403).json({
      error: 'Access denied: administrator privileges required',
      error_code: 'ADMIN_REQUIRED',
    });
  }

  next();
};

/**
 * Platform administrator only.
 *
 * Use for operations that cross institution boundaries:
 * - create institution
 * - disable institution
 * - assign/create Institution Admin
 * - platform-wide configuration
 *
 * IMPORTANT:
 * This middleware does NOT authorize permanent institution deletion.
 * Permanent institution/data deletion belongs exclusively to Superadmin.
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

  if (
    req.user.role !== SystemRoles.PLATFORM_ADMIN &&
    req.user.role !== SystemRoles.ADMIN
  ) {
    logger.debug(
      `[requirePlatformAdmin] Access denied for user: ${req.user.email}`,
    );

    return res.status(403).json({
      error: 'Platform administrator privileges required',
      error_code: 'PLATFORM_ADMIN_REQUIRED',
    });
  }

  next();
};

/**
 * Institution administrator only.
 *
 * PLATFORM_ADMIN is intentionally accepted because platform administrators
 * must be able to administer institutions.
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

  if (
    req.user.role !== SystemRoles.INSTITUTION_ADMIN &&
    req.user.role !== SystemRoles.PLATFORM_ADMIN &&
    req.user.role !== SystemRoles.ADMIN
  ) {
    logger.debug(
      `[requireInstitutionAdmin] Access denied for user: ${req.user.email}`,
    );

    return res.status(403).json({
      error: 'Institution administrator privileges required',
      error_code: 'INSTITUTION_ADMIN_REQUIRED',
    });
  }

  next();
};

/**
 * Require an authenticated user to belong to an institution.
 *
 * Platform administrators may operate without an institution because they
 * are platform-scoped.
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

  if (
    req.user.role === SystemRoles.PLATFORM_ADMIN ||
    req.user.role === SystemRoles.ADMIN
  ) {
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
