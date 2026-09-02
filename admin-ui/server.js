import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3090;

// Immutable AI Scholar Hub Superadmin.
// This is the creator/owner account and must never be deleted or demoted.
const SUPERADMIN_EMAIL = "ppatra@seedsnet.org";

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();

const db = client.db("LibreChat");
const users = db.collection("users");
const institutions = db.collection("institutions");
const adminAudit = db.collection("adminAudit");
const sessions = new Map();

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
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map(x => {
        const i = x.indexOf("=");
        return [
          x.slice(0, i).trim(),
          decodeURIComponent(x.slice(i + 1))
        ];
      })
  );
}

async function requireAdmin(req, res, next) {
  try {
    const token = cookies(req).admin_session;
    const session = token && sessions.get(token);

    if (!session) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const admin = await users.findOne(
      { _id: new ObjectId(session.userId) },
      {
        projection: {
          name: 1,
          email: 1,
          role: 1,
          superAdmin: 1,
          tenantId: 1,
          ragAccess: 1
        }
      }
    );

    if (!admin) {
      sessions.delete(token);
      return res.status(403).json({
        error: "Administrator account not found"
      });
    }

    const role = normalizedRole(admin);

    const allowed =
      isSuperAdmin(admin) ||
      role === "PLATFORM_ADMIN" ||
      role === "INSTITUTION_ADMIN";

    if (!allowed) {
      sessions.delete(token);

      return res.status(403).json({
        error: "Administrator access required"
      });
    }



    if (normalizedRole(admin) === "INSTITUTION_ADMIN") {
      const tenantId = String(admin.tenantId || "").trim();

      if (!tenantId) {
        sessions.delete(token);

        return res.status(403).json({
          error: "Institution context required"
        });
      }

      const institution = await institutions.findOne(
        { _id: tenantId },
        {
          projection: {
            _id: 1,
            status: 1
          }
        }
      );

      if (!institution) {
        sessions.delete(token);

        return res.status(403).json({
          error: "Institution not found"
        });
      }

      if (institution.status === "disabled") {
        sessions.delete(token);

        return res.status(403).json({
          error: "This institution is disabled"
        });
      }
    }

    req.admin = admin;
    next();
  } catch (e) {
    console.error("[require-admin]", e);

    res.status(500).json({
      error: "Authentication error"
    });
  }
}

function normalizedRole(user) {
  return String(user?.role || "")
    .trim()
    .toUpperCase();
}

function isDesignatedSuperAdmin(user) {
  return (
    String(user?.email || "")
      .trim()
      .toLowerCase() === SUPERADMIN_EMAIL &&
    user?.superAdmin === true
  );
}

function isSuperAdmin(user) {
  return (
    isDesignatedSuperAdmin(user) &&
    ["SUPERADMIN", "ADMIN"].includes(normalizedRole(user))
  );
}

function isHigherAdmin(user) {
  return (
    isSuperAdmin(user) ||
    normalizedRole(user) === "PLATFORM_ADMIN" ||
    normalizedRole(user) === "ADMIN"
  );
}

async function institutionExists(tenantId) {
  const id = String(tenantId || "").trim();

  if (!id) return false;

  return !!(
    await institutions.findOne(
      { _id: id },
      {
        projection: {
          _id: 1
        }
      }
    )
  );
}

function targetTenantForRequest(req, requestedTenantId) {
  if (isInstitutionAdmin(req.admin)) {
    return actorTenant(req);
  }

  return String(requestedTenantId || "").trim() || null;
}

function isPlatformAdmin(user) {
  return (
    isSuperAdmin(user) ||
    normalizedRole(user) === "PLATFORM_ADMIN"
  );
}

function isInstitutionAdmin(user) {
  return normalizedRole(user) === "INSTITUTION_ADMIN";
}

/*
 * ============================================================
 * RAG ACCESS
 * ============================================================
 *
 * RAG Access is an independent capability.
 *
 * It is deliberately NOT a role.
 *
 * user.ragAccess === true
 *     -> user is permitted to use RAG functionality
 *
 * user.ragAccess !== true
 *     -> user does not have RAG access
 *
 * The Admin UI controls the flag.
 * The RAG/MCP layer must enforce the flag at request time.
 */

function normalizedRagAccess(user) {
  return user?.ragAccess === true;
}

function parseRagAccess(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const v = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    [
      "true",
      "1",
      "yes",
      "on",
      "enabled"
    ].includes(v)
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "off",
      "disabled",
      ""
    ].includes(v)
  ) {
    return false;
  }

  return undefined;
}

function canManageRagAccess(req, user) {
  if (!user) {
    return false;
  }

  const targetRole = normalizedRole(user);

  // Superadmin has full RAG-management authority.
  if (isSuperAdmin(req.admin)) {
    return true;
  }

  // Platform Admin can manage RAG access for institution-scoped
  // accounts, but cannot alter privileged platform administrators.
  if (normalizedRole(req.admin) === "PLATFORM_ADMIN") {
    return (
      targetRole !== "SUPERADMIN" &&
      targetRole !== "PLATFORM_ADMIN" &&
      targetRole !== "ADMIN"
    );
  }

  // Institution Admin can manage RAG access only for USER and
  // INSTRUCTOR accounts belonging to the same institution.
  if (isInstitutionAdmin(req.admin)) {
    return (
      String(user.tenantId || "").trim() === actorTenant(req) &&
      (
        targetRole === "USER" ||
        targetRole === "INSTRUCTOR"
      )
    );
  }

  return false;
}

function actorTenant(req) {
  return String(req.admin?.tenantId || "").trim() || null;
}

function userScope(req, extra = {}) {
  return isInstitutionAdmin(req.admin)
    ? {
        tenantId: actorTenant(req),
        ...extra
      }
    : extra;
}

function canTargetUser(req, user) {
  const actor = req.admin;
  const targetRole = normalizedRole(user);

  // Superadmin has absolute authority.
  if (isSuperAdmin(actor)) {
    return true;
  }

  // Platform Admin can manage Institution Admins and lower roles.
  // Platform Admin cannot manage another Platform Admin, legacy ADMIN,
  // or Superadmin.
  if (normalizedRole(actor) === "PLATFORM_ADMIN") {
    return (
      targetRole !== "SUPERADMIN" &&
      targetRole !== "PLATFORM_ADMIN" &&
      targetRole !== "ADMIN"
    );
  }

  // Institution Admin is restricted to own institution and ordinary
  // users/instructors.
  if (isInstitutionAdmin(actor)) {
    return (
      String(user?.tenantId || "").trim() === actorTenant(req) &&
      (
        targetRole === "USER" ||
        targetRole === "INSTRUCTOR"
      )
    );
  }

  return false;
}

function canAssignRoleToUser(req, role) {
  const r = String(role || "")
    .trim()
    .toUpperCase();

  if (r === "SUPERADMIN") {
    return false;
  }

  if (r === "PLATFORM_ADMIN" || r === "ADMIN") {
    return isSuperAdmin(req.admin);
  }

  if (
    isSuperAdmin(req.admin) ||
    normalizedRole(req.admin) === "PLATFORM_ADMIN"
  ) {
    return (
      r === "USER" ||
      r === "INSTRUCTOR" ||
      r === "INSTITUTION_ADMIN"
    );
  }

  return (
    isInstitutionAdmin(req.admin) &&
    (
      r === "USER" ||
      r === "INSTRUCTOR"
    )
  );
}

function allowedUserRole(req, role) {
  const r = String(role || "").trim();

  if (isInstitutionAdmin(req.admin)) {
    return (
      r === "USER" ||
      r === "Instructor"
    );
  }

  if (isSuperAdmin(req.admin)) {
    return (
      r === "USER" ||
      r === "Instructor" ||
      r === "INSTITUTION_ADMIN" ||
      r === "PLATFORM_ADMIN"
    );
  }

  if (normalizedRole(req.admin) === "PLATFORM_ADMIN") {
    return (
      r === "USER" ||
      r === "Instructor" ||
      r === "INSTITUTION_ADMIN"
    );
  }

  return (
    r === "USER" ||
    r === "Instructor" ||
    r === "INSTITUTION_ADMIN"
  );
}

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "AI Scholar Hub User Management"
  })
);

app.get("/login", (_req, res) =>
  res.sendFile("/app/public/login.html")
);

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    const user = await users.findOne({ email });

    const loginRole = user ? normalizedRole(user) : "";

    const loginAllowed =
      user &&
      (
        isSuperAdmin(user) ||
        loginRole === "PLATFORM_ADMIN" ||
        loginRole === "INSTITUTION_ADMIN"
      );

    if (
      !user ||
      !loginAllowed ||
      !user.password ||
      !(await bcrypt.compare(password, user.password))
    ) {
      await audit("LOGIN_FAILED", req, {
        result: "denied",
        targetEmail: email || null,
        targetRole: user?.role || null,
        safeDetails: {
          reason: "Invalid administrator credentials"
        }
      });

      return res.status(401).json({
        error: "Invalid administrator credentials"
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
      userId: user._id.toString(),
      createdAt: Date.now()
    });

    const forwardedProto = String(
      req.headers["x-forwarded-proto"] || ""
    )
      .split(",")[0]
      .trim()
      .toLowerCase();

    const secureCookie =
      forwardedProto === "https" ||
      req.secure === true;

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
    console.error("[login]", e);

    res.status(500).json({
      error: "Login failed"
    });
  }
});

app.post("/api/logout", async (req, res) => {
  const token = cookies(req).admin_session;
  const session = token ? sessions.get(token) : null;

  if (session) {
    try {
      const user = await users.findOne({
        _id: new ObjectId(session.userId)
      });

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

  const forwardedProto = String(
    req.headers["x-forwarded-proto"] || ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();

  const secureCookie =
    forwardedProto === "https" ||
    req.secure === true;

  res.setHeader(
    "Set-Cookie",
    `admin_session=; HttpOnly; SameSite=Lax; Path=/${secureCookie ? "; Secure" : ""}; Max-Age=0`
  );

  res.json({
    ok: true
  });
});

app.use(requireAdmin);

/*
 * ============================================================
 * SUPERADMIN AUDIT API
 * ============================================================
 */

app.get(
  "/api/superadmin/audit",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const limit = Math.min(
        Math.max(
          Number.parseInt(req.query.limit || "100", 10),
          1
        ),
        500
      );

      const filter = {};

      if (req.query.action) {
        filter.action = String(req.query.action).trim();
      }

      if (req.query.actor) {
        filter.actorEmail = {
          $regex: String(req.query.actor).trim(),
          $options: "i"
        };
      }

      if (req.query.target) {
        filter.targetEmail = {
          $regex: String(req.query.target).trim(),
          $options: "i"
        };
      }

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
  }
);

app.get(
  "/api/superadmin/audit/actions",
  requireSuperAdmin,
  async (_req, res) => {
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
  }
);

app.get("/api/me", (req, res) => {
  const admin = {
    ...req.admin,
    ragAccess: normalizedRagAccess(req.admin)
  };

  delete admin.password;
  delete admin.refreshToken;
  delete admin.backupCodes;

  res.json(admin);
});

app.get("/api/users", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedRole = String(req.query.role || "").trim();

    const filter = userScope(req);

    if (q) {
      filter.$or = [
        {
          name: {
            $regex: q,
            $options: "i"
          }
        },
        {
          username: {
            $regex: q,
            $options: "i"
          }
        },
        {
          email: {
            $regex: q,
            $options: "i"
          }
        }
      ];
    }

    if (requestedRole) {
      filter.role = requestedRole;
    }

    const result = await users
      .find(filter, {
        projection: {
          password: 0,
          refreshToken: 0,
          backupCodes: 0
        }
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(result);
  } catch (e) {
    console.error("[users-list]", e);

    res.status(500).json({
      error: "Failed to retrieve users"
    });
  }
});

function normalizeInstitutionDomains(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const raw = Array.isArray(value)
    ? value
    : String(value)
        .split(/[\n,]+/);

  const domains = [];

  for (const item of raw) {
    let domain = String(item || "")
      .trim()
      .toLowerCase();

    if (domain.startsWith("@")) {
      domain = domain.slice(1);
    }

    if (!domain) {
      continue;
    }

    if (
      domain.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ) {
      throw new Error(`Invalid domain: ${domain}`);
    }

    if (!domains.includes(domain)) {
      domains.push(domain);
    }
  }

  return domains.sort();
}

app.get("/api/institutions", async (req, res) => {
  try {
    if (isInstitutionAdmin(req.admin)) {
      const id = actorTenant(req);

      const institution = await institutions.findOne({
        _id: id
      });

      if (!institution) {
        return res.status(404).json({
          error: "Institution not found"
        });
      }

      return res.json({
        institutions: [institution]
      });
    }

    const list = await institutions
      .find({})
      .sort({ name: 1 })
      .toArray();

    const admins = await users
      .find(
        {
          role: "INSTITUTION_ADMIN",
          tenantId: {
            $exists: true,
            $ne: null
          }
        },
        {
          projection: {
            name: 1,
            email: 1,
            tenantId: 1
          }
        }
      )
      .toArray();

    const allTenantUsers = await users
      .find(
        {
          tenantId: {
            $exists: true,
            $nin: [null, ""]
          }
        },
        {
          projection: {
            email: 1,
            tenantId: 1
          }
        }
      )
      .toArray();

    const byTenant = new Map();

    for (const admin of admins) {
      const key = String(admin.tenantId || "");

      if (!byTenant.has(key)) {
        byTenant.set(key, []);
      }

      byTenant.get(key).push({
        _id: admin._id,
        name: admin.name,
        email: admin.email
      });
    }

    res.json({
      institutions: list.map(x => ({
        ...x,
        admins:
          byTenant.get(String(x._id)) || [],
        domains: Array.isArray(x.domains)
          ? [...new Set(
              x.domains
                .map(d =>
                  String(d || "")
                    .trim()
                    .toLowerCase()
                    .replace(/^@/, "")
                )
                .filter(Boolean)
            )].sort()
          : []
      }))
    });
  } catch (e) {
    console.error("[institutions-list]", e);

    res.status(500).json({
      error: "Failed to retrieve institutions"
    });
  }
});

app.post("/api/institutions", async (req, res) => {
  if (!isPlatformAdmin(req.admin)) {
    return res.status(403).json({
      error: "Platform administrator privileges required"
    });
  }

  const id = String(req.body.id || "").trim();
  const name = String(req.body.name || "").trim();

  if (
    !/^[-a-zA-Z0-9_.]{1,128}$/.test(id) ||
    !name ||
    name.length > 200
  ) {
    return res.status(400).json({
      error: "Valid institution id and name are required"
    });
  }

  let domains;

  try {
    domains =
      normalizeInstitutionDomains(
        req.body.domains
      );
  } catch (e) {
    return res.status(400).json({
      error: e.message
    });
  }

  try {
    if (domains.length) {
      const existing =
        await institutions.findOne({
          domains: {
            $in: domains
          }
        });

      if (existing) {
        return res.status(409).json({
          error:
            `Domain already assigned to institution: ${domains.find(d => (existing.domains || []).includes(d)) || "unknown"}`
        });
      }
    }

    const now = new Date();

    const doc = {
      _id: id,
      tenantId: id,
      name,
      domains,
      status: "enabled",
      createdAt: now,
      updatedAt: now
    };

    await institutions.insertOne(doc);

    await audit(
      "INSTITUTION_CREATED",
      req,
      {
        safeDetails: {
          institutionId: id,
          name
        }
      }
    );

    res.status(201).json({
      institution: doc
    });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        error: "Institution already exists"
      });
    }

    console.error("[institution-create]", e);

    res.status(500).json({
      error: "Failed to create institution"
    });
  }
});

app.patch("/api/institutions/:id", async (req, res) => {
  if (!isPlatformAdmin(req.admin)) {
    return res.status(403).json({
      error: "Platform administrator privileges required"
    });
  }

  const id = String(req.params.id || "").trim();

  if (!/^[-a-zA-Z0-9_.]{1,128}$/.test(id)) {
    return res.status(400).json({
      error: "Invalid institution id"
    });
  }

  const update = {
    updatedAt: new Date()
  };

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();

    if (!name || name.length > 200) {
      return res.status(400).json({
        error: "Invalid institution name"
      });
    }

    update.name = name;
  }

  if (req.body.status !== undefined) {
    if (
      ![
        "enabled",
        "disabled"
      ].includes(req.body.status)
    ) {
      return res.status(400).json({
        error: "Invalid institution status"
      });
    }

    update.status = req.body.status;
  }

  if (req.body.domains !== undefined) {
    let domains;

    try {
      domains =
        normalizeInstitutionDomains(
          req.body.domains
        );
    } catch (e) {
      return res.status(400).json({
        error: e.message
      });
    }

    if (domains.length) {
      const existing =
        await institutions.findOne({
          _id: {
            $ne: id
          },
          domains: {
            $in: domains
          }
        });

      if (existing) {
        return res.status(409).json({
          error:
            `Domain already assigned to institution: ${domains.find(d => (existing.domains || []).includes(d)) || "unknown"}`
        });
      }
    }

    update.domains = domains;
  }

  try {
    const result =
      await institutions.findOneAndUpdate(
        { _id: id },
        { $set: update },
        {
          returnDocument: "after"
        }
      );

    if (!result) {
      return res.status(404).json({
        error: "Institution not found"
      });
    }

    await audit(
      "INSTITUTION_UPDATED",
      req,
      {
        safeDetails: {
          institutionId: id,
          fields: Object.keys(update)
            .filter(k => k !== "updatedAt")
        }
      }
    );

    res.json({
      institution: result
    });
  } catch (e) {
    console.error("[institution-update]", e);

    res.status(500).json({
      error: "Failed to update institution"
    });
  }
});

app.delete(
  "/api/institutions/:id",
  requireSuperAdmin,
  async (req, res) => {
    const id = String(req.params.id || "").trim();

    if (!/^[-a-zA-Z0-9_.]{1,128}$/.test(id)) {
      return res.status(400).json({
        error: "Invalid institution id"
      });
    }

    try {
      /*
       * The main API owns the canonical purge implementation.
       * The Admin UI deliberately does not reimplement tenant-data
       * deletion here.
       */

      const librechatUrl =
        process.env.LIBRECHAT_INTERNAL_URL ||
        "http://api:3080";

      const proxySecret =
        String(
          process.env.ADMIN_INTERNAL_SECRET || ""
        ).trim();

      if (!proxySecret) {
        console.error(
          "[institution-delete] ADMIN_INTERNAL_SECRET is not configured"
        );

        return res.status(503).json({
          error:
            "Institution deletion is temporarily unavailable because internal administration security is not configured"
        });
      }

      const response = await fetch(
        `${librechatUrl}/api/admin/institutions/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: {
            "X-AI-Scholar-Hub-Admin-Proxy": proxySecret
          }
        }
      );

      if (!response.ok) {
        const data =
          await response.json().catch(() => ({}));

        return res.status(response.status).json({
          error:
            data.error ||
            "Failed to permanently delete institution"
        });
      }

      await audit(
        "INSTITUTION_DELETED",
        req,
        {
          safeDetails: {
            institutionId: id
          }
        }
      );

      res.json({
        ok: true
      });
    } catch (e) {
      console.error("[institution-delete]", e);

      res.status(500).json({
        error:
          "Failed to permanently delete institution"
      });
    }
  }
);

app.post(
  "/api/institutions/:id/admin",
  async (req, res) => {
    if (!isPlatformAdmin(req.admin)) {
      return res.status(403).json({
        error:
          "Platform administrator privileges required"
      });
    }

    const institutionId =
      String(req.params.id || "").trim();

    const userId =
      String(req.body.userId || "").trim();

    if (
      !/^[-a-zA-Z0-9_.]{1,128}$/.test(institutionId) ||
      !userId
    ) {
      return res.status(400).json({
        error:
          "institution id and userId are required"
      });
    }

    try {
      const institution =
        await institutions.findOne({
          _id: institutionId
        });

      if (!institution) {
        return res.status(404).json({
          error: "Institution not found"
        });
      }

      if (institution.status === "disabled") {
        return res.status(400).json({
          error:
            "Cannot assign an admin to a disabled institution"
        });
      }

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({
          error: "Invalid user ID"
        });
      }

      const user = await users.findOne({
        _id: new ObjectId(userId)
      });

      if (!user) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      const targetRole = normalizedRole(user);
      const userTenantId =
        String(user.tenantId || "").trim();

      if (
        targetRole !== "USER" &&
        targetRole !== "INSTRUCTOR"
      ) {
        return res.status(403).json({
          error:
            "Only users and instructors may be assigned as Institution Admins"
        });
      }

      if (userTenantId !== institutionId) {
        return res.status(409).json({
          error: userTenantId
            ? "User belongs to another institution; transfer the user explicitly before assigning Institution Admin"
            : "User has no institution assignment; assign the user to this institution before assigning Institution Admin"
        });
      }

      await users.updateOne(
        {
          _id: user._id
        },
        {
          $set: {
            role: "INSTITUTION_ADMIN",
            tenantId: institutionId,
            updatedAt: new Date()
          }
        }
      );

      await audit(
        "INSTITUTION_ADMIN_ASSIGNED",
        req,
        {
          targetUserId: user._id,
          targetEmail: user.email,
          targetRole: "INSTITUTION_ADMIN",
          safeDetails: {
            institutionId
          }
        }
      );

      res.json({
        ok: true
      });
    } catch (e) {
      console.error("[institution-admin]", e);

      res.status(500).json({
        error:
          "Failed to assign institution admin"
      });
    }
  }
);

app.post("/api/users", async (req, res) => {
  try {
    const name =
      String(req.body.name || "").trim();

    const username =
      String(req.body.username || "").trim() ||
      null;

    const email =
      String(req.body.email || "")
        .trim()
        .toLowerCase();

    const role =
      String(req.body.role || "USER").trim();

    const ragAccess =
      parseRagAccess(
        req.body.ragAccess === undefined
          ? true
          : req.body.ragAccess
      );

    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email are required"
      });
    }

    if (
      !allowedUserRole(req, role) ||
      !canAssignRoleToUser(req, role)
    ) {
      return res.status(400).json({
        error: "Invalid or unauthorized role"
      });
    }

    if (ragAccess === undefined) {
      return res.status(400).json({
        error:
          "RAG Access must be enabled or disabled"
      });
    }

    if (ragAccess === true) {
      const prospectiveUser = {
        role,
        tenantId:
          isInstitutionAdmin(req.admin)
            ? actorTenant(req)
            : String(
                req.body.tenantId || ""
              ).trim() || null
      };

      if (
        !canManageRagAccess(
          req,
          prospectiveUser
        )
      ) {
        return res.status(403).json({
          error:
            "You are not authorized to grant RAG Access to this user"
        });
      }
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        error: "Invalid email address"
      });
    }

    if (await users.findOne({ email })) {
      return res.status(409).json({
        error:
          "A user with this email already exists"
      });
    }

    const requestedTenantId =
      String(req.body.tenantId || "").trim();

    const tenantId =
      isInstitutionAdmin(req.admin)
        ? actorTenant(req)
        : role === "PLATFORM_ADMIN"
          ? null
          : requestedTenantId;

    if (
      role === "USER" ||
      role === "Instructor" ||
      role === "INSTITUTION_ADMIN"
    ) {
      if (!tenantId) {
        return res.status(400).json({
          error:
            "Institution is required for institution-scoped users"
        });
      }

      if (!(await institutionExists(tenantId))) {
        return res.status(400).json({
          error:
            "Selected institution does not exist"
        });
      }
    }

    /*
     * The administrator never creates or receives
     * a usable password.
     *
     * Generate an internal bootstrap password only.
     * User establishes real password through
     * LibreChat password setup/reset mechanism.
     */

    const bootstrapPassword =
      crypto.randomBytes(32).toString("hex");

    const now = new Date();

    const doc = {
      name,
      username,
      email,
      emailVerified: true,
      password:
        await bcrypt.hash(
          bootstrapPassword,
          10
        ),
      avatar: null,
      provider: "local",
      role,

      ...(tenantId
        ? {
            tenantId
          }
        : {}),

      // RAG capability.
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

    const result =
      await users.insertOne(doc);

    await audit(
      "USER_CREATED",
      req,
      {
        targetUserId:
          result.insertedId,
        targetEmail: email,
        targetRole: role,
        safeDetails: {
          username,
          ragAccess,
          emailSent: false
        }
      }
    );

    /*
     * Reuse LibreChat's native password-reset
     * service so the administrator does not need
     * to handle passwords.
     */

    const librechatUrl =
      process.env.LIBRECHAT_INTERNAL_URL ||
      "http://api:3080";

    const resetResponse =
      await fetch(
        `${librechatUrl}/api/auth/requestPasswordReset`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            email
          })
        }
      );

    const resetData =
      await resetResponse
        .json()
        .catch(() => ({}));

    if (!resetResponse.ok) {
      console.error(
        `[create-user] User created but setup email failed for ${email}:`,
        resetData
      );

      return res.status(201).json({
        ok: true,
        id: result.insertedId,
        emailSent: false,
        warning:
          "User created, but the password setup email could not be sent."
      });
    }

    await audit(
      "USER_SETUP_EMAIL_SENT",
      req,
      {
        targetUserId:
          result.insertedId,
        targetEmail: email,
        targetRole: role,
        safeDetails: {}
      }
    );

    res.json({
      ok: true,
      id: result.insertedId,
      emailSent: true
    });
  } catch (e) {
    console.error("[user-create]", e);

    res.status(500).json({
      error: "Failed to create user"
    });
  }
});

app.patch("/api/users/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        error: "Invalid user ID"
      });
    }

    const id =
      new ObjectId(req.params.id);

    const user =
      await users.findOne(
        userScope(req, {
          _id: id
        })
      );

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    if (id.equals(req.admin._id)) {
      return res.status(400).json({
        error:
          "You cannot modify your own administrative account"
      });
    }

    if (!canTargetUser(req, user)) {
      return res.status(403).json({
        error:
          "User administration is not permitted"
      });
    }

    const targetIsSuperadmin =
      isSuperAdmin(user);

    /*
     * RAG ACCESS
     */

    const update = {
      updatedAt: new Date()
    };

    if (req.body.ragAccess !== undefined) {
      const ragAccess =
        parseRagAccess(
          req.body.ragAccess
        );

      if (ragAccess === undefined) {
        return res.status(400).json({
          error:
            "RAG Access must be enabled or disabled"
        });
      }

      if (
        !canManageRagAccess(
          req,
          user
        )
      ) {
        return res.status(403).json({
          error:
            "You are not authorized to change this user's RAG Access"
        });
      }

      update.ragAccess = ragAccess;
    }

    /*
     * Superadmin account is immutable.
     */

    if (
      targetIsSuperadmin &&
      req.body.role !== undefined &&
      String(req.body.role)
        .trim()
        .toUpperCase() !== "SUPERADMIN"
    ) {
      return res.status(403).json({
        error:
          "The Superadmin account cannot be demoted"
      });
    }

    if (
      targetIsSuperadmin &&
      req.body.superAdmin !== undefined &&
      req.body.superAdmin !== true
    ) {
      return res.status(403).json({
        error:
          "The Superadmin designation cannot be removed"
      });
    }

    if (
      !targetIsSuperadmin &&
      req.body.superAdmin !== undefined
    ) {
      return res.status(403).json({
        error:
          "Only the designated AI Scholar Hub Superadmin may have the Superadmin designation"
      });
    }

    if (req.body.name !== undefined) {
      update.name =
        String(req.body.name).trim();
    }

    if (req.body.username !== undefined) {
      update.username =
        String(req.body.username).trim() ||
        null;
    }

    if (req.body.role !== undefined) {
      const role =
        String(req.body.role).trim();

      if (
        !allowedUserRole(
          req,
          role
        ) ||
        !canAssignRoleToUser(
          req,
          role
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid or unauthorized role"
        });
      }

      if (
        normalizedRole(user) === "ADMIN" &&
        !isSuperAdmin(req.admin)
      ) {
        return res.status(403).json({
          error:
            "Only the AI Scholar Hub Superadmin may modify a legacy ADMIN account"
        });
      }

      if (
        user.role === "ADMIN" &&
        role !== "ADMIN"
      ) {
        const count =
          await users.countDocuments({
            role: "ADMIN"
          });

        if (count <= 1) {
          return res.status(400).json({
            error:
              "Cannot remove the last admin"
          });
        }
      }

      if (targetIsSuperadmin) {
        update.role = "SUPERADMIN";
        update.superAdmin = true;
        delete update.tenantId;
      } else {
        update.role = role;
      }

      if (targetIsSuperadmin) {
        delete update.tenantId;
      } else if (
        role === "PLATFORM_ADMIN"
      ) {
        update.tenantId = null;
      } else if (
        role === "INSTITUTION_ADMIN"
      ) {
        const tenantId =
          isInstitutionAdmin(req.admin)
            ? actorTenant(req)
            : String(
                req.body.tenantId ||
                user.tenantId ||
                ""
              ).trim();

        if (
          !tenantId ||
          !(await institutionExists(
            tenantId
          ))
        ) {
          return res.status(400).json({
            error:
              "A valid institution is required for Institution Admin"
          });
        }

        update.tenantId = tenantId;
      } else if (
        role === "USER" ||
        role === "Instructor"
      ) {
        const tenantId =
          isInstitutionAdmin(req.admin)
            ? actorTenant(req)
            : req.body.tenantId !== undefined
              ? String(
                  req.body.tenantId || ""
                ).trim()
              : String(
                  user.tenantId || ""
                ).trim();

        if (
          !tenantId ||
          !(await institutionExists(
            tenantId
          ))
        ) {
          return res.status(400).json({
            error:
              "A valid institution is required for institution-scoped users"
          });
        }

        update.tenantId = tenantId;
      }
    }

    if (
      req.body.tenantId !== undefined &&
      !isInstitutionAdmin(req.admin) &&
      req.body.role === undefined
    ) {
      const tenantId =
        String(
          req.body.tenantId || ""
        ).trim();

      if (
        tenantId &&
        !(await institutionExists(
          tenantId
        ))
      ) {
        return res.status(400).json({
          error:
            "Selected institution does not exist"
        });
      }

      if (tenantId) {
        update.tenantId =
          tenantId;
      } else {
        delete update.tenantId;
      }
    }

    if (req.body.password) {
      update.password =
        await bcrypt.hash(
          String(req.body.password),
          10
        );
    }

    await users.updateOne(
      {
        _id: id
      },
      {
        $set: update
      }
    );

    await audit(
      "USER_UPDATED",
      req,
      {
        targetUserId: id,
        targetEmail: user.email,
        targetRole:
          update.role || user.role,
        safeDetails: {
          fields:
            Object.keys(update)
              .filter(
                k => k !== "updatedAt"
              ),
          previousRole: user.role,
          newRole:
            update.role ||
            user.role,

          ...(update.ragAccess !==
          undefined
            ? {
                previousRagAccess:
                  normalizedRagAccess(
                    user
                  ),
                newRagAccess:
                  update.ragAccess
              }
            : {})
        }
      }
    );

    if (
      update.ragAccess !== undefined &&
      update.ragAccess !==
        normalizedRagAccess(user)
    ) {
      await audit(
        "USER_RAG_ACCESS_UPDATED",
        req,
        {
          targetUserId: id,
          targetEmail: user.email,
          targetRole:
            update.role ||
            user.role,
          safeDetails: {
            previousRagAccess:
              normalizedRagAccess(
                user
              ),
            newRagAccess:
              update.ragAccess
          }
        }
      );
    }

    res.json({
      ok: true
    });
  } catch (e) {
    console.error("[user-update]", e);

    res.status(500).json({
      error: "Failed to update user"
    });
  }
});

app.post(
  "/api/users/:id/send-reset",
  async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({
          error: "Invalid user ID"
        });
      }

      const id =
        new ObjectId(req.params.id);

      const user =
        await users.findOne(
          userScope(req, {
            _id: id
          }),
          {
            projection: {
              email: 1,
              name: 1,
              tenantId: 1,
              role: 1,
              superAdmin: 1
            }
          }
        );

      if (!user) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      /*
       * IMPORTANT:
       * There is intentionally only ONE declaration of `id`
       * in this route.
       */

      if (id.equals(req.admin._id)) {
        return res.status(400).json({
          error:
            "You cannot reset your own administrative account from this portal"
        });
      }

      if (!canTargetUser(req, user)) {
        return res.status(403).json({
          error:
            "User administration is not permitted"
        });
      }

      const librechatUrl =
        process.env.LIBRECHAT_INTERNAL_URL ||
        "http://api:3080";

      const response =
        await fetch(
          `${librechatUrl}/api/auth/requestPasswordReset`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              email: user.email
            })
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        return res.status(502).json({
          error:
            data.message ||
            "Unable to send password setup email"
        });
      }

      await audit(
        "PASSWORD_RESET_SENT",
        req,
        {
          targetUserId: user._id,
          targetEmail: user.email,
          targetRole: user.role,
          safeDetails: {}
        }
      );

      res.json({
        ok: true,
        message:
          `Password setup/reset link sent to ${user.email}`
      });
    } catch (e) {
      console.error(
        "[send-reset]",
        e
      );

      res.status(500).json({
        error:
          "Failed to send password setup/reset email"
      });
    }
  }
);

app.delete(
  "/api/users/:id",
  async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({
          error: "Invalid user ID"
        });
      }

      const id =
        new ObjectId(req.params.id);

      if (id.equals(req.admin._id)) {
        return res.status(400).json({
          error:
            "You cannot delete your own account"
        });
      }

      const user =
        await users.findOne(
          userScope(req, {
            _id: id
          })
        );

      if (!user) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      if (
        isSuperAdmin(user) &&
        !isSuperAdmin(req.admin)
      ) {
        return res.status(403).json({
          error:
            "The AI Scholar Hub Superadmin account is protected and cannot be deleted"
        });
      }

      if (!canTargetUser(req, user)) {
        return res.status(403).json({
          error:
            "User administration is not permitted"
        });
      }

      if (
        normalizedRole(user) === "ADMIN"
      ) {
        const count =
          await users.countDocuments({
            role: "ADMIN"
          });

        if (count <= 1) {
          return res.status(400).json({
            error:
              "Cannot delete the last admin"
          });
        }
      }

      await users.deleteOne({
        _id: id
      });

      await audit(
        "USER_DELETED",
        req,
        {
          targetUserId: user._id,
          targetEmail: user.email,
          targetRole: user.role,
          safeDetails: {}
        }
      );

      res.json({
        ok: true
      });
    } catch (e) {
      console.error("[user-delete]", e);

      res.status(500).json({
        error: "Failed to delete user"
      });
    }
  }
);

function parseCSV(text) {
  const lines =
    text
      .split(/\r?\n/)
      .filter(x => x.trim());

  if (!lines.length) {
    return [];
  }

  const headers =
    lines
      .shift()
      .split(",")
      .map(x =>
        x.trim().toLowerCase()
      );

  return lines.map(line => {
    const values = [];

    let value = "";
    let quoted = false;

    for (
      let i = 0;
      i < line.length;
      i++
    ) {
      const c = line[i];

      if (c === '"') {
        quoted = !quoted;
      } else if (
        c === "," &&
        !quoted
      ) {
        values.push(
          value.trim()
        );

        value = "";
      } else {
        value += c;
      }
    }

    values.push(
      value.trim()
    );

    const row = {};

    headers.forEach(
      (h, i) => {
        row[h] =
          values[i] ?? "";
      }
    );

    return row;
  });
}

app.post(
  "/api/users/bulk",
  async (req, res) => {
    try {
      const rows =
        parseCSV(
          String(
            req.body.csv || ""
          )
        );

      const confirm =
        req.body.confirm === true;

      if (!rows.length) {
        return res.status(400).json({
          error: "CSV is empty"
        });
      }

      const allowedRoles =
        isInstitutionAdmin(
          req.admin
        )
          ? [
              "USER",
              "Instructor"
            ]
          : isPlatformAdmin(
              req.admin
            )
            ? [
                "USER",
                "Instructor",
                "INSTITUTION_ADMIN"
              ]
            : [
                "USER",
                "Instructor",
                "INSTITUTION_ADMIN",
                "ADMIN"
              ];

      /*
       * Bulk ADMIN creation is restricted to Superadmin.
       */

      if (!isSuperAdmin(req.admin)) {
        const containsAdmin =
          rows.some(
            r =>
              String(
                r.role ||
                  "USER"
              ).trim() ===
              "ADMIN"
          );

        if (containsAdmin) {
          return res.status(403).json({
            error:
              "Only the AI Scholar Hub Superadmin may create administrator accounts"
          });
        }
      }

      const seen = new Set();
      const preview = [];
      const errors = [];

      for (
        let i = 0;
        i < rows.length;
        i++
      ) {
        const r = rows[i];

        const rowNo = i + 2;

        const name =
          String(
            r.name || ""
          ).trim();

        const username =
          String(
            r.username || ""
          ).trim() ||
          null;

        const email =
          String(
            r.email || ""
          )
            .trim()
            .toLowerCase();

        const role =
          String(
            r.role ||
              "USER"
          ).trim();

        const institutionId =
          String(
            r.institutionId ||
              r.tenantId ||
              ""
          ).trim();

        const ragAccess =
          parseRagAccess(
            r.ragAccess
          );

        if (
          ragAccess ===
          undefined
        ) {
          errors.push(
            `Row ${rowNo}: ragAccess must be true/false, yes/no, or enabled/disabled`
          );

          continue;
        }

        if (
          !name ||
          !email
        ) {
          errors.push(
            `Row ${rowNo}: name and email are required`
          );

          continue;
        }

        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            email
          )
        ) {
          errors.push(
            `Row ${rowNo}: invalid email address`
          );

          continue;
        }

        if (
          !allowedRoles.includes(
            role
          )
        ) {
          errors.push(
            `Row ${rowNo}: invalid or unauthorized role "${role}"`
          );

          continue;
        }

        if (
          [
            "USER",
            "Instructor",
            "INSTITUTION_ADMIN"
          ].includes(role)
        ) {
          const effectiveTenantId =
            isInstitutionAdmin(
              req.admin
            )
              ? actorTenant(req)
              : institutionId;

          if (
            !effectiveTenantId ||
            !/^[-a-zA-Z0-9_.]{1,128}$/.test(
              effectiveTenantId
            )
          ) {
            errors.push(
              `Row ${rowNo}: institutionId is required for institution-scoped users`
            );

            continue;
          }

          if (
            isInstitutionAdmin(
              req.admin
            ) &&
            institutionId &&
            institutionId !==
              actorTenant(req)
          ) {
            errors.push(
              `Row ${rowNo}: Institution Admin may only use their own institution`
            );

            continue;
          }

          const institution =
            await institutions.findOne(
              {
                _id:
                  effectiveTenantId
              }
            );

          if (!institution) {
            errors.push(
              `Row ${rowNo}: institutionId "${effectiveTenantId}" was not found`
            );

            continue;
          }

          if (
            institution.status ===
            "disabled"
          ) {
            errors.push(
              `Row ${rowNo}: institution "${effectiveTenantId}" is disabled`
            );

            continue;
          }
        }

        if (
          ragAccess === true
        ) {
          const prospectiveUser = {
            role,
            tenantId:
              isInstitutionAdmin(
                req.admin
              )
                ? actorTenant(req)
                : institutionId ||
                  null
          };

          if (
            !canManageRagAccess(
              req,
              prospectiveUser
            )
          ) {
            errors.push(
              `Row ${rowNo}: you are not authorized to grant RAG Access to this account`
            );

            continue;
          }
        }

        if (
          seen.has(email)
        ) {
          errors.push(
            `Row ${rowNo}: duplicate email in CSV`
          );

          continue;
        }

        seen.add(email);

        const existing =
          await users.findOne({
            email
          });

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
            reason:
              "Email already exists"
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

      for (
        const item of preview
      ) {
        if (
          item.status ===
          "skipped"
        ) {
          skipped.push({
            email:
              item.email,
            reason:
              item.reason
          });

          continue;
        }

        try {
          const bootstrapPassword =
            crypto.randomBytes(
              32
            ).toString("hex");

          const now =
            new Date();

          const doc = {
            name:
              item.name,

            username:
              item.username ||
              null,

            email:
              item.email,

            emailVerified:
              true,

            password:
              await bcrypt.hash(
                bootstrapPassword,
                10
              ),

            avatar: null,
            provider: "local",

            role:
              item.role,

            ragAccess:
              item.ragAccess ===
              true,

            ...(
              [
                "USER",
                "Instructor",
                "INSTITUTION_ADMIN"
              ].includes(
                item.role
              )
                ? {
                    tenantId:
                      isInstitutionAdmin(
                        req.admin
                      )
                        ? actorTenant(
                            req
                          )
                        : String(
                            item.institutionId ||
                              ""
                          ).trim() ||
                          null
                  }
                : {}
            ),

            plugins: [],
            twoFactorEnabled:
              false,

            termsAccepted:
              false,

            termsAcceptedAt:
              null,

            personalization: {
              memories: true,
              statefulCodeEnvironment:
                "user",
              _id:
                new ObjectId()
            },

            backupCodes: [],
            refreshToken: [],
            favorites: [],
            skillStates: {},

            createdAt: now,
            updatedAt: now,
            __v: 0
          };

          await users.insertOne(
            doc
          );

          let emailSent =
            false;

          try {
            const librechatUrl =
              process.env
                .LIBRECHAT_INTERNAL_URL ||
              "http://api:3080";

            const resetResponse =
              await fetch(
                `${librechatUrl}/api/auth/requestPasswordReset`,
                {
                  method:
                    "POST",

                  headers: {
                    "Content-Type":
                      "application/json"
                  },

                  body:
                    JSON.stringify({
                      email:
                        item.email
                    })
                }
              );

            emailSent =
              resetResponse.ok;

            if (
              !emailSent
            ) {
              const resetData =
                await resetResponse
                  .json()
                  .catch(
                    () => ({})
                  );

              console.error(
                `[bulk-create] Setup email failed for ${item.email}:`,
                resetData
              );
            }
          } catch (
            emailError
          ) {
            console.error(
              `[bulk-create] Setup email request failed for ${item.email}:`,
              emailError
            );
          }

          created.push({
            name:
              item.name,

            email:
              item.email,

            role:
              item.role,

            ragAccess:
              item.ragAccess ===
              true,

            emailSent
          });
        } catch (e) {
          console.error(
            `Bulk create failed for ${item.email}:`,
            e
          );

          failed.push({
            email:
              item.email,

            error:
              "Failed to create user"
          });
        }
      }

      await audit(
        "USERS_BULK_CREATED",
        req,
        {
          safeDetails: {
            createdCount:
              created.length,

            skippedCount:
              skipped.length,

            failedCount:
              failed.length,

            errorCount:
              errors.length,

            roles: [
              ...new Set(
                created.map(
                  x => x.role
                )
              )
            ],

            ragAccessCount:
              created.filter(
                x =>
                  x.ragAccess ===
                  true
              ).length
          }
        }
      );

      res.json({
        ok: true,
        created,
        skipped,
        failed,
        errors
      });
    } catch (e) {
      console.error(
        "[bulk-upload]",
        e
      );

      res.status(500).json({
        error:
          "Bulk upload failed"
      });
    }
  }
);

app.get(
  "/api/users/export",
  async (req, res) => {
    try {
      const rows =
        await users.find(
          userScope(req),
          {
            projection: {
              name: 1,
              username: 1,
              email: 1,
              role: 1,
              provider: 1,
              tenantId: 1,
              ragAccess: 1,
              createdAt: 1
            }
          }
        )
        .sort({
          createdAt: -1
        })
        .toArray();

      const esc =
        v =>
          `"${String(
            v ?? ""
          ).replaceAll(
            '"',
            '""'
          )}"`;

      const csv = [
        [
          "name",
          "username",
          "email",
          "role",
          "institutionId",
          "provider",
          "ragAccess",
          "createdAt"
        ].join(","),

        ...rows.map(
          u =>
            [
              u.name,
              u.username,
              u.email,
              u.role,
              u.tenantId,
              u.provider,
              normalizedRagAccess(
                u
              ),
              u.createdAt
                ?.toISOString?.() ||
                ""
            ]
              .map(esc)
              .join(",")
        )
      ].join("\n");

      res.setHeader(
        "Content-Type",
        "text/csv"
      );

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=ai-scholar-hub-users.csv"
      );

      res.send(csv);
    } catch (e) {
      console.error(
        "[users-export]",
        e
      );

      res.status(500).json({
        error:
          "Failed to export users"
      });
    }
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `AI Scholar Hub User Management listening on port ${PORT}`
    );
  }
);
