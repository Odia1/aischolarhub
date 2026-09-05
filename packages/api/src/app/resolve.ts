import { tenantStorage } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';

interface UserForConfigResolution {
  id?: string;
  tenantId?: string;
  role?: string;
}

type GetAppConfig = (opts: {
  role?: string;
  userId?: string;
  tenantId?: string;
  baseOnly?: boolean;
}) => Promise<AppConfig>;

/**
 * Resolves AppConfig scoped to the given user's tenant when available,
 * falling back to YAML-only base config for new users or non-tenant deployments.
 *
 * Authenticated tenant resolution propagates role and userId so principal-
 * scoped overrides and learner context resolve consistently.
 *
 * `tenantId` is propagated through two channels that serve different purposes:
 * - `tenantStorage.run()` sets the ALS context so Mongoose's `applyTenantIsolation`
 *   plugin scopes any DB queries (e.g., `getApplicableConfigs`) to the tenant.
 * - The explicit `tenantId` parameter to `getAppConfig` is used for cache-key
 *   computation in `overrideCacheKey()`. Both channels are required.
 */
export async function resolveAppConfigForUser(
  getAppConfig: GetAppConfig,
  user: UserForConfigResolution | null | undefined,
): Promise<AppConfig> {
  if (user?.tenantId) {
    return tenantStorage.run({ tenantId: user.tenantId }, async () =>
      getAppConfig({
        role: user.role,
        userId: user.id,
        tenantId: user.tenantId,
      }),
    );
  }
  return getAppConfig({ baseOnly: true });
}
