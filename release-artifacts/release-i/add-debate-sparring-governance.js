const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db('LibreChat');
  const now = new Date();

  const providerKey = 'ais-free-router';
  const model = 'sparring';
  const policyRef = `${providerKey}:${model}`;

  // 1. Managed logical model catalog.
  await db.collection('aiModels').updateOne(
    { providerKey, model },
    {
      $set: {
        enabled: true,
        managed: true,
        label: 'Debate & Sparring — Deep Reasoning',
        description: 'Managed AI Scholar Hub debate and intellectual sparring route',
        costTier: 'BALANCED',
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );

  // 2. Governed persona -> logical runtime route.
  await db.collection('personaModelRoutes').updateOne(
    {
      tenantId: 'SEEDS',
      personaId: 'DEBATE_SPARRING_PARTNER',
      routeId: 'PRIMARY'
    },
    {
      $set: {
        modelSpecName: 'Debate & Sparring Partner',
        providerKey,
        model,
        priority: 250,
        enabled: true,
        description: 'Primary governed route for Debate & Sparring Partner',
        updatedAt: now
      },
      $setOnInsert: {
        tenantId: 'SEEDS',
        personaId: 'DEBATE_SPARRING_PARTNER',
        routeId: 'PRIMARY',
        createdAt: now
      }
    },
    { upsert: true }
  );

  // 3. Existing role entitlements gain sparring without changing defaults.
  const roles = [
    'USER',
    'INSTRUCTOR',
    'INSTITUTION_ADMIN',
    'SUPERADMIN'
  ];

  for (const role of roles) {
    const result = await db.collection('modelEntitlements').updateOne(
      {
        tenantId: 'SEEDS',
        role,
        agentId: '*',
        enabled: true
      },
      {
        $addToSet: {
          allowedModels: policyRef
        },
        $set: {
          updatedAt: now
        }
      }
    );

    if (!result.matchedCount) {
      throw new Error(
        `Missing existing SEEDS entitlement for role ${role}; refusing to invent one`
      );
    }
  }

  // 4. Permit Superadmin to exercise the agent in the user-facing DEV UI.
  await db.collection('academicAgents').updateOne(
    {
      tenantId: 'SEEDS',
      agentId: 'DEBATE_SPARRING_PARTNER'
    },
    {
      $addToSet: {
        allowedRoles: 'SUPERADMIN'
      },
      $set: {
        updatedAt: now
      }
    }
  );

  console.log('PASS: Debate/Sparring governance migration applied');

  await client.close();
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
