const mongoose = require('mongoose');
const { CacheKeys } = require('librechat-data-provider');
const { AppService, logger } = require('@librechat/data-schemas');
const {
  createAppConfigService,
  clearMcpConfigCache,
  RETRIEVAL_RESPONSE_POLICY,
} = require('@librechat/api');
const { setCachedTools, invalidateCachedTools } = require('./getCachedTools');
const { loadAndFormatTools } = require('~/server/services/start/tools');
const loadCustomConfig = require('./loadCustomConfig');
const getLogStores = require('~/cache/getLogStores');
const paths = require('~/config/paths');
const db = require('~/models');

const loadBaseConfig = async () => {
  /** @type {TCustomConfig} */
  const config = (await loadCustomConfig()) ?? {};
  /** @type {Record<string, FunctionTool>} */
  const systemTools = loadAndFormatTools({
    adminFilter: config.filteredTools,
    adminIncluded: config.includedTools,
    directory: paths.structuredTools,
  });
  return AppService({ config, paths, systemTools });
};

const {
  getAppConfig: getBaseAppConfig,
  clearAppConfigCache,
  clearOverrideCache,
} = createAppConfigService({
  loadBaseConfig,
  setCachedTools,
  getCache: getLogStores,
  cacheKeys: CacheKeys,
  getApplicableConfigs: db.getApplicableConfigs,
  getUserPrincipals: db.getUserPrincipals,
});

/* ============================================================
 * AI SCHOLAR HUB MODEL ENTITLEMENT ENFORCEMENT
 * ============================================================ */

async function applyModelEntitlement(appConfig, options = {}) {
  const tenantId = String(options?.tenantId || '').trim();
  const role = String(options?.role || '').trim().toUpperCase();

  if (
    options?.baseOnly === true ||
    !tenantId ||
    !role ||
    mongoose.connection.readyState !== 1 ||
    !mongoose.connection.db
  ) {
    return appConfig;
  }

  const mongo = mongoose.connection.db;

  const [entitlement, routes] = await Promise.all([
    mongo.collection('modelEntitlements').findOne({
      tenantId,
      role,
      agentId: '*',
      enabled: { $ne: false }
    }),

    mongo.collection('personaModelRoutes')
      .find({
        tenantId,
        enabled: { $ne: false }
      })
      .sort({ priority: -1, routeId: 1 })
      .toArray()
  ]);

  if (!entitlement) {
    logger.warn(
      `[modelEntitlements] tenant=${tenantId} role=${role} no enabled entitlement; exposing zero managed model specs`
    );

    return {
      ...appConfig,
      modelSpecs: {
        ...(appConfig.modelSpecs || {}),
        enforce: true,
        prioritize: true,
        list: []
      },
      interface: {
        ...(appConfig.interface || {}),
        modelSelect: false,
        parameters: false,
        presets: false
      }
    };
  }

  const allowedRefs = Array.isArray(entitlement.allowedModels)
    ? entitlement.allowedModels
        .map(x => String(x || '').trim())
        .filter(Boolean)
    : [];

  const allowedRefSet = new Set(allowedRefs);

  const defaultRef = String(
    entitlement.defaultModel || ''
  ).trim();

  const providerKeys = [
    ...new Set([
      ...allowedRefs
        .map(ref => {
          const i = ref.indexOf(':');
          return i > 0 ? ref.slice(0, i) : '';
        })
        .filter(Boolean),

      ...routes
        .map(route => String(route.providerKey || '').trim())
        .filter(Boolean)
    ])
  ];

  const referencedPolicyRefs = [
    ...new Set([
      ...allowedRefs,
      ...routes
        .map(route => {
          const providerKey =
            String(route.providerKey || '').trim();

          const model =
            String(route.model || '').trim();

          return providerKey && model
            ? `${providerKey}:${model}`
            : '';
        })
        .filter(Boolean)
    ])
  ];

  const referencedModelPairs =
    referencedPolicyRefs
      .map(ref => {
        const i = ref.indexOf(':');

        return i > 0
          ? {
              providerKey: ref.slice(0, i),
              model: ref.slice(i + 1)
            }
          : null;
      })
      .filter(Boolean);

  const [providers, enabledModels] =
    await Promise.all([
      providerKeys.length
        ? mongo.collection('aiProviders')
            .find(
              {
                key: { $in: providerKeys },
                enabled: { $ne: false }
              },
              {
                projection: {
                  key: 1,
                  name: 1
                }
              }
            )
            .toArray()
        : Promise.resolve([]),

      referencedModelPairs.length
        ? mongo.collection('aiModels')
            .find(
              {
                enabled: { $ne: false },
                $or: referencedModelPairs
              },
              {
                projection: {
                  providerKey: 1,
                  model: 1
                }
              }
            )
            .toArray()
        : Promise.resolve([])
    ]);

  const enabledPolicyRefs = new Set(
    enabledModels.map(model =>
      `${String(model.providerKey || '').trim()}:${String(model.model || '').trim()}`
    )
  );

  const providerMap = new Map(
    providers.map(provider => [
      String(provider.key || '').trim(),
      String(provider.name || provider.key || '').trim()
    ])
  );

  const runtimeRef = ref => {
    ref = String(ref || '').trim();

    const i = ref.indexOf(':');
    if (i <= 0) return null;

    const providerKey = ref.slice(0, i);
    const model = ref.slice(i + 1);
    const endpoint = providerMap.get(providerKey);

    if (!endpoint || !model) return null;

    return `${endpoint}:${model}`;
  };

  const allowedRuntime = new Set(
    allowedRefs
      .filter(ref => enabledPolicyRefs.has(ref))
      .map(runtimeRef)
      .filter(Boolean)
  );

  const defaultRuntime = runtimeRef(defaultRef);

  const routesBySpec = new Map();

  for (const route of routes) {
    const modelSpecName =
      String(route.modelSpecName || '').trim();

    const providerKey =
      String(route.providerKey || '').trim();

    const model =
      String(route.model || '').trim();

    if (!modelSpecName || !providerKey || !model)
      continue;

    const policyRef = `${providerKey}:${model}`;

    // Routing preference can never expand authorization
    // or reactivate a disabled catalog model.
    if (
      !allowedRefSet.has(policyRef) ||
      !enabledPolicyRefs.has(policyRef)
    )
      continue;

    const endpoint = providerMap.get(providerKey);
    if (!endpoint)
      continue;

    if (!routesBySpec.has(modelSpecName))
      routesBySpec.set(modelSpecName, []);

    routesBySpec.get(modelSpecName).push({
      endpoint,
      model,
      personaId:
        String(route.personaId || '').trim(),
      routeId:
        String(route.routeId || '').trim()
    });
  }

  const specs = Array.isArray(appConfig?.modelSpecs?.list)
    ? appConfig.modelSpecs.list
    : [];

  let defaultAssigned = false;

  let filtered = specs
    .map(spec => {
      const specName =
        String(spec?.name || '').trim();

      const baseEndpoint =
        String(spec?.preset?.endpoint || '').trim();

      const baseModel =
        String(spec?.preset?.model || '').trim();

      const baseRuntime =
        `${baseEndpoint}:${baseModel}`;

      const route =
        routesBySpec.get(specName)?.[0] || null;

      let resolved = null;

      if (route) {
        resolved = {
          ...spec,
          personaId:
            route.personaId ||
            String(spec?.personaId || '').trim(),
          personaRouteId:
            route.routeId || null,
          preset: {
            ...(spec.preset || {}),
            endpoint: route.endpoint,
            model: route.model
          }
        };
      } else if (allowedRuntime.has(baseRuntime)) {
        resolved = spec;
      }

      if (!resolved)
        return null;

      const endpoint =
        String(resolved?.preset?.endpoint || '').trim();

      const model =
        String(resolved?.preset?.model || '').trim();

      const resolvedRuntime =
        `${endpoint}:${model}`;

      const shouldDefault =
        !defaultAssigned &&
        (
          defaultRuntime
            ? resolvedRuntime === defaultRuntime
            : resolved.default === true
        );

      if (shouldDefault)
        defaultAssigned = true;

      return {
        ...resolved,
        default: shouldDefault
      };
    })
    .filter(Boolean);

  if (
    filtered.length &&
    !filtered.some(spec => spec.default === true)
  ) {
    filtered = filtered.map((spec, index) => ({
      ...spec,
      default: index === 0
    }));
  }

  logger.info(
    `[modelEntitlements] tenant=${tenantId} role=${role} allowed=${filtered.length}/${specs.length} routes=${routes.length}`
  );

  return {
    ...appConfig,

    modelSpecs: {
      ...(appConfig?.modelSpecs || {}),
      enforce: true,
      prioritize: true,
      list: filtered
    },

    interface: {
      ...(appConfig?.interface || {}),
      modelSelect: false,
      parameters: false,
      presets: false
    }
  };
}


async function applyAcademicIntelligence(appConfig, options = {}) {
  const tenantId = String(options?.tenantId || '').trim();
  const userId = String(options?.userId || '').trim();
  const role = String(options?.role || '').trim().toUpperCase();

  if (
    options?.baseOnly === true ||
    !tenantId ||
    mongoose.connection.readyState !== 1 ||
    !mongoose.connection.db
  ) {
    return appConfig;
  }

  const mongo = mongoose.connection.db;
  const academicStart = process.hrtime.bigint();

  const [agents, learnerState, promptPolicies, integrityPolicies] =
    await Promise.all([
      mongo.collection('academicAgents')
        .find({
          tenantId,
          enabled: { $ne: false }
        })
        .toArray(),

      userId
        ? mongo.collection('learnerStates').findOne({
            tenantId,
            userId
          })
        : Promise.resolve(null),

      mongo.collection('personaPromptPolicies')
        .find({
          tenantId,
          enabled: true
        })
        .sort({
          personaId: 1,
          version: -1
        })
        .toArray(),

      mongo.collection('academicIntegrityPolicies')
        .find({
          tenantId,
          enabled: true
        })
        .sort({
          policyId: 1,
          version: -1
        })
        .toArray()
    ]);

  const academicMs =
    Number(process.hrtime.bigint() - academicStart) /
    1_000_000;

  if (academicMs >= 25) {
    logger.info(
      `[PERF] component=academic-policy tenant=${tenantId} role=${role} durationMs=${academicMs.toFixed(1)}`
    );
  }

  if (!agents.length) {
    return appConfig;
  }

  const agentMap = new Map();

  // A primary MODE owns the user-facing ModelSpec. Specialized AGENT records
  // may share that experience but must not unpredictably replace its runtime
  // policy merely because MongoDB returned them later.
  for (const agent of agents) {
    const modelSpecName = String(agent.modelSpecName || '').trim();
    if (!modelSpecName) continue;
    const current = agentMap.get(modelSpecName);
    if (!current || String(agent.agentType || '').toUpperCase() === 'MODE')
      agentMap.set(modelSpecName, agent);
  }

  const promptPolicyMap = new Map();

  for (const policy of promptPolicies) {
    const personaId =
      String(policy.personaId || '').trim().toUpperCase();

    if (personaId && !promptPolicyMap.has(personaId))
      promptPolicyMap.set(personaId, policy);
  }

  const integrityPolicyMap = new Map();

  for (const policy of integrityPolicies) {
    const policyId = String(policy.policyId || '').trim().toUpperCase();
    if (policyId && !integrityPolicyMap.has(policyId))
      integrityPolicyMap.set(policyId, policy);
  }

  const compact = (value, max) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, max);

  const learnerParts = learnerState
    ? [
        compact(learnerState.currentObjective, 400)
          ? `Objective: ${compact(
              learnerState.currentObjective,
              400
            )}`
          : '',

        compact(learnerState.currentFocus, 400)
          ? `Focus: ${compact(
              learnerState.currentFocus,
              400
            )}`
          : '',

        compact(learnerState.masteryLevel, 100)
          ? `Mastery: ${compact(
              learnerState.masteryLevel,
              100
            )}`
          : '',

        compact(learnerState.supportLevel, 100)
          ? `Support: ${compact(
              learnerState.supportLevel,
              100
            )}`
          : '',

        compact(learnerState.preferredLanguage, 100)
          ? `Language: ${compact(
              learnerState.preferredLanguage,
              100
            )}`
          : ''
      ].filter(Boolean)
    : [];

  const learnerContext =
    learnerParts.length
      ? [
          '## CURRENT LEARNER CONTEXT',
          ...learnerParts
        ].join('\n')
      : '';

  const specs = Array.isArray(appConfig?.modelSpecs?.list)
    ? appConfig.modelSpecs.list
    : [];

  const list = specs
    .filter(spec => {
      const agent = agentMap.get(
        String(spec?.name || '').trim()
      );

      if (!agent)
        return false;

      const allowedRoles =
        Array.isArray(agent.allowedRoles)
          ? agent.allowedRoles.map(
              x => String(x).toUpperCase()
            )
          : [];

      return (
        !allowedRoles.length ||
        allowedRoles.includes(role)
      );
    })
    .map(spec => {
      const agent = agentMap.get(
        String(spec?.name || '').trim()
      );

      if (!agent)
        return spec;

      const personaId =
        String(
          agent.agentId || ''
        ).trim().toUpperCase();

      const promptPolicy =
        promptPolicyMap.get(personaId) || null;

      const integrityPolicyId = String(
        agent.integrityPolicyId || 'SCHOLARLY_INTEGRITY_CORE'
      ).trim().toUpperCase();

      const integrityPolicy =
        integrityPolicyMap.get(integrityPolicyId) || {
          policyId: integrityPolicyId,
          version: 'runtime-default',
          principle:
            'AI should reduce the mechanical burden of scholarship without removing the intellectual responsibility of the scholar.',
          rules: {
            prohibitFabricatedCitations: true,
            prohibitFabricatedData: true,
            prohibitFabricatedResults: true,
            prohibitFalseSourceInspectionClaims: true,
            distinguishEvidenceFromInference: true,
            preserveContradictoryEvidence: true,
            requireGapSearchScopeCaveat: true,
            requireHumanScholarlyJudgment: true
          }
        };

      let stablePolicy = '';

      if (promptPolicy?.prompt) {
        stablePolicy =
          String(promptPolicy.prompt).trim();
      } else {
        const pedagogy = agent.pedagogy || {};

        stablePolicy = [
          `Academic Agent: ${
            agent.name || agent.agentId
          }`,

          pedagogy.diagnoseFirst !== false
            ? 'Diagnose understanding before substantial instruction.'
            : '',

          pedagogy.activeRetrieval !== false
            ? 'Use active retrieval to verify understanding.'
            : '',

          pedagogy.adaptiveDifficulty !== false
            ? 'Adapt difficulty and scaffolding to demonstrated mastery.'
            : '',

          pedagogy.misconceptionRepair !== false
            ? 'Identify and repair misconceptions.'
            : '',

          pedagogy.masteryTracking !== false
            ? 'Use conversational evidence to track mastery.'
            : '',

          compact(pedagogy.strategy, 1500)
        ].filter(Boolean).join('\n');
      }

      const basePrompt =
        String(
          spec?.preset?.promptPrefix || ''
        ).trim();

      const integrityRules = integrityPolicy?.rules || {};
      const integrityDirective = integrityPolicy
        ? [
            '## ACADEMIC INTEGRITY',
            integrityRules.prohibitFabricatedCitations
              ? 'Do not fabricate citations.'
              : '',
            integrityRules.prohibitFabricatedData
              ? 'Do not fabricate data.'
              : '',
            integrityRules.prohibitFabricatedResults
              ? 'Do not fabricate results.'
              : '',
            integrityRules.prohibitFalseSourceInspectionClaims
              ? 'Do not claim source inspection unless the source was provided or retrieved.'
              : '',
            integrityRules.distinguishEvidenceFromInference
              ? 'Separate evidence and tool output from inference and uncertainty.'
              : '',
            integrityRules.preserveContradictoryEvidence
              ? 'Preserve material contradictions.'
              : '',
            integrityRules.requireGapSearchScopeCaveat
              ? 'Qualify gap claims by search scope.'
              : '',
            integrityRules.requireHumanScholarlyJudgment
              ? 'Leave consequential scholarly judgment to the human.'
              : ''
          ].filter(Boolean).join(' ')
        : '';

      const promptPrefix = [
        basePrompt,
        stablePolicy,
        RETRIEVAL_RESPONSE_POLICY,
        integrityDirective,
        learnerContext
      ].filter(Boolean).join('\n\n');

      logger.info(
        `[academicIntelligence] tenant=${tenantId} role=${role} persona=${personaId} promptVersion=${promptPolicy?.version ?? 'fallback'} integrityPolicy=${integrityPolicy ? `${integrityPolicyId}@${integrityPolicy.version}` : 'fallback'} promptChars=${promptPrefix.length} learnerContext=${learnerContext ? 'yes' : 'no'}`
      );

      return {
        ...spec,

        label: String(
          agent.name ||
          spec.label ||
          spec.name ||
          ''
        ).trim(),

        academicAgentId:
          String(agent.agentId || '').trim(),

        personaId,

        ...(integrityPolicy
          ? {
              academicIntegrityPolicyId: integrityPolicyId,
              academicIntegrityPolicyVersion: integrityPolicy.version
            }
          : {}),

        ...(promptPolicy
          ? {
              personaPromptVersion:
                promptPolicy.version
            }
          : {}),

        preset: {
          ...(spec.preset || {}),
          ...(promptPrefix
            ? { promptPrefix }
            : {})
        }
      };
    });

  return {
    ...appConfig,
    modelSpecs: {
      ...(appConfig?.modelSpecs || {}),
      list
    }
  };
}

async function getAppConfig(options = {}) {
  const policyStart = process.hrtime.bigint();

  const baseConfigStart = process.hrtime.bigint();
  let config = await getBaseAppConfig(options);
  const baseConfigMs =
    Number(process.hrtime.bigint() - baseConfigStart) / 1_000_000;

  try {
    const entitlementStart = process.hrtime.bigint();

    config = await applyModelEntitlement(
      config,
      options
    );

    const entitlementMs =
      Number(process.hrtime.bigint() - entitlementStart) / 1_000_000;

    const academicStart = process.hrtime.bigint();

    config = await applyAcademicIntelligence(
      config,
      options
    );

    const academicMs =
      Number(process.hrtime.bigint() - academicStart) / 1_000_000;

    const totalMs =
      Number(process.hrtime.bigint() - policyStart) / 1_000_000;

    if (totalMs >= 25) {
      logger.info(
        `[PERF] component=config-policy tenant=${String(options?.tenantId || '')} role=${String(options?.role || '')} baseConfigMs=${baseConfigMs.toFixed(1)} entitlementMs=${entitlementMs.toFixed(1)} academicMs=${academicMs.toFixed(1)} totalMs=${totalMs.toFixed(1)}`
      );
    }

    return config;
  } catch (error) {
    logger.error(
      '[academicIntelligence] policy application failed:',
      error
    );

    return config;
  }
}



/**
 * Invalidate all config-related caches after an admin config mutation.
 * Clears the base config, per-principal override caches, tool caches,
 * and the MCP config-source server cache.
 * @param {string} [tenantId] - Optional tenant ID to scope override cache clearing.
 */
async function invalidateConfigCaches(tenantId) {
  const results = await Promise.allSettled([
    clearAppConfigCache(),
    clearOverrideCache(tenantId),
    invalidateCachedTools({ invalidateGlobal: true }),
    clearMcpConfigCache(),
  ]);
  const labels = [
    'clearAppConfigCache',
    'clearOverrideCache',
    'invalidateCachedTools',
    'clearMcpConfigCache',
  ];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      logger.error(`[invalidateConfigCaches] ${labels[i]} failed:`, results[i].reason);
    }
  }
}

module.exports = {
  getAppConfig,
  clearAppConfigCache,
  invalidateConfigCaches,
};
