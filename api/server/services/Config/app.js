const mongoose = require('mongoose');
const { CacheKeys } = require('librechat-data-provider');
const { AppService, logger } = require('@librechat/data-schemas');
const { createAppConfigService, clearMcpConfigCache } = require('@librechat/api');
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

  const entitlement = await mongo
    .collection('modelEntitlements')
    .findOne({
      tenantId,
      role,
      agentId: '*',
      enabled: { $ne: false },
    });

  if (!entitlement) {
    return appConfig;
  }

  const allowedRefs = Array.isArray(entitlement.allowedModels)
    ? entitlement.allowedModels
        .map(x => String(x || '').trim())
        .filter(Boolean)
    : [];

  const defaultRef = String(
    entitlement.defaultModel || ''
  ).trim();

  const providerKeys = [
    ...new Set(
      [...allowedRefs, defaultRef]
        .filter(Boolean)
        .map(ref => {
          const i = ref.indexOf(':');
          return i > 0 ? ref.slice(0, i) : '';
        })
        .filter(Boolean)
    )
  ];

  const providers = providerKeys.length
    ? await mongo.collection('aiProviders')
        .find(
          { key: { $in: providerKeys } },
          { projection: { key: 1, name: 1 } }
        )
        .toArray()
    : [];

  const providerMap = new Map(
    providers.map(p => [
      String(p.key || '').trim(),
      String(p.name || p.key || '').trim()
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
    allowedRefs.map(runtimeRef).filter(Boolean)
  );

  const defaultRuntime = runtimeRef(defaultRef);

  const specs = Array.isArray(appConfig?.modelSpecs?.list)
    ? appConfig.modelSpecs.list
    : [];

  const filtered = specs
    .filter(spec => {
      const endpoint =
        String(spec?.preset?.endpoint || '').trim();

      const model =
        String(spec?.preset?.model || '').trim();

      return allowedRuntime.has(
        `${endpoint}:${model}`
      );
    })
    .map(spec => {
      const endpoint =
        String(spec?.preset?.endpoint || '').trim();

      const model =
        String(spec?.preset?.model || '').trim();

      const ref = `${endpoint}:${model}`;

      return {
        ...spec,
        default: defaultRuntime
          ? ref === defaultRuntime
          : spec.default === true
      };
    });

  logger.info(
    `[modelEntitlements] tenant=${tenantId} role=${role} allowed=${filtered.length}/${specs.length}`
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

  const [agents, learnerState] = await Promise.all([
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
      : Promise.resolve(null)
  ]);

  const academicMs =
    Number(process.hrtime.bigint() - academicStart) / 1_000_000;

  if (academicMs >= 25) {
    logger.info(
      `[PERF] component=academic-policy tenant=${tenantId} role=${role} durationMs=${academicMs.toFixed(1)}`
    );
  }

  if (!agents.length) {
    return appConfig;
  }

  const agentMap = new Map(
    agents.map(agent => [
      String(agent.modelSpecName || '').trim(),
      agent
    ])
  );

  const specs = Array.isArray(appConfig?.modelSpecs?.list)
    ? appConfig.modelSpecs.list
    : [];

  const list = specs
    .filter(spec => {
      const agent = agentMap.get(
        String(spec?.name || '').trim()
      );

      // When Academic Agents are configured for this tenant,
      // only model specs explicitly represented by an enabled
      // Academic Agent are exposed in the academic experience selector.
      if (!agent) return false;

      const allowedRoles = Array.isArray(agent.allowedRoles)
        ? agent.allowedRoles.map(x => String(x).toUpperCase())
        : [];

      return !allowedRoles.length || allowedRoles.includes(role);
    })
    .map(spec => {
      const agent = agentMap.get(
        String(spec?.name || '').trim()
      );

      if (!agent) return spec;

      const pedagogy = agent.pedagogy || {};

      const adaptiveContext = learnerState
        ? [
            learnerState.currentObjective
              ? `Current learning objective: ${learnerState.currentObjective}`
              : '',
            learnerState.currentFocus
              ? `Current learning focus: ${learnerState.currentFocus}`
              : '',
            Array.isArray(learnerState.evidence) &&
            learnerState.evidence.length
              ? `Recent learner evidence:\n${learnerState.evidence
                  .slice(-3)
                  .map(item => `- ${String(item?.learnerText || '').trim()}`)
                  .filter(item => item !== '- ')
                  .join('\n')}`
              : '',
            learnerState.masteryLevel
              ? `Current mastery level: ${learnerState.masteryLevel}`
              : '',
            learnerState.supportLevel
              ? `Support level: ${learnerState.supportLevel}`
              : '',
            learnerState.preferredLanguage
              ? `Preferred explanatory language: ${learnerState.preferredLanguage}`
              : ''
          ].filter(Boolean).join('\n')
        : '';

      const policy = [
        '',
        '## AI SCHOLAR HUB ACADEMIC AGENT POLICY',
        `Academic Agent: ${agent.name || agent.agentId}`,
        `Pedagogical mode: ${pedagogy.mode || 'ADAPTIVE'}`,
        pedagogy.diagnoseFirst !== false
          ? 'Diagnose the learner’s current understanding before substantial instruction.'
          : '',
        pedagogy.activeRetrieval !== false
          ? 'Use active retrieval to verify understanding after important explanations.'
          : '',
        pedagogy.adaptiveDifficulty !== false
          ? 'Adapt difficulty and scaffolding to demonstrated mastery.'
          : '',
        pedagogy.misconceptionRepair !== false
          ? 'Identify and repair misconceptions rather than merely marking answers wrong.'
          : '',
        pedagogy.masteryTracking !== false
          ? 'Use evidence from the conversation to reason about mastery, without invasive psychological profiling.'
          : '',
        pedagogy.strategy || '',
        adaptiveContext
          ? `\n## CURRENT LEARNER CONTEXT\n${adaptiveContext}`
          : ''
      ].filter(Boolean).join('\n');

      return {
        ...spec,

        // Preserve spec.name as the stable internal model-spec identifier.
        // Academic Agent name becomes the user-facing experience label.
        label: String(agent.name || spec.label || spec.name || '').trim(),

        academicAgentId: String(agent.agentId || '').trim(),

        preset: {
          ...(spec.preset || {}),
          promptPrefix:
            String(spec?.preset?.promptPrefix || '').trim() +
            '\n\n' +
            policy
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
