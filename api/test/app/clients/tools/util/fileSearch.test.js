const axios = require('axios');
const { ResourceType } = require('librechat-data-provider');

jest.mock('axios');
jest.mock('@librechat/api', () => ({
  generateShortLivedToken: jest.fn(),
  getKnowledgeSourceLabel: jest.fn((scopeKey) => {
    const type = String(scopeKey || '').split(':', 1)[0];
    return type === 'INSTITUTION' ? 'Institutional knowledge' : 'Personal or attached file';
  }),
  logAxiosError: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/server/services/Files/permissions', () => ({
  filterFilesByAgentAccess: jest.fn((options) => Promise.resolve(options.files)),
}));

jest.mock('~/server/services/AcademicIntelligence/knowledgeScope', () => ({
  resolveAuthorizedKnowledgeScopes: jest.fn().mockResolvedValue({
    scope: {},
    scopeKeys: [],
  }),
}));

const { createFileSearchTool, primeFiles } = require('~/app/clients/tools/util/fileSearch');
const { generateShortLivedToken } = require('@librechat/api');
const {
  resolveAuthorizedKnowledgeScopes,
} = require('~/server/services/AcademicIntelligence/knowledgeScope');

describe('fileSearch.js - agent file authorization', () => {
  it('uses the permission resource type established by the calling route', async () => {
    const { getFiles } = require('~/models');
    const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
    const files = [{ file_id: 'owner-file', filename: 'owner.pdf', user: 'agent-owner' }];
    getFiles.mockResolvedValueOnce(files);

    await primeFiles({
      req: { user: { id: 'remote-viewer', role: 'USER' } },
      agentId: 'agent-123',
      agentResourceType: ResourceType.REMOTE_AGENT,
      tool_resources: { file_search: { file_ids: ['owner-file'] } },
    });

    expect(filterFilesByAgentAccess).toHaveBeenCalledWith({
      files,
      userId: 'remote-viewer',
      role: 'USER',
      agentId: 'agent-123',
      resourceType: ResourceType.REMOTE_AGENT,
    });
  });
});

describe('fileSearch.js - tuple return validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://localhost:8000';
  });

  describe('error cases should return tuple with undefined as second value', () => {
    it('should return tuple when no files provided', async () => {
      const fileSearchTool = await createFileSearchTool({
        userId: 'user1',
        files: [],
      });

      const result = await fileSearchTool.func({ query: 'test query' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('No files to search. Instruct the user to add files for the search.');
      expect(result[1]).toBeUndefined();
    });

    it('should return tuple when JWT token generation fails', async () => {
      generateShortLivedToken.mockReturnValue(null);

      const fileSearchTool = await createFileSearchTool({
        userId: 'user1',
        files: [{ file_id: 'file-1', filename: 'test.pdf' }],
      });

      const result = await fileSearchTool.func({ query: 'test query' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('There was an error authenticating the file search request.');
      expect(result[1]).toBeUndefined();
    });

    it('should return tuple when no valid results found', async () => {
      generateShortLivedToken.mockReturnValue('mock-jwt-token');
      axios.post.mockRejectedValue(new Error('API Error'));

      const fileSearchTool = await createFileSearchTool({
        userId: 'user1',
        files: [{ file_id: 'file-1', filename: 'test.pdf' }],
      });

      const result = await fileSearchTool.func({ query: 'test query' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('No results found or errors occurred while searching the files.');
      expect(result[1]).toBeUndefined();
    });
  });

  describe('success cases should return tuple with artifact object', () => {
    it('should return tuple with formatted results and sources artifact', async () => {
      generateShortLivedToken.mockReturnValue('mock-jwt-token');

      const mockApiResponse = {
        data: [
          [
            {
              page_content: 'This is test content from the document',
              metadata: { source: '/path/to/test.pdf', page: 1, file_id: 'file-123' },
            },
            0.2,
          ],
          [
            {
              page_content: 'Additional relevant content',
              metadata: { source: '/path/to/test.pdf', page: 2, file_id: 'file-123' },
            },
            0.35,
          ],
        ],
      };

      axios.post.mockResolvedValue(mockApiResponse);

      const fileSearchTool = await createFileSearchTool({
        userId: 'user1',
        files: [{ file_id: 'file-123', filename: 'test.pdf' }],
        entity_id: 'agent-456',
      });

      const result = await fileSearchTool.func({ query: 'test query' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);

      const [formattedString, artifact] = result;

      expect(typeof formattedString).toBe('string');
      expect(formattedString).toContain('File: test.pdf');
      expect(formattedString).toContain('Source context: Personal or attached file');
      expect(formattedString).toContain('Relevance:');
      expect(formattedString).toContain('This is test content from the document');
      expect(formattedString).toContain('Additional relevant content');

      expect(artifact).toBeDefined();
      expect(artifact).toHaveProperty('file_search');
      expect(artifact.file_search).toHaveProperty('sources');
      expect(artifact.file_search).toHaveProperty('fileCitations', false);
      expect(Array.isArray(artifact.file_search.sources)).toBe(true);
      expect(artifact.file_search.sources.length).toBe(2);

      const source = artifact.file_search.sources[0];
      expect(source).toMatchObject({
        type: 'file',
        fileId: 'file-123',
        fileName: 'test.pdf',
        content: expect.any(String),
        relevance: expect.any(Number),
        pages: [1],
        pageRelevance: { 1: expect.any(Number) },
      });
    });

    it('should include file citations in description when enabled', async () => {
      generateShortLivedToken.mockReturnValue('mock-jwt-token');

      const mockApiResponse = {
        data: [
          [
            {
              page_content: 'Content with citations',
              metadata: { source: '/path/to/doc.pdf', page: 3, file_id: 'file-789' },
            },
            0.15,
          ],
        ],
      };

      axios.post.mockResolvedValue(mockApiResponse);

      const fileSearchTool = await createFileSearchTool({
        userId: 'user1',
        files: [{ file_id: 'file-789', filename: 'doc.pdf' }],
        fileCitations: true,
      });

      const result = await fileSearchTool.func({ query: 'test query' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);

      const [formattedString, artifact] = result;

      expect(formattedString).toContain('Anchor:');
      expect(formattedString).toContain('\\ue202turn0file0');
      expect(artifact.file_search.fileCitations).toBe(true);
    });

    it('should handle multiple files correctly', async () => {
      generateShortLivedToken.mockReturnValue('mock-jwt-token');

      const response = {
        data: [
          [
            {
              page_content: 'Content from file 1',
              metadata: { source: '/path/to/file1.pdf', page: 1, file_id: 'file-1' },
            },
            0.25,
          ],
          [
            {
              page_content: 'Content from file 2',
              metadata: { source: '/path/to/file2.pdf', page: 1, file_id: 'file-2' },
            },
            0.15,
          ],
        ],
      };

      axios.post.mockResolvedValue(response);

      const fileSearchTool = await createFileSearchTool({
        userId: 'user1',
        files: [
          { file_id: 'file-1', filename: 'file1.pdf' },
          { file_id: 'file-2', filename: 'file2.pdf' },
        ],
      });

      const result = await fileSearchTool.func({ query: 'test query' });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);

      const [formattedString, artifact] = result;

      expect(formattedString).toContain('file1.pdf');
      expect(formattedString).toContain('file2.pdf');
      expect(artifact.file_search.sources).toHaveLength(2);
      // Results are sorted by distance (ascending), so file-2 (0.15) comes before file-1 (0.25)
      expect(artifact.file_search.sources[0].fileId).toBe('file-2');
      expect(artifact.file_search.sources[1].fileId).toBe('file-1');
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post.mock.calls[0][0]).toMatch(/\/query_scoped$/);
      expect(axios.post.mock.calls[0][1].file_ids).toEqual(['file-1', 'file-2']);
    });
  });
});

describe('entity_id scoping by file origin', () => {
  const ORIGINAL_RAG_API_URL = process.env.RAG_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://localhost:8000';
    generateShortLivedToken.mockReturnValue('mock-jwt-token');
    axios.post.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    if (ORIGINAL_RAG_API_URL === undefined) {
      delete process.env.RAG_API_URL;
    } else {
      process.env.RAG_API_URL = ORIGINAL_RAG_API_URL;
    }
  });

  function bodiesSent() {
    return axios.post.mock.calls
      .filter(([url]) => String(url).endsWith('/query_scoped'))
      .map(([, body]) => body);
  }

  it('sends entity_id only for agent knowledge-base files', async () => {
    const tool = await createFileSearchTool({
      userId: 'user1',
      entity_id: 'agent_123',
      files: [
        { file_id: 'kb-1', filename: 'kb.pdf', fromAgent: true },
        { file_id: 'user-1', filename: 'attachment.txt', fromAgent: false },
      ],
    });
    await tool.func({ query: 'q' });

    const bodies = bodiesSent();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      file_ids: ['kb-1', 'user-1'],
      entity_id: 'agent_123',
    });
  });

  it('omits entity_id when fromAgent is not set (safe default)', async () => {
    const tool = await createFileSearchTool({
      userId: 'user1',
      entity_id: 'agent_123',
      files: [{ file_id: 'legacy-1', filename: 'legacy.pdf' }],
    });
    await tool.func({ query: 'q' });
    expect(bodiesSent()[0].entity_id).toBeUndefined();
  });

  it('sends no entity_id when none is provided', async () => {
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [{ file_id: 'f1', filename: 'a.txt', fromAgent: true }],
    });
    await tool.func({ query: 'q' });
    expect(bodiesSent()[0].entity_id).toBeUndefined();
  });
});

describe('AI Scholar Hub hierarchical File Search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAuthorizedKnowledgeScopes.mockResolvedValue({
      scope: {},
      scopeKeys: [],
    });
  });

  it('primes shared-only institutional knowledge without enumerating documents', async () => {
    resolveAuthorizedKnowledgeScopes.mockResolvedValueOnce({
      scope: {},
      scopeKeys: ['INSTITUTION:SEEDS'],
    });

    const result = await primeFiles({
      req: {
        user: {
          id: 'user-1',
          tenantId: 'SEEDS',
          role: 'USER',
        },
      },
      tool_resources: undefined,
    });

    expect(resolveAuthorizedKnowledgeScopes).toHaveBeenCalledWith({
      tenantId: 'SEEDS',
      userId: 'user-1',
      role: 'USER',
      activeGroupId: null,
    });
    expect(result.files).toEqual([]);
    expect(result.authorizedKnowledgeScopeKeys).toEqual(['INSTITUTION:SEEDS']);
    expect(result.toolContext).toContain('authorized institutional knowledge');
  });

  it('preserves personal-only File Search', async () => {
    const { getFiles } = require('~/models');
    getFiles.mockResolvedValueOnce([
      {
        file_id: 'personal-file',
        filename: 'personal.pdf',
        user: 'user-1',
      },
    ]);

    const result = await primeFiles({
      req: {
        user: {
          id: 'user-1',
          tenantId: 'SEEDS',
          role: 'USER',
        },
      },
      tool_resources: {
        file_search: {
          file_ids: ['personal-file'],
        },
      },
    });

    expect(result.files).toEqual([
      expect.objectContaining({
        file_id: 'personal-file',
        fromInstitutionalKnowledge: false,
      }),
    ]);
    expect(result.authorizedKnowledgeScopeKeys).toEqual([]);
  });

  it('merges personal and shared knowledge without replacing either', async () => {
    const { getFiles } = require('~/models');
    getFiles.mockResolvedValueOnce([
      {
        file_id: 'personal-file',
        filename: 'personal.pdf',
        user: 'user-1',
      },
    ]);
    resolveAuthorizedKnowledgeScopes.mockResolvedValueOnce({
      scope: {},
      scopeKeys: ['INSTITUTION:SEEDS'],
    });

    const result = await primeFiles({
      req: {
        user: {
          id: 'user-1',
          tenantId: 'SEEDS',
          role: 'USER',
        },
      },
      tool_resources: {
        file_search: {
          file_ids: ['personal-file'],
        },
      },
    });

    expect(result.files.map((file) => file.file_id)).toEqual(['personal-file']);
    expect(result.authorizedKnowledgeScopeKeys).toEqual(['INSTITUTION:SEEDS']);
  });

  it('honors a user RAG Point selection only by narrowing authorized scopes', async () => {
    resolveAuthorizedKnowledgeScopes.mockResolvedValueOnce({
      scope: {},
      scopeKeys: ['INSTITUTION:SEEDS', 'GROUP:allowed-group'],
    });

    const result = await primeFiles({
      req: {
        user: { id: 'user-1', tenantId: 'SEEDS', role: 'USER' },
        body: {
          ragSelection: {
            enabled: true,
            selectedPointKeys: ['PERSONAL', 'GROUP:allowed-group', 'GROUP:forged-group'],
          },
        },
      },
      tool_resources: undefined,
    });

    expect(result.authorizedKnowledgeScopeKeys).toEqual(['GROUP:allowed-group']);
  });

  it('disables all document retrieval when the user disables RAG', async () => {
    resolveAuthorizedKnowledgeScopes.mockResolvedValueOnce({
      scope: {},
      scopeKeys: ['INSTITUTION:SEEDS'],
    });
    const result = await primeFiles({
      req: {
        user: { id: 'user-1', tenantId: 'SEEDS', role: 'USER' },
        body: { ragSelection: { enabled: false } },
      },
      tool_resources: undefined,
    });
    expect(result.files).toEqual([]);
    expect(result.authorizedKnowledgeScopeKeys).toEqual([]);
    expect(result.ragEnabled).toBe(false);
  });

  it('runs exactly one vector query for personal plus institutional knowledge', async () => {
    generateShortLivedToken.mockReturnValue('mock-jwt-token');
    axios.post.mockResolvedValue({
      data: [[{
        page_content: 'Grounded institutional content',
        metadata: {
          source: '/documents/institution.pdf',
          file_id: 'institution-file',
          page: 4,
          knowledge_scope_key: 'INSTITUTION:SEEDS',
        },
      }, 0.1]],
    });

    const fileSearchTool = await createFileSearchTool({
      userId: 'user-1',
      tenantId: 'SEEDS',
      files: [
        { file_id: 'personal-file', filename: 'personal.pdf', fromAgent: false },
      ],
      authorizedKnowledgeScopeKeys: ['INSTITUTION:SEEDS'],
    });

    const [formattedString, artifact] = await fileSearchTool.func({
      query: 'grounded question',
    });

    expect(formattedString).toContain('Source context: Institutional knowledge');
    expect(artifact.file_search.sources).toHaveLength(1);
    expect(artifact.file_search.sources[0]).toMatchObject({
      fileId: 'institution-file',
      fileName: 'institution.pdf',
      pages: [4],
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1]).toEqual({
      query: 'grounded question',
      file_ids: ['personal-file'],
      k: 10,
    });
    expect(generateShortLivedToken).toHaveBeenCalledWith(
      'user-1',
      '1m',
      'SEEDS',
      { authorizedKnowledgeScopeKeys: ['INSTITUTION:SEEDS'] },
    );
  });

  it('instructs factual institutional lookup without overriding learning pedagogy', async () => {
    const fileSearchTool = await createFileSearchTool({
      userId: 'user-1',
      tenantId: 'SEEDS',
      files: [],
      authorizedKnowledgeScopeKeys: ['INSTITUTION:SEEDS'],
    });

    expect(fileSearchTool.description).toContain(
      'For factual or administrative institutional requests, answer directly',
    );
    expect(fileSearchTool.description).toContain(
      'unless the user requests teaching',
    );
  });
});
