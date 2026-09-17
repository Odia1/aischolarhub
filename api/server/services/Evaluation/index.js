const mongoose = require('mongoose');

const CACHE_TTL_MS = 30_000;

let cachedPolicy = null;
let cachedAt = 0;

const DEFAULT_POLICY = Object.freeze({
  policyKey: 'PLATFORM',
  telemetryMode: 'OFF',
  semanticMode: 'OFF',
  startsAt: null,
  endsAt: null,
  scopeType: 'PLATFORM',
  scopeIds: [],
  telemetrySamplingRate: 1,
  semanticSamplingRate: 0.05,
  leanEfficiencyEnabled: true,
});

function db() {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.connection.db
  ) {
    return null;
  }

  return mongoose.connection.db;
}

function active(mode, startsAt, endsAt, now = new Date()) {
  const normalized = String(mode || 'OFF')
    .trim()
    .toUpperCase();

  if (normalized === 'ON') {
    return true;
  }

  if (normalized !== 'TIMED') {
    return false;
  }

  const start =
    startsAt instanceof Date
      ? startsAt
      : startsAt
        ? new Date(startsAt)
        : null;

  const end =
    endsAt instanceof Date
      ? endsAt
      : endsAt
        ? new Date(endsAt)
        : null;

  if (
    !start ||
    !end ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return false;
  }

  return now >= start && now < end;
}

async function getEvaluationPolicy({
  forceRefresh = false,
} = {}) {
  const now = Date.now();

  if (
    !forceRefresh &&
    cachedPolicy &&
    now - cachedAt < CACHE_TTL_MS
  ) {
    return cachedPolicy;
  }

  const mongo = db();

  if (!mongo) {
    return {
      ...DEFAULT_POLICY,
      telemetryEffective: false,
      semanticEffective: false,
    };
  }

  const stored =
    await mongo
      .collection('evaluationPolicies')
      .findOne({ policyKey: 'PLATFORM' });

  const policy = {
    ...DEFAULT_POLICY,
    ...(stored || {}),
  };

  const effectiveAt = new Date();

  cachedPolicy = {
    ...policy,
    telemetryEffective: active(
      policy.telemetryMode,
      policy.startsAt,
      policy.endsAt,
      effectiveAt,
    ),
    semanticEffective: active(
      policy.semanticMode,
      policy.startsAt,
      policy.endsAt,
      effectiveAt,
    ),
    effectiveAt,
  };

  cachedAt = now;

  return cachedPolicy;
}

function scopeMatches(
  policy,
  {
    tenantId = null,
    experienceId = null,
    agentId = null,
  } = {},
) {
  const type = String(
    policy.scopeType || 'PLATFORM',
  )
    .trim()
    .toUpperCase();

  const ids = new Set(
    Array.isArray(policy.scopeIds)
      ? policy.scopeIds
          .map(String)
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  );

  if (type === 'PLATFORM') {
    return true;
  }

  if (type === 'INSTITUTION') {
    return tenantId != null && ids.has(String(tenantId));
  }

  if (type === 'EXPERIENCE') {
    return experienceId != null && ids.has(String(experienceId));
  }

  if (type === 'AGENT') {
    return agentId != null && ids.has(String(agentId));
  }

  return false;
}

function sampled(rate, random = Math.random) {
  const n = Number(rate);

  if (!Number.isFinite(n) || n <= 0) {
    return false;
  }

  if (n >= 1) {
    return true;
  }

  return random() < n;
}

async function getEvaluationDecision(context = {}) {
  const policy = await getEvaluationPolicy();

  if (!scopeMatches(policy, context)) {
    return {
      policy,
      telemetry: false,
      semantic: false,
      leanEfficiency: false,
    };
  }

  const telemetry =
    policy.telemetryEffective === true &&
    sampled(policy.telemetrySamplingRate);

  /*
   * Semantic evaluation is deliberately independent and sampled.
   * A caller should enqueue/offload it rather than synchronously
   * invoking another model in the user's request path.
   */
  const semantic =
    policy.semanticEffective === true &&
    sampled(policy.semanticSamplingRate);

  return {
    policy,
    telemetry,
    semantic,
    leanEfficiency:
      telemetry &&
      policy.leanEfficiencyEnabled !== false,
  };
}

async function recordEvaluationEvent(event = {}) {
  const mongo = db();

  if (!mongo) {
    return false;
  }

  const doc = {
    timestamp: new Date(),
    evaluationType: String(
      event.evaluationType || 'TELEMETRY',
    )
      .trim()
      .toUpperCase()
      .slice(0, 40),

    tenantId:
      event.tenantId == null
        ? null
        : String(event.tenantId).slice(0, 200),

    userId:
      event.userId == null
        ? null
        : String(event.userId).slice(0, 200),

    conversationId:
      event.conversationId == null
        ? null
        : String(event.conversationId).slice(0, 200),

    experienceId:
      event.experienceId == null
        ? null
        : String(event.experienceId).slice(0, 200),

    agentId:
      event.agentId == null
        ? null
        : String(event.agentId).slice(0, 200),

    latencyMs:
      Number.isFinite(Number(event.latencyMs))
        ? Number(event.latencyMs)
        : null,

    promptTokens:
      Number.isFinite(Number(event.promptTokens))
        ? Number(event.promptTokens)
        : null,

    completionTokens:
      Number.isFinite(Number(event.completionTokens))
        ? Number(event.completionTokens)
        : null,

    toolCalls:
      Number.isFinite(Number(event.toolCalls))
        ? Number(event.toolCalls)
        : null,

    retrievalCount:
      Number.isFinite(Number(event.retrievalCount))
        ? Number(event.retrievalCount)
        : null,

    costUSD:
      Number.isFinite(Number(event.costUSD))
        ? Number(event.costUSD)
        : null,

    success:
      typeof event.success === 'boolean'
        ? event.success
        : null,

    /*
     * Never persist prompts, response bodies, credentials,
     * retrieved document text, or arbitrary diagnostic blobs here.
     */
  };

  await mongo
    .collection('evaluationEvents')
    .insertOne(doc);

  return true;
}

function clearEvaluationPolicyCache() {
  cachedPolicy = null;
  cachedAt = 0;
}

module.exports = {
  getEvaluationPolicy,
  getEvaluationDecision,
  recordEvaluationEvent,
  clearEvaluationPolicyCache,
  scopeMatches,
};
