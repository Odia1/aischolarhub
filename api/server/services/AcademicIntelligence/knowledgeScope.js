const mongoose = require('mongoose');

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
 * There is deliberately no parallel ragGroups authorization hierarchy here.
 * Institutional knowledge follows the institution's existing organizational
 * hierarchy: institution → department/course → group/class.
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

/*
 * Compatibility hook.
 *
 * Knowledge authorization is intentionally uncached. Existing diagnostics
 * and tests may still call this function; keeping it as a no-op avoids
 * unnecessary coupling while preserving immediate revocation semantics.
 */
function invalidateKnowledgeScopeCache() {}

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

  if (!agentId) {
    throw new Error('Academic Agent is required');
  }


  const mongo = getMongo();
  const users = mongo.collection('users');
  const academicAgents = mongo.collection('academicAgents');
  const groups = mongo.collection('groups');

  const userObjectId = oid(userId);

  if (!userObjectId) {
    throw new Error('Invalid user context');
  }

  const [user, agent] = await Promise.all([
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
        },
      },
    ),

    academicAgents.findOne(
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
    ),
  ]);

  if (!user) {
    throw new Error('User not found in this institution');
  }

  if (!agent) {
    throw new Error('Academic Agent not found or disabled');
  }

  const effectiveRole = clean(user.role || role);

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

  for (const group of directGroups) {
    chainByDirectGroup.set(
      clean(group._id),
      await buildGroupChain(mongo, tenantId, group),
    );
  }

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
  const departmentIds = new Set();
  const courseIds = new Set();

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

      for (
        const departmentId of Array.isArray(node.departmentIds)
          ? node.departmentIds
          : []
      ) {
        departmentIds.add(clean(departmentId));
      }

      for (
        const courseId of Array.isArray(node.courseIds)
          ? node.courseIds
          : []
      ) {
        courseIds.add(clean(courseId));
      }
    }
  }

  const allowedScopes = {
    institution: {
      allowed: true,
      tenantId,
    },

    departments: [...departmentIds].filter(Boolean).sort(),

    courses: [...courseIds].filter(Boolean).sort(),

    groups: [...authorizedGroupIds].filter(Boolean).sort(),

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

    allowedScopes,

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

module.exports = {
  resolveKnowledgeScope,
  resolveAuthorizedKnowledgeFiles,
  invalidateKnowledgeScopeCache,
};
