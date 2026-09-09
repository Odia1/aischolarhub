const mongoose = require('mongoose');
const crypto = require('crypto');

/*
 * AI SCHOLAR HUB — HIERARCHY-NATIVE KNOWLEDGE AUTHORIZATION
 * ==========================================================
 *
 * This is the authoritative runtime resolver for institutional knowledge.
 *
 * Trust boundary:
 *
 *   authenticated user
 *        ↓
 *   tenant + role + institutional memberships
 *        ↓
 *   resolveKnowledgeScope()
 *        ↓
 *   allowed hierarchy locations
 *        ↓
 *   authorized institutional documents
 *        ↓
 *   signed RAG authorization
 *
 * The LLM never determines authorization.
 *
 * RAG Access Points own document corpora. RAG Access Groups are authorization
 * bundles that grant selected users or organizational groups access to one or
 * more Access Points. Descendant grants follow the existing organization tree;
 * they do not create a second, competing hierarchy.
 */


function getMongo() {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.connection.db
  ) {
    throw new Error('MongoDB is not ready');
  }

  return mongoose.connection.db;
}

function clean(value) {
  return String(value || '').trim();
}

const KNOWLEDGE_SCOPE_TYPES = new Set([
  'INSTITUTION',
  'DEPARTMENT',
  'COURSE',
  'GROUP',
]);

function knowledgeScopeKey(type, targetId) {
  const normalizedType = clean(type).toUpperCase();
  const normalizedTarget = clean(targetId);
  if (!KNOWLEDGE_SCOPE_TYPES.has(normalizedType) || !normalizedTarget) {
    return null;
  }
  return `${normalizedType}:${normalizedTarget}`;
}

function allowedKnowledgeScopeKeys(scope) {
  const keys = [];
  if (scope?.allowedScopes?.institution?.allowed === true) {
    keys.push(knowledgeScopeKey('INSTITUTION', scope.tenantId));
  }
  for (const [type, field] of [
    ['DEPARTMENT', 'departments'],
    ['COURSE', 'courses'],
    ['GROUP', 'groups'],
  ]) {
    for (const targetId of scope?.allowedScopes?.[field] || []) {
      keys.push(knowledgeScopeKey(type, targetId));
    }
  }
  return [...new Set(keys.filter(Boolean))].sort();
}

function oid(value) {
  const stringValue = clean(value);

  if (!stringValue || !mongoose.Types.ObjectId.isValid(stringValue)) {
    return null;
  }

  return new mongoose.Types.ObjectId(stringValue);
}

function idSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => clean(value))
      .filter(Boolean),
  );
}

const knowledgeScopeCache = new Map();
const knowledgeScopeInFlight = new Map();
const KNOWLEDGE_SCOPE_CACHE_TTL_MS = process.env.NODE_ENV === 'test'
  ? 0
  : Math.max(0, Number(process.env.KNOWLEDGE_SCOPE_CACHE_TTL_MS || 3600000));
const KNOWLEDGE_SCOPE_CACHE_MAX = 1000;
const KNOWLEDGE_SCOPE_CACHE_VERSION = clean(
  process.env.KNOWLEDGE_SCOPE_CACHE_VERSION || 'v1',
);
let sharedCacheRuntime;

function getSharedCacheRuntime() {
  if (KNOWLEDGE_SCOPE_CACHE_TTL_MS <= 0) {
    return null;
  }
  if (sharedCacheRuntime !== undefined) {
    return sharedCacheRuntime;
  }
  try {
    const { cacheConfig, ioredisClient } = require('@librechat/api');
    sharedCacheRuntime = cacheConfig?.USE_REDIS && ioredisClient
      ? { ioredisClient }
      : null;
  } catch {
    sharedCacheRuntime = null;
  }
  return sharedCacheRuntime;
}

function sharedCacheKey(cacheKey) {
  return `aih:knowledge-scope:${KNOWLEDGE_SCOPE_CACHE_VERSION}:${crypto
    .createHash('sha256')
    .update(cacheKey)
    .digest('hex')}`;
}

async function getSharedKnowledgeScope(cacheKey) {
  const runtime = getSharedCacheRuntime();
  if (!runtime) {
    return null;
  }
  try {
    const value = await runtime.ioredisClient.get(sharedCacheKey(cacheKey));
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function setSharedKnowledgeScope(cacheKey, value) {
  const runtime = getSharedCacheRuntime();
  if (!runtime) {
    return;
  }
  try {
    await runtime.ioredisClient.set(
      sharedCacheKey(cacheKey),
      JSON.stringify(value),
      'PX',
      KNOWLEDGE_SCOPE_CACHE_TTL_MS,
    );
  } catch {
    // Cache failure must never turn into an authorization or availability failure.
  }
}

function invalidateKnowledgeScopeCache() {
  knowledgeScopeCache.clear();
  knowledgeScopeInFlight.clear();
}

async function buildGroupChain(mongo, tenantId, group) {
  const groups = mongo.collection('groups');

  const chain = [];
  const visited = new Set();
  let current = group;

  while (current) {
    const key = clean(current._id);

    if (visited.has(key)) {
      throw new Error(
        'Group hierarchy cycle encountered during knowledge-scope resolution',
      );
    }

    visited.add(key);
    chain.push(current);

    if (!current.parentGroupId) {
      break;
    }

    const parentId = oid(current.parentGroupId);

    if (!parentId) {
      break;
    }

    current = await groups.findOne({
      _id: parentId,
      tenantId,
    });
  }

  return chain;
}

/*
 * Resolve the hierarchy locations an authenticated user may use with one
 * hierarchy-aware Academic Agent.
 *
 * Returns metadata/IDs only — never document contents.
 */
async function resolveKnowledgeScope({
  tenantId,
  userId,
  role,
  agentId,
  activeGroupId = null,
}) {
  tenantId = clean(tenantId);
  userId = clean(userId);
  agentId = clean(agentId);
  activeGroupId = clean(activeGroupId) || null;

  if (!tenantId) {
    throw new Error('Institution context is required');
  }

  if (!userId) {
    throw new Error('User context is required');
  }

  const mongo = getMongo();
  const users = mongo.collection('users');
  const academicAgents = mongo.collection('academicAgents');
  const groups = mongo.collection('groups');

  const userObjectId = oid(userId);

  if (!userObjectId) {
    throw new Error('Invalid user context');
  }

  const [user, configuredAgent] = await Promise.all([
    users.findOne(
      {
        _id: userObjectId,
        tenantId,
      },
      {
        projection: {
          _id: 1,
          tenantId: 1,
          role: 1,
          ragAccess: 1,
        },
      },
    ),

    agentId
      ? academicAgents.findOne(
          {
            tenantId,
            agentId,
            enabled: true,
          },
          {
            projection: {
              _id: 1,
              agentId: 1,
              agentType: 1,
              allowedRoles: 1,
              audiences: 1,
              ragPolicy: 1,
            },
          },
        )
      : Promise.resolve(null),
  ]);

  if (!user) {
    throw new Error('User not found in this institution');
  }

  /*
   * An Academic Agent policy may further restrict retrieval, but normal
   * AIH chat does not require an Agent. In generic chat, institution/group
   * access policies and the authenticated user's hierarchy are authoritative.
   */
  const agent = agentId
    ? configuredAgent
    : {
        allowedRoles: [],
        ragPolicy: {
          sharedScopeMode: 'CONTEXTUAL_HIERARCHY',
        },
      };

  if (agentId && !agent) {
    throw new Error('Academic Agent not found or disabled');
  }

  const effectiveRole = clean(user.role || role);

  /*
   * Shared institutional retrieval is an independent account capability.
   * A user without it retains ordinary personal File Search, but receives
   * no institution/group-authorized documents.
   */
  if (user.ragAccess !== true) {
    return {
      tenantId,
      userId,
      role: effectiveRole,
      allowedScopes: {
        institution: {
          allowed: false,
          tenantId,
        },
        departments: [],
        courses: [],
        groups: [],
        personal: {
          allowed: true,
          userId,
        },
      },
      availableRagPoints: [
        {
          key: 'PERSONAL',
          type: 'PERSONAL',
          targetId: userId,
          label: 'My files',
          defaultSelected: true,
        },
      ],
    };
  }

  const allowedRoles = new Set(
    Array.isArray(agent.allowedRoles)
      ? agent.allowedRoles
          .map((value) => clean(value).toUpperCase())
          .filter(Boolean)
      : [],
  );

  if (
    allowedRoles.size &&
    !allowedRoles.has(effectiveRole.toUpperCase())
  ) {
    throw new Error(
      'User role is not permitted to use this Academic Agent',
    );
  }

  if (
    agent.ragPolicy?.sharedScopeMode !== 'CONTEXTUAL_HIERARCHY'
  ) {
    throw new Error(
      'Academic Agent does not use contextual hierarchy',
    );
  }

  /*
   * Ordinary institutional membership is stored on groups.memberIds.
   *
   * Support both historic string IDs and ObjectId values without allowing
   * either representation to cross the tenant boundary.
   */
  const directGroups = await groups
    .find({
      tenantId,
      memberIds: {
        $in: [userId, userObjectId],
      },
    })
    .toArray();

  const chainByDirectGroup = new Map();

  const groupChains = await Promise.all(
    directGroups.map((group) => buildGroupChain(mongo, tenantId, group)),
  );
  directGroups.forEach((group, index) => {
    chainByDirectGroup.set(clean(group._id), groupChains[index]);
  });

  let scopedDirectGroups = directGroups;

  /*
   * Active academic context may narrow authorization but can never expand it.
   *
   * The active group must already lie on an organizational branch reachable
   * from one of the user's direct memberships.
   */
  if (activeGroupId) {
    const activeObjectId = oid(activeGroupId);

    if (!activeObjectId) {
      throw new Error('Invalid activeGroupId');
    }

    const activeGroup = await groups.findOne({
      _id: activeObjectId,
      tenantId,
    });

    if (!activeGroup) {
      throw new Error(
        'Active group not found in this institution',
      );
    }

    scopedDirectGroups = directGroups.filter((group) => {
      const chain =
        chainByDirectGroup.get(clean(group._id)) || [];

      return chain.some(
        (node) => clean(node._id) === activeGroupId,
      );
    });

    if (!scopedDirectGroups.length) {
      throw new Error(
        "Active group is outside the user's authorized hierarchy",
      );
    }
  }

  const directGroupIds = idSet(
    scopedDirectGroups.map((group) => group._id),
  );

  const authorizedGroupIds = new Set();

  /*
   * Hierarchical inheritance comes from the organization tree itself.
   *
   * No administrator needs to create a second RAG-access hierarchy.
   */
  for (const group of scopedDirectGroups) {
    const chain =
      chainByDirectGroup.get(clean(group._id)) ||
      (await buildGroupChain(mongo, tenantId, group));

    for (const node of chain) {
      authorizedGroupIds.add(clean(node._id));

    }
  }

  const ragAccessGroups = await mongo.collection('ragGroups')
    .find({
      tenantId,
      enabled: { $ne: false },
      ragLocationIds: { $exists: true, $ne: [] },
    })
    .toArray();

  const grantedAccessGroups = ragAccessGroups.filter((accessGroup) => {
    const mode = clean(accessGroup.accessMode).toUpperCase();
    const selectedUsers = idSet(accessGroup.userIds);
    const selectedGroups = idSet(accessGroup.groupIds);

    if (mode === 'SELECTED_USERS') {
      return selectedUsers.has(userId);
    }

    if (mode === 'GROUP_AND_DESCENDANTS') {
      return [...selectedGroups].some((value) => authorizedGroupIds.has(value));
    }

    if (mode === 'SELECTED_GROUPS' || mode === 'GROUP_ONLY') {
      return [...selectedGroups].some((value) => directGroupIds.has(value));
    }

    return false;
  });

  const grantedLocationIds = idSet(
    grantedAccessGroups.flatMap((accessGroup) => accessGroup.ragLocationIds || []),
  );
  const configuredLocationIds = [...grantedLocationIds]
    .filter((value) => value !== `institution:${tenantId}`)
    .map(oid)
    .filter(Boolean);
  const grantedLocations = configuredLocationIds.length
    ? await mongo.collection('ragLocations')
        .find({
          _id: { $in: configuredLocationIds },
          tenantId,
          enabled: { $ne: false },
        })
        .toArray()
    : [];

  /*
   * Organizational membership establishes audience eligibility only.
   * Retrieval scope is granted exclusively through enabled RAG policies
   * that reference enabled RAG Access Points.
   */
  const grantedDepartmentIds = new Set();
  const grantedCourseIds = new Set();
  const grantedGroupIds = new Set();

  for (const location of grantedLocations) {
    const targetId = clean(location.targetId);
    if (!targetId) continue;
    if (location.type === 'DEPARTMENT') {
      grantedDepartmentIds.add(targetId);
    }
    if (location.type === 'COURSE') {
      grantedCourseIds.add(targetId);
    }
    if (location.type === 'GROUP') {
      grantedGroupIds.add(targetId);
    }
  }

  const allowedScopes = {
    institution: {
      allowed: grantedLocationIds.has(`institution:${tenantId}`),
      tenantId,
    },

    departments: [...grantedDepartmentIds].filter(Boolean).sort(),

    courses: [...grantedCourseIds].filter(Boolean).sort(),

    groups: [...grantedGroupIds].filter(Boolean).sort(),

    personal: {
      allowed: true,
      userId,
    },
  };

  const result = {
    tenantId,
    userId,
    role: effectiveRole,
    agentId,
    activeGroupId,

    directGroupIds: [...directGroupIds].sort(),

    grantedRagAccessGroupIds: grantedAccessGroups
      .map((accessGroup) => clean(accessGroup._id))
      .filter(Boolean)
      .sort(),

    allowedScopes,

    availableRagPoints: [
      {
        key: 'PERSONAL',
        type: 'PERSONAL',
        targetId: userId,
        label: 'My files',
        defaultSelected: true,
      },
      ...(allowedScopes.institution.allowed
        ? [{
            key: knowledgeScopeKey('INSTITUTION', tenantId),
            type: 'INSTITUTION',
            targetId: tenantId,
            label: `${tenantId} institutional knowledge`,
            defaultSelected: false,
          }]
        : []),
      ...grantedLocations.map((location) => ({
        key: knowledgeScopeKey(location.type, location.targetId),
        type: location.type,
        targetId: clean(location.targetId),
        label: clean(location.name) || `${location.type}: ${location.targetId}`,
        defaultSelected: false,
      })),
    ].filter((point) => point.key),

    /*
     * Audience is agent-policy metadata. Do not infer educational stage from
     * USER/INSTRUCTOR role alone.
     */
    agentAudiences:
      Array.isArray(agent.audiences)
        ? agent.audiences
        : [],

    /*
     * Freshness/debug token only. It is never accepted as an authorization
     * credential by the retrieval service.
     */
    contextVersion: [
      tenantId,
      userId,
      agentId,
      activeGroupId || 'ALL',
      Date.now(),
    ].join('.'),

    resolvedAt: new Date().toISOString(),
  };


  return {
    ...result,
  };
}


/*
 * Convert an already-authorized hierarchy scope into institutional files.
 *
 * IMPORTANT:
 *   This function does not decide hierarchy membership. That decision has
 *   already been made by resolveKnowledgeScope().
 *
 * It merely maps authorized natural hierarchy locations to files carrying
 * matching knowledgeScope metadata.
 */
async function resolveAuthorizedKnowledgeFiles({
  tenantId,
  userId,
  role,
  agentId,
  activeGroupId = null,
}) {
  const scope = await resolveKnowledgeScope({
    tenantId,
    userId,
    role,
    agentId,
    activeGroupId,
  });

  const mongo = getMongo();
  const files = mongo.collection('files');

  const clauses = [];

  if (scope.allowedScopes?.institution?.allowed === true) {
    clauses.push({
      'knowledgeScope.type': 'INSTITUTION',
      'knowledgeScope.targetId': tenantId,
    });
  }

  const departments =
    Array.isArray(scope.allowedScopes?.departments)
      ? scope.allowedScopes.departments
      : [];

  if (departments.length) {
    clauses.push({
      'knowledgeScope.type': 'DEPARTMENT',
      'knowledgeScope.targetId': { $in: departments },
    });
  }

  const courses =
    Array.isArray(scope.allowedScopes?.courses)
      ? scope.allowedScopes.courses
      : [];

  if (courses.length) {
    clauses.push({
      'knowledgeScope.type': 'COURSE',
      'knowledgeScope.targetId': { $in: courses },
    });
  }

  const groups =
    Array.isArray(scope.allowedScopes?.groups)
      ? scope.allowedScopes.groups
      : [];

  if (groups.length) {
    clauses.push({
      'knowledgeScope.type': 'GROUP',
      'knowledgeScope.targetId': { $in: groups },
    });
  }

  if (!clauses.length) {
    return {
      scope,
      files: [],
    };
  }

  const authorizedFiles = await files
    .find(
      {
        tenantId,
        embedded: true,

        /*
         * Disabled/unpublished fields are optional for backward compatibility.
         * Explicit false disables retrieval.
         */
        enabled: { $ne: false },
        published: { $ne: false },

        $or: clauses,
      },
      {
        projection: {
          _id: 0,
          file_id: 1,
          filename: 1,
          knowledgeScope: 1,
        },
      },
    )
    .toArray();

  return {
    scope,
    files: authorizedFiles
      .filter((file) => file?.file_id)
      .map((file) => ({
        file_id: String(file.file_id),
        filename: String(file.filename || file.file_id),
        knowledgeScope: file.knowledgeScope,
      })),
  };
}

/**
 * Resolve authorization to a compact set of hierarchy scope keys.
 *
 * Unlike resolveAuthorizedKnowledgeFiles(), this does not enumerate files, so
 * its result and the signed retrieval credential remain bounded by the user's
 * organizational hierarchy rather than the repository size.
 */
async function resolveAuthorizedKnowledgeScopes(options) {
  const cacheKey = [
    clean(options?.tenantId),
    clean(options?.userId),
    clean(options?.role),
    clean(options?.agentId),
    clean(options?.activeGroupId),
  ].join('|');
  const now = Date.now();
  const cached = knowledgeScopeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (knowledgeScopeInFlight.has(cacheKey)) {
    return knowledgeScopeInFlight.get(cacheKey);
  }

  const resolution = (async () => {
    const sharedValue = await getSharedKnowledgeScope(cacheKey);
    if (sharedValue) {
      knowledgeScopeCache.set(cacheKey, {
        value: sharedValue,
        expiresAt: Date.now() + KNOWLEDGE_SCOPE_CACHE_TTL_MS,
      });
      return sharedValue;
    }
    const scope = await resolveKnowledgeScope(options);
    const value = {
      scope,
      scopeKeys: allowedKnowledgeScopeKeys(scope),
    };
    if (KNOWLEDGE_SCOPE_CACHE_TTL_MS > 0) {
      if (knowledgeScopeCache.size >= KNOWLEDGE_SCOPE_CACHE_MAX) {
        knowledgeScopeCache.delete(knowledgeScopeCache.keys().next().value);
      }
      knowledgeScopeCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + KNOWLEDGE_SCOPE_CACHE_TTL_MS,
      });
      await setSharedKnowledgeScope(cacheKey, value);
    }
    return value;
  })();
  knowledgeScopeInFlight.set(cacheKey, resolution);
  try {
    return await resolution;
  } finally {
    knowledgeScopeInFlight.delete(cacheKey);
  }
}

module.exports = {
  resolveKnowledgeScope,
  resolveAuthorizedKnowledgeFiles,
  resolveAuthorizedKnowledgeScopes,
  allowedKnowledgeScopeKeys,
  knowledgeScopeKey,
  invalidateKnowledgeScopeCache,
};
