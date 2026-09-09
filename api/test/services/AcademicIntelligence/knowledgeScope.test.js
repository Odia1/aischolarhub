const mockState = {
  user: null,
  directGroups: [],
  policies: [],
  files: [],
};

const mockAcademicAgentFindOne = jest.fn();

function cursor(values) {
  return {
    toArray: jest.fn().mockResolvedValue(values),
  };
}

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'users') {
      return {
        findOne: jest.fn(async (filter) => {
          if (
            mockState.user &&
            mockState.user.tenantId === filter.tenantId
          ) {
            return mockState.user;
          }
          return null;
        }),
      };
    }

    if (name === 'academicAgents') {
      return {
        findOne: mockAcademicAgentFindOne,
      };
    }

    if (name === 'groups') {
      return {
        find: jest.fn(() => cursor(mockState.directGroups)),
        findOne: jest.fn(async (filter) =>
          mockState.directGroups.find(
            (group) =>
              String(group._id) === String(filter._id) &&
              group.tenantId === filter.tenantId,
          ) || null
        ),
      };
    }

    if (name === 'ragGroups') {
      return {
        find: jest.fn(() =>
          cursor(
            mockState.policies.filter(
              (policy) =>
                policy.enabled !== false &&
                Array.isArray(policy.ragLocationIds) &&
                policy.ragLocationIds.length > 0,
            ),
          )
        ),
      };
    }

    if (name === 'ragLocations') {
      return {
        find: jest.fn(() => cursor([])),
      };
    }

    if (name === 'files') {
      return {
        find: jest.fn((filter) => {
          const institutionGranted = (filter.$or || []).some(
            (clause) =>
              clause['knowledgeScope.type'] === 'INSTITUTION' &&
              clause['knowledgeScope.targetId'] === filter.tenantId,
          );

          return cursor(
            institutionGranted
              ? mockState.files.filter(
                  (file) =>
                    file.tenantId === filter.tenantId &&
                    file.embedded === true &&
                    file.enabled !== false &&
                    file.published !== false,
                )
              : [],
          );
        }),
      };
    }

    throw new Error(`Unexpected collection: ${name}`);
  }),
};

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');

  return {
    ...actual,
    connection: {
      readyState: 1,
      db: mockDb,
    },
  };
});

const {
  resolveAuthorizedKnowledgeFiles,
  resolveAuthorizedKnowledgeScopes,
} = require(
  '~/server/services/AcademicIntelligence/knowledgeScope'
);

const USER_ID = '64a000000000000000000001';
const GROUP_ID = '64a000000000000000000002';
const POLICY_ID = '64a000000000000000000003';

function makeUser(overrides = {}) {
  return {
    _id: USER_ID,
    tenantId: 'SEEDS',
    role: 'USER',
    ragAccess: true,
    ...overrides,
  };
}

function makeGroup() {
  return {
    _id: GROUP_ID,
    tenantId: 'SEEDS',
    memberIds: [USER_ID],
    parentGroupId: null,
  };
}

function makePolicy(overrides = {}) {
  return {
    _id: POLICY_ID,
    tenantId: 'SEEDS',
    enabled: true,
    accessMode: 'GROUP_ONLY',
    groupIds: [GROUP_ID],
    userIds: [],
    ragLocationIds: ['institution:SEEDS'],
    ...overrides,
  };
}

function makeFile(id) {
  return {
    file_id: id,
    filename: `${id}.pdf`,
    tenantId: 'SEEDS',
    embedded: true,
    enabled: true,
    published: true,
    knowledgeScope: {
      type: 'INSTITUTION',
      targetId: 'SEEDS',
    },
  };
}

async function resolve(tenantId = 'SEEDS') {
  return resolveAuthorizedKnowledgeFiles({
    tenantId,
    userId: USER_ID,
    role: 'USER',
    activeGroupId: null,
  });
}

describe('AI Scholar Hub hierarchical knowledge authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = makeUser();
    mockState.directGroups = [makeGroup()];
    mockState.policies = [makePolicy()];
    mockState.files = [makeFile('institution-1'), makeFile('institution-2')];
  });

  it('authorizes institutional files through membership plus enabled policy', async () => {
    const result = await resolve();

    expect(result.files.map((file) => file.file_id)).toEqual([
      'institution-1',
      'institution-2',
    ]);
    expect(result.scope.allowedScopes.institution).toEqual({
      allowed: true,
      tenantId: 'SEEDS',
    });

    /*
     * Normal chat must not perform an Academic Agent lookup.
     */
    expect(mockAcademicAgentFindOne).not.toHaveBeenCalled();
  });

  it('resolves compact RAG Point keys without enumerating repository files', async () => {
    const result = await resolveAuthorizedKnowledgeScopes({
      tenantId: 'SEEDS',
      userId: USER_ID,
      role: 'USER',
      activeGroupId: null,
    });

    expect(result.scopeKeys).toEqual(['INSTITUTION:SEEDS']);
    expect(result.scope.availableRagPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'PERSONAL', defaultSelected: true }),
        expect.objectContaining({ key: 'INSTITUTION:SEEDS', defaultSelected: false }),
      ]),
    );
  });

  it('returns no institutional files when ragAccess is false', async () => {
    mockState.user = makeUser({ ragAccess: false });

    const result = await resolve();

    expect(result.files).toEqual([]);
    expect(result.scope.allowedScopes.institution.allowed).toBe(false);
  });

  it('denies a nonmember even when the policy and access point exist', async () => {
    mockState.directGroups = [];

    const result = await resolve();

    expect(result.files).toEqual([]);
    expect(result.scope.allowedScopes.institution.allowed).toBe(false);
  });

  it('rejects cross-tenant user context', async () => {
    await expect(resolve('OTHER_TENANT')).rejects.toThrow(
      'User not found in this institution',
    );
  });

  it('ignores disabled and empty policies', async () => {
    mockState.policies = [
      makePolicy({ enabled: false }),
      makePolicy({ ragLocationIds: [] }),
    ];

    const result = await resolve();

    expect(result.files).toEqual([]);
    expect(result.scope.allowedScopes.institution.allowed).toBe(false);
  });
});
