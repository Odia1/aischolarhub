const FILE_CITATION_PATTERN = /(?:\\ue202|\ue202)turn\d+file\d+/;
const FILE_SEARCH = 'file_search';

/**
 * Models are asked to place file citation anchors in their answer, but some
 * providers omit them even when File Search returned grounded sources. The
 * structured attachment remains authoritative, so add a response-level source
 * block only when no file anchor exists anywhere in the completed response.
 *
 * File-search attachments are mapped by the client to consecutive file turns;
 * references inside each turn are de-duplicated by fileId in first-seen order.
 */
function buildFileCitationFallback(attachments) {
  if (!Array.isArray(attachments)) {
    return '';
  }

  const anchors = [];
  let turn = 0;
  for (const attachment of attachments) {
    if (attachment?.type !== FILE_SEARCH || !attachment?.[FILE_SEARCH]) {
      continue;
    }

    const sources = attachment[FILE_SEARCH].sources;
    const seenFileIds = new Set();
    if (Array.isArray(sources)) {
      for (const source of sources) {
        const fileId = typeof source?.fileId === 'string' ? source.fileId.trim() : '';
        if (!fileId || seenFileIds.has(fileId)) {
          continue;
        }
        seenFileIds.add(fileId);
        anchors.push(`\\ue202turn${turn}file${seenFileIds.size - 1}`);
      }
    }
    turn += 1;
  }

  if (anchors.length === 0) {
    return '';
  }
  return anchors.length === 1
    ? `Sources: ${anchors[0]}`
    : `Sources: \\ue200${anchors.join('')}\\ue201`;
}

function ensureFileCitationAnchors(responseMessage) {
  if (!responseMessage || !Array.isArray(responseMessage.attachments)) {
    return responseMessage;
  }

  const contentText = Array.isArray(responseMessage.content)
    ? responseMessage.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
    : '';
  const legacyText = typeof responseMessage.text === 'string' ? responseMessage.text : '';
  if (FILE_CITATION_PATTERN.test(`${legacyText}\n${contentText}`)) {
    return responseMessage;
  }

  const fallback = buildFileCitationFallback(responseMessage.attachments);
  if (!fallback) {
    return responseMessage;
  }

  if (Array.isArray(responseMessage.content)) {
    const lastTextIndex = responseMessage.content.findLastIndex(
      (part) => part?.type === 'text' && typeof part.text === 'string',
    );
    if (lastTextIndex >= 0) {
      const part = responseMessage.content[lastTextIndex];
      responseMessage.content[lastTextIndex] = {
        ...part,
        text: `${part.text.trimEnd()}\n\n${fallback}`,
      };
    } else {
      responseMessage.content.push({ type: 'text', text: fallback });
    }
  } else {
    responseMessage.text = legacyText
      ? `${legacyText.trimEnd()}\n\n${fallback}`
      : fallback;
  }

  return responseMessage;
}

module.exports = {
  FILE_CITATION_PATTERN,
  buildFileCitationFallback,
  ensureFileCitationAnchors,
};
