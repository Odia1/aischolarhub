import { Types } from 'mongoose';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString, runAsSystem } from '@librechat/data-schemas';
import type {
  IUser,
  IConfig,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';
import { canManageUser, isInstitutionAdminRole } from './institutionAuthorization';

const MAX_SEARCH_LENGTH = 200;

const USER_LIST_FIELDS = '_id name username email avatar role provider tenantId createdAt updatedAt';

function isPlatformScoped(req: ServerRequest): boolean {
  const role = req.user?.role?.toUpperCase();
  return role === SystemRoles.ADMIN || role === SystemRoles.PLATFORM_ADMIN || role === SystemRoles.SUPERADMIN;
}

function runUserScope<T>(req: ServerRequest, fn: () => Promise<T>): Promise<T> {
  return isPlatformScoped(req) ? runAsSystem(fn) : fn();
}

export interface AdminUsersDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  beginAgentTriggerUserDeletion: (
    userId: string,
    startedAt: Date,
  ) => Promise<'acquired' | 'in_progress' | 'missing'>;
  cancelAgentTriggerUserDeletion: (userId: string, startedAt: Date) => Promise<boolean>;
  drainAgentTriggerDeliveriesForUser: (userId: string) => Promise<void>;
  prepareAgentTriggerUserPurge: (
    userId: string,
    fenceStartedAt: Date,
    tenantId?: string,
  ) => Promise<void>;
  cancelAgentTriggerUserPurge: (userId: string, fenceStartedAt: Date) => Promise<boolean>;
  purgeAgentTriggerDeliveriesForUser: (userId: string) => Promise<void>;
  /**
   * Thin data-layer delete — removes the User document only.
   * Full cascade of user-owned resources (conversations, messages, files, tokens, etc.)
   * is handled by `UserController.deleteUserController` in the self-delete flow.
   * This admin endpoint fences durable triggers around the user commit and currently
   * cascades Config and AclEntries.
   * A future iteration should consolidate the full cascade into a shared service function.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
}

export function createAdminUsersHandlers(deps: AdminUsersDeps): {
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  searchUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteUser: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUsers,
    countUsers,
    beginAgentTriggerUserDeletion,
    cancelAgentTriggerUserDeletion,
    drainAgentTriggerDeliveriesForUser,
    prepareAgentTriggerUserPurge,
    cancelAgentTriggerUserPurge,
    purgeAgentTriggerDeliveriesForUser,
    deleteUserById,
    deleteConfig,
    deleteAclEntries,
  } = deps;

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const callerTenantId = req.user?.tenantId?.trim();
      const scopeFilter = isInstitutionAdminRole(req.user?.role) ? { tenantId: callerTenantId } : {};
      if (isInstitutionAdminRole(req.user?.role) && !callerTenantId) {
        return res.status(403).json({ error: 'Institution context required' });
      }
      const [users, total] = await Promise.all([
        runUserScope(req, () => findUsers(scopeFilter, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } })),
        runUserScope(req, () => countUsers(scopeFilter)),
      ]);

      const mapped: AdminUserListItem[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        username: u.username ?? '',
        email: u.email ?? '',
        avatar: u.avatar ?? '',
        role: u.role ?? 'USER',
        provider: u.provider ?? 'local',
        createdAt: u.createdAt?.toISOString(),
        updatedAt: u.updatedAt?.toISOString(),
      }));

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}`, 'i');

      const scopeFilter = isInstitutionAdminRole(req.user?.role)
        ? { tenantId: req.user?.tenantId, $or: [{ name: regex }, { email: regex }, { username: regex }] }
        : { $or: [{ name: regex }, { email: regex }, { username: regex }] };
      if (isInstitutionAdminRole(req.user?.role) && !req.user?.tenantId) {
        return res.status(403).json({ error: 'Institution context required' });
      }

      const users = await runUserScope(req, () => findUsers(
        scopeFilter,
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      ));

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    let targetUserId: string | undefined;
    let triggerDeletionFence: Date | undefined;
    let userDeleted = false;

    try {
      const { id } = req.params as { id: string };
      targetUserId = id;

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const isInstitutionAdmin = isInstitutionAdminRole(req.user?.role);
      const callerTenantId = req.user?.tenantId?.trim();
      if (isInstitutionAdmin && !callerTenantId) {
        return res.status(403).json({ error: 'Institution context required' });
      }
      const targetFilter = isInstitutionAdmin
        ? { _id: id, tenantId: callerTenantId }
        : { _id: id };
      const [targetUser] = await runUserScope(req, () => findUsers(targetFilter, 'role tenantId', { limit: 1 }));
      if (!targetUser && isInstitutionAdmin) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (targetUser && !canManageUser(
        { role: req.user?.role, tenantId: req.user?.tenantId, id: callerId },
        { tenantId: targetUser.tenantId, role: targetUser.role, id },
      )) {
        return res.status(403).json({ error: 'User administration is not permitted' });
      }
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await runUserScope(req, () => countUsers({ role: SystemRoles.ADMIN }));
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      triggerDeletionFence = new Date();
      const fenceState = await runUserScope(req, () => beginAgentTriggerUserDeletion(id, triggerDeletionFence!));
      if (fenceState === 'in_progress') {
        triggerDeletionFence = undefined;
        return res.status(409).json({ error: 'User deletion is already in progress' });
      }
      if (fenceState === 'missing') {
        triggerDeletionFence = undefined;
        return res.status(404).json({ error: 'User not found' });
      }
      await runUserScope(req, () => prepareAgentTriggerUserPurge(id, triggerDeletionFence!, targetUser?.tenantId));
      await runUserScope(req, () => drainAgentTriggerDeliveriesForUser(id));

      const result = await runUserScope(req, () => deleteUserById(id));

      if (result.deletedCount === 0) {
        await cancelAgentTriggerUserPurge(id, triggerDeletionFence);
        await cancelAgentTriggerUserDeletion(id, triggerDeletionFence);
        triggerDeletionFence = undefined;
        return res.status(404).json({ error: 'User not found' });
      }
      userDeleted = true;
      await runUserScope(req, () => purgeAgentTriggerDeliveriesForUser(id));

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await runUserScope(req, () => countUsers({ role: SystemRoles.ADMIN }));
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        runUserScope(req, () => deleteConfig(PrincipalType.USER, id)),
        runUserScope(req, () => deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId })),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      if (targetUserId != null && triggerDeletionFence != null && !userDeleted) {
        try {
          await cancelAgentTriggerUserPurge(targetUserId, triggerDeletionFence);
        } catch (purgeFenceError) {
          logger.error('[adminUsers] failed to disarm trigger purge recovery:', purgeFenceError);
        }
        try {
          await cancelAgentTriggerUserDeletion(targetUserId, triggerDeletionFence);
        } catch (fenceError) {
          logger.error('[adminUsers] failed to release trigger deletion fence:', fenceError);
        }
      }
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  return {
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    deleteUser: deleteUserHandler,
  };
}
