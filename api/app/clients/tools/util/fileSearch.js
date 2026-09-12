const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const {
  generateShortLivedToken,
  getKnowledgeSourceLabel,
  logAxiosError,
} = require('@librechat/api');
const { Tools, EToolResources } = require('librechat-data-provider');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { getFiles } = require('~/models');
const {
  resolveAuthorizedKnowledgeScopes,
} = require('~/server/services/AcademicIntelligence/knowledgeScope');

const fileSearchJsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        "A natural language query to search for relevant information in the files. Be specific and use keywords related to the information you're looking for. The query will be used for semantic similarity matching against the file contents.",
    },
  },
  required: ['query'],
};

/**
 *
 * @param {Object} options
 * @param {ServerRequest} options.req
 * @param {Agent['tool_resources']} options.tool_resources
 * @param {string} [options.agentId] - The agent ID for file access control
 * @param {string} [options.agentResourceType] - Permission resource type for the authorized agent route
 * @returns {Promise<{
 *   files: Array<{ file_id: string; filename: string; fromAgent: boolean }>,
 *   toolContext: string
 * }>}
 */
const primeFiles = async (options) => {
  const {
    tool_resources,
    req,
    agentId,
    agentResourceType,
  } = options;
  const file_ids = tool_resources?.[EToolResources.file_search]?.file_ids ?? [];
  const agentResourceIds = new Set(file_ids);
  const resourceFiles = tool_resources?.[EToolResources.file_search]?.files ?? [];

  // Get all files first
  const allFiles = (await getFiles({ file_id: { $in: file_ids } }, null, { text: 0 })) ?? [];

  // Filter by access if user and agent are provided
  let dbFiles;
  if (req?.user?.id && agentId) {
    dbFiles = await filterFilesByAgentAccess({
      files: allFiles,
      userId: req.user.id,
      role: req.user.role,
      agentId,
      resourceType: agentResourceType,
    });
  } else {
    dbFiles = allFiles;
  }

  dbFiles = dbFiles.concat(resourceFiles);

  let authorizedKnowledgeScopeKeys = [];
  const ragSelection = req?.body?.ragSelection;
  const ragEnabled = ragSelection?.enabled !== false;
  const hasExplicitSelection = Array.isArray(ragSelection?.selectedPointKeys);
  const selectedPointKeys = new Set(
    hasExplicitSelection
      ? ragSelection.selectedPointKeys.map((value) => String(value || '').trim())
      : [],
  );
  const includePersonal = ragEnabled && (!hasExplicitSelection || selectedPointKeys.has('PERSONAL'));

  /*
   * Hierarchical institutional knowledge belongs to the authenticated
   * user's normal AIH retrieval scope. It is independent of any selected
   * or persisted Agent and is merged with personal/attached files.
   */
  if (req?.user?.id && req?.user?.tenantId) {
    const knowledge = await resolveAuthorizedKnowledgeScopes({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      role: req.user.role,

      /*
       * No active academic group is currently transported through the
       * LibreChat tool path. Null means the user's complete authorized
       * hierarchy. A future activeGroupId may narrow this, never expand it.
       */
      activeGroupId: null,
    });

    authorizedKnowledgeScopeKeys = ragEnabled
      ? knowledge.scopeKeys.filter(
          (key) => !hasExplicitSelection || selectedPointKeys.has(key),
        )
      : [];
  }

  let toolContext = `- Note: Semantic search is available through the ${Tools.file_search} tool but no files are currently loaded. Request the user to upload documents to search through.`;

  const files = [];
  for (let i = 0; i < dbFiles.length; i++) {
    const file = dbFiles[i];
    if (!file) {
      continue;
    }
    if (i === 0) {
      toolContext = `- Note: The ${Tools.file_search} tool is available for relevant document-grounded questions. Use it only when the user's request plausibly concerns one of these documents, institutional/course/group knowledge, or the user explicitly asks to search files. Do not invoke File Search for ordinary general-knowledge questions merely because documents are available:`;
    }
    toolContext += `\n\t- ${file.filename}${
      agentResourceIds.has(file.file_id)
        ? ''
        : file.fromInstitutionalKnowledge === true
          ? ' (authorized institutional knowledge)'
          : ' (just attached by user)'
    }`;
    files.push({
      file_id: file.file_id,
      filename: file.filename,
      fromAgent: agentResourceIds.has(file.file_id),
      fromInstitutionalKnowledge:
        file.fromInstitutionalKnowledge === true,
    });
  }

  if (authorizedKnowledgeScopeKeys.length) {
    if (!files.length) {
      toolContext = `- Note: Authorized institutional knowledge is available through ${Tools.file_search}. Use it only when the user's request plausibly concerns institutional, course, department, group, policy, or document-specific information, or when the user explicitly asks to search institutional files. Do not invoke it for unrelated general-world questions.`;
    } else {
      toolContext += '\n\t- Authorized institutional knowledge';
    }
  }
  if (!ragEnabled) {
    toolContext = '- Note: Document search is disabled for this conversation.';
  }

  return {
    files: includePersonal ? files : [],
    toolContext,
    authorizedKnowledgeScopeKeys,
    ragEnabled,
  };
};

/**
 *
 * @param {Object} options
 * @param {string} options.userId
 * @param {Array<{ file_id: string; filename: string; fromAgent?: boolean }>} options.files
 * @param {string} [options.entity_id]
 * @param {boolean} [options.fileCitations=false] - Whether to include citation instructions
 * @returns
 */
const createFileSearchTool = async ({
  userId,
  tenantId,
  files,
  entity_id,
  fileCitations = false,
  authorizedKnowledgeScopeKeys = [],
  ragEnabled = true,
}) => {
  return tool(
    async ({ query }) => {
      if (!ragEnabled) {
        return ['Document search is disabled for this conversation.', undefined];
      }
      if (files.length === 0 && authorizedKnowledgeScopeKeys.length === 0) {
        return ['No files to search. Instruct the user to add files for the search.', undefined];
      }
      /*
       * Ordinary LibreChat file search keeps the existing five-minute token.
       *
       * Hierarchy-authorized institutional knowledge uses a one-minute token.
       * The authorization itself is recomputed from Mongo before these file
       * IDs are signed, so this short lifetime bounds the residual revocation
       * window of an already-issued institutional credential.
       */
      const jwtToken = generateShortLivedToken(
        userId,
        authorizedKnowledgeScopeKeys.length ? '1m' : '5m',
        tenantId,
        authorizedKnowledgeScopeKeys.length
          ? { authorizedKnowledgeScopeKeys }
          : {},
      );
      if (!jwtToken) {
        return ['There was an error authenticating the file search request.', undefined];
      }

      const fileIds = files.map((file) => file.file_id).filter(Boolean);
      const body = {
        query,
        file_ids: fileIds,
        k: 10,
      };
      if (entity_id && files.some((file) => file.fromAgent === true)) {
        body.entity_id = entity_id;
      }

      let result;
      try {
        result = await axios.post(`${process.env.RAG_API_URL}/query_scoped`, body, {
          headers: {
            Authorization: `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        logAxiosError({
          message: 'Error encountered in `file_search` while running scoped search',
          error,
        });
        return ['No results found or errors occurred while searching the files.', undefined];
      }

      const formattedResults = result.data
        .map(([docInfo, distance]) => ({
          filename: docInfo.metadata.source.split('/').pop(),
          content: docInfo.page_content,
          distance,
          file_id: docInfo.metadata.file_id,
          page: docInfo.metadata.page || null,
          sourceContext: getKnowledgeSourceLabel(docInfo.metadata.knowledge_scope_key),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);

      if (formattedResults.length === 0) {
        return [
          'No content found in the files. The files may not have been processed correctly or you may need to refine your query.',
          undefined,
        ];
      }

      const formattedString = formattedResults
        .map(
          (result, index) =>
            `File: ${result.filename}${
              fileCitations ? `\nAnchor: \\ue202turn0file${index} (${result.filename})` : ''
            }\nSource context: ${result.sourceContext}\nRelevance: ${(1.0 - result.distance).toFixed(4)}\nContent: ${result.content}\n`,
        )
        .join('\n---\n');

      const sources = formattedResults.map((result) => ({
        type: 'file',
        fileId: result.file_id,
        content: result.content,
        fileName: result.filename,
        relevance: 1.0 - result.distance,
        pages: result.page ? [result.page] : [],
        pageRelevance: result.page ? { [result.page]: 1.0 - result.distance } : {},
      }));

      return [formattedString, { [Tools.file_search]: { sources, fileCitations } }];
    },
    {
      name: Tools.file_search,
      responseFormat: 'content_and_artifact',
      description: `Performs semantic search across attached and authorized "${Tools.file_search}" documents using natural language queries. Invoke this tool only when the user's request plausibly depends on attached documents, institutional/course/department/group knowledge, or explicitly asks for file/document search. Do not use it for unrelated general-knowledge questions simply because authorized files exist. This tool analyzes document content to find relevant information, quotes, and passages. Retrieved source-context labels distinguish personal, institutional, department, course, and group evidence. For factual or administrative institutional requests, answer directly from the evidence with citations and do not append a Socratic exercise unless the user requests teaching.${
        fileCitations
          ? `

**CITE FILE SEARCH RESULTS:**
Use the EXACT anchor markers shown below (copy them verbatim) immediately after statements derived from file content. Reference the filename in your text:
- File citation: "The document.pdf states that... \\ue202turn0file0"  
- Page reference: "According to report.docx... \\ue202turn0file1"
- Multi-file: "Multiple sources confirm... \\ue200\\ue202turn0file0\\ue202turn0file1\\ue201"

**CRITICAL:** Output these escape sequences EXACTLY as shown (e.g., \\ue202turn0file0). Do NOT substitute with other characters like † or similar symbols.
**ALWAYS mention the filename in your text before the citation marker. NEVER use markdown links or footnotes.**`
          : ''
      }`,
      schema: fileSearchJsonSchema,
    },
  );
};

module.exports = { createFileSearchTool, primeFiles, fileSearchJsonSchema };
