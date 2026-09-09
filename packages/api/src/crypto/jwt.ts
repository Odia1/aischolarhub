import jwt from 'jsonwebtoken';

export const AGENT_TRIGGER_SCOPE = 'agent_trigger';

type AgentTriggerRequest = {
  headers?: Record<string, string | string[] | undefined>;
  _isAgentTrigger?: boolean;
};

/**
 * Generate a short-lived JWT token.
 * @param {String} userId - The ID of the user.
 * @param {String} [expireIn='5m'] - The expiration time for the token.
 * @returns {String} - The generated JWT token.
 */
export type ShortLivedTokenClaims = {
  /**
   * Institutional file IDs authorized upstream by AI Scholar Hub.
   *
   * This claim is deliberately narrow: it transports an authorization result;
   * it does not transport or reconstruct the institution hierarchy itself.
   */
  authorizedFileIds?: string[];
  /**
   * Canonical hierarchy scopes resolved by the trusted AI Scholar Hub API.
   * The RAG service may narrow these claims but can never expand them.
   */
  authorizedKnowledgeScopeKeys?: string[];
};

const KNOWLEDGE_SCOPE_TYPES = new Set(['INSTITUTION', 'DEPARTMENT', 'COURSE', 'GROUP']);

function normalizeKnowledgeScopeClaims(values?: string[]): string[] {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => {
      const raw = String(value ?? '').trim();
      const separator = raw.indexOf(':');
      if (separator <= 0) {
        return null;
      }
      const type = raw.slice(0, separator).trim().toUpperCase();
      const targetId = raw.slice(separator + 1).trim();
      if (!KNOWLEDGE_SCOPE_TYPES.has(type) || !targetId || targetId.length > 256) {
        return null;
      }
      return `${type}:${targetId}`;
    })
    .filter((value): value is string => value != null);

  return [...new Set(normalized)].sort().slice(0, 256);
}

export const generateShortLivedToken = (
  userId: string,
  expireIn: string = '5m',
  tenantId?: string,
  claims: ShortLivedTokenClaims = {},
): string => {
  const authorizedFileIds = Array.isArray(claims.authorizedFileIds)
    ? [...new Set(claims.authorizedFileIds.map(String).filter(Boolean))]
    : [];
  const authorizedKnowledgeScopeKeys = normalizeKnowledgeScopeClaims(
    claims.authorizedKnowledgeScopeKeys,
  );

  return jwt.sign(
    {
      id: userId,
      ...(tenantId ? { tenantId } : {}),
      ...(authorizedFileIds.length ? { authorizedFileIds } : {}),
      ...(authorizedKnowledgeScopeKeys.length ? { authorizedKnowledgeScopeKeys } : {}),
    },
    process.env.JWT_SECRET!,
    {
    expiresIn: expireIn,
      algorithm: 'HS256',
    },
  );
};

/** Mint the server-only identity used by durable agent trigger admission. */
export const generateAgentTriggerToken = (userId: string, expireIn: string = '60s'): string => {
  return jwt.sign({ id: userId, scope: AGENT_TRIGGER_SCOPE }, process.env.JWT_SECRET!, {
    expiresIn: expireIn,
      algorithm: 'HS256',
    },
  );
};

/** Verify the signed trigger scope together with its explicit transport marker. */
export const isAgentTriggerRequest = (req?: AgentTriggerRequest): boolean => {
  if (req?.headers?.['x-lc-agent-trigger'] !== '1') {
    return false;
  }
  const auth = req.headers.authorization;
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (token == null) {
    return false;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
    return typeof payload === 'object' && payload.scope === AGENT_TRIGGER_SCOPE;
  } catch {
    return false;
  }
};

/** Skip the shared loopback IP bucket while retaining per-user and concurrency limits. */
export const exemptAgentTriggerFromIpLimiter = (req?: AgentTriggerRequest): boolean =>
  typeof req?._isAgentTrigger === 'boolean' ? req._isAgentTrigger : isAgentTriggerRequest(req);
