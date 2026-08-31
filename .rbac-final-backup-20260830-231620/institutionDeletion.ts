import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { requireSuperadmin } from './institutionAdmin';

/**
 * Permanent institution/data deletion is SUPERADMIN-only.
 *
 * PLATFORM_ADMIN may disable an institution but can never reach a permanent
 * deletion handler through this middleware.
 */
export const requireInstitutionDeletion = (
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): Response | undefined => requireSuperadmin(req, res, next);
