import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import multer from "multer";

const app = express();
const PORT = process.env.PORT || 3090;

// Immutable AI Scholar Hub Superadmin.
// This is the creator/owner account and must never be deleted or demoted.
const SUPERADMIN_EMAIL = "ppatra@seedsnet.org";

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

const ragDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 20 * 1024 * 1024
  }
});

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

const db = client.db("LibreChat");
const users = db.collection("users");
const institutions = db.collection("institutions");
const adminAudit = db.collection("adminAudit");

const aiProviders = db.collection("aiProviders");
const aiModels = db.collection("aiModels");
const modelEntitlements = db.collection("modelEntitlements");
const academicAgents = db.collection("academicAgents");
const academicIntegrityPolicies = db.collection("academicIntegrityPolicies");
const learnerStates = db.collection("learnerStates");

/*
 * learnerGuidanceProfiles:
 *   persistent, user-correctable context used for education/career guidance.
 *
 * Keep this separate from learnerStates:
 *   learnerStates            -> pedagogical/mastery state
 *   learnerGuidanceProfiles  -> interests, preferences and practical constraints
 */
const learnerGuidanceProfiles =
  db.collection("learnerGuidanceProfiles");

/*
 * Persona routing is intentionally separate from model entitlement.
 *
 * modelEntitlements:
 *   authorization -- which provider/models a tenant/role may use
 *
 * personaModelRoutes:
 *   optimization -- which entitled provider/model a persona should use now
 *
 * personaPromptPolicies:
 *   stable, versioned persona instructions independent of provider/model
 */
const personaModelRoutes = db.collection("personaModelRoutes");
const personaPromptPolicies = db.collection("personaPromptPolicies");

const sessions = new Map();

const MODEL_COST_TIERS = new Set([
  "ECONOMY",
  "BALANCED",
  "ADVANCED"
]);

const AIS_CLASS_CATALOG = [
  {
    providerKey: "ais-free-router",
    providerName: "AI Scholar Free Router",
    endpointType: "custom",
    providerCostTier: "BALANCED",
    model: "class-a",
    label: "Class A — Advanced Academic",
    costTier: "ADVANCED"
  },
  {
    providerKey: "ais-free-router",
    providerName: "AI Scholar Free Router",
    endpointType: "custom",
    providerCostTier: "BALANCED",
    model: "class-b",
    label: "Class B — General Academic",
    costTier: "BALANCED"
  },
  {
    providerKey: "azure-undergraduate",
    providerName: "Azure OpenAI Undergrad Tutor",
    endpointType: "custom",
    providerCostTier: "ADVANCED",
    model: "gpt-4.1-mini",
    label: "Class C — Premium General",
    costTier: "ADVANCED"
  },
  {
    providerKey: "azure-research",
    providerName: "Azure OpenAI Scholar Research",
    endpointType: "custom",
    providerCostTier: "ADVANCED",
    model: "gpt-5.4-mini",
    label: "Class C — Premium Advanced",
    costTier: "ADVANCED"
  }
];

// Operational inventory only. This is returned exclusively by model-policy
// endpoints guarded by canManageModelPolicy; never include credentials,
// account IDs, endpoint URLs, or secret fragments here.
const AIS_CLASS_COMPOSITION = [
  {
    classId: "CLASS_A",
    label: "Class A — Advanced Academic",
    routes: [
      { provider: "Google", model: "gemini-3.7-flash", mode: "STANDARD" },
      { provider: "Groq", model: "openai/gpt-oss-120b", mode: "STANDARD" },
      { provider: "Cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", mode: "STANDARD" },
      { provider: "Cloudflare", model: "@cf/meta/llama-3.1-70b-instruct-fp8-fast", mode: "FALLBACK" }
    ]
  },
  {
    classId: "CLASS_B",
    label: "Class B — General Academic",
    routes: [
      { provider: "Google", model: "gemini-3.5-flash", mode: "STANDARD" },
      { provider: "Google", model: "gemini-3.5-flash-lite", mode: "STANDARD" },
      { provider: "Groq", model: "qwen/qwen3.8-27b", mode: "STANDARD" },
      { provider: "Cloudflare", model: "@cf/qwen/qwen3.8-27b", mode: "STANDARD" },
      { provider: "Cloudflare", model: "@cf/google/gemma-4-26b-a4b-it", mode: "STANDARD" },
      { provider: "Cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fast", mode: "STANDARD" }
    ]
  },
  {
    classId: "CLASS_C_GENERAL",
    label: "Class C — Premium General",
    routes: [
      { provider: "Azure OpenAI", model: "gpt-4.1-mini", mode: "PREMIUM" }
    ]
  },
  {
    classId: "CLASS_C_ADVANCED",
    label: "Class C — Premium Advanced",
    routes: [
      { provider: "Azure OpenAI", model: "gpt-5.4-mini", mode: "PREMIUM" }
    ]
  },
  {
    classId: "OPENROUTER_RESERVE",
    label: "Reserve Capacity",
    routes: [
      { provider: "OpenRouter", model: "No approved stable route", mode: "RESERVED" }
    ]
  }
];

const ACADEMIC_AGENT_TYPES = new Set([
  "MODE",
  "AGENT"
]);

const CORE_ACADEMIC_AGENT_IDS = new Set([
  "K12_SOCRATIC_TUTOR",
  "SOCRATIC_TUTOR",
  "RESEARCH_SYNTHESIZER",
  "SEMANTIC_SCHOLAR_SEARCH",
  "LITERATURE_REVIEW",
  "RESEARCH_GAP_FINDER",
  "EDUCATION_CAREER_PATHWAYS",
  "COURSE_KNOWLEDGE"
]);

const ACADEMIC_AUDIENCES = new Set([
  "COLLEGE_FACULTY",
  "RESEARCHER",
  "UNDERGRADUATE",
  "SCHOOL_TEACHER",
  "SCHOOL_STUDENT"
]);

const ACADEMIC_AGENT_VISIBILITIES = new Set([
  "INSTITUTION",
  "PRIVATE"
]);

const RESEARCH_MATURITY_LEVELS = new Set([
  "NOVICE",
  "DEVELOPING",
  "INDEPENDENT",
  "ADVANCED"
]);

async function ensureManagedClassCatalog() {
  const now = new Date();
  const providersByKey = new Map();

  for (const entry of AIS_CLASS_CATALOG) {
    if (!providersByKey.has(entry.providerKey))
      providersByKey.set(entry.providerKey, entry);
  }

  await Promise.all([
    ...[...providersByKey.values()].map(entry =>
      aiProviders.updateOne(
        { key: entry.providerKey },
        {
          $set: {
            name: entry.providerName,
            endpointType: entry.endpointType,
            costTier: entry.providerCostTier,
            managed: true,
            enabled: true,
            updatedAt: now
          },
          $setOnInsert: {
            description: "Managed AI Scholar Hub model class provider",
            createdAt: now
          }
        },
        { upsert: true }
      )
    ),
    ...AIS_CLASS_CATALOG.map(entry =>
      aiModels.updateOne(
        { providerKey: entry.providerKey, model: entry.model },
        {
          $set: {
            label: entry.label,
            costTier: entry.costTier,
            managed: true,
            enabled: true,
            updatedAt: now
          },
          $setOnInsert: {
            description: "Managed AI Scholar Hub experience class",
            contextWindow: null,
            createdAt: now
          }
        },
        { upsert: true }
      )
    )
  ]);
}

async function ensureSuperadminEntitlements() {
  const tenantList = await institutions
    .find({ status: { $ne: "disabled" } }, { projection: { _id: 1 } })
    .toArray();
  if (!tenantList.length) return 0;

  const now = new Date();
  const result = await modelEntitlements.bulkWrite(
    tenantList.map(tenant => ({
      updateOne: {
        filter: {
          tenantId: String(tenant._id),
          role: "SUPERADMIN",
          agentId: "*"
        },
        update: {
          $setOnInsert: {
            tenantId: String(tenant._id),
            role: "SUPERADMIN",
            agentId: "*",
            allowedModels: [
              "ais-free-router:class-a",
              "ais-free-router:class-b"
            ],
            defaultModel: "ais-free-router:class-b",
            fallbackModels: ["ais-free-router:class-a"],
            costTier: "BALANCED",
            enabled: true,
            createdAt: now,
            updatedAt: now
          }
        },
        upsert: true
      }
    }))
  );

  return result.upsertedCount;
}

await Promise.all([
  /*
   * Institutional domains are globally exclusive tenant identifiers.
   *
   * Application validation provides useful conflict messages, while this
   * unique multikey index closes the race where two concurrent requests
   * could otherwise claim the same domain for different institutions.
   */
  institutions.createIndex(
    { domains: 1 },
    {
      unique: true,
      partialFilterExpression: { domains: { $type: "string" } },
      name: "domains_1_unique"
    }
  ),

  aiProviders.createIndex({ key: 1 }, { unique: true }),
  aiModels.createIndex({ providerKey: 1, model: 1 }, { unique: true }),
  aiModels.createIndex({ enabled: 1, costTier: 1 }),
  modelEntitlements.createIndex(
    { tenantId: 1, role: 1, agentId: 1 },
    { unique: true }
  ),
  modelEntitlements.createIndex({ tenantId: 1, enabled: 1 }),
  academicAgents.createIndex(
    { tenantId: 1, agentId: 1 },
    { unique: true }
  ),
  academicAgents.createIndex({ tenantId: 1, enabled: 1 }),
  academicAgents.createIndex({
    tenantId: 1,
    agentType: 1,
    enabled: 1
  }),

  academicIntegrityPolicies.createIndex(
    { tenantId: 1, policyId: 1, version: 1 },
    { unique: true }
  ),
  academicIntegrityPolicies.createIndex({
    tenantId: 1,
    policyId: 1,
    enabled: 1,
    version: -1
  }),

  learnerStates.createIndex(
    { tenantId: 1, userId: 1 },
    { unique: true }
  ),

  learnerGuidanceProfiles.createIndex(
    { tenantId: 1, userId: 1 },
    { unique: true }
  ),
  learnerGuidanceProfiles.createIndex({
    tenantId: 1,
    updatedAt: -1
  }),

  personaModelRoutes.createIndex(
    { tenantId: 1, personaId: 1, routeId: 1 },
    { unique: true }
  ),
  personaModelRoutes.createIndex(
    { tenantId: 1, modelSpecName: 1, enabled: 1, priority: -1 }
  ),

  /*
   * Prompt policies are versioned independently of model routing.
   *
   * Multiple historical versions may exist for the same persona.
   * Runtime selection will choose the enabled/current policy rather
   * than using document uniqueness as the version mechanism.
   */
  personaPromptPolicies.createIndex(
    { tenantId: 1, personaId: 1, version: 1 },
    { unique: true }
  ),
  personaPromptPolicies.createIndex(
    { tenantId: 1, personaId: 1, enabled: 1, updatedAt: -1 }
  ),
  personaPromptPolicies.createIndex(
    { tenantId: 1, modelSpecName: 1, enabled: 1 }
  )
]);

// Idempotent startup initialization: administrators should never need to
// understand or manually trigger database catalog bootstrapping.
await ensureManagedClassCatalog();
const superadminEntitlementsCreated = await ensureSuperadminEntitlements();
if (superadminEntitlementsCreated) {
  await adminAudit.insertOne({
    timestamp: new Date(),
    actorUserId: null,
    actorEmail: null,
    actorName: "AI Scholar Hub",
    actorRole: "SYSTEM",
    actorSuperAdmin: false,
    action: "SUPERADMIN_ENTITLEMENTS_AUTO_PROVISIONED",
    targetUserId: null,
    targetEmail: SUPERADMIN_EMAIL,
    targetRole: "SUPERADMIN",
    result: "success",
    source: "AI Scholar Hub Admin UI",
    ipAddress: null,
    userAgent: null,
    details: { created: superadminEntitlementsCreated }
  });
}

async function audit(action, req, details = {}) {
  try {
    const actor = req.admin || null;

    await adminAudit.insertOne({
      timestamp: new Date(),
      actorUserId: actor?._id || null,
      actorEmail: actor?.email || null,
      actorName: actor?.name || null,
      actorRole: actor?.role || null,
      actorSuperAdmin: actor?.superAdmin === true,
      action,
      targetUserId: details.targetUserId || null,
      targetEmail: details.targetEmail || null,
      targetRole: details.targetRole || null,
      result: details.result || "success",
      source: "AI Scholar Hub Admin UI",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      details: details.safeDetails || {}
    });
  } catch (e) {
    // Audit failure must never break the administrative operation.
    console.error("[AUDIT] Failed to write audit event:", e);
  }
}

async function requireSuperAdmin(req, res, next) {
  if (!req.admin || !isSuperAdmin(req.admin)) {
    await audit("SUPERADMIN_ACCESS_DENIED", req, {
      result: "denied"
    });

    return res.status(403).json({
      error: "Superadmin access required"
    });
  }

  next();
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").filter(Boolean).map(x => {
      const i = x.indexOf("=");
      return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1))];
    })
  );
}

async function requireAdmin(req, res, next) {
  try {
    const token = cookies(req).admin_session;
    const session = token && sessions.get(token);
    if (!session) return res.status(401).json({ error: "Authentication required" });

    const admin = await users.findOne(
      { _id: new ObjectId(session.userId) },
      { projection: { name: 1, email: 1, role: 1, superAdmin: 1, tenantId: 1, ragAccess: 1 } }
    );

    const role = normalizedRole(admin);
    const allowed = isSuperAdmin(admin) ||
      role === "PLATFORM_ADMIN" ||
      role === "INSTITUTION_ADMIN";

    if (!admin || !allowed) {
      sessions.delete(token);
      return res.status(403).json({ error: "Administrator access required" });
    }

    // Normalize the designated Superadmin from the legacy ADMIN role to the
    // canonical SUPERADMIN role on the first authenticated request.
    if (isDesignatedSuperAdmin(admin) && role === "ADMIN") {
      await users.updateOne(
        { _id: admin._id },
        { $set: { role: "SUPERADMIN", updatedAt: new Date() } }
      );
      admin.role = "SUPERADMIN";
    }

    if (normalizedRole(admin) === "INSTITUTION_ADMIN") {
      const tenantId = String(admin.tenantId || "").trim();
      if (!tenantId) {
        sessions.delete(token);
        return res.status(403).json({ error: "Institution context required" });
      }
      const institution = await institutions.findOne(
        { _id: tenantId },
        { projection: { _id: 1, status: 1 } }
      );
      if (!institution) {
        sessions.delete(token);
        return res.status(403).json({ error: "Institution not found" });
      }
      if (institution.status === "disabled") {
        sessions.delete(token);
        return res.status(403).json({ error: "This institution is disabled" });
      }
    }

    req.admin = admin;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Authentication error" });
  }
}

function normalizedRole(user) {
  return String(user?.role || "").trim().toUpperCase();
}

function isDesignatedSuperAdmin(user) {
  return String(user?.email || "").trim().toLowerCase() === SUPERADMIN_EMAIL &&
    user?.superAdmin === true;
}

function isSuperAdmin(user) {
  return isDesignatedSuperAdmin(user) &&
    ["SUPERADMIN", "ADMIN"].includes(normalizedRole(user));
}

function isHigherAdmin(user) {
  return isSuperAdmin(user) || normalizedRole(user) === "PLATFORM_ADMIN" ||
    normalizedRole(user) === "ADMIN";
}

async function institutionExists(tenantId) {
  const id = String(tenantId || "").trim();
  if (!id) return false;
  return !!(await institutions.findOne({ _id: id }, { projection: { _id: 1 } }));
}

/*
 * Institutional email domains are tenant identity data.
 *
 * The institution record is the authoritative owner of its domains.
 * User records may consume that ownership, but must never create or infer it.
 */
function normalizeInstitutionDomains(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Institution domains must be an array");
  }

  const normalized = [...new Set(
    value
      .map(domain =>
        String(domain || "")
          .trim()
          .toLowerCase()
          .replace(/^@/, "")
      )
      .filter(Boolean)
  )].sort();

  const domainPattern =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  for (const domain of normalized) {
    if (!domainPattern.test(domain)) {
      throw new Error(`Invalid institutional domain: ${domain}`);
    }
  }

  return normalized;
}

function emailDomain(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 ? normalized.slice(at + 1) : "";
}

async function assertEmailMatchesInstitution(email, institutionId) {
  const tenantId = String(institutionId || "").trim();
  const domain = emailDomain(email);

  if (!tenantId) {
    const err = new Error("Institution is required for institution-scoped users");
    err.statusCode = 400;
    throw err;
  }

  if (!domain) {
    const err = new Error("A valid email address is required");
    err.statusCode = 400;
    throw err;
  }

  const institution = await institutions.findOne(
    { _id: tenantId },
    { projection: { _id: 1, name: 1, status: 1, domains: 1 } }
  );

  if (!institution) {
    const err = new Error("Selected institution does not exist");
    err.statusCode = 400;
    throw err;
  }

  const domains = normalizeInstitutionDomains(institution.domains || []) || [];

  if (!domains.includes(domain)) {
    const err = new Error(
      `Email domain "${domain}" does not belong to institution "${tenantId}"`
    );
    err.statusCode = 409;
    throw err;
  }

  return institution;
}

async function assertInstitutionDomainsAvailable(institutionId, domains) {
  if (!domains?.length) return;

  const conflict = await institutions.findOne({
    _id: { $ne: institutionId },
    domains: { $in: domains }
  }, {
    projection: { _id: 1, name: 1, domains: 1 }
  });

  if (conflict) {
    const conflictingDomain = domains.find(domain =>
      Array.isArray(conflict.domains) &&
      conflict.domains.includes(domain)
    );

    const err = new Error(
      `Domain "${conflictingDomain || "requested domain"}" already belongs to institution "${conflict._id}"`
    );
    err.statusCode = 409;
    throw err;
  }
}

async function assertDomainsNotInUseBeforeRemoval(institutionId, existingDomains, newDomains) {
  const removed = (existingDomains || []).filter(
    domain => !(newDomains || []).includes(domain)
  );

  if (!removed.length) return;

  const usersStillUsingDomain = await users.findOne({
    tenantId: institutionId,
    email: {
      $regex: `@(?:${removed.map(domain =>
        domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("|")})$`,
      $options: "i"
    }
  }, {
    projection: { _id: 1, email: 1 }
  });

  if (usersStillUsingDomain) {
    const err = new Error(
      `Cannot remove an institutional domain while assigned users still use it (${usersStillUsingDomain.email})`
    );
    err.statusCode = 409;
    throw err;
  }
}

function targetTenantForRequest(req, requestedTenantId) {
  if (isInstitutionAdmin(req.admin)) return actorTenant(req);
  return String(requestedTenantId || "").trim() || null;
}

function isPlatformAdmin(user) {
  return isSuperAdmin(user) || normalizedRole(user) === "PLATFORM_ADMIN";
}

function isInstitutionAdmin(user) {
  return normalizedRole(user) === "INSTITUTION_ADMIN";
}

// RAG Access is an independent usage capability, not an administrative role.
// It defaults to false and is enforced by the RAG/MCP service at request time.
function normalizedRagAccess(user) {
  return user?.ragAccess === true;
}

function parseRagAccess(value) {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(v)) return true;
  if (["false", "0", "no", "off", "disabled", ""].includes(v)) return false;
  return undefined;
}

function canManageRagAccess(req, user) {
  if (!user) return false;
  const targetRole = normalizedRole(user);

  if (isSuperAdmin(req.admin)) return true;

  if (normalizedRole(req.admin) === "PLATFORM_ADMIN") {
    return targetRole !== "SUPERADMIN" &&
      targetRole !== "PLATFORM_ADMIN" &&
      targetRole !== "ADMIN";
  }

  if (isInstitutionAdmin(req.admin)) {
    return String(user.tenantId || "").trim() === actorTenant(req) &&
      (targetRole === "USER" || targetRole === "INSTRUCTOR");
  }

  return false;
}

function actorTenant(req) {
  return String(req.admin?.tenantId || "").trim() || null;
}


function cleanPolicyKey(value, label = "Key") {
  const v = String(value || "").trim();
  if (!v || !/^[A-Za-z0-9_.:-]{1,128}$/.test(v)) {
    throw new Error(
      `${label} must contain only letters, numbers, dot, underscore, colon or hyphen`
    );
  }
  return v;
}

function cleanCostTier(value, fallback = "BALANCED") {
  const v = String(value || fallback).trim().toUpperCase();
  if (!MODEL_COST_TIERS.has(v))
    throw new Error("Cost tier must be ECONOMY, BALANCED, or ADVANCED");
  return v;
}

function cleanStringList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map(v => String(v || "").trim())
      .filter(Boolean)
  )];
}

function canManageModelPolicy(req) {
  return isSuperAdmin(req.admin) ||
    normalizedRole(req.admin) === "PLATFORM_ADMIN";
}

async function resolvePolicyTenant(req, requestedTenantId) {
  if (!canManageModelPolicy(req)) return null;

  const tenantId = String(requestedTenantId || "").trim();
  if (!tenantId) return null;

  return await institutionExists(tenantId)
    ? tenantId
    : null;
}


function canManageAcademicAgents(req) {
  return canManageModelPolicy(req) || isInstitutionAdmin(req.admin);
}

async function resolveAcademicTenant(req, requestedTenantId) {
  if (isInstitutionAdmin(req.admin)) {
    return actorTenant(req);
  }

  const tenantId = String(requestedTenantId || "").trim();
  if (!tenantId) return null;

  return await institutionExists(tenantId) ? tenantId : null;
}

function normalizeAcademicAgentType(value, fallback = "AGENT") {
  const v = String(value || fallback).trim().toUpperCase();

  if (!ACADEMIC_AGENT_TYPES.has(v))
    throw new Error("Academic Agent type must be MODE or AGENT");

  return v;
}


function normalizeAcademicAudiences(values) {
  const out = cleanStringList(values)
    .map(v => v.toUpperCase());

  for (const value of out) {
    if (!ACADEMIC_AUDIENCES.has(value))
      throw new Error(`Unsupported Academic Agent audience: ${value}`);
  }

  return out;
}


function normalizeAcademicVisibility(value, fallback = "INSTITUTION") {
  const v = String(value || fallback).trim().toUpperCase();

  if (!ACADEMIC_AGENT_VISIBILITIES.has(v))
    throw new Error(
      "Academic Agent visibility must be INSTITUTION or PRIVATE"
    );

  return v;
}


function normalizeAcademicTools(values) {
  return cleanStringList(values)
    .map(v => v.slice(0, 200))
    .slice(0, 100);
}


function normalizeAcademicMcpServers(values) {
  return cleanStringList(values)
    .map(v => v.slice(0, 200))
    .slice(0, 50);
}


function normalizeAcademicWorkflow(value) {
  const input =
    value && typeof value === "object"
      ? value
      : {};

  return {
    type: String(input.type || "GUIDED")
      .trim()
      .toUpperCase()
      .slice(0, 100),

    steps: cleanStringList(input.steps)
      .map(v => v.slice(0, 1000))
      .slice(0, 50)
  };
}


function normalizeAcademicModelPolicy(value) {
  const input =
    value && typeof value === "object"
      ? value
      : {};

  return {
    mode: String(input.mode || "PERSONA_ROUTE")
      .trim()
      .toUpperCase()
      .slice(0, 100),

    costTier: cleanCostTier(
      input.costTier,
      "BALANCED"
    )
  };
}


function normalizeResearchMaturityPolicy(value) {
  const input =
    value && typeof value === "object"
      ? value
      : {};

  const levels =
    cleanStringList(input.allowedLevels)
      .map(v => v.toUpperCase());

  const normalized =
    levels.length
      ? levels
      : [
          "NOVICE",
          "DEVELOPING",
          "INDEPENDENT",
          "ADVANCED"
        ];

  for (const value of normalized) {
    if (!RESEARCH_MATURITY_LEVELS.has(value))
      throw new Error(
        `Unsupported research maturity level: ${value}`
      );
  }

  return {
    adaptive: input.adaptive !== false,
    allowedLevels: normalized
  };
}


function normalizeAcademicRagPolicy(value) {
  const policy =
    value && typeof value === "object"
      ? value
      : {};

  const personalRag =
    String(
      policy.personalRag ||
      "INHERIT_USER_ACCESS"
    ).trim().toUpperCase();

  if (personalRag !== "INHERIT_USER_ACCESS")
    throw new Error(
      "Academic Agent personalRag must be INHERIT_USER_ACCESS"
    );

  const sharedScopeMode =
    String(
      policy.sharedScopeMode ||
      "NONE"
    ).trim().toUpperCase();

  if (![
    "NONE",
    "SELECTED_RAG_GROUPS",
    "CONTEXTUAL_HIERARCHY"
  ].includes(sharedScopeMode))
    throw new Error(
      "Academic Agent sharedScopeMode must be NONE, SELECTED_RAG_GROUPS, or CONTEXTUAL_HIERARCHY"
    );

  return {
    personalRag: "INHERIT_USER_ACCESS",
    sharedScopeMode,
    ragGroupIds:
      sharedScopeMode === "SELECTED_RAG_GROUPS"
        ? cleanIdList(policy.ragGroupIds)
        : []
  };
}


function normalizePedagogy(input = {}) {
  const mode = String(input.mode || "SOCRATIC")
    .trim()
    .toUpperCase();

  return {
    mode,
    diagnoseFirst: input.diagnoseFirst !== false,
    activeRetrieval: input.activeRetrieval !== false,
    adaptiveDifficulty: input.adaptiveDifficulty !== false,
    misconceptionRepair: input.misconceptionRepair !== false,
    masteryTracking: input.masteryTracking !== false,
    strategy: String(input.strategy || "")
      .trim()
      .slice(0, 4000)
  };
}

function userScope(req, extra = {}) {
  return isInstitutionAdmin(req.admin)
    ? { tenantId: actorTenant(req), ...extra }
    : extra;
}

function canTargetUser(req, user) {
  const actor = req.admin;
  const targetRole = normalizedRole(user);

  // Superadmin has absolute authority, including over other privileged accounts.
  if (isSuperAdmin(actor)) return true;

  // Platform Admins may manage Institution Admins and all lower roles,
  // but may never manage another Platform Admin, legacy ADMIN, or Superadmin.
  if (normalizedRole(actor) === "PLATFORM_ADMIN") {
    return targetRole !== "SUPERADMIN" &&
      targetRole !== "PLATFORM_ADMIN" &&
      targetRole !== "ADMIN";
  }

  // Institution Admins are restricted to their own institution and
  // may manage only ordinary users and instructors.
  if (isInstitutionAdmin(actor)) {
    return String(user?.tenantId || "").trim() === actorTenant(req) &&
      (targetRole === "USER" || targetRole === "INSTRUCTOR");
  }

  return false;
}

function canAssignRoleToUser(req, role) {
  const r = String(role || "").trim().toUpperCase();

  if (r === "SUPERADMIN") {
    return false; // The designated Superadmin account is unique and immutable.
  }

  if (r === "PLATFORM_ADMIN" || r === "ADMIN") {
    return isSuperAdmin(req.admin);
  }

  if (isSuperAdmin(req.admin) || normalizedRole(req.admin) === "PLATFORM_ADMIN") {
    return r === "USER" || r === "INSTRUCTOR" || r === "INSTITUTION_ADMIN";
  }

  return isInstitutionAdmin(req.admin) &&
    (r === "USER" || r === "INSTRUCTOR");
}

function allowedUserRole(req, role) {
  const r = String(role || "").trim();

  // Institution Admins may only create ordinary users/instructors.
  if (isInstitutionAdmin(req.admin)) {
    return r === "USER" || r === "Instructor";
  }

  // Only the immutable Superadmin may create a Platform Admin.
  if (isSuperAdmin(req.admin)) {
    return r === "USER" ||
      r === "Instructor" ||
      r === "INSTITUTION_ADMIN" ||
      r === "PLATFORM_ADMIN";
  }

  // Platform Admins have platform-wide management privileges,
  // but cannot create another Platform Admin.
  if (normalizedRole(req.admin) === "PLATFORM_ADMIN") {
    return r === "USER" ||
      r === "Instructor" ||
      r === "INSTITUTION_ADMIN";
  }

  return r === "USER" ||
    r === "Instructor" ||
    r === "INSTITUTION_ADMIN";
}

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "AI Scholar Hub User Management" })
);

app.get("/login", (_req, res) => res.sendFile("/app/public/login.html"));

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await users.findOne({ email });

    if (!user || !(isPlatformAdmin(user) || isInstitutionAdmin(user)) || !user.password ||
        !(await bcrypt.compare(password, user.password))) {

      await audit("LOGIN_FAILED", req, {
        result: "denied",
        targetEmail: email || null,
        targetRole: user?.role || null,
        safeDetails: {
          reason: "Invalid administrator credentials"
        }
      });

      return res.status(401).json({ error: "Invalid administrator credentials" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user._id.toString(), createdAt: Date.now() });

    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();

    const secureCookie =
      forwardedProto === "https" || req.secure === true;

    res.setHeader(
      "Set-Cookie",
      `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/${secureCookie ? "; Secure" : ""}`
    );

    req.admin = user;

    await audit("LOGIN_SUCCESS", req, {
      targetUserId: user._id,
      targetEmail: user.email,
      targetRole: user.role
    });

    res.json({
      ok: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId || null,
        superAdmin: user.superAdmin === true,
        ragAccess: normalizedRagAccess(user)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/logout", async (req, res) => {
  const token = cookies(req).admin_session;
  const session = token ? sessions.get(token) : null;

  if (session) {
    try {
      const user = await users.findOne(
        { _id: new ObjectId(session.userId) }
      );

      if (user) {
        req.admin = user;

        await audit("LOGOUT", req, {
          targetUserId: user._id,
          targetEmail: user.email,
          targetRole: user.role
        });
      }
    } catch (e) {
      console.error("[logout-audit]", e);
    }

    sessions.delete(token);
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  const secureCookie =
    forwardedProto === "https" || req.secure === true;

  res.setHeader(
    "Set-Cookie",
    `admin_session=; HttpOnly; SameSite=Lax; Path=/${secureCookie ? "; Secure" : ""}; Max-Age=0`
  );

  res.json({ ok: true });
});

app.use(requireAdmin);

/*
 * ============================================================
 * SUPERADMIN SECURITY CENTER — AUDIT API
 * ============================================================
 */

app.get("/api/superadmin/audit", requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit || "100", 10), 1),
      500
    );

    const filter = {};

    if (req.query.action)
      filter.action = String(req.query.action).trim();

    if (req.query.actor)
      filter.actorEmail = {
        $regex: String(req.query.actor).trim(),
        $options: "i"
      };

    if (req.query.target)
      filter.targetEmail = {
        $regex: String(req.query.target).trim(),
        $options: "i"
      };

    const events = await adminAudit
      .find(filter, {
        projection: {
          _id: 1,
          timestamp: 1,
          actorUserId: 1,
          actorEmail: 1,
          actorName: 1,
          actorRole: 1,
          actorSuperAdmin: 1,
          action: 1,
          targetUserId: 1,
          targetEmail: 1,
          targetRole: 1,
          result: 1,
          source: 1,
          ipAddress: 1,
          userAgent: 1,
          details: 1
        }
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({
      ok: true,
      count: events.length,
      events
    });
  } catch (e) {
    console.error("[SUPERADMIN-AUDIT]", e);
    res.status(500).json({
      error: "Failed to retrieve audit log"
    });
  }
});

app.get("/api/superadmin/audit/actions", requireSuperAdmin, async (_req, res) => {
  try {
    const actions = await adminAudit.distinct("action");

    res.json({
      ok: true,
      actions: actions.sort()
    });
  } catch (e) {
    console.error("[SUPERADMIN-AUDIT-ACTIONS]", e);
    res.status(500).json({
      error: "Failed to retrieve audit actions"
    });
  }
});

app.get("/api/me", (req, res) => {
  const admin = { ...req.admin, ragAccess: normalizedRagAccess(req.admin) };
  delete admin.password;
  delete admin.refreshToken;
  delete admin.backupCodes;
  res.json(admin);
});

app.get("/api/users", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const roleParam = String(req.query.role || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "0", 10) || 0, 0), 100);
    const filter = userScope(req);

    if (q) {
      /*
       * User search is tenant-aware and server-side.
       *
       * Institution Admins remain constrained by userScope(req), while
       * platform-level administrators may search by institution name/ID
       * without loading the entire directory into the browser.
       */
      const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const institutionMatches = await institutions.find(
        {
          $or: [
            { _id: { $regex: escapedQ, $options: "i" } },
            { name: { $regex: escapedQ, $options: "i" } }
          ]
        },
        { projection: { _id: 1 } }
      ).limit(100).toArray();

      const matchingTenantIds = institutionMatches
        .map(x => String(x._id || "").trim())
        .filter(Boolean);

      filter.$or = [
        { name: { $regex: escapedQ, $options: "i" } },
        { username: { $regex: escapedQ, $options: "i" } },
        { email: { $regex: escapedQ, $options: "i" } },
        ...(matchingTenantIds.length
          ? [{ tenantId: { $in: matchingTenantIds } }]
          : [])
      ];
    }
    const roles = roleParam.split(",").map(x => x.trim()).filter(Boolean);
    if (roles.length === 1) filter.role = roles[0];
    else if (roles.length > 1) filter.role = { $in: roles };

    let cursor = users.find(filter, {
      projection: { password: 0, refreshToken: 0, backupCodes: 0 }
    }).sort({ createdAt: -1 });

    if (limit) cursor = cursor.limit(limit);

    const result = await cursor.toArray();

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to retrieve users" });
  }
});

app.get("/api/institutions", async (req, res) => {
  try {
    if (isInstitutionAdmin(req.admin)) {
      const id = actorTenant(req);
      const institution = await institutions.findOne({ _id: id });
      if (!institution) return res.status(404).json({ error: "Institution not found" });
      return res.json({ institutions: [institution] });
    }
    const list = await institutions.find({}).sort({ name: 1 }).toArray();
    const admins = await users.find(
      { role: "INSTITUTION_ADMIN", tenantId: { $exists: true, $ne: null } },
      { projection: { name: 1, email: 1, tenantId: 1 } }
    ).toArray();
    const byTenant = new Map();
    for (const admin of admins) {
      const key = String(admin.tenantId || "");
      if (!byTenant.has(key)) byTenant.set(key, []);
      byTenant.get(key).push({ _id: admin._id, name: admin.name, email: admin.email });
    }
    res.json({
      institutions: list.map(x => ({
        ...x,
        admins: byTenant.get(String(x._id)) || [],
        domains: normalizeInstitutionDomains(x.domains || []) || []
      }))
    });
  } catch (e) {
    console.error("[institutions-list]", e);
    res.status(500).json({ error: "Failed to retrieve institutions" });
  }
});

app.post("/api/institutions", async (req, res) => {
  if (!isPlatformAdmin(req.admin)) return res.status(403).json({ error: "Platform administrator privileges required" });
  const id = String(req.body.id || "").trim();
  const name = String(req.body.name || "").trim();
  if (!/^[-a-zA-Z0-9_.]{1,128}$/.test(id) || !name || name.length > 200)
    return res.status(400).json({ error: "Valid institution id and name are required" });
  try {
    const domains = normalizeInstitutionDomains(req.body.domains) || [];
    await assertInstitutionDomainsAvailable(id, domains);

    const now = new Date();
    const doc = {
      _id: id,
      name,
      status: "enabled",
      domains,
      createdAt: now,
      updatedAt: now
    };
    await institutions.insertOne(doc);
    await audit("INSTITUTION_CREATED", req, { safeDetails: { institutionId: id, name } });
    res.status(201).json({ institution: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({
        error: "Institution or institutional domain already exists"
      });

    if (e?.statusCode)
      return res.status(e.statusCode).json({ error: e.message });

    console.error("[institution-create]", e);
    res.status(500).json({ error: "Failed to create institution" });
  }
});

app.patch("/api/institutions/:id", async (req, res) => {
  if (!isPlatformAdmin(req.admin)) return res.status(403).json({ error: "Platform administrator privileges required" });
  const id = String(req.params.id || "").trim();
  if (!/^[-a-zA-Z0-9_.]{1,128}$/.test(id)) return res.status(400).json({ error: "Invalid institution id" });
  const update = { updatedAt: new Date() };
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 200) return res.status(400).json({ error: "Invalid institution name" });
    update.name = name;
  }
  if (req.body.status !== undefined) {
    if (!['enabled', 'disabled'].includes(req.body.status)) return res.status(400).json({ error: "Invalid institution status" });
    update.status = req.body.status;
  }
  try {
    if (req.body.domains !== undefined) {
      const institution = await institutions.findOne(
        { _id: id },
        { projection: { domains: 1 } }
      );

      if (!institution)
        return res.status(404).json({ error: "Institution not found" });

      const domains = normalizeInstitutionDomains(req.body.domains);

      await assertInstitutionDomainsAvailable(id, domains);

      await assertDomainsNotInUseBeforeRemoval(
        id,
        normalizeInstitutionDomains(institution.domains || []) || [],
        domains
      );

      update.domains = domains;
    }

    const result = await institutions.findOneAndUpdate(
      { _id: id },
      { $set: update },
      { returnDocument: "after" }
    );
    if (!result) return res.status(404).json({ error: "Institution not found" });
    await audit("INSTITUTION_UPDATED", req, { safeDetails: { institutionId: id, fields: Object.keys(update).filter(k => k !== "updatedAt") } });
    res.json({ institution: result });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({
        error: "Institutional domain already belongs to another institution"
      });

    if (e?.statusCode)
      return res.status(e.statusCode).json({ error: e.message });

    console.error("[institution-update]", e);
    res.status(500).json({ error: "Failed to update institution" });
  }
});

app.delete("/api/institutions/:id", requireSuperAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^[-a-zA-Z0-9_.]{1,128}$/.test(id)) return res.status(400).json({ error: "Invalid institution id" });
  try {
    // The main API owns the canonical purge implementation. The admin UI deliberately
    // does not attempt to reimplement tenant-data deletion here.
    const librechatUrl = process.env.LIBRECHAT_INTERNAL_URL || "http://api:3080";
    const proxySecret = String(process.env.ADMIN_INTERNAL_SECRET || "").trim();

    if (!proxySecret) {
      console.error("[institution-delete] ADMIN_INTERNAL_SECRET is not configured");
      return res.status(503).json({
        error: "Institution deletion is temporarily unavailable because internal administration security is not configured"
      });
    }

    const response = await fetch(`${librechatUrl}/api/admin/institutions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-AI-Scholar-Hub-Admin-Proxy": proxySecret }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: data.error || "Failed to permanently delete institution" });
    }
    await audit("INSTITUTION_DELETED", req, { safeDetails: { institutionId: id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("[institution-delete]", e);
    res.status(500).json({ error: "Failed to permanently delete institution" });
  }
});

app.post("/api/institutions/:id/admin", async (req, res) => {
  if (!isPlatformAdmin(req.admin)) return res.status(403).json({ error: "Platform administrator privileges required" });
  const institutionId = String(req.params.id || "").trim();
  const userId = String(req.body.userId || "").trim();
  if (!/^[-a-zA-Z0-9_.]{1,128}$/.test(institutionId) || !userId)
    return res.status(400).json({ error: "institution id and userId are required" });
  try {
    const institution = await institutions.findOne({ _id: institutionId });
    if (!institution) return res.status(404).json({ error: "Institution not found" });
    if (institution.status === "disabled") return res.status(400).json({ error: "Cannot assign an admin to a disabled institution" });
    if (!ObjectId.isValid(userId)) return res.status(400).json({ error: "Invalid user ID" });
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) return res.status(404).json({ error: "User not found" });

    const targetRole = normalizedRole(user);
    const userTenantId = String(user.tenantId || "").trim();

    if (targetRole !== "USER" && targetRole !== "INSTRUCTOR") {
      return res.status(403).json({
        error: "Only users and instructors may be assigned as Institution Admins"
      });
    }

    // Assignment never doubles as an institution transfer. The target account
    // must already belong to the institution being administered.
    if (userTenantId !== institutionId) {
      return res.status(409).json({
        error: userTenantId
          ? "User belongs to another institution; transfer the user explicitly before assigning Institution Admin"
          : "User has no institution assignment; assign the user to this institution before assigning Institution Admin"
      });
    }

    await users.updateOne({ _id: user._id }, { $set: { role: "INSTITUTION_ADMIN", tenantId: institutionId, updatedAt: new Date() } });
    await audit("INSTITUTION_ADMIN_ASSIGNED", req, { targetUserId: user._id, targetEmail: user.email, targetRole: "INSTITUTION_ADMIN", safeDetails: { institutionId } });
    res.json({ ok: true });
  } catch (e) {
    console.error("[institution-admin]", e);
    res.status(500).json({ error: "Failed to assign institution admin" });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim() || null;
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || "USER").trim();
    const ragAccess = parseRagAccess(req.body.ragAccess);

    if (!name || !email)
      return res.status(400).json({ error: "Name and email are required" });

    if (!allowedUserRole(req, role) || !canAssignRoleToUser(req, role))
      return res.status(400).json({ error: "Invalid or unauthorized role" });

    if (ragAccess === undefined)
      return res.status(400).json({ error: "RAG Access must be enabled or disabled" });

    // A requested RAG grant is subject to the same administrative hierarchy
    // as an existing user's RAG capability.
    if (ragAccess === true) {
      const prospectiveUser = {
        role,
        tenantId: isInstitutionAdmin(req.admin)
          ? actorTenant(req)
          : String(req.body.tenantId || "").trim() || null
      };
      if (!canManageRagAccess(req, prospectiveUser))
        return res.status(403).json({ error: "You are not authorized to grant RAG Access to this user" });
    }

    // PLATFORM_ADMIN and SUPERADMIN/legacy ADMIN are privileged roles
    // that only the designated Superadmin may create.

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Invalid email address" });

    if (await users.findOne({ email }))
      return res.status(409).json({ error: "A user with this email already exists" });

    const requestedTenantId = String(req.body.tenantId || "").trim();
    const tenantId = isInstitutionAdmin(req.admin)
      ? actorTenant(req)
      : (role === "PLATFORM_ADMIN" ? null : requestedTenantId);

    if (role === "USER" || role === "Instructor" || role === "INSTITUTION_ADMIN") {
      await assertEmailMatchesInstitution(email, tenantId);
    }

    /*
     * The administrator never creates or receives a usable password.
     * Generate a random password only as an internal bootstrap value.
     * The user will establish their real password through LibreChat's
     * existing password-reset/setup mechanism.
     */
    const bootstrapPassword = crypto.randomBytes(32).toString("hex");
    const now = new Date();

    const doc = {
      name,
      username,
      email,
      emailVerified: true,
      password: await bcrypt.hash(bootstrapPassword, 10),
      avatar: null,
      provider: "local",
      role,
      ...(tenantId ? { tenantId } : {}),
      ragAccess,
      plugins: [],
      twoFactorEnabled: false,
      termsAccepted: false,
      termsAcceptedAt: null,
      personalization: {
        memories: true,
        statefulCodeEnvironment: "user",
        _id: new ObjectId()
      },
      backupCodes: [],
      refreshToken: [],
      favorites: [],
      skillStates: {},
      createdAt: now,
      updatedAt: now,
      __v: 0
    };

    const result = await users.insertOne(doc);

    await audit("USER_CREATED", req, {
      targetUserId: result.insertedId,
      targetEmail: email,
      targetRole: role,
      safeDetails: {
        username,
        emailSent: false
      }
    });

    /*
     * Reuse LibreChat's native password-reset service through its
     * public authentication endpoint. This produces the same
     * one-time setup link used by "Forgot Password".
     */
    const librechatUrl =
      process.env.LIBRECHAT_INTERNAL_URL ||
      "http://api:3080";

    const resetResponse = await fetch(
      `${librechatUrl}/api/auth/requestPasswordReset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      }
    );

    const resetData = await resetResponse.json().catch(() => ({}));

    if (!resetResponse.ok) {
      console.error(
        `[create-user] User created but setup email failed for ${email}:`,
        resetData
      );

      return res.status(201).json({
        ok: true,
        id: result.insertedId,
        emailSent: false,
        warning: "User created, but the password setup email could not be sent."
      });
    }

    await audit("USER_SETUP_EMAIL_SENT", req, {
      targetUserId: result.insertedId,
      targetEmail: email,
      targetRole: role,
      safeDetails: {}
    });

    res.json({
      ok: true,
      id: result.insertedId,
      emailSent: true
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create user" });
  }
});

app.patch("/api/users/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid user ID" });

    const id = new ObjectId(req.params.id);
    const user = await users.findOne(userScope(req, { _id: id }));

    if (!user) return res.status(404).json({ error: "User not found" });

    if (id.equals(req.admin._id)) {
      return res.status(400).json({ error: "You cannot modify your own administrative account" });
    }

    if (!canTargetUser(req, user)) {
      return res.status(403).json({ error: "User administration is not permitted" });
    }

    const isSuperadmin = isSuperAdmin(user);

    // The designated account is the only account allowed to carry the
    // Superadmin designation, and that account can never be demoted.
    if (user?.superAdmin === true && !isSuperadmin) {
      return res.status(403).json({
        error: "Only the designated AI Scholar Hub Superadmin account may have the Superadmin designation"
      });
    }


    const update = { updatedAt: new Date() };

    if (req.body.ragAccess !== undefined) {
      const ragAccess = parseRagAccess(req.body.ragAccess);
      if (ragAccess === undefined)
        return res.status(400).json({ error: "RAG Access must be enabled or disabled" });
      if (!canManageRagAccess(req, user))
        return res.status(403).json({ error: "You are not authorized to change this user's RAG Access" });
      update.ragAccess = ragAccess;
    }

    if (isSuperadmin && req.body.role !== undefined &&
        String(req.body.role).trim().toUpperCase() !== "SUPERADMIN") {
      return res.status(403).json({
        error: "The Superadmin account cannot be demoted"
      });
    }

    if (isSuperadmin && req.body.superAdmin !== undefined &&
        req.body.superAdmin !== true) {
      return res.status(403).json({
        error: "The Superadmin designation cannot be removed"
      });
    }

    // Only the immutable creator account may have superAdmin=true.
    // No other administrator can grant or modify the Superadmin designation.
    if (!isSuperadmin && req.body.superAdmin !== undefined) {
      return res.status(403).json({
        error: "Only the designated AI Scholar Hub Superadmin may have the Superadmin designation"
      });
    }

    if (req.body.name !== undefined)
      update.name = String(req.body.name).trim();

    if (req.body.username !== undefined)
      update.username = String(req.body.username).trim() || null;

    if (req.body.role !== undefined) {
      const role = String(req.body.role).trim();
      if (!allowedUserRole(req, role) || !canAssignRoleToUser(req, role))
        return res.status(400).json({ error: "Invalid or unauthorized role" });

      // A Superadmin may change privileged roles. Platform Admins may
      // promote/demote within the lower tiers, including Institution Admin.
      // Institution Admins may only manage USER/INSTRUCTOR.
      if (normalizedRole(user) === "ADMIN" && !isSuperAdmin(req.admin)) {
        return res.status(403).json({
          error: "Only the AI Scholar Hub Superadmin may modify a legacy ADMIN account"
        });
      }

      if (user.role === "ADMIN" && role !== "ADMIN") {
        const count = await users.countDocuments({ role: "ADMIN" });
        if (count <= 1)
          return res.status(400).json({ error: "Cannot remove the last admin" });
      }

      if (isSuperadmin) {
        // Canonical Superadmin invariant.
        update.role = "SUPERADMIN";
        update.superAdmin = true;
        delete update.tenantId;
      } else {
        update.role = role;
      }

      if (isSuperadmin) {
        // Superadmin is platform-wide and never institution-scoped.
        delete update.tenantId;
      } else if (role === "PLATFORM_ADMIN") {
        // Platform Admins are platform-wide.
        update.tenantId = null;
      } else if (role === "INSTITUTION_ADMIN") {
        const tenantId = isInstitutionAdmin(req.admin)
          ? actorTenant(req)
          : String(req.body.tenantId || user.tenantId || "").trim();

        await assertEmailMatchesInstitution(user.email, tenantId);
        update.tenantId = tenantId;

      } else if (role === "USER" || role === "Instructor") {
        const tenantId = isInstitutionAdmin(req.admin)
          ? actorTenant(req)
          : (req.body.tenantId !== undefined
            ? String(req.body.tenantId || "").trim()
            : String(user.tenantId || "").trim());

        await assertEmailMatchesInstitution(user.email, tenantId);
        update.tenantId = tenantId;
      }
    }

    if (req.body.tenantId !== undefined && !isInstitutionAdmin(req.admin) && req.body.role === undefined) {
      const tenantId = String(req.body.tenantId || "").trim();

      if (tenantId) {
        await assertEmailMatchesInstitution(user.email, tenantId);
        update.tenantId = tenantId;
      } else {
        delete update.tenantId;
      }
    }

    if (req.body.password) {
      update.password = await bcrypt.hash(String(req.body.password), 10);
    }

    await users.updateOne({ _id: id }, { $set: update });

    await audit("USER_UPDATED", req, {
      targetUserId: id,
      targetEmail: user.email,
      targetRole: update.role || user.role,
      safeDetails: {
        fields: Object.keys(update).filter(k => k !== "updatedAt"),
        previousRole: user.role,
        newRole: update.role || user.role,
        ...(update.ragAccess !== undefined ? {
          previousRagAccess: normalizedRagAccess(user),
          newRagAccess: update.ragAccess
        } : {})
      }
    });

    if (update.ragAccess !== undefined && update.ragAccess !== normalizedRagAccess(user)) {
      await audit("USER_RAG_ACCESS_UPDATED", req, {
        targetUserId: id,
        targetEmail: user.email,
        targetRole: update.role || user.role,
        safeDetails: {
          previousRagAccess: normalizedRagAccess(user),
          newRagAccess: update.ragAccess
        }
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update user" });
  }
});


app.post("/api/users/:id/send-reset", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid user ID" });

    const id = new ObjectId(req.params.id);

    const user = await users.findOne(
      userScope(req, { _id: id }),
      { projection: { email: 1, name: 1, tenantId: 1, role: 1, superAdmin: 1 } }
    );

    if (!user)
      return res.status(404).json({ error: "User not found" });

    if (id.equals(req.admin._id))
      return res.status(400).json({ error: "You cannot reset your own administrative account from this portal" });

    if (!canTargetUser(req, user))
      return res.status(403).json({ error: "User administration is not permitted" });

    const librechatUrl =
      process.env.LIBRECHAT_INTERNAL_URL ||
      "http://api:3080";

    const response = await fetch(
      `${librechatUrl}/api/auth/requestPasswordReset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok)
      return res.status(502).json({
        error: data.message || "Unable to send password setup email"
      });

    await audit("PASSWORD_RESET_SENT", req, {
      targetUserId: user._id,
      targetEmail: user.email,
      safeDetails: {}
    });

    res.json({
      ok: true,
      message: `Password setup/reset link sent to ${user.email}`
    });
  } catch (e) {
    console.error("[send-reset]", e);
    res.status(500).json({
      error: "Failed to send password setup/reset email"
    });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: "Invalid user ID" });

    const id = new ObjectId(req.params.id);

    if (id.equals(req.admin._id))
      return res.status(400).json({ error: "You cannot delete your own account" });

    const user = await users.findOne(userScope(req, { _id: id }));
    if (!user) return res.status(404).json({ error: "User not found" });

    if (isSuperAdmin(user) && !isSuperAdmin(req.admin)) {
      return res.status(403).json({
        error: "The AI Scholar Hub Superadmin account is protected and cannot be deleted"
      });
    }

    if (!canTargetUser(req, user)) {
      return res.status(403).json({ error: "User administration is not permitted" });
    }

    if (normalizedRole(user) === "ADMIN") {
      const count = await users.countDocuments({ role: "ADMIN" });
      if (count <= 1)
        return res.status(400).json({ error: "Cannot delete the last admin" });
    }

    await users.deleteOne({ _id: id });

    await audit("USER_DELETED", req, {
      targetUserId: user._id,
      targetEmail: user.email,
      targetRole: user.role,
      safeDetails: {}
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(x => x.trim());
  if (!lines.length) return [];

  const headers = lines.shift().split(",").map(x => x.trim().toLowerCase());

  return lines.map(line => {
    const values = [];
    let value = "", quoted = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (c === "," && !quoted) {
        values.push(value.trim());
        value = "";
      } else value += c;
    }
    values.push(value.trim());

    const row = {};
    headers.forEach((h, i) => row[h] = values[i] ?? "");
    return row;
  });
}

app.post("/api/users/bulk", async (req, res) => {
  try {
    const rows = parseCSV(String(req.body.csv || ""));
    const confirm = req.body.confirm === true;

    if (!rows.length)
      return res.status(400).json({ error: "CSV is empty" });

    const allowedRoles = isInstitutionAdmin(req.admin)
      ? ["USER", "Instructor"]
      : isPlatformAdmin(req.admin)
        ? ["USER", "Instructor", "INSTITUTION_ADMIN"]
        : ["USER", "Instructor", "INSTITUTION_ADMIN", "ADMIN"];

    // Bulk creation of ADMIN accounts is restricted to the Superadmin.
    if (!isSuperAdmin(req.admin)) {
      const containsAdmin = rows.some(
        r => String(r.role || "USER").trim() === "ADMIN"
      );

      if (containsAdmin) {
        return res.status(403).json({
          error: "Only the AI Scholar Hub Superadmin may create administrator accounts"
        });
      }
    }

    const seen = new Set();
    const preview = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      const name = String(r.name || "").trim();
      const username = String(r.username || "").trim() || null;
      const email = String(r.email || "").trim().toLowerCase();
      const role = String(r.role || "USER").trim();
      const institutionId = String(r.institutionId || r.tenantId || "").trim();
      const ragAccess = parseRagAccess(r.ragAccess);

      if (ragAccess === undefined) {
        errors.push(`Row ${rowNo}: ragAccess must be true/false, yes/no, or enabled/disabled`);
        continue;
      }

      if (!name || !email) {
        errors.push(`Row ${rowNo}: name and email are required`);
        continue;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`Row ${rowNo}: invalid email address`);
        continue;
      }

      if (!allowedRoles.includes(role)) {
        errors.push(`Row ${rowNo}: invalid or unauthorized role "${role}"`);
        continue;
      }

      if (["USER", "Instructor", "INSTITUTION_ADMIN"].includes(role)) {
        const effectiveTenantId = isInstitutionAdmin(req.admin) ? actorTenant(req) : institutionId;
        if (!effectiveTenantId || !/^[-a-zA-Z0-9_.]{1,128}$/.test(effectiveTenantId)) {
          errors.push(`Row ${rowNo}: institutionId is required for institution-scoped users`);
          continue;
        }
        if (isInstitutionAdmin(req.admin) && institutionId && institutionId !== actorTenant(req)) {
          errors.push(`Row ${rowNo}: Institution Admin may only use their own institution`);
          continue;
        }
        const institution = await institutions.findOne({ _id: effectiveTenantId });
        if (!institution) {
          errors.push(`Row ${rowNo}: institutionId "${effectiveTenantId}" was not found`);
          continue;
        }
        if (institution.status === "disabled") {
          errors.push(`Row ${rowNo}: institution "${effectiveTenantId}" is disabled`);
          continue;
        }

        /*
         * Bulk enrollment is subject to the same tenant identity boundary
         * as single-user administration. The CSV cannot assign an email
         * domain to an institution that does not own that domain.
         */
        try {
          await assertEmailMatchesInstitution(email, effectiveTenantId);
        } catch (e) {
          errors.push(`Row ${rowNo}: ${e.message}`);
          continue;
        }
      }

      if (ragAccess === true) {
        const prospectiveUser = {
          role,
          tenantId: isInstitutionAdmin(req.admin) ? actorTenant(req) : institutionId || null
        };
        if (!canManageRagAccess(req, prospectiveUser)) {
          errors.push(`Row ${rowNo}: you are not authorized to grant RAG Access to this account`);
          continue;
        }
      }

      if (seen.has(email)) {
        errors.push(`Row ${rowNo}: duplicate email in CSV`);
        continue;
      }

      seen.add(email);

      const existing = await users.findOne({ email });

      if (existing) {
        preview.push({
          row: rowNo,
          name,
          username,
          email,
          role,
          institutionId,
          ragAccess,
          status: "skipped",
          reason: "Email already exists"
        });
      } else {
        preview.push({
          row: rowNo,
          name,
          username,
          email,
          role,
          institutionId,
          ragAccess,
          status: "new"
        });
      }
    }

    if (!confirm) {
      return res.json({
        ok: true,
        preview,
        errors
      });
    }

    const created = [];
    const skipped = [];
    const failed = [];

    for (const item of preview) {
      if (item.status === "skipped") {
        skipped.push({
          email: item.email,
          reason: item.reason
        });
        continue;
      }

      try {
        // Generate an internal bootstrap password.
        // It is never returned to or shown to the administrator.
        const bootstrapPassword = crypto.randomBytes(32).toString("hex");

        const now = new Date();

        const doc = {
          name: item.name,
          username: item.username || null,
          email: item.email,
          emailVerified: true,
          password: await bcrypt.hash(bootstrapPassword, 10),
          avatar: null,
          provider: "local",
          role: item.role,
          ragAccess: item.ragAccess === true,
          ...(["USER", "Instructor", "INSTITUTION_ADMIN"].includes(item.role)
            ? { tenantId: isInstitutionAdmin(req.admin) ? actorTenant(req) : String(item.institutionId || "").trim() || null }
            : {}),
          plugins: [],
          twoFactorEnabled: false,
          termsAccepted: false,
          termsAcceptedAt: null,
          personalization: {
            memories: true,
            statefulCodeEnvironment: "user",
            _id: new ObjectId()
          },
          backupCodes: [],
          refreshToken: [],
          favorites: [],
          skillStates: {},
          createdAt: now,
          updatedAt: now,
          __v: 0
        };

        await users.insertOne(doc);

        let emailSent = false;

        try {
          const librechatUrl =
            process.env.LIBRECHAT_INTERNAL_URL ||
            "http://api:3080";

          const resetResponse = await fetch(
            `${librechatUrl}/api/auth/requestPasswordReset`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: item.email })
            }
          );

          emailSent = resetResponse.ok;

          if (!emailSent) {
            const resetData = await resetResponse.json().catch(() => ({}));
            console.error(
              `[bulk-create] Setup email failed for ${item.email}:`,
              resetData
            );
          }
        } catch (emailError) {
          console.error(
            `[bulk-create] Setup email request failed for ${item.email}:`,
            emailError
          );
        }

        created.push({
          name: item.name,
          email: item.email,
          role: item.role,
          ragAccess: item.ragAccess === true,
          emailSent
        });
      } catch (e) {
        console.error(`Bulk create failed for ${item.email}:`, e);
        failed.push({
          email: item.email,
          error: "Failed to create user"
        });
      }
    }

    await audit("USERS_BULK_CREATED", req, {
      safeDetails: {
        createdCount: created.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        errorCount: errors.length,
        roles: [...new Set(created.map(x => x.role))]
      }
    });

    res.json({
      ok: true,
      created,
      skipped,
      failed,
      errors
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Bulk upload failed" });
  }
});


/*
 * ============================================================
 * INSTITUTION ORGANIZATION + RAG ACCESS POINTS
 * ============================================================
 * All organization resources are tenant-owned.  The tenant is
 * derived from the authenticated administrator; client-supplied
 * tenantId values are never authoritative for Institution Admins.
 */

const departments = db.collection("departments");
const courses = db.collection("courses");
const groups = db.collection("groups");
const groupAdmins = db.collection("group_admins");
const courseInstructors = db.collection("course_instructors");
const groupCourses = db.collection("group_courses");
const groupDepartments = db.collection("group_departments");
const ragLocations = db.collection("ragLocations");
const ragGroups = db.collection("ragGroups");
const ragGroupManagers = db.collection("ragGroupManagers");
const ragFiles = db.collection("files");

const ORG_ID_RE = /^[-a-zA-Z0-9_.]{1,128}$/;
const RAG_TYPES = new Set(["DEPARTMENT", "COURSE", "GROUP"]);

function orgTenant(req, requestedTenantId = null) {
  if (isInstitutionAdmin(req.admin)) return actorTenant(req);
  return String(requestedTenantId || req.query.tenantId || "").trim() || null;
}

async function requireOrgTenant(req, res) {
  const tenantId = orgTenant(req, req.body?.tenantId || req.params?.tenantId);
  if (!tenantId || !ORG_ID_RE.test(tenantId)) {
    res.status(400).json({ error: "Valid institution context is required" });
    return null;
  }
  const institution = await institutions.findOne({ _id: tenantId }, { projection: { _id: 1, status: 1, name: 1 } });
  if (!institution) {
    res.status(404).json({ error: "Institution not found" });
    return null;
  }
  if (institution.status === "disabled") {
    res.status(409).json({ error: "This institution is disabled" });
    return null;
  }
  if (isInstitutionAdmin(req.admin) && tenantId !== actorTenant(req)) {
    res.status(403).json({ error: "Institution Admin may only manage their own institution" });
    return null;
  }
  return tenantId;
}

function orgCanManage(req) {
  return isSuperAdmin(req.admin) || isPlatformAdmin(req.admin) || isInstitutionAdmin(req.admin);
}

const GROUP_ADMIN_PERMISSIONS = new Set([
  "MANAGE_MEMBERS",
  "MANAGE_SUBGROUPS",
  "MANAGE_RAG",
  "MANAGE_ADMINS"
]);

function isOrgElevated(req) {
  return isSuperAdmin(req.admin) ||
    isPlatformAdmin(req.admin) ||
    isInstitutionAdmin(req.admin);
}

async function groupAdminPermissions(req, group) {
  if (!req.admin || !group) return new Set();

  const userId = req.admin._id;
  if (!userId) return new Set();

  const assignments = await groupAdmins.find({
    tenantId: group.tenantId,
    groupId: group._id,
    userId: String(userId)
  }).toArray();

  const permissions = new Set();

  for (const assignment of assignments) {
    for (const permission of Array.isArray(assignment.permissions) ? assignment.permissions : []) {
      const value = String(permission).trim().toUpperCase();
      if (GROUP_ADMIN_PERMISSIONS.has(value)) permissions.add(value);
    }
  }

  return permissions;
}

async function hasGroupAdminPermission(req, group, permission, includeDescendants = false) {
  if (isOrgElevated(req)) return true;
  if (!group || group.tenantId !== actorTenant(req)) return false;

  const requested = String(permission || "").trim().toUpperCase();
  if (!GROUP_ADMIN_PERMISSIONS.has(requested)) return false;

  let current = group;
  const visited = new Set();

  while (current) {
    const key = String(current._id);
    if (visited.has(key)) return false;
    visited.add(key);

    const permissions = await groupAdminPermissions(req, current);
    if (permissions.has(requested)) {
      if (String(current._id) === String(group._id) || includeDescendants) {
        return true;
      }
    }

    if (!includeDescendants || !current.parentGroupId) break;

    const parentId = oid(current.parentGroupId);
    if (!parentId) break;

    current = await groups.findOne({
      _id: parentId,
      tenantId: group.tenantId
    });
  }

  return false;
}

async function requireGroupPermission(req, res, group, permission, includeDescendants = false) {
  if (await hasGroupAdminPermission(req, group, permission, includeDescendants)) {
    return true;
  }

  res.status(403).json({
    error: "You do not have permission to manage this group"
  });
  return false;
}

function oid(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

async function ensureOrgIndexes() {
  await Promise.all([
    departments.createIndex({ tenantId: 1, name: 1 }, { unique: true }),
    departments.createIndex({ tenantId: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } }),
    courses.createIndex({ tenantId: 1, code: 1 }, { unique: true }),
    courses.createIndex({ tenantId: 1, departmentId: 1 }),
    groups.createIndex({ tenantId: 1, name: 1 }, { unique: true }),
    groups.createIndex({ tenantId: 1, parentGroupId: 1 }),
    groupAdmins.createIndex({ tenantId: 1, groupId: 1, userId: 1 }, { unique: true }),
    groupAdmins.createIndex({ tenantId: 1, groupId: 1 }),
    groupAdmins.createIndex({ tenantId: 1, userId: 1 }),
    courseInstructors.createIndex({ tenantId: 1, courseId: 1, userId: 1 }, { unique: true }),
    courseInstructors.createIndex({ tenantId: 1, userId: 1 }),
    groupCourses.createIndex({ tenantId: 1, groupId: 1, courseId: 1 }, { unique: true }),
    groupDepartments.createIndex({ tenantId: 1, groupId: 1, departmentId: 1 }, { unique: true }),
    ragLocations.createIndex({ tenantId: 1, type: 1, targetId: 1 }, { unique: true }),
    ragLocations.createIndex({ tenantId: 1, type: 1 }),
    ragGroups.createIndex({ tenantId: 1, name: 1 }, { unique: true }),
    ragGroups.createIndex({ tenantId: 1, enabled: 1 }),
    ragGroups.createIndex({ tenantId: 1, groupIds: 1 }),
    ragGroups.createIndex({ tenantId: 1, departmentIds: 1 }),
    ragGroups.createIndex({ tenantId: 1, courseIds: 1 }),
    ragGroups.createIndex({ tenantId: 1, userIds: 1 }),
    ragGroups.createIndex({ tenantId: 1, ragLocationIds: 1 }),
    ragFiles.createIndex({ tenantId: 1, ragGroupIds: 1 }),
    ragGroupManagers.createIndex({ tenantId: 1, ragGroupId: 1, userId: 1 }, { unique: true }),
    ragGroupManagers.createIndex({ tenantId: 1, ragGroupId: 1 }),
    ragGroupManagers.createIndex({ tenantId: 1, userId: 1 })
  ]);
}

ensureOrgIndexes().catch(e => console.error("[ORG-INDEXES]", e));

function cleanName(value, label = "Name") {
  const v = String(value || "").trim();
  if (!v || v.length > 200) throw new Error(`${label} is required and must be 200 characters or fewer`);
  return v;
}

function cleanOptionalCode(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (v.length > 100 || !/^[\w.-]+$/.test(v)) throw new Error("Code may contain only letters, numbers, underscore, dot, and hyphen");
  return v;
}

async function getScopedDepartment(req, id) {
  const _id = oid(id);
  if (!_id) return null;
  const tenantId = actorTenant(req);
  return departments.findOne(isInstitutionAdmin(req.admin) ? { _id, tenantId } : { _id });
}

async function getScopedCourse(req, id) {
  const _id = oid(id);
  if (!_id) return null;
  const tenantId = actorTenant(req);
  return courses.findOne(isInstitutionAdmin(req.admin) ? { _id, tenantId } : { _id });
}

async function getScopedGroup(req, id) {
  const _id = oid(id);
  if (!_id) return null;
  const tenantId = actorTenant(req);
  return groups.findOne(isInstitutionAdmin(req.admin) ? { _id, tenantId } : { _id });
}

app.get("/api/departments", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const tenantId = await requireOrgTenant(req, res); if (!tenantId) return;
    const result = await departments.find({ tenantId }).sort({ name: 1 }).toArray();
    res.json({ departments: result });
  } catch (e) { console.error("[DEPARTMENTS-LIST]", e); res.status(500).json({ error: "Failed to retrieve departments" }); }
});

app.post("/api/departments", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const tenantId = await requireOrgTenant(req, res); if (!tenantId) return;
    const name = cleanName(req.body.name, "Department name");
    const code = cleanOptionalCode(req.body.code);
    const now = new Date();
    const doc = { tenantId, name, ...(code ? { code } : {}), description: String(req.body.description || "").trim().slice(0, 1000), createdAt: now, updatedAt: now };
    const result = await departments.insertOne(doc);
    doc._id = result.insertedId;
    await audit("DEPARTMENT_CREATED", req, { safeDetails: { tenantId, departmentId: doc._id.toString(), name } });
    res.status(201).json({ department: doc });
  } catch (e) { if (e?.code === 11000) return res.status(409).json({ error: "Department name or code already exists in this institution" }); res.status(400).json({ error: e.message || "Failed to create department" }); }
});

app.patch("/api/departments/:id", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const current = await getScopedDepartment(req, req.params.id);
    if (!current) return res.status(404).json({ error: "Department not found" });
    const update = { updatedAt: new Date() };
    const unset = {};
    if (req.body.name !== undefined) update.name = cleanName(req.body.name, "Department name");
    if (req.body.code !== undefined) { const code = cleanOptionalCode(req.body.code); if (code) update.code = code; else unset.code = ""; }
    if (req.body.description !== undefined) update.description = String(req.body.description || "").trim().slice(0, 1000);
    const result = await departments.findOneAndUpdate({ _id: current._id, tenantId: current.tenantId }, { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { returnDocument: "after" });
    await audit("DEPARTMENT_UPDATED", req, { safeDetails: { tenantId: current.tenantId, departmentId: current._id.toString() } });
    res.json({ department: result });
  } catch (e) { if (e?.code === 11000) return res.status(409).json({ error: "Department name or code already exists in this institution" }); res.status(400).json({ error: e.message || "Failed to update department" }); }
});

app.delete("/api/departments/:id", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const current = await getScopedDepartment(req, req.params.id);
    if (!current) return res.status(404).json({ error: "Department not found" });
    const tenantId = current.tenantId;
    const coursesUsing = await courses.countDocuments({ tenantId, departmentId: current._id });
    if (coursesUsing) return res.status(409).json({ error: "Department has courses. Move or remove its courses before deleting it." });
    const ragLocation = await ragLocations.findOne(
      { tenantId, type: "DEPARTMENT", targetId: current._id.toString() },
      { projection: { _id: 1 } }
    );
    if (ragLocation) return res.status(409).json({
      error: "Department has a RAG Access Point. Remove its documents and Access Group assignments, then delete the Access Point first."
    });
    await groupDepartments.deleteMany({ tenantId, departmentId: current._id });
    await departments.deleteOne({ _id: current._id, tenantId });
    await audit("DEPARTMENT_DELETED", req, { safeDetails: { tenantId, departmentId: current._id.toString() } });
    res.json({ ok: true });
  } catch (e) { console.error("[DEPARTMENT-DELETE]", e); res.status(500).json({ error: "Failed to delete department" }); }
});

app.get("/api/courses", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const tenantId = await requireOrgTenant(req, res); if (!tenantId) return;
    const filter = { tenantId };
    if (req.query.departmentId) {
      const departmentId = oid(req.query.departmentId);
      if (!departmentId) return res.status(400).json({ error: "Invalid department ID" });
      filter.departmentId = departmentId;
    }
    const result = await courses.find(filter).sort({ name: 1 }).toArray();
    res.json({ courses: result });
  } catch (e) { console.error("[COURSES-LIST]", e); res.status(500).json({ error: "Failed to retrieve courses" }); }
});

app.post("/api/courses", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const tenantId = await requireOrgTenant(req, res); if (!tenantId) return;
    const name = cleanName(req.body.name, "Course name");
    const code = cleanOptionalCode(req.body.code);
    let departmentId = null;
    if (req.body.departmentId) {
      departmentId = oid(req.body.departmentId);
      if (!departmentId || !(await departments.findOne({ _id: departmentId, tenantId }))) return res.status(400).json({ error: "Department does not belong to this institution" });
    }
    const now = new Date();
    const doc = { tenantId, name, code, departmentId, description: String(req.body.description || "").trim().slice(0, 1000), createdAt: now, updatedAt: now };
    const result = await courses.insertOne(doc); doc._id = result.insertedId;
    await audit("COURSE_CREATED", req, { safeDetails: { tenantId, courseId: doc._id.toString(), name } });
    res.status(201).json({ course: doc });
  } catch (e) { if (e?.code === 11000) return res.status(409).json({ error: "Course code already exists in this institution" }); res.status(400).json({ error: e.message || "Failed to create course" }); }
});

app.patch("/api/courses/:id", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const current = await getScopedCourse(req, req.params.id); if (!current) return res.status(404).json({ error: "Course not found" });
    const update = { updatedAt: new Date() };
    const unset = {};
    if (req.body.name !== undefined) update.name = cleanName(req.body.name, "Course name");
    if (req.body.code !== undefined) { const code = cleanOptionalCode(req.body.code); if (code) update.code = code; else unset.code = ""; }
    if (req.body.description !== undefined) update.description = String(req.body.description || "").trim().slice(0, 1000);
    if (req.body.departmentId !== undefined) {
      if (!req.body.departmentId) update.departmentId = null;
      else {
        const departmentId = oid(req.body.departmentId);
        if (!departmentId || !(await departments.findOne({ _id: departmentId, tenantId: current.tenantId }))) return res.status(400).json({ error: "Department does not belong to this institution" });
        update.departmentId = departmentId;
      }
    }
    const result = await courses.findOneAndUpdate({ _id: current._id, tenantId: current.tenantId }, { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { returnDocument: "after" });
    await audit("COURSE_UPDATED", req, { safeDetails: { tenantId: current.tenantId, courseId: current._id.toString() } });
    res.json({ course: result });
  } catch (e) { if (e?.code === 11000) return res.status(409).json({ error: "Course code already exists in this institution" }); res.status(400).json({ error: e.message || "Failed to update course" }); }
});

app.delete("/api/courses/:id", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const current = await getScopedCourse(req, req.params.id); if (!current) return res.status(404).json({ error: "Course not found" });
    const tenantId = current.tenantId;
    const ragLocation = await ragLocations.findOne(
      { tenantId, type: "COURSE", targetId: current._id.toString() },
      { projection: { _id: 1 } }
    );
    if (ragLocation) return res.status(409).json({
      error: "Course has a RAG Access Point. Remove its documents and Access Group assignments, then delete the Access Point first."
    });
    await courseInstructors.deleteMany({ tenantId, courseId: current._id });
    await groupCourses.deleteMany({ tenantId, courseId: current._id });
    await courses.deleteOne({ _id: current._id, tenantId });
    await audit("COURSE_DELETED", req, { safeDetails: { tenantId, courseId: current._id.toString() } });
    res.json({ ok: true });
  } catch (e) { console.error("[COURSE-DELETE]", e); res.status(500).json({ error: "Failed to delete course" }); }
});

app.get("/api/courses/:id/instructors", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const course = await getScopedCourse(req, req.params.id); if (!course) return res.status(404).json({ error: "Course not found" });
    const links = await courseInstructors.find({ tenantId: course.tenantId, courseId: course._id }).toArray();
    const ids = links.map(x => x.userId).filter(ObjectId.isValid).map(x => new ObjectId(x));
    const instructors = await users.find({ _id: { $in: ids }, tenantId: course.tenantId, role: "Instructor" }, { projection: { password: 0, refreshToken: 0, backupCodes: 0 } }).toArray();
    res.json({ instructors });
  } catch (e) { res.status(500).json({ error: "Failed to retrieve course instructors" }); }
});

app.put("/api/courses/:id/instructors", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const course = await getScopedCourse(req, req.params.id); if (!course) return res.status(404).json({ error: "Course not found" });
    const ids = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map(String))];
    const valid = [];
    for (const id of ids) {
      const _id = oid(id); if (!_id) continue;
      const user = await users.findOne({ _id, tenantId: course.tenantId, role: "Instructor" }, { projection: { _id: 1 } });
      if (user) valid.push(user._id.toString());
    }
    await courseInstructors.deleteMany({ tenantId: course.tenantId, courseId: course._id });
    if (valid.length) await courseInstructors.insertMany(valid.map(userId => ({ tenantId: course.tenantId, courseId: course._id, userId })));
    await audit("COURSE_INSTRUCTORS_UPDATED", req, { safeDetails: { tenantId: course.tenantId, courseId: course._id.toString(), count: valid.length } });
    res.json({ ok: true, userIds: valid });
  } catch (e) { res.status(400).json({ error: e.message || "Failed to update course instructors" }); }
});

app.get("/api/groups", async (req, res) => {
  try {
    if (!orgCanManage(req)) return res.status(403).json({ error: "Organization administration is not permitted" });
    const tenantId = await requireOrgTenant(req, res); if (!tenantId);

    const result = await groups.find({ tenantId }).sort({ name: 1 }).toArray();

    const counts = await groupAdmins.aggregate([
      { $match: { tenantId } },
      { $group: { _id: "$groupId", count: { $sum: 1 } } }
    ]).toArray();

    const countMap = new Map(
      counts.map(x => [String(x._id), x.count])
    );

    res.json({
      groups: result.map(g => ({
        ...g,
        adminCount: countMap.get(String(g._id)) || 0
      }))
    });
  } catch (e) { res.status(500).json({ error: "Failed to retrieve groups" }); }
});

app.get("/api/groups/mine", async (req, res) => {
  try {
    const tenantId = actorTenant(req);
    if (!tenantId) return res.status(403).json({ error: "Institution context is required" });

    if (isOrgElevated(req)) {
      const result = await groups.find({ tenantId }).sort({ name: 1 }).toArray();
      return res.json({ groups: result });
    }

    const assignments = await groupAdmins.find({
      tenantId,
      userId: String(req.admin?._id || "")
    }).toArray();

    const ids = assignments
      .map(a => oid(a.groupId))
      .filter(Boolean);

    if (!ids.length) return res.json({ groups: [] });

    const result = await groups.find({
      tenantId,
      _id: { $in: ids }
    }).sort({ name: 1 }).toArray();

    res.json({
      groups: result,
      permissions: assignments.map(a => ({
        groupId: String(a.groupId),
        permissions: Array.isArray(a.permissions) ? a.permissions : []
      }))
    });
  } catch (e) {
    console.error("[GROUPS-MINE]", e);
    res.status(500).json({ error: "Failed to retrieve assigned groups" });
  }
});

async function validateGroupParent(tenantId, groupId, parentGroupId) {
  if (parentGroupId === undefined || parentGroupId === null || parentGroupId === "") return null;

  const parentId = oid(parentGroupId);
  if (!parentId) throw new Error("Invalid parentGroupId");
  if (groupId && parentId.equals(groupId)) {
    throw new Error("A group cannot be its own parent");
  }

  const parent = await groups.findOne(
    { _id: parentId, tenantId },
    { projection: { _id: 1 } }
  );
  if (!parent) throw new Error("Parent group not found in this institution");

  // Walk upward and reject cycles.
  const seen = new Set();
  let cursor = parentId;

  while (cursor) {
    const key = cursor.toString();
    if (seen.has(key)) throw new Error("Group hierarchy contains a cycle");
    seen.add(key);

    const node = await groups.findOne(
      { _id: cursor, tenantId },
      { projection: { parentGroupId: 1 } }
    );

    if (!node) break;

    if (groupId && node.parentGroupId && String(node.parentGroupId) === String(groupId)) {
      throw new Error("Group hierarchy would create a cycle");
    }

    cursor = node.parentGroupId ? oid(node.parentGroupId) : null;
  }

  return parentId;
}

async function validateGroupRelations(tenantId, memberIds, departmentIds, courseIds) {
  const members = [];
  for (const id of [...new Set((memberIds || []).map(String))]) {
    const _id = oid(id); if (!_id) continue;
    const u = await users.findOne({ _id, tenantId, role: { $in: ["USER", "Instructor"] } }, { projection: { _id: 1 } });
    if (u) members.push(u._id.toString());
  }
  const departmentsValid = [];
  for (const id of [...new Set((departmentIds || []).map(String))]) { const _id=oid(id); if (_id && await departments.findOne({_id,tenantId},{projection:{_id:1}})) departmentsValid.push(_id.toString()); }
  const coursesValid = [];
  for (const id of [...new Set((courseIds || []).map(String))]) { const _id=oid(id); if (_id && await courses.findOne({_id,tenantId},{projection:{_id:1}})) coursesValid.push(_id.toString()); }
  return { members, departments: departmentsValid, courses: coursesValid };
}

app.post("/api/groups", async (req, res) => {
  try {
    const tenantId = await requireOrgTenant(req, res); if (!tenantId) return;
    const parentGroupId = await validateGroupParent(tenantId, null, req.body.parentGroupId);

    if (!isOrgElevated(req)) {
      if (!parentGroupId) {
        return res.status(403).json({ error: "Group Admins may only create subgroups" });
      }
      const parent = await groups.findOne({ _id: parentGroupId, tenantId });
      if (!parent || !(await hasGroupAdminPermission(req, parent, "MANAGE_SUBGROUPS"))) {
        return res.status(403).json({ error: "You do not have permission to create a subgroup here" });
      }
    }

    const name = cleanName(req.body.name, "Group name");
    const rel = await validateGroupRelations(tenantId, req.body.memberIds, req.body.departmentIds, req.body.courseIds);
    const now = new Date();
    const doc = {
      tenantId,
      name,
      description: String(req.body.description || "").trim().slice(0, 1000),
      memberIds: rel.members,
      departmentIds: rel.departments,
      courseIds: rel.courses,
      parentGroupId,
      createdAt: now,
      updatedAt: now
    };
    const result = await groups.insertOne(doc); doc._id=result.insertedId;

    // New membership/hierarchy nodes may change contextual RAG scope.

    await audit("GROUP_CREATED", req, { safeDetails: { tenantId, groupId: doc._id.toString(), name } });
    res.status(201).json({ group: doc });
  } catch (e) { if(e?.code===11000)return res.status(409).json({error:"Group name already exists in this institution"}); res.status(400).json({error:e.message||"Failed to create group"}); }
});

app.patch("/api/groups/:id", async (req, res) => {
  try {
    const current=await getScopedGroup(req,req.params.id); if(!current)return res.status(404).json({error:"Group not found"});

    if (!isOrgElevated(req)) {
      const onlyMembers =
        req.body.memberIds !== undefined &&
        req.body.name === undefined &&
        req.body.description === undefined &&
        req.body.parentGroupId === undefined &&
        req.body.departmentIds === undefined &&
        req.body.courseIds === undefined;

      if (!(await requireGroupPermission(
        req,
        res,
        current,
        onlyMembers ? "MANAGE_MEMBERS" : "MANAGE_SUBGROUPS"
      ))) return;
    }

    const update={updatedAt:new Date()};
    if(req.body.name!==undefined)update.name=cleanName(req.body.name,"Group name");
    if(req.body.description!==undefined)update.description=String(req.body.description||"").trim().slice(0,1000);
    if(req.body.parentGroupId!==undefined){
      update.parentGroupId=await validateGroupParent(current.tenantId,current._id,req.body.parentGroupId);
    }
    if(req.body.memberIds!==undefined||req.body.departmentIds!==undefined||req.body.courseIds!==undefined){
      const rel=await validateGroupRelations(current.tenantId, req.body.memberIds??current.memberIds, req.body.departmentIds??current.departmentIds, req.body.courseIds??current.courseIds);
      if(req.body.memberIds!==undefined)update.memberIds=rel.members;
      if(req.body.departmentIds!==undefined)update.departmentIds=rel.departments;
      if(req.body.courseIds!==undefined)update.courseIds=rel.courses;
    }
    const result=await groups.findOneAndUpdate({_id:current._id,tenantId:current.tenantId},{$set:update},{returnDocument:"after"});

    // Membership, ancestry, department, or course changes affect scope.
    await audit("GROUP_UPDATED",req,{safeDetails:{tenantId:current.tenantId,groupId:current._id.toString()}});
    res.json({group:result});
  } catch(e){if(e?.code===11000)return res.status(409).json({error:"Group name already exists in this institution"});res.status(400).json({error:e.message||"Failed to update group"});}
});

app.delete("/api/groups/:id", async (req,res)=>{
  try{
    const current=await getScopedGroup(req,req.params.id);if(!current)return res.status(404).json({error:"Group not found"});
    if (!(await requireGroupPermission(req, res, current, "MANAGE_SUBGROUPS"))) return;
    const child = await groups.findOne(
      { tenantId: current.tenantId, parentGroupId: current._id },
      { projection: { _id: 1, name: 1 } }
    );
    if (child) {
      return res.status(409).json({
        error: "Group has subgroups. Move or delete its subgroups first."
      });
    }

    const [ragLocation,ragAccessGroup]=await Promise.all([
      ragLocations.findOne({
        tenantId:current.tenantId,
        type:"GROUP",
        targetId:String(current._id)
      },{projection:{_id:1}}),
      ragGroups.findOne({
        tenantId:current.tenantId,
        groupIds:String(current._id)
      },{projection:{_id:1}})
    ]);
    if(ragLocation||ragAccessGroup){
      return res.status(409).json({
        error:"Group is used by RAG policy. Remove its RAG Access Point and Access Group assignments first."
      });
    }

    await Promise.all([
      groupCourses.deleteMany({tenantId:current.tenantId,groupId:current._id}),
      groupDepartments.deleteMany({tenantId:current.tenantId,groupId:current._id}),
      groupAdmins.deleteMany({tenantId:current.tenantId,groupId:current._id}),
      groups.deleteOne({_id:current._id,tenantId:current.tenantId})
    ]);

    // Removing a hierarchy node may revoke inherited RAG authorization.

    await audit("GROUP_DELETED",req,{safeDetails:{tenantId:current.tenantId,groupId:current._id.toString()}});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"Failed to delete group"});}
});

// ============================================================
// GROUP ADMINISTRATORS
// Scoped relationship; not a global role.
// ============================================================

app.get("/api/groups/:id/admins", async (req, res) => {
  try {
    if (!orgCanManage(req)) {
      return res.status(403).json({ error: "Organization administration is not permitted" });
    }

    const group = await getScopedGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const admins = await groupAdmins.find({
      tenantId: group.tenantId,
      groupId: group._id
    }).sort({ userId: 1 }).toArray();

    const ids = admins.map(x => oid(x.userId)).filter(Boolean);
    const userDocs = ids.length
      ? await users.find(
          { _id: { $in: ids }, tenantId: group.tenantId },
          { projection: { password: 0, refreshToken: 0, backupCodes: 0 } }
        ).toArray()
      : [];

    const byId = new Map(userDocs.map(u => [u._id.toString(), u]));

    res.json({
      admins: admins.map(a => ({
        ...a,
        user: byId.get(String(a.userId)) || null
      }))
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to retrieve group administrators" });
  }
});

app.put("/api/groups/:id/admins", async (req, res) => {
  try {
    if (!orgCanManage(req)) {
      return res.status(403).json({ error: "Organization administration is not permitted" });
    }

    const group = await getScopedGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const requested = Array.isArray(req.body.admins) ? req.body.admins : [];

    const valid = [];
    for (const item of requested) {
      const userId = String(item?.userId || "");
      const userObjectId = oid(userId);
      if (!userObjectId) continue;

      const user = await users.findOne(
        {
          _id: userObjectId,
          tenantId: group.tenantId,
          role: { $in: ["USER", "Instructor", "INSTITUTION_ADMIN"] }
        },
        { projection: { _id: 1 } }
      );

      if (!user) continue;

      const permissions = [...new Set(
        (Array.isArray(item?.permissions) ? item.permissions : [
          "MANAGE_MEMBERS",
          "MANAGE_SUBGROUPS",
          "MANAGE_RAG"
        ])
        .map(String)
        .filter(Boolean)
      )];

      valid.push({
        tenantId: group.tenantId,
        groupId: group._id,
        userId: user._id.toString(),
        permissions,
        updatedAt: new Date()
      });
    }

    await groupAdmins.deleteMany({
      tenantId: group.tenantId,
      groupId: group._id
    });

    if (valid.length) {
      await groupAdmins.insertMany(valid);
    }

    await audit("GROUP_ADMINS_UPDATED", req, {
      safeDetails: {
        tenantId: group.tenantId,
        groupId: group._id.toString(),
        count: valid.length
      }
    });

    res.json({ ok: true, admins: valid });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update group administrators"
    });
  }
});


const RAG_GROUP_ACCESS_MODES = new Set([
  "GROUP_ONLY",
  "GROUP_AND_DESCENDANTS",
  "SELECTED_GROUPS",
  "SELECTED_USERS"
]);

function cleanIdList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values.map(v => String(v || "").trim()).filter(Boolean)
  )];
}

function signRagToken(userId, tenantId) {
  const secret = String(process.env.JWT_SECRET || "");
  if (!secret)
    throw new Error("Document upload signing is not configured");

  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer
    .from(JSON.stringify(value))
    .toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    id: String(userId),
    tenantId: String(tenantId),
    iat: now,
    exp: now + 300
  });
  const content = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(content)
    .digest("base64url");

  return `${content}.${signature}`;
}

async function readUpstreamJson(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;

  const message = String(
    data.error || data.message || data.detail || fallback
  );
  const error = new Error(message);
  error.statusCode = response.status;
  throw error;
}

async function validateRagGroupReferences(tenantId, body) {
  const groupIds = cleanIdList(body.groupIds);
  const departmentIds = cleanIdList(body.departmentIds);
  const courseIds = cleanIdList(body.courseIds);
  const userIds = cleanIdList(body.userIds);
  const ragLocationIds = cleanIdList(body.ragLocationIds);

  const groupObjects = groupIds.map(oid).filter(Boolean);
  const departmentObjects = departmentIds.map(oid).filter(Boolean);
  const courseObjects = courseIds.map(oid).filter(Boolean);

  if (groupIds.length !== groupObjects.length)
    throw new Error("One or more Group IDs are invalid");
  if (departmentIds.length !== departmentObjects.length)
    throw new Error("One or more Department IDs are invalid");
  if (courseIds.length !== courseObjects.length)
    throw new Error("One or more Course IDs are invalid");

  const institutionLocationId = `institution:${tenantId}`;
  const configuredLocationIds = ragLocationIds.filter(
    value => value !== institutionLocationId
  );
  const configuredLocationObjects = configuredLocationIds
    .map(oid)
    .filter(Boolean);

  if (configuredLocationObjects.length !== configuredLocationIds.length)
    throw new Error("One or more RAG Access Point IDs are invalid");

  const [groupsFound, departmentsFound, coursesFound, locationsFound] = await Promise.all([
    groupObjects.length
      ? groups.countDocuments({ _id: { $in: groupObjects }, tenantId })
      : 0,
    departmentObjects.length
      ? departments.countDocuments({ _id: { $in: departmentObjects }, tenantId })
      : 0,
    courseObjects.length
      ? courses.countDocuments({ _id: { $in: courseObjects }, tenantId })
      : 0,
    configuredLocationObjects.length
      ? ragLocations.countDocuments({
          _id: { $in: configuredLocationObjects },
          tenantId,
          enabled: { $ne: false }
        })
      : 0
  ]);

  if (groupsFound !== groupObjects.length)
    throw new Error("One or more Groups do not belong to this institution");
  if (departmentsFound !== departmentObjects.length)
    throw new Error("One or more Departments do not belong to this institution");
  if (coursesFound !== courseObjects.length)
    throw new Error("One or more Courses do not belong to this institution");
  if (locationsFound !== configuredLocationObjects.length)
    throw new Error("One or more RAG Access Points do not belong to this institution");

  if (userIds.length) {
    const userObjects = userIds.map(oid).filter(Boolean);
    if (userIds.length !== userObjects.length)
      throw new Error("One or more User IDs are invalid");

    const usersFound = await db.collection("users").countDocuments({
      _id: { $in: userObjects },
      tenantId
    });

    if (usersFound !== userObjects.length)
      throw new Error("One or more Users do not belong to this institution");
  }

  return { groupIds, departmentIds, courseIds, userIds, ragLocationIds };
}


/*
 * CONTEXTUAL_HIERARCHY RAG RESOLUTION
 *
 * Authorization model
 * -------------------
 *
 * GROUP_ONLY
 *   Match only the active/direct group itself.
 *
 * GROUP_AND_DESCENDANTS
 *   A RAG group attached to an ancestor is inherited by users in
 *   descendant groups.
 *
 * SELECTED_GROUPS
 *   Match only explicitly selected groups in which the user has
 *   direct membership/context.
 *
 * SELECTED_USERS
 *   Match only explicitly selected users.
 *
 * Department/course references are explicit contextual anchors.
 * They are derived only from the user's authorized group branch.
 *
 * IMPORTANT:
 *   This function resolves candidate authorized RAG Group IDs.
 *   The actual retrieval layer must still re-authorize the requested
 *   RAG group before any document content is returned.
 */

app.get("/api/rag-groups", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG Group administration is not permitted" });

    const tenantId = await requireOrgTenant(req, res);
    if (!tenantId) return;

    const result = await ragGroups.find({ tenantId }).sort({ name: 1 }).toArray();
    res.json({ ragGroups: result });
  } catch (e) {
    console.error("[RAG-GROUPS-LIST]", e);
    res.status(500).json({ error: "Failed to retrieve RAG Groups" });
  }
});

app.post("/api/rag-groups", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG Group administration is not permitted" });

    const tenantId = await requireOrgTenant(req, res);
    if (!tenantId) return;

    const name = cleanName(req.body.name, "RAG Group name");
    const description = String(req.body.description || "").trim().slice(0, 1000);
    const accessMode = String(req.body.accessMode || "GROUP_ONLY").trim().toUpperCase();

    if (!RAG_GROUP_ACCESS_MODES.has(accessMode))
      return res.status(400).json({ error: "Invalid RAG Group access mode" });

    const refs = await validateRagGroupReferences(tenantId, req.body);

    const now = new Date();
    const doc = {
      tenantId,
      name,
      description,
      enabled: req.body.enabled !== false,
      accessMode,
      ...refs,
      createdAt: now,
      updatedAt: now
    };

    const result = await ragGroups.insertOne(doc);
    doc._id = result.insertedId;

    // Newly created RAG policy must be reflected immediately.

    await audit("RAG_GROUP_CREATED", req, {
      safeDetails: {
        tenantId,
        ragGroupId: doc._id.toString(),
        name,
        accessMode
      }
    });

    res.status(201).json({ ragGroup: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({ error: "A RAG Group with this name already exists" });

    res.status(400).json({
      error: e.message || "Failed to create RAG Group"
    });
  }
});

app.patch("/api/rag-groups/:id", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG Group administration is not permitted" });

    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "Invalid RAG Group ID" });

    const tenantId = actorTenant(req);
    const filter = isInstitutionAdmin(req.admin)
      ? { _id, tenantId }
      : { _id };

    const current = await ragGroups.findOne(filter);
    if (!current)
      return res.status(404).json({ error: "RAG Group not found" });

    const update = { updatedAt: new Date() };

    if (req.body.name !== undefined)
      update.name = cleanName(req.body.name, "RAG Group name");

    if (req.body.description !== undefined)
      update.description = String(req.body.description || "").trim().slice(0, 1000);

    if (req.body.enabled !== undefined)
      update.enabled = req.body.enabled === true;

    if (req.body.accessMode !== undefined) {
      const accessMode = String(req.body.accessMode).trim().toUpperCase();
      if (!RAG_GROUP_ACCESS_MODES.has(accessMode))
        return res.status(400).json({ error: "Invalid RAG Group access mode" });
      update.accessMode = accessMode;
    }

    if (
      req.body.groupIds !== undefined ||
      req.body.departmentIds !== undefined ||
      req.body.courseIds !== undefined ||
      req.body.userIds !== undefined ||
      req.body.ragLocationIds !== undefined
    ) {
      const refs = await validateRagGroupReferences(current.tenantId, {
        groupIds: req.body.groupIds !== undefined ? req.body.groupIds : current.groupIds,
        departmentIds: req.body.departmentIds !== undefined ? req.body.departmentIds : current.departmentIds,
        courseIds: req.body.courseIds !== undefined ? req.body.courseIds : current.courseIds,
        userIds: req.body.userIds !== undefined ? req.body.userIds : current.userIds,
        ragLocationIds: req.body.ragLocationIds !== undefined
          ? req.body.ragLocationIds
          : current.ragLocationIds
      });

      Object.assign(update, refs);
    }

    const result = await ragGroups.findOneAndUpdate(
      { _id: current._id, tenantId: current.tenantId },
      { $set: update },
      { returnDocument: "after" }
    );

    // Access mode or targeting changes alter authorization immediately.

    await audit("RAG_GROUP_UPDATED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        ragGroupId: current._id.toString()
      }
    });

    res.json({ ragGroup: result });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({ error: "A RAG Group with this name already exists" });

    res.status(400).json({
      error: e.message || "Failed to update RAG Group"
    });
  }
});


async function canManageRagDocuments(req, ragGroup) {
  if (isOrgElevated(req)) return true;

  if (!req.admin || !ragGroup) return false;
  if (ragGroup.tenantId !== actorTenant(req)) return false;

  const assignment = await ragGroupManagers.findOne({
    tenantId: ragGroup.tenantId,
    ragGroupId: String(ragGroup._id),
    userId: String(req.admin._id),
    permissions: "MANAGE_DOCUMENTS"
  });

  return !!assignment;
}

async function resolveRagLocation(req, rawId) {
  const requestedTenantId = String(
    req.body?.tenantId || req.query?.tenantId || ""
  ).trim();
  const tenantId = orgTenant(req, requestedTenantId);
  if (!tenantId || !(await institutionExists(tenantId))) return null;

  const locationId = String(rawId || "").trim();
  if (locationId === `institution:${tenantId}`) {
    return {
      id: locationId,
      tenantId,
      type: "INSTITUTION",
      targetId: tenantId,
      name: tenantId,
      automatic: true,
      enabled: true
    };
  }

  const _id = oid(locationId);
  if (!_id) return null;
  return ragLocations.findOne({
    _id,
    tenantId,
    type: { $in: [...RAG_TYPES] },
    enabled: { $ne: false }
  });
}

app.get("/api/rag-locations/:id/documents", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG document management is not permitted" });

    const location = await resolveRagLocation(req, req.params.id);
    if (!location)
      return res.status(404).json({ error: "RAG Access Point not found" });

    const documents = await ragFiles.find(
      {
        tenantId: location.tenantId,
        "knowledgeScope.type": location.type,
        "knowledgeScope.targetId": String(location.targetId),
        enabled: { $ne: false },
        published: { $ne: false }
      },
      {
        projection: {
          text: 0
        }
      }
    ).sort({ filename: 1 }).toArray();

    res.json({ documents });
  } catch (e) {
    console.error("[RAG-LOCATION-DOCUMENTS]", e);
    res.status(500).json({ error: "Failed to retrieve RAG documents" });
  }
});

app.delete("/api/rag-locations/:id/documents/:fileId", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG document management is not permitted" });

    const location = await resolveRagLocation(req, req.params.id);
    if (!location)
      return res.status(404).json({ error: "RAG Access Point not found" });

    const document = await ragFiles.findOneAndUpdate(
      {
        file_id: String(req.params.fileId || ""),
        tenantId: location.tenantId,
        "knowledgeScope.type": location.type,
        "knowledgeScope.targetId": String(location.targetId)
      },
      {
        $set: {
          published: false,
          enabled: false,
          removedFromRagAt: new Date(),
          updatedAt: new Date()
        },
        $unset: { knowledgeScope: "" }
      },
      { returnDocument: "before" }
    );

    if (!document)
      return res.status(404).json({ error: "RAG document not found" });

    await audit("RAG_ACCESS_POINT_DOCUMENT_REMOVED", req, {
      safeDetails: {
        tenantId: location.tenantId,
        ragLocationId: String(location.id || location._id),
        fileId: document.file_id,
        filename: document.filename
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("[RAG-DOCUMENT-REMOVE]", e);
    res.status(400).json({
      error: e.message || "Failed to remove RAG document"
    });
  }
});

app.post(
  "/api/rag-locations/:id/documents",
  ragDocumentUpload.single("file"),
  async (req, res) => {
    let uploadedFile = null;
    let cleanupContext = null;

    try {
      if (!orgCanManage(req))
        return res.status(403).json({
          error: "RAG document management is not permitted"
        });

      const location = await resolveRagLocation(req, req.params.id);
      if (!location)
        return res.status(404).json({ error: "RAG Access Point not found" });

      if (!req.file)
        return res.status(400).json({ error: "Select a document to upload" });

      const filenameExtension = String(req.file.originalname || "")
        .toLowerCase()
        .match(/\.[a-z0-9]+$/)?.[0];
      const allowedMimeTypes = new Set([
        "application/pdf",
        "text/plain",
        "text/markdown"
      ]);
      const allowedExtensions = new Set([".pdf", ".txt", ".md", ".markdown"]);
      if (
        !allowedMimeTypes.has(String(req.file.mimetype || "").toLowerCase()) ||
        !allowedExtensions.has(filenameExtension)
      ) {
        return res.status(400).json({
          error: "Only PDF, plain-text, and Markdown documents are supported"
        });
      }

      const digest = crypto
        .createHash("sha256")
        .update(req.file.buffer)
        .digest("hex");
      const duplicate = await ragFiles.findOne(
        { tenantId: location.tenantId, digest },
        { projection: { filename: 1 } }
      );

      if (duplicate)
        return res.status(409).json({
          error: `This institution already contains the document “${duplicate.filename}”.`
        });

      const token = signRagToken(req.admin._id, location.tenantId);
      cleanupContext = {
        token,
        libreChatBase: String(
          process.env.LIBRECHAT_INTERNAL_URL || "http://api:3080"
        ).replace(/\/$/, ""),
        ragBase: String(
          process.env.RAG_API_URL || "http://rag_api:8000"
        ).replace(/\/$/, "")
      };
      const uploadBody = new FormData();
      const requestedFileId = crypto.randomUUID();
      const filename = String(req.file.originalname || "document")
        .replace(/[\r\n]/g, " ")
        .slice(0, 240);
      const blob = new Blob([req.file.buffer], {
        type: req.file.mimetype || "application/octet-stream"
      });

      uploadBody.set("endpoint", "AI Scholar Free Router");
      uploadBody.set("endpointType", "custom");
      uploadBody.set("file_id", requestedFileId);
      uploadBody.set("message_file", "true");
      uploadBody.set("file", blob, encodeURIComponent(filename));

      const uploadResponse = await fetch(`${cleanupContext.libreChatBase}/api/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: uploadBody,
        signal: AbortSignal.timeout(120000)
      });
      uploadedFile = await readUpstreamJson(
        uploadResponse,
        "LibreChat could not store the document"
      );

      const fileId = String(uploadedFile.file_id || "");
      if (!fileId)
        throw new Error("LibreChat did not return a document ID");

      const embeddingBody = new FormData();
      embeddingBody.set("file_id", fileId);
      embeddingBody.set("file", blob, encodeURIComponent(filename));

      const embeddingResponse = await fetch(`${cleanupContext.ragBase}/embed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: embeddingBody,
        signal: AbortSignal.timeout(120000)
      });
      const embedding = await readUpstreamJson(
        embeddingResponse,
        "The document could not be indexed"
      );

      if (embedding.status !== true)
        throw new Error("The document could not be indexed");

      const document = await ragFiles.findOneAndUpdate(
        {
          file_id: fileId,
          tenantId: location.tenantId,
          user: req.admin._id
        },
        {
          $set: {
            digest,
            embedded: true,
            enabled: true,
            published: true,
            knowledgeScope: {
              type: location.type,
              targetId: String(location.targetId)
            },
            updatedAt: new Date()
          },
          $unset: { expiresAt: "" }
        },
        { returnDocument: "after" }
      );

      if (!document)
        throw new Error("Stored document metadata could not be finalized");

      await audit("RAG_ACCESS_POINT_DOCUMENT_UPLOADED", req, {
        safeDetails: {
          tenantId: location.tenantId,
          ragLocationId: String(location.id || location._id),
          knowledgeScope: {
            type: location.type,
            targetId: String(location.targetId)
          },
          fileId,
          filename: document.filename,
          bytes: document.bytes
        }
      });

      res.status(201).json({ document });
    } catch (e) {
      console.error("[RAG-DOCUMENT-UPLOAD]", e);

      if (uploadedFile?.file_id && cleanupContext) {
        await Promise.allSettled([
          fetch(`${cleanupContext.ragBase}/documents`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${cleanupContext.token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify([uploadedFile.file_id]),
            signal: AbortSignal.timeout(15000)
          }),
          fetch(`${cleanupContext.libreChatBase}/api/files`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${cleanupContext.token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              files: [{
                file_id: uploadedFile.file_id,
                filepath: uploadedFile.filepath
              }]
            }),
            signal: AbortSignal.timeout(15000)
          })
        ]);
      }

      res.status(Number(e.statusCode) || 400).json({
        error: e.message || "Failed to upload RAG Access Point document"
      });
    }
  }
);

app.patch("/api/rag-files/:fileId/rag-groups", async (req, res) => {
  try {
    const fileId = String(req.params.fileId || "").trim();
    if (!fileId)
      return res.status(400).json({ error: "File ID is required" });

    const requestedIds = cleanIdList(req.body.ragGroupIds);

    const file = await ragFiles.findOne({ file_id: fileId });
    if (!file)
      return res.status(404).json({ error: "RAG document not found" });

    if (
      isInstitutionAdmin(req.admin) &&
      file.tenantId !== actorTenant(req)
    ) {
      return res.status(403).json({ error: "Cross-institution RAG access is not permitted" });
    }

    const objectIds = requestedIds.map(oid).filter(Boolean);

    if (objectIds.length !== requestedIds.length)
      return res.status(400).json({ error: "One or more RAG Group IDs are invalid" });

    const targetGroups = objectIds.length
      ? await ragGroups.find({
          _id: { $in: objectIds },
          tenantId: file.tenantId
        }).toArray()
      : [];

    if (targetGroups.length !== objectIds.length)
      return res.status(400).json({
        error: "One or more RAG Groups do not belong to this institution"
      });

    const existingIds = cleanIdList(file.ragGroupIds);

    const permissionIds = [...new Set([
      ...existingIds,
      ...requestedIds
    ])];

    if (!isOrgElevated(req)) {
      const permissionObjects = permissionIds.map(oid).filter(Boolean);

      const permissionGroups = permissionObjects.length
        ? await ragGroups.find({
            _id: { $in: permissionObjects },
            tenantId: file.tenantId
          }).toArray()
        : [];

      for (const ragGroup of permissionGroups) {
        if (!(await canManageRagDocuments(req, ragGroup))) {
          return res.status(403).json({
            error: "You do not have document-management permission for one or more RAG Groups"
          });
        }
      }
    }

    const result = await ragFiles.findOneAndUpdate(
      {
        _id: file._id,
        tenantId: file.tenantId
      },
      {
        $set: {
          ragGroupIds: requestedIds,
          updatedAt: new Date()
        }
      },
      {
        returnDocument: "after"
      }
    );

    await audit("RAG_FILE_GROUPS_UPDATED", req, {
      safeDetails: {
        tenantId: file.tenantId,
        fileId,
        previousRagGroupIds: existingIds,
        ragGroupIds: requestedIds
      }
    });

    res.json({ file: result });
  } catch (e) {
    console.error("[RAG-FILE-GROUPS]", e);
    res.status(400).json({
      error: e.message || "Failed to update RAG document assignment"
    });
  }
});

app.delete("/api/rag-groups/:id", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG Group administration is not permitted" });

    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "Invalid RAG Group ID" });

    const filter = isInstitutionAdmin(req.admin)
      ? { _id, tenantId: actorTenant(req) }
      : { _id };

    const current = await ragGroups.findOne(filter);
    if (!current)
      return res.status(404).json({ error: "RAG Group not found" });

    await ragGroupManagers.deleteMany({
      ragGroupId: current._id,
      tenantId: current.tenantId
    });

    await ragGroups.deleteOne({
      _id: current._id,
      tenantId: current.tenantId
    });

    // Deleted RAG policy must disappear from resolved scope immediately.

    await audit("RAG_GROUP_DELETED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        ragGroupId: current._id.toString()
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete RAG Group" });
  }
});


app.get("/api/rag-groups/:id/managers", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG Group administration is not permitted" });

    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "Invalid RAG Group ID" });

    const filter = isInstitutionAdmin(req.admin)
      ? { _id, tenantId: actorTenant(req) }
      : { _id };

    const ragGroup = await ragGroups.findOne(filter);
    if (!ragGroup)
      return res.status(404).json({ error: "RAG Group not found" });

    const managers = await ragGroupManagers.find({
      tenantId: ragGroup.tenantId,
      ragGroupId: ragGroup._id
    }).toArray();

    const userIds = managers
      .map(x => oid(x.userId))
      .filter(Boolean);

    const managerUsers = userIds.length
      ? await users.find(
          { _id: { $in: userIds }, tenantId: ragGroup.tenantId },
          { projection: { _id: 1, name: 1, username: 1, email: 1, role: 1 } }
        ).toArray()
      : [];

    const userMap = new Map(
      managerUsers.map(u => [String(u._id), u])
    );

    res.json({
      managers: managers.map(m => ({
        userId: String(m.userId),
        permissions: Array.isArray(m.permissions) ? m.permissions : [],
        user: userMap.get(String(m.userId)) || null
      }))
    });
  } catch (e) {
    console.error("[RAG-GROUP-MANAGERS-LIST]", e);
    res.status(500).json({ error: "Failed to retrieve RAG Group managers" });
  }
});

app.put("/api/rag-groups/:id/managers", async (req, res) => {
  try {
    if (!orgCanManage(req))
      return res.status(403).json({ error: "RAG Group administration is not permitted" });

    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "Invalid RAG Group ID" });

    const filter = isInstitutionAdmin(req.admin)
      ? { _id, tenantId: actorTenant(req) }
      : { _id };

    const ragGroup = await ragGroups.findOne(filter);
    if (!ragGroup)
      return res.status(404).json({ error: "RAG Group not found" });

    if (!Array.isArray(req.body.managers))
      return res.status(400).json({ error: "managers must be an array" });

    const requested = [];
    const seen = new Set();

    for (const item of req.body.managers) {
      const userId = String(item?.userId || "").trim();
      const userObjectId = oid(userId);

      if (!userObjectId)
        return res.status(400).json({ error: "Invalid manager user ID" });

      if (seen.has(userId)) continue;
      seen.add(userId);

      const user = await users.findOne(
        { _id: userObjectId, tenantId: ragGroup.tenantId },
        { projection: { _id: 1, role: 1 } }
      );

      if (!user)
        return res.status(404).json({ error: "One or more managers do not belong to this institution" });

      const role = String(user.role || "").toUpperCase();

      if (!["INSTRUCTOR", "INSTITUTION_ADMIN", "PLATFORM_ADMIN", "SUPERADMIN"].includes(role))
        return res.status(400).json({
          error: "RAG Managers must be Instructors or institution/platform administrators"
        });

      requested.push({
        tenantId: ragGroup.tenantId,
        ragGroupId: ragGroup._id,
        userId,
        permissions: Array.isArray(item?.permissions)
          ? [...new Set(item.permissions.map(x => String(x).trim().toUpperCase()).filter(Boolean))]
          : ["MANAGE_DOCUMENTS", "MANAGE_ACCESS"],
        updatedAt: new Date()
      });
    }

    await ragGroupManagers.deleteMany({
      tenantId: ragGroup.tenantId,
      ragGroupId: ragGroup._id
    });

    if (requested.length)
      await ragGroupManagers.insertMany(
        requested.map(x => ({
          ...x,
          createdAt: new Date()
        }))
      );

    await audit("RAG_GROUP_MANAGERS_UPDATED", req, {
      safeDetails: {
        tenantId: ragGroup.tenantId,
        ragGroupId: ragGroup._id.toString(),
        managerCount: requested.length
      }
    });

    res.json({
      ok: true,
      managers: requested.map(x => ({
        userId: x.userId,
        permissions: x.permissions
      }))
    });
  } catch (e) {
    console.error("[RAG-GROUP-MANAGERS-UPDATE]", e);
    res.status(400).json({
      error: e.message || "Failed to update RAG Group managers"
    });
  }
});

app.get("/api/rag-locations", async (req,res)=>{
  try{
    if(!orgCanManage(req))return res.status(403).json({error:"RAG location administration is not permitted"});
    const tenantId=await requireOrgTenant(req,res);if(!tenantId)return;
    const [institution,configured,personalUsers,documentCounts]=await Promise.all([
      institutions.findOne({_id:tenantId},{projection:{_id:1,name:1,status:1}}),
      ragLocations.find({tenantId, type:{$in:[...RAG_TYPES]}}).sort({type:1,name:1}).toArray(),
      users.find({tenantId,role:{$in:["USER","Instructor"]}},{projection:{_id:1,name:1,email:1,role:1}}).sort({name:1}).toArray(),
      ragFiles.aggregate([
        {$match:{tenantId,embedded:true,"knowledgeScope.type":{$exists:true}}},
        {$group:{
          _id:{type:"$knowledgeScope.type",targetId:"$knowledgeScope.targetId"},
          count:{$sum:1}
        }}
      ]).toArray()
    ]);
    const countMap=new Map(documentCounts.map(x=>[`${x._id.type}:${x._id.targetId}`,x.count]));
    const locations=[{id:`institution:${tenantId}`,type:"INSTITUTION",name:institution?.name||tenantId,targetId:tenantId,automatic:true,enabled:institution?.status!=="disabled"},...configured].map(x=>({...x,documentCount:countMap.get(`${x.type}:${x.targetId}`)||0}));
    for(const u of personalUsers) locations.push({id:`user:${u._id}`,type:"PERSONAL",name:`${u.name||u.email} — Personal`,targetId:u._id.toString(),userId:u._id.toString(),email:u.email,role:u.role,automatic:true,enabled:true});
    res.json({locations, configurableTypes:[...RAG_TYPES]});
  }catch(e){console.error("[RAG-LOCATIONS-LIST]",e);res.status(500).json({error:"Failed to retrieve RAG access points"});}
});

app.post("/api/rag-locations", async(req,res)=>{
  try{
    if(!orgCanManage(req))return res.status(403).json({error:"RAG location administration is not permitted"});
    const tenantId=await requireOrgTenant(req,res);if(!tenantId)return;
    const type=String(req.body.type||"").trim().toUpperCase();
    if(!RAG_TYPES.has(type))return res.status(400).json({error:"Only Department, Course, and Group RAG access points are administrator-configurable"});
    const targetId=String(req.body.targetId||"").trim();if(!targetId)return res.status(400).json({error:"targetId is required"});
    let target=null;
    if(type==="DEPARTMENT"){const _id=oid(targetId);if(!_id) return res.status(400).json({error:"Invalid department ID"});target=await departments.findOne({_id,tenantId});}
    if(type==="COURSE"){const _id=oid(targetId);if(!_id) return res.status(400).json({error:"Invalid course ID"});target=await courses.findOne({_id,tenantId});}
    if(type==="GROUP"){const _id=oid(targetId);if(!_id)return res.status(400).json({error:"Invalid group ID"});target=await groups.findOne({_id,tenantId},{projection:{_id:1,name:1}});}
    if(!target)return res.status(404).json({error:"RAG target was not found in this institution"});
    const name=String(req.body.name||target.name||target.email||target.code||targetId).trim().slice(0,200);
    const now=new Date();
    const doc={tenantId,type,targetId:String(target._id),name,description:String(req.body.description||"").trim().slice(0,1000),enabled:req.body.enabled!==false,automatic:false,createdAt:now,updatedAt:now};
    const result=await ragLocations.insertOne(doc);doc._id=result.insertedId;
    await audit("RAG_LOCATION_CREATED",req,{safeDetails:{tenantId,type,targetId:doc.targetId,ragLocationId:doc._id.toString()}});
    res.status(201).json({location:doc});
  }catch(e){if(e?.code===11000)return res.status(409).json({error:"A RAG access point already exists for this target"});res.status(400).json({error:e.message||"Failed to create RAG access point"});}
});

app.patch("/api/rag-locations/:id", async(req,res)=>{
  try{
    if(!orgCanManage(req))return res.status(403).json({error:"RAG location administration is not permitted"});
    const _id=oid(req.params.id);if(!_id)return res.status(400).json({error:"Invalid RAG location ID"});
    const tenantId=actorTenant(req);
    const filter=isInstitutionAdmin(req.admin)?{_id,tenantId}:{_id};
    const current=await ragLocations.findOne(filter);if(!current)return res.status(404).json({error:"RAG access point not found"});
    if(current.automatic)return res.status(400).json({error:"Automatic RAG access points cannot be modified"});
    const update={updatedAt:new Date()};
    if(req.body.name!==undefined){const n=cleanName(req.body.name,"RAG access point name");update.name=n;}
    if(req.body.description!==undefined)update.description=String(req.body.description||"").trim().slice(0,1000);
    if(req.body.enabled!==undefined)update.enabled=req.body.enabled===true;
    const result=await ragLocations.findOneAndUpdate({_id:current._id,tenantId:current.tenantId},{$set:update},{returnDocument:"after"});
    await audit("RAG_LOCATION_UPDATED",req,{safeDetails:{tenantId:current.tenantId,type:current.type,targetId:current.targetId,ragLocationId:current._id.toString()}});
    res.json({location:result});
  }catch(e){res.status(400).json({error:e.message||"Failed to update RAG access point"});}
});

app.delete("/api/rag-locations/:id", async(req,res)=>{
  try{
    if(!orgCanManage(req))return res.status(403).json({error:"RAG location administration is not permitted"});
    const _id=oid(req.params.id);if(!_id)return res.status(400).json({error:"Invalid RAG location ID"});
    const filter=isInstitutionAdmin(req.admin)?{_id,tenantId:actorTenant(req)}:{_id};
    const current=await ragLocations.findOne(filter);if(!current)return res.status(404).json({error:"RAG access point not found"});
    if(current.automatic)return res.status(400).json({error:"Automatic RAG access points cannot be deleted"});
    const [accessGroupCount,documentCount]=await Promise.all([
      ragGroups.countDocuments({tenantId:current.tenantId,ragLocationIds:String(current._id)}),
      ragFiles.countDocuments({
        tenantId:current.tenantId,
        "knowledgeScope.type":current.type,
        "knowledgeScope.targetId":String(current.targetId),
        enabled:{$ne:false},
        published:{$ne:false}
      })
    ]);
    if(accessGroupCount)return res.status(409).json({error:"Remove this access point from its RAG Access Groups before deleting it"});
    if(documentCount)return res.status(409).json({error:"Remove this access point's documents before deleting it"});
    await ragLocations.deleteOne({_id:current._id,tenantId:current.tenantId});
    await audit("RAG_LOCATION_DELETED",req,{safeDetails:{tenantId:current.tenantId,type:current.type,targetId:current.targetId,ragLocationId:current._id.toString()}});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"Failed to delete RAG access point"});}
});



/* ============================================================
 * ACADEMIC AGENT FRAMEWORK
 * ============================================================ */

app.get("/api/academic-agents", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Academic Agent administration is not permitted"
      });

    const tenantId = await resolveAcademicTenant(
      req,
      req.query.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const created = await ensureCoreAcademicAgents(tenantId);
    if (created) {
      await audit("ACADEMIC_AGENTS_AUTO_PROVISIONED", req, {
        safeDetails: { tenantId, created }
      });
    }

    const agents = await academicAgents
      .find({ tenantId })
      .sort({ name: 1 })
      .toArray();

    res.json({ agents, tenantId });
  } catch (e) {
    console.error("[ACADEMIC-AGENTS-LIST]", e);
    res.status(500).json({
      error: "Failed to retrieve Academic Agents"
    });
  }
});


async function ensureCoreAcademicAgents(tenantId) {
    const now = new Date();

    const integrityPolicyId = "SCHOLARLY_INTEGRITY_CORE";

    await academicIntegrityPolicies.updateOne(
      {
        tenantId,
        policyId: integrityPolicyId,
        version: 1
      },
      {
        $setOnInsert: {
          tenantId,
          policyId: integrityPolicyId,
          version: 1,
          enabled: true,

          principle:
            "AI should reduce the mechanical burden of scholarship without removing the intellectual responsibility of the scholar.",

          taskClasses: [
            "LEARN_EXPLAIN",
            "SEARCH_RETRIEVE",
            "EVIDENCE_SYNTHESIS",
            "SCHOLARLY_AUTHORSHIP",
            "ASSESSMENT_ASSISTANCE",
            "DATA_ANALYSIS",
            "RESEARCH_DESIGN",
            "CITATION_VERIFICATION",
            "FABRICATION_REQUEST"
          ],

          scaffoldStrategies: [
            "DIRECT_ASSIST",
            "SOCRATIC",
            "REQUIRE_ATTEMPT",
            "EVIDENCE_FIRST",
            "REQUIRE_RESEARCHER_DECISION",
            "CRITIQUE_NOT_AUTHOR",
            "REFUSE_FABRICATION"
          ],

          provenanceTypes: [
            "VERIFIED_SOURCE",
            "USER_PROVIDED",
            "RAG_SOURCE",
            "TOOL_RESULT",
            "CALCULATION",
            "MODEL_INFERENCE",
            "UNVERIFIED"
          ],

          rules: {
            prohibitFabricatedCitations: true,
            prohibitFabricatedData: true,
            prohibitFabricatedResults: true,
            prohibitFalseSourceInspectionClaims: true,
            distinguishEvidenceFromInference: true,
            preserveContradictoryEvidence: true,
            requireGapSearchScopeCaveat: true,
            requireHumanScholarlyJudgment: true
          },

          updatedAt: now,
          createdAt: now
        }
      },
      {
        upsert: true
      }
    );

    const defaults = [
      {
        tenantId,
        agentId: "K12_SOCRATIC_TUTOR",
        agentType: "MODE",
        name: "K-12 Socratic Tutor",
        description:
          "Age-appropriate Socratic tutoring for primary and secondary school learners.",
        modelSpecName: "K-12 Socratic Tutor",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR"],
        audiences: [
          "SCHOOL_STUDENT",
          "SCHOOL_TEACHER"
        ],
        integrityPolicyId,
        tools: [],
        mcpServers: [],
        workflow: {
          type: "PEDAGOGICAL_MODE",
          steps: [
            "Diagnose the learner's current understanding",
            "Adapt language and difficulty to learner level",
            "Use progressive Socratic scaffolding",
            "Protect learner safety and privacy",
            "Verify understanding through active retrieval"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "ECONOMY"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "NOVICE",
            "DEVELOPING"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "NONE",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "SOCRATIC",
          diagnoseFirst: true,
          activeRetrieval: true,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: true,
          strategy:
            "Use short age-appropriate steps, protect learner safety and privacy, encourage independent reasoning, and escalate sensitive matters to a trusted adult."
        },
        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "SOCRATIC_TUTOR",
        agentType: "MODE",
        name: "Undergraduate Socratic Tutor",
        description:
          "Adaptive higher-education tutor using guided discovery, misconception repair and active retrieval.",
        modelSpecName: "Undergrad Socratic Tutor",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR"],
        audiences: ["UNDERGRADUATE"],
        integrityPolicyId,
        tools: [],
        mcpServers: [],
        workflow: {
          type: "PEDAGOGICAL_MODE",
          steps: [
            "Diagnose current understanding",
            "Use progressive scaffolding",
            "Verify learning through active retrieval"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "BALANCED"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "NOVICE",
            "DEVELOPING"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "NONE",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "SOCRATIC",
          diagnoseFirst: true,
          activeRetrieval: true,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: true,
          strategy:
            "Diagnose current understanding first. Use minimum necessary assistance. Move from prompt to hint to explanation only as needed. Verify learning with active retrieval."
        },
        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "RESEARCH_SYNTHESIZER",
        agentType: "MODE",
        name: "Research Synthesizer",
        description:
          "Advanced research mode for literature synthesis, scholarly reasoning and research-method support.",
        modelSpecName: "PhD & Post-Doc Research",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR", "INSTITUTION_ADMIN"],
        audiences: [
          "COLLEGE_FACULTY",
          "RESEARCHER",
          "UNDERGRADUATE"
        ],
        integrityPolicyId,
        tools: [],
        mcpServers: [],
        workflow: {
          type: "PEDAGOGICAL_MODE",
          steps: [
            "Clarify the research question",
            "Distinguish evidence from inference",
            "Expose uncertainty",
            "Compare competing explanations"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "ADVANCED"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "DEVELOPING",
            "INDEPENDENT",
            "ADVANCED"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "NONE",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "RESEARCH",
          diagnoseFirst: true,
          activeRetrieval: false,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: false,
          strategy:
            "Clarify the research question, distinguish evidence from inference, expose uncertainty, compare competing explanations and preserve scholarly rigor."
        },
        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "SEMANTIC_SCHOLAR_SEARCH",
        agentType: "AGENT",
        name: "Semantic Scholar Search",
        description:
          "Searches and inspects real scholarly papers using the Academic Research MCP and Semantic Scholar.",
        modelSpecName: "PhD & Post-Doc Research",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR", "INSTITUTION_ADMIN"],
        audiences: [
          "COLLEGE_FACULTY",
          "RESEARCHER",
          "UNDERGRADUATE"
        ],
        integrityPolicyId,
        tools: [
          "search_papers",
          "get_paper",
          "get_author",
          "get_citations"
        ],
        mcpServers: [
          "academic-research"
        ],
        workflow: {
          type: "TOOL_WORKFLOW",
          steps: [
            "Clarify the search question",
            "Construct an explicit literature search",
            "Retrieve real paper records",
            "Inspect relevant papers",
            "Return verifiable sources and search limitations"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "BALANCED"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "DEVELOPING",
            "INDEPENDENT",
            "ADVANCED"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "NONE",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "RESEARCH",
          diagnoseFirst: true,
          activeRetrieval: false,
          adaptiveDifficulty: true,
          misconceptionRepair: false,
          masteryTracking: false,
          strategy:
            "Search transparently. Never invent references. Separate retrieved evidence from model interpretation and state the limits of the search."
        },
        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "LITERATURE_REVIEW",
        agentType: "AGENT",
        name: "Literature Review Agent",
        description:
          "Builds a source-grounded thematic literature synthesis from explicitly retrieved scholarly evidence.",
        modelSpecName: "PhD & Post-Doc Research",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR", "INSTITUTION_ADMIN"],
        audiences: [
          "COLLEGE_FACULTY",
          "RESEARCHER",
          "UNDERGRADUATE"
        ],
        integrityPolicyId,
        tools: [
          "search_papers",
          "get_paper",
          "get_author",
          "get_citations"
        ],
        mcpServers: [
          "academic-research"
        ],
        workflow: {
          type: "EVIDENCE_SYNTHESIS",
          steps: [
            "Clarify research question and scope",
            "Search the scholarly literature",
            "Retrieve and inspect relevant records",
            "Deduplicate the evidence set",
            "Group evidence into themes",
            "Compare methods, datasets and findings",
            "Preserve contradictory evidence",
            "Produce a source-grounded synthesis",
            "Report search limitations"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "ADVANCED"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "DEVELOPING",
            "INDEPENDENT",
            "ADVANCED"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "NONE",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "RESEARCH",
          diagnoseFirst: true,
          activeRetrieval: false,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: false,
          strategy:
            "Require evidence before synthesis. Preserve contradictory findings. Distinguish verified evidence, inference and uncertainty. Do not fabricate citations."
        },
        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "RESEARCH_GAP_FINDER",
        agentType: "AGENT",
        name: "Research Gap Finder",
        description:
          "Identifies candidate research gaps from an explicit evidence set without presenting search absence as proof of literature absence.",
        modelSpecName: "PhD & Post-Doc Research",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR", "INSTITUTION_ADMIN"],
        audiences: [
          "COLLEGE_FACULTY",
          "RESEARCHER",
          "UNDERGRADUATE"
        ],
        integrityPolicyId,
        tools: [
          "search_papers",
          "get_paper",
          "get_citations"
        ],
        mcpServers: [
          "academic-research"
        ],
        workflow: {
          type: "RESEARCH_GAP_ANALYSIS",
          steps: [
            "Define the research domain and question",
            "Build an explicit evidence set",
            "Compare questions, methods, datasets and populations",
            "Compare findings and limitations",
            "Identify contradictions and underexplored areas",
            "Generate candidate gaps",
            "Rate confidence",
            "State search scope and limitations",
            "Require researcher judgment before treating a candidate gap as a research claim"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "ADVANCED"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "DEVELOPING",
            "INDEPENDENT",
            "ADVANCED"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "NONE",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "RESEARCH",
          diagnoseFirst: true,
          activeRetrieval: false,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: false,
          strategy:
            "Treat gaps as evidence-based candidates, not declarations. Never equate absence from the retrieved search set with absence from the entire literature."
        },
        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "EDUCATION_CAREER_PATHWAYS",
        agentType: "AGENT",
        name: "Education & Career Pathways",
        description:
          "Open-minded education and career exploration for school students and families, grounded in the learner's interests, developing skills, practical circumstances and regional opportunities.",
        modelSpecName: "K-12 Socratic Tutor",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR"],
        audiences: [
          "SCHOOL_STUDENT",
          "SCHOOL_TEACHER"
        ],
        integrityPolicyId,

        tools: [],
        mcpServers: [],

        workflow: {
          type: "LOCATION_AWARE_GUIDANCE",
          steps: [
            "Understand the learner's interests, curiosity, motivations and demonstrated skills",
            "Ask reflective questions before narrowing possible pathways",
            "Distinguish subjects the learner enjoys from subjects they are simply good at",
            "Explore values, preferred work styles and activities that sustain the learner's interest",
            "Identify external expectations or assumptions that may be influencing the decision",
            "Resolve only the minimum useful geographic context",
            "Explore multiple meaningfully different education and career pathways",
            "Consider economic and geographic constraints without suppressing aspiration",
            "Investigate affordable, scholarship-supported and alternative access routes",
            "Compare local, regional, relocation and remote possibilities where relevant",
            "Use current verified information for changing facts",
            "Identify uncertainties and information the student or family should verify",
            "Support parent-student dialogue without taking sides",
            "Leave the final decision with the learner and family"
          ]
        },

        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "ECONOMY"
        },

        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "NOVICE",
            "DEVELOPING"
          ]
        },

        visibility: "INSTITUTION",

        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "CONTEXTUAL_HIERARCHY"
        },

        locationPolicy: {
          required: true,
          precision: "REGIONAL",
          allowExactAddress: false,
          preferredSources: [
            "ACTIVE_SCHOOL_CONTEXT",
            "USER_DECLARED_LOCATION",
            "INSTITUTION_REGION"
          ]
        },

        contextPolicy: {
          profileCollection: "learnerGuidanceProfiles",
          persistUserDeclaredContext: true,
          userCorrectable: true,
          distinguishDeclaredFromInferred: true,

          profileSections: [
            "EDUCATION_STAGE",
            "INTERESTS",
            "DEMONSTRATED_SKILLS",
            "MOTIVATIONS",
            "VALUES",
            "WORK_STYLE",
            "LANGUAGE_PREFERENCES",
            "AFFORDABILITY",
            "FINANCIAL_AID_IMPORTANCE",
            "GEOGRAPHIC_CONSTRAINTS",
            "RELOCATION_PREFERENCE",
            "TRAVEL_RADIUS",
            "FAMILY_RESPONSIBILITIES"
          ],

          economicConstraintRule:
            "Use economic constraints to search for feasible access routes, scholarships and alternatives; never use them to lower the learner's assumed potential.",

          geographicConstraintRule:
            "Use geography to organize realistic access options; do not hide broader possibilities merely because they require travel or relocation."
        },

        guidancePolicy: {
          explorationBeforeRecommendation: true,
          expandOptionsBeforeNarrowing: true,
          askCriticalQuestions: true,
          challengeUnexaminedAssumptions: true,

          prohibitPrescriptiveCareerSteering: true,
          prohibitSinglePathOptimization: true,
          prohibitDeterministicAptitudeClaims: true,
          prohibitSocioeconomicStereotyping: true,

          exploreInterests: true,
          exploreDemonstratedSkills: true,
          exploreMotivationAndPassion: true,
          exploreValuesAndPreferredWorkStyle: true,

          requireMultipleMeaningfullyDifferentPathways: true,
          requireAlternativePlans: true,
          distinguishPossibilityFromRecommendation: true,

          considerAffordability: true,
          considerGeographicAccess: true,
          searchForAccessSolutionsBeforeEliminatingPath: true,

          encourageStudentAgency: true,
          supportParentStudentDialogue: true,

          prohibitAdmissionGuarantees: true,
          prohibitEmploymentGuarantees: true,

          identifyMissingInformation: true,
          recommendVerificationSteps: true,

          requireCurrentDataForAdmissions: true,
          requireCurrentDataForScholarships: true,
          requireCurrentDataForInstitutionAvailability: true,
          distinguishFactsFromGuidance: true
        },

        pedagogy: {
          mode: "EXPLAINER",
          diagnoseFirst: true,
          activeRetrieval: true,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: false,
          strategy:
            "Explore rather than prescribe. Sense the learner's interests, developing skills, curiosity, motivation and values through thoughtful questions. Open the learner's eyes to unfamiliar possibilities, examine practical constraints without allowing those constraints to define the learner's potential, compare multiple realistic pathways using current information, and preserve learner ownership of major education and career decisions."
        },

        createdAt: now,
        updatedAt: now
      },

      {
        tenantId,
        agentId: "COURSE_KNOWLEDGE",
        agentType: "AGENT",
        name: "Course Knowledge Agent",
        description:
          "Provides guided learning from authorized course or class knowledge while preserving group and institution RAG boundaries.",
        modelSpecName: "Undergrad Socratic Tutor",
        enabled: true,
        allowedRoles: ["USER", "INSTRUCTOR"],
        audiences: [
          "COLLEGE_FACULTY",
          "UNDERGRADUATE",
          "SCHOOL_TEACHER",
          "SCHOOL_STUDENT"
        ],
        integrityPolicyId,
        tools: [],
        mcpServers: [],
        workflow: {
          type: "AUTHORIZED_RAG_LEARNING",
          steps: [
            "Resolve the user's authorized course or class scope",
            "Retrieve only permitted course knowledge",
            "Explain using an appropriate academic mode",
            "Use progressive scaffolding for assessed learning",
            "Identify when the requested answer is outside the approved knowledge scope"
          ]
        },
        modelPolicy: {
          mode: "PERSONA_ROUTE",
          costTier: "BALANCED"
        },
        researchMaturityPolicy: {
          adaptive: true,
          allowedLevels: [
            "NOVICE",
            "DEVELOPING"
          ]
        },
        visibility: "INSTITUTION",
        ragPolicy: {
          personalRag: "INHERIT_USER_ACCESS",
          sharedScopeMode: "CONTEXTUAL_HIERARCHY",
          ragGroupIds: []
        },
        pedagogy: {
          mode: "SOCRATIC",
          diagnoseFirst: true,
          activeRetrieval: true,
          adaptiveDifficulty: true,
          misconceptionRepair: true,
          masteryTracking: true,
          strategy:
            "Use only authorized course knowledge. Prefer explanation, questioning and progressive hints over completing assessed work for the learner."
        },
        createdAt: now,
        updatedAt: now
      }
    ];

    let created = 0;

    for (const doc of defaults) {
      const result = await academicAgents.updateOne(
        {
          tenantId,
          agentId: doc.agentId
        },
        {
          $setOnInsert: {
            ...doc
          }
        },
        {
          upsert: true
        }
      );

      if (result.upsertedCount) created++;
    }

    return created;
}

app.post("/api/academic-agents/bootstrap", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Academic Agent administration is not permitted"
      });

    const tenantId = await resolveAcademicTenant(req, req.body.tenantId);
    if (!tenantId)
      return res.status(400).json({ error: "A valid institution is required" });

    const created = await ensureCoreAcademicAgents(tenantId);
    if (created) {
      await audit("ACADEMIC_AGENTS_AUTO_PROVISIONED", req, {
        safeDetails: { tenantId, created }
      });
    }

    res.json({ ok: true, created });
  } catch (e) {
    console.error("[ACADEMIC-AGENTS-BOOTSTRAP]", e);
    res.status(400).json({
      error: e.message || "Failed to bootstrap Academic Agents"
    });
  }
});


app.post("/api/academic-agents", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Academic Agent administration is not permitted"
      });

    const tenantId = await resolveAcademicTenant(
      req,
      req.body.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const agentId = cleanPolicyKey(
      req.body.agentId,
      "Agent ID"
    ).toUpperCase();

    const name = String(req.body.name || "")
      .trim()
      .slice(0, 200);

    const modelSpecName = String(
      req.body.modelSpecName || ""
    ).trim().slice(0, 200);

    if (!name || !modelSpecName)
      return res.status(400).json({
        error: "Agent name and modelSpecName are required"
      });

    const now = new Date();

    const doc = {
      tenantId,
      agentId,
      name,
      description: String(req.body.description || "")
        .trim()
        .slice(0, 2000),
      modelSpecName,
      agentType: normalizeAcademicAgentType(req.body.agentType),
      enabled: req.body.enabled !== false,
      allowedRoles: cleanStringList(req.body.allowedRoles)
        .map(x => x.toUpperCase()),
      audiences: normalizeAcademicAudiences(req.body.audiences),
      integrityPolicyId: cleanPolicyKey(
        req.body.integrityPolicyId || "SCHOLARLY_INTEGRITY_CORE",
        "Integrity policy ID"
      ).toUpperCase(),
      tools: normalizeAcademicTools(req.body.tools),
      mcpServers: normalizeAcademicMcpServers(req.body.mcpServers),
      workflow: normalizeAcademicWorkflow(req.body.workflow),
      modelPolicy: normalizeAcademicModelPolicy(req.body.modelPolicy),
      researchMaturityPolicy:
        normalizeResearchMaturityPolicy(
          req.body.researchMaturityPolicy
        ),
      visibility: normalizeAcademicVisibility(req.body.visibility),
      ragPolicy: normalizeAcademicRagPolicy(req.body.ragPolicy),
      pedagogy: normalizePedagogy(req.body.pedagogy),
      createdAt: now,
      updatedAt: now
    };

    const result = await academicAgents.insertOne(doc);
    doc._id = result.insertedId;

    await audit("ACADEMIC_AGENT_CREATED", req, {
      safeDetails: {
        tenantId,
        agentId,
        modelSpecName
      }
    });

    res.status(201).json({ agent: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({
        error: "This Academic Agent ID already exists for the institution"
      });

    res.status(400).json({
      error: e.message || "Failed to create Academic Agent"
    });
  }
});


app.patch("/api/academic-agents/:id", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Academic Agent administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);

    const filter = isInstitutionAdmin(req.admin)
      ? { _id, tenantId: actorTenant(req) }
      : { _id };

    const current = await academicAgents.findOne(filter);

    if (!current)
      return res.status(404).json({
        error: "Academic Agent not found"
      });

    const update = {
      updatedAt: new Date()
    };

    if (req.body.name !== undefined)
      update.name = String(req.body.name || "")
        .trim().slice(0, 200);

    if (req.body.description !== undefined)
      update.description = String(req.body.description || "")
        .trim().slice(0, 2000);

    if (req.body.modelSpecName !== undefined)
      update.modelSpecName = String(req.body.modelSpecName || "")
        .trim().slice(0, 200);

    if (req.body.enabled !== undefined)
      update.enabled = req.body.enabled === true;

    if (req.body.allowedRoles !== undefined)
      update.allowedRoles = cleanStringList(
        req.body.allowedRoles
      ).map(x => x.toUpperCase());

    if (req.body.agentType !== undefined)
      update.agentType =
        normalizeAcademicAgentType(req.body.agentType);

    if (req.body.audiences !== undefined)
      update.audiences =
        normalizeAcademicAudiences(req.body.audiences);

    if (req.body.integrityPolicyId !== undefined)
      update.integrityPolicyId = cleanPolicyKey(
        req.body.integrityPolicyId,
        "Integrity policy ID"
      ).toUpperCase();

    if (req.body.tools !== undefined)
      update.tools =
        normalizeAcademicTools(req.body.tools);

    if (req.body.mcpServers !== undefined)
      update.mcpServers =
        normalizeAcademicMcpServers(req.body.mcpServers);

    if (req.body.workflow !== undefined)
      update.workflow =
        normalizeAcademicWorkflow(req.body.workflow);

    if (req.body.modelPolicy !== undefined)
      update.modelPolicy =
        normalizeAcademicModelPolicy(req.body.modelPolicy);

    if (req.body.researchMaturityPolicy !== undefined)
      update.researchMaturityPolicy =
        normalizeResearchMaturityPolicy(
          req.body.researchMaturityPolicy
        );

    if (req.body.visibility !== undefined)
      update.visibility =
        normalizeAcademicVisibility(req.body.visibility);

    if (req.body.ragPolicy !== undefined)
      update.ragPolicy = normalizeAcademicRagPolicy(
        req.body.ragPolicy
      );

    if (req.body.pedagogy !== undefined)
      update.pedagogy = normalizePedagogy(
        req.body.pedagogy
      );

    const agent = await academicAgents.findOneAndUpdate(
      { _id: current._id, tenantId: current.tenantId },
      { $set: update },
      { returnDocument: "after" }
    );

    await audit("ACADEMIC_AGENT_UPDATED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        agentId: current.agentId
      }
    });

    res.json({ agent });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update Academic Agent"
    });
  }
});


app.delete("/api/academic-agents/:id", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Academic Agent administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);

    const filter = isInstitutionAdmin(req.admin)
      ? { _id, tenantId: actorTenant(req) }
      : { _id };

    const current = await academicAgents.findOne(filter);

    if (!current)
      return res.status(404).json({
        error: "Academic Agent not found"
      });

    if (CORE_ACADEMIC_AGENT_IDS.has(String(current.agentId || "")))
      return res.status(409).json({
        error: "Core Academic Agents may be edited or disabled, but not deleted"
      });

    await academicAgents.deleteOne({
      _id: current._id,
      tenantId: current.tenantId
    });

    await audit("ACADEMIC_AGENT_DELETED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        agentId: current.agentId
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to delete Academic Agent"
    });
  }
});


app.get("/api/learner-states/:userId", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Learner-state administration is not permitted"
      });

    const userObjectId = new ObjectId(req.params.userId);

    const user = await users.findOne(
      isInstitutionAdmin(req.admin)
        ? {
            _id: userObjectId,
            tenantId: actorTenant(req)
          }
        : { _id: userObjectId },
      {
        projection: {
          _id: 1,
          tenantId: 1,
          name: 1,
          email: 1,
          role: 1
        }
      }
    );

    if (!user)
      return res.status(404).json({
        error: "User not found"
      });

    const state = await learnerStates.findOne({
      tenantId: user.tenantId,
      userId: String(user._id)
    });

    res.json({
      user,
      state: state || null
    });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to retrieve learner state"
    });
  }
});


app.put("/api/learner-states/:userId", async (req, res) => {
  try {
    if (!canManageAcademicAgents(req))
      return res.status(403).json({
        error: "Learner-state administration is not permitted"
      });

    const userObjectId = new ObjectId(req.params.userId);

    const user = await users.findOne(
      isInstitutionAdmin(req.admin)
        ? {
            _id: userObjectId,
            tenantId: actorTenant(req)
          }
        : { _id: userObjectId },
      {
        projection: {
          _id: 1,
          tenantId: 1
        }
      }
    );

    if (!user)
      return res.status(404).json({
        error: "User not found"
      });

    const now = new Date();

    const stateSet = {
      tenantId: user.tenantId,
      userId: String(user._id),
      updatedAt: now
    };

    if (req.body.currentObjective !== undefined)
      stateSet.currentObjective = String(
        req.body.currentObjective || ""
      ).trim().slice(0, 1000);

    if (req.body.preferredLanguage !== undefined)
      stateSet.preferredLanguage = String(
        req.body.preferredLanguage || ""
      ).trim().slice(0, 100);

    if (req.body.masteryLevel !== undefined)
      stateSet.masteryLevel = String(
        req.body.masteryLevel || "UNKNOWN"
      ).trim().toUpperCase().slice(0, 50);

    if (req.body.supportLevel !== undefined)
      stateSet.supportLevel = String(
        req.body.supportLevel || "ADAPTIVE"
      ).trim().toUpperCase().slice(0, 50);

    if (req.body.notes !== undefined)
      stateSet.notes = String(
        req.body.notes || ""
      ).trim().slice(0, 2000);

    const state = await learnerStates.findOneAndUpdate(
      {
        tenantId: user.tenantId,
        userId: String(user._id)
      },
      {
        $set: stateSet,
        $setOnInsert: {
          createdAt: now,
          currentObjective: "",
          preferredLanguage: "",
          masteryLevel: "UNKNOWN",
          supportLevel: "ADAPTIVE"
        }
      },
      {
        upsert: true,
        returnDocument: "after"
      }
    );

    await audit("LEARNER_STATE_UPDATED", req, {
      safeDetails: {
        tenantId: user.tenantId,
        userId: String(user._id)
      }
    });

    res.json({ state });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update learner state"
    });
  }
});


/* ============================================================
 * AI PROVIDERS / MODELS / ENTITLEMENT POLICY
 * ============================================================ */


/* ============================================================================
 * PERSONA MODEL ROUTING
 *
 * These routes define preferred runtime routing only.
 * They MUST NOT grant model access. Authorization remains controlled by
 * modelEntitlements.
 * ========================================================================== */

app.get("/api/persona-model-routes", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona model routing administration is not permitted"
      });

    const tenantId = await resolvePolicyTenant(
      req,
      req.query.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const routes = await personaModelRoutes
      .find({ tenantId })
      .sort({
        personaId: 1,
        priority: -1,
        routeId: 1
      })
      .toArray();

    res.json({ routes });
  } catch (e) {
    console.error("[PERSONA-MODEL-ROUTES-GET]", e);
    res.status(500).json({
      error: "Failed to retrieve persona model routes"
    });
  }
});


app.post("/api/persona-model-routes", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona model routing administration is not permitted"
      });

    const tenantId = await resolvePolicyTenant(
      req,
      req.body.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const personaId = cleanPolicyKey(
      req.body.personaId,
      "Persona ID"
    ).toUpperCase();

    const routeId = cleanPolicyKey(
      req.body.routeId,
      "Route ID"
    ).toUpperCase();

    const modelSpecName = String(
      req.body.modelSpecName || ""
    ).trim().slice(0, 200);

    const providerKey = cleanPolicyKey(
      req.body.providerKey,
      "Provider key"
    );

    const model = String(
      req.body.model || ""
    ).trim().slice(0, 200);

    if (!modelSpecName || !model)
      return res.status(400).json({
        error: "modelSpecName and model are required"
      });

    const provider = await aiProviders.findOne({
      key: providerKey,
      enabled: true
    });

    if (!provider)
      return res.status(404).json({
        error: "Enabled AI provider not found"
      });

    const modelDoc = await aiModels.findOne({
      providerKey,
      model,
      enabled: true
    });

    if (!modelDoc)
      return res.status(404).json({
        error: "Enabled AI model not found"
      });

    const now = new Date();

    const doc = {
      tenantId,
      personaId,
      routeId,
      modelSpecName,
      providerKey,
      model,
      priority:
        Number.isFinite(Number(req.body.priority))
          ? Number(req.body.priority)
          : 0,
      enabled: req.body.enabled !== false,
      description: String(req.body.description || "")
        .trim()
        .slice(0, 1000),
      createdAt: now,
      updatedAt: now
    };

    const result = await personaModelRoutes.insertOne(doc);
    doc._id = result.insertedId;

    await audit("PERSONA_MODEL_ROUTE_CREATED", req, {
      safeDetails: {
        tenantId,
        personaId,
        routeId,
        modelSpecName,
        providerKey,
        model
      }
    });

    res.status(201).json({ route: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({
        error: "This persona route ID already exists for the institution"
      });

    res.status(400).json({
      error: e.message || "Failed to create persona model route"
    });
  }
});


app.patch("/api/persona-model-routes/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona model routing administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);
    const current = await personaModelRoutes.findOne({ _id });

    if (!current)
      return res.status(404).json({
        error: "Persona model route not found"
      });

    const update = {
      updatedAt: new Date()
    };

    if (req.body.modelSpecName !== undefined)
      update.modelSpecName = String(
        req.body.modelSpecName || ""
      ).trim().slice(0, 200);

    if (req.body.providerKey !== undefined) {
      const providerKey = cleanPolicyKey(
        req.body.providerKey,
        "Provider key"
      );

      const provider = await aiProviders.findOne({
        key: providerKey,
        enabled: true
      });

      if (!provider)
        return res.status(404).json({
          error: "Enabled AI provider not found"
        });

      update.providerKey = providerKey;
    }

    if (req.body.model !== undefined)
      update.model = String(req.body.model || "")
        .trim()
        .slice(0, 200);

    if (
      req.body.providerKey !== undefined ||
      req.body.model !== undefined
    ) {
      const providerKey =
        update.providerKey || current.providerKey;
      const model =
        update.model || current.model;

      const modelDoc = await aiModels.findOne({
        providerKey,
        model,
        enabled: true
      });

      if (!modelDoc)
        return res.status(404).json({
          error: "Enabled AI model not found"
        });
    }

    if (req.body.priority !== undefined) {
      const n = Number(req.body.priority);
      if (!Number.isFinite(n))
        return res.status(400).json({
          error: "priority must be numeric"
        });
      update.priority = n;
    }

    if (req.body.enabled !== undefined)
      update.enabled = req.body.enabled === true;

    if (req.body.description !== undefined)
      update.description = String(
        req.body.description || ""
      ).trim().slice(0, 1000);

    const route = await personaModelRoutes.findOneAndUpdate(
      { _id },
      { $set: update },
      { returnDocument: "after" }
    );

    await audit("PERSONA_MODEL_ROUTE_UPDATED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        personaId: current.personaId,
        routeId: current.routeId
      }
    });

    res.json({ route });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update persona model route"
    });
  }
});


app.delete("/api/persona-model-routes/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona model routing administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);
    const current = await personaModelRoutes.findOne({ _id });

    if (!current)
      return res.status(404).json({
        error: "Persona model route not found"
      });

    await personaModelRoutes.deleteOne({ _id });

    await audit("PERSONA_MODEL_ROUTE_DELETED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        personaId: current.personaId,
        routeId: current.routeId
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to delete persona model route"
    });
  }
});


/* ============================================================================
 * PERSONA PROMPT POLICIES
 *
 * Prompt content is versioned. Creating a new version never overwrites an
 * existing version.
 * ========================================================================== */

app.get("/api/persona-prompt-policies", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona prompt policy administration is not permitted"
      });

    const tenantId = await resolvePolicyTenant(
      req,
      req.query.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const policies = await personaPromptPolicies
      .find({ tenantId })
      .sort({
        personaId: 1,
        version: -1
      })
      .toArray();

    res.json({ policies });
  } catch (e) {
    console.error("[PERSONA-PROMPT-POLICIES-GET]", e);
    res.status(500).json({
      error: "Failed to retrieve persona prompt policies"
    });
  }
});


app.post("/api/persona-prompt-policies", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona prompt policy administration is not permitted"
      });

    const tenantId = await resolvePolicyTenant(
      req,
      req.body.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const personaId = cleanPolicyKey(
      req.body.personaId,
      "Persona ID"
    ).toUpperCase();

    const modelSpecName = String(
      req.body.modelSpecName || ""
    ).trim().slice(0, 200);

    const prompt = String(
      req.body.prompt || ""
    ).trim();

    if (!modelSpecName || !prompt)
      return res.status(400).json({
        error: "modelSpecName and prompt are required"
      });

    if (prompt.length > 50000)
      return res.status(400).json({
        error: "Prompt policy exceeds 50000 characters"
      });

    const latest = await personaPromptPolicies
      .find({
        tenantId,
        personaId
      })
      .sort({ version: -1 })
      .limit(1)
      .toArray();

    const version =
      latest.length &&
      Number.isFinite(Number(latest[0].version))
        ? Number(latest[0].version) + 1
        : 1;

    const now = new Date();
    const enabled = req.body.enabled !== false;

    if (enabled) {
      await personaPromptPolicies.updateMany(
        {
          tenantId,
          personaId,
          enabled: true
        },
        {
          $set: {
            enabled: false,
            updatedAt: now
          }
        }
      );
    }

    const doc = {
      tenantId,
      personaId,
      modelSpecName,
      version,
      prompt,
      enabled,
      notes: String(req.body.notes || "")
        .trim()
        .slice(0, 2000),
      createdAt: now,
      updatedAt: now
    };

    const result = await personaPromptPolicies.insertOne(doc);
    doc._id = result.insertedId;

    await audit("PERSONA_PROMPT_POLICY_CREATED", req, {
      safeDetails: {
        tenantId,
        personaId,
        modelSpecName,
        version,
        enabled
      }
    });

    res.status(201).json({ policy: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({
        error: "This prompt-policy version already exists"
      });

    res.status(400).json({
      error: e.message || "Failed to create persona prompt policy"
    });
  }
});


app.patch("/api/persona-prompt-policies/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona prompt policy administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);
    const current = await personaPromptPolicies.findOne({ _id });

    if (!current)
      return res.status(404).json({
        error: "Persona prompt policy not found"
      });

    const update = {
      updatedAt: new Date()
    };

    /*
     * Versioned content is immutable.
     * To change prompt text or modelSpecName, create a new version.
     */
    if (
      req.body.prompt !== undefined ||
      req.body.modelSpecName !== undefined ||
      req.body.version !== undefined ||
      req.body.personaId !== undefined ||
      req.body.tenantId !== undefined
    )
      return res.status(400).json({
        error:
          "Versioned prompt content is immutable; create a new policy version instead"
      });

    if (req.body.notes !== undefined)
      update.notes = String(req.body.notes || "")
        .trim()
        .slice(0, 2000);

    if (req.body.enabled !== undefined) {
      const enabled = req.body.enabled === true;

      if (enabled) {
        await personaPromptPolicies.updateMany(
          {
            tenantId: current.tenantId,
            personaId: current.personaId,
            enabled: true,
            _id: { $ne: current._id }
          },
          {
            $set: {
              enabled: false,
              updatedAt: new Date()
            }
          }
        );
      }

      update.enabled = enabled;
    }

    const policy = await personaPromptPolicies.findOneAndUpdate(
      { _id },
      { $set: update },
      { returnDocument: "after" }
    );

    await audit("PERSONA_PROMPT_POLICY_UPDATED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        personaId: current.personaId,
        version: current.version,
        enabled:
          update.enabled !== undefined
            ? update.enabled
            : current.enabled
      }
    });

    res.json({ policy });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update persona prompt policy"
    });
  }
});


app.delete("/api/persona-prompt-policies/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Persona prompt policy administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);
    const current = await personaPromptPolicies.findOne({ _id });

    if (!current)
      return res.status(404).json({
        error: "Persona prompt policy not found"
      });

    if (current.enabled === true)
      return res.status(409).json({
        error:
          "Disable the active prompt-policy version before deleting it"
      });

    await personaPromptPolicies.deleteOne({ _id });

    await audit("PERSONA_PROMPT_POLICY_DELETED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        personaId: current.personaId,
        version: current.version
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to delete persona prompt policy"
    });
  }
});


app.post("/api/ai-policy/bootstrap-classes", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI model policy administration is not permitted"
      });

    await ensureManagedClassCatalog();

    await audit("AIS_MODEL_CLASSES_BOOTSTRAPPED", req, {
      safeDetails: { classCount: AIS_CLASS_CATALOG.length }
    });

    res.json({ ok: true, classCount: AIS_CLASS_CATALOG.length });
  } catch (e) {
    console.error("[AIS-CLASS-BOOTSTRAP]", e);
    res.status(500).json({ error: "Failed to bootstrap AI Scholar Hub classes" });
  }
});


app.get("/api/ai-policy/catalog", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI model policy administration is not permitted"
      });

    const tenantId = String(req.query.tenantId || "").trim();

    const [providers, models, entitlements, agents, personaRoutes, tenantList] = await Promise.all([
      aiProviders.find({}).sort({ name: 1 }).toArray(),
      aiModels.find({}).sort({ providerKey: 1, label: 1, model: 1 }).toArray(),
      tenantId
        ? modelEntitlements
            .find({ tenantId })
            .sort({ role: 1, agentId: 1 })
            .toArray()
        : Promise.resolve([]),
      tenantId
        ? academicAgents
            .find({ tenantId, enabled: { $ne: false } })
            .sort({ name: 1 })
            .toArray()
        : Promise.resolve([]),
      tenantId
        ? personaModelRoutes
            .find({ tenantId, enabled: { $ne: false } })
            .sort({ personaId: 1, priority: -1 })
            .toArray()
        : Promise.resolve([]),
      institutions
        .find({}, { projection: { _id: 1, name: 1, status: 1 } })
        .sort({ name: 1 })
        .toArray()
    ]);

    res.json({
      providers,
      models,
      classComposition: AIS_CLASS_COMPOSITION,
      entitlements,
      agents,
      personaRoutes,
      institutions: tenantList,
      costTiers: [...MODEL_COST_TIERS],
      roles: [
        "USER",
        "INSTRUCTOR",
        "INSTITUTION_ADMIN",
        "PLATFORM_ADMIN",
        "SUPERADMIN"
      ]
    });
  } catch (e) {
    console.error("[AI-POLICY-CATALOG]", e);
    res.status(500).json({ error: "Failed to retrieve AI model policy" });
  }
});


app.post("/api/ai-policy/validate-routes", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI route validation is not permitted"
      });

    const routerKey = String(
      process.env.ASH_MODEL_ROUTER_API_KEY ||
      process.env.GEMINI_PROXY_API_KEY ||
      ""
    ).trim();

    if (!routerKey)
      return res.status(503).json({
        error: "Model router validation is not configured"
      });

    const routerBase = String(
      process.env.ASH_MODEL_ROUTER_INTERNAL_URL ||
      "http://model-router:8000"
    ).replace(/\/$/, "");

    const response = await fetch(`${routerBase}/admin/routes/validate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${routerKey}` },
      signal: AbortSignal.timeout(240000)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return res.status(502).json({
        error: "Model route validation did not complete"
      });

    await audit("AIS_MODEL_ROUTES_VALIDATED", req, {
      safeDetails: {
        routeCount: Array.isArray(data.results) ? data.results.length : 0,
        availableCount: Array.isArray(data.results)
          ? data.results.filter(item => item.available === true).length
          : 0
      }
    });

    res.json({
      validatedAt: data.validatedAt || null,
      results: Array.isArray(data.results) ? data.results : []
    });
  } catch (e) {
    console.error("[AIS-ROUTE-VALIDATION]", e?.name || "Error");
    res.status(502).json({ error: "Model route validation failed" });
  }
});


app.post("/api/ai-providers", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI provider administration is not permitted"
      });

    const key = cleanPolicyKey(req.body.key, "Provider key");
    const name = String(req.body.name || "").trim().slice(0, 200);

    if (!name)
      return res.status(400).json({ error: "Provider name is required" });

    const now = new Date();

    const doc = {
      key,
      name,
      endpointType: String(req.body.endpointType || "custom")
        .trim()
        .slice(0, 100),
      description: String(req.body.description || "")
        .trim()
        .slice(0, 1000),
      enabled: req.body.enabled !== false,
      costTier: cleanCostTier(req.body.costTier),
      createdAt: now,
      updatedAt: now
    };

    const result = await aiProviders.insertOne(doc);
    doc._id = result.insertedId;

    await audit("AI_PROVIDER_CREATED", req, {
      safeDetails: {
        providerKey: key,
        name,
        costTier: doc.costTier
      }
    });

    res.status(201).json({ provider: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({ error: "Provider key already exists" });

    res.status(400).json({
      error: e.message || "Failed to create AI provider"
    });
  }
});


app.patch("/api/ai-providers/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI provider administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);
    const current = await aiProviders.findOne({ _id });

    if (!current)
      return res.status(404).json({ error: "AI provider not found" });

    const update = { updatedAt: new Date() };

    if (req.body.name !== undefined)
      update.name = String(req.body.name || "").trim().slice(0, 200);

    if (req.body.description !== undefined)
      update.description = String(req.body.description || "")
        .trim()
        .slice(0, 1000);

    if (req.body.endpointType !== undefined)
      update.endpointType = String(req.body.endpointType || "custom")
        .trim()
        .slice(0, 100);

    if (req.body.enabled !== undefined)
      update.enabled = req.body.enabled === true;

    if (req.body.costTier !== undefined)
      update.costTier = cleanCostTier(req.body.costTier);

    const provider = await aiProviders.findOneAndUpdate(
      { _id },
      { $set: update },
      { returnDocument: "after" }
    );

    await audit("AI_PROVIDER_UPDATED", req, {
      safeDetails: { providerKey: current.key }
    });

    res.json({ provider });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update AI provider"
    });
  }
});


app.post("/api/ai-models", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI model administration is not permitted"
      });

    const providerKey = cleanPolicyKey(
      req.body.providerKey,
      "Provider key"
    );

    const provider = await aiProviders.findOne({
      key: providerKey
    });

    if (!provider)
      return res.status(404).json({
        error: "Provider does not exist"
      });

    const model = String(req.body.model || "").trim().slice(0, 200);
    if (!model)
      return res.status(400).json({ error: "Model identifier is required" });

    const now = new Date();

    const doc = {
      providerKey,
      model,
      label: String(req.body.label || model).trim().slice(0, 200),
      description: String(req.body.description || "")
        .trim()
        .slice(0, 1000),
      costTier: cleanCostTier(
        req.body.costTier,
        provider.costTier || "BALANCED"
      ),
      enabled: req.body.enabled !== false,
      contextWindow:
        Number.isFinite(Number(req.body.contextWindow)) &&
        Number(req.body.contextWindow) > 0
          ? Number(req.body.contextWindow)
          : null,
      createdAt: now,
      updatedAt: now
    };

    const result = await aiModels.insertOne(doc);
    doc._id = result.insertedId;

    await audit("AI_MODEL_CREATED", req, {
      safeDetails: {
        providerKey,
        model,
        costTier: doc.costTier
      }
    });

    res.status(201).json({ model: doc });
  } catch (e) {
    if (e?.code === 11000)
      return res.status(409).json({
        error: "This provider/model combination already exists"
      });

    res.status(400).json({
      error: e.message || "Failed to create AI model"
    });
  }
});


app.patch("/api/ai-models/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "AI model administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);
    const current = await aiModels.findOne({ _id });

    if (!current)
      return res.status(404).json({ error: "AI model not found" });

    const update = { updatedAt: new Date() };

    if (req.body.label !== undefined)
      update.label = String(req.body.label || current.model)
        .trim()
        .slice(0, 200);

    if (req.body.description !== undefined)
      update.description = String(req.body.description || "")
        .trim()
        .slice(0, 1000);

    if (req.body.costTier !== undefined)
      update.costTier = cleanCostTier(req.body.costTier);

    if (req.body.enabled !== undefined)
      update.enabled = req.body.enabled === true;

    if (req.body.contextWindow !== undefined) {
      const n = Number(req.body.contextWindow);
      update.contextWindow =
        Number.isFinite(n) && n > 0 ? n : null;
    }

    const model = await aiModels.findOneAndUpdate(
      { _id },
      { $set: update },
      { returnDocument: "after" }
    );

    await audit("AI_MODEL_UPDATED", req, {
      safeDetails: {
        providerKey: current.providerKey,
        model: current.model
      }
    });

    res.json({ model });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update AI model"
    });
  }
});


app.put("/api/model-entitlements", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Model entitlement administration is not permitted"
      });

    const tenantId = await resolvePolicyTenant(
      req,
      req.body.tenantId
    );

    if (!tenantId)
      return res.status(400).json({
        error: "A valid institution is required"
      });

    const role = String(req.body.role || "")
      .trim()
      .toUpperCase();

    if (![
      "USER",
      "INSTRUCTOR",
      "INSTITUTION_ADMIN",
      "PLATFORM_ADMIN"
    ].includes(role))
      return res.status(400).json({
        error: "Invalid entitlement role"
      });

    const agentId = String(req.body.agentId || "*").trim() || "*";

    const allowedModels = cleanStringList(req.body.allowedModels);
    const fallbackModels = cleanStringList(req.body.fallbackModels);

    const allReferenced = [
      ...new Set([
        ...allowedModels,
        ...fallbackModels,
        String(req.body.defaultModel || "").trim()
      ].filter(Boolean))
    ];

    if (allReferenced.length) {
      const parts = allReferenced.map(v => {
        const i = v.indexOf(":");
        return i > 0
          ? { providerKey: v.slice(0, i), model: v.slice(i + 1) }
          : null;
      });

      if (parts.some(x => !x))
        return res.status(400).json({
          error: "Models must use provider:model format"
        });

      for (const ref of parts) {
        const exists = await aiModels.findOne({
          providerKey: ref.providerKey,
          model: ref.model
        });

        if (!exists)
          return res.status(400).json({
            error: `Unknown model ${ref.providerKey}:${ref.model}`
          });
      }
    }

    const defaultModel = String(req.body.defaultModel || "").trim();

    if (
      defaultModel &&
      allowedModels.length &&
      !allowedModels.includes(defaultModel)
    ) {
      return res.status(400).json({
        error: "Default model must be included in allowed models"
      });
    }

    const now = new Date();

    const entitlement = await modelEntitlements.findOneAndUpdate(
      { tenantId, role, agentId },
      {
        $set: {
          tenantId,
          role,
          agentId,
          enabled: req.body.enabled !== false,
          costTier: cleanCostTier(req.body.costTier),
          allowedModels,
          defaultModel: defaultModel || null,
          fallbackModels,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      {
        upsert: true,
        returnDocument: "after"
      }
    );

    await audit("MODEL_ENTITLEMENT_UPDATED", req, {
      safeDetails: {
        tenantId,
        role,
        agentId,
        costTier: entitlement.costTier,
        allowedModelCount: allowedModels.length
      }
    });

    res.json({ entitlement });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to update model entitlement"
    });
  }
});


app.delete("/api/model-entitlements/:id", async (req, res) => {
  try {
    if (!canManageModelPolicy(req))
      return res.status(403).json({
        error: "Model entitlement administration is not permitted"
      });

    const _id = new ObjectId(req.params.id);

    const current = await modelEntitlements.findOne({ _id });
    if (!current)
      return res.status(404).json({
        error: "Model entitlement not found"
      });

    await modelEntitlements.deleteOne({ _id });

    await audit("MODEL_ENTITLEMENT_DELETED", req, {
      safeDetails: {
        tenantId: current.tenantId,
        role: current.role,
        agentId: current.agentId
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({
      error: e.message || "Failed to delete model entitlement"
    });
  }
});


app.get("/api/users/export", async (_req, res) => {
  const rows = await users.find(userScope(_req), {
    projection: { name: 1, username: 1, email: 1, role: 1, provider: 1, ragAccess: 1, createdAt: 1 }
  }).sort({ createdAt: -1 }).toArray();

  const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;

  const csv = [
    "name,username,email,role,provider,ragAccess,createdAt",
    ...rows.map(u => [
      u.name, u.username, u.email, u.role, u.provider,
      normalizedRagAccess(u),
      u.createdAt?.toISOString?.() || ""
    ].map(esc).join(","))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=ai-scholar-hub-users.csv");
  res.send(csv);
});

app.use((error, _req, res, next) => {
  if (!error) return next();

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Document exceeds the 20 MB upload limit"
      : "The document upload could not be accepted";
    return res.status(400).json({ error: message });
  }

  console.error("[ADMIN-UI-UNHANDLED]", error);
  return res.status(500).json({ error: "The request could not be completed" });
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`AI Scholar Hub User Management listening on port ${PORT}`)
);
