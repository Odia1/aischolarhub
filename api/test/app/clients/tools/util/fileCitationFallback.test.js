const {
  buildFileCitationFallback,
  ensureFileCitationAnchors,
} = require('../../../../../app/clients/tools/util/fileCitationFallback');

const attachment = (fileIds) => ({
  type: 'file_search',
  file_search: {
    sources: fileIds.map((fileId) => ({ fileId, fileName: `${fileId}.pdf` })),
  },
});

describe('deterministic File Search citation fallback', () => {
  it('builds anchors using the client file-turn and de-duplicated reference order', () => {
    expect(buildFileCitationFallback([attachment(['a', 'a', 'b']), attachment(['c'])])).toBe(
      'Sources: \\ue200\\ue202turn0file0\\ue202turn0file1\\ue202turn1file0\\ue201',
    );
  });

  it('appends a source anchor to completed agent content when the model omitted it', () => {
    const message = {
      text: '',
      content: [{ type: 'text', text: 'Grounded answer.' }],
      attachments: [attachment(['a'])],
    };

    ensureFileCitationAnchors(message);
    expect(message.content[0].text).toBe('Grounded answer.\n\nSources: \\ue202turn0file0');
  });

  it('preserves model-provided file citations', () => {
    const message = {
      content: [{ type: 'text', text: 'Grounded answer. \\ue202turn0file0' }],
      attachments: [attachment(['a'])],
    };

    ensureFileCitationAnchors(message);
    expect(message.content[0].text).toBe('Grounded answer. \\ue202turn0file0');
  });

  it('does not cite responses without usable File Search sources', () => {
    const message = { text: 'Ungrounded answer.', attachments: [] };
    ensureFileCitationAnchors(message);
    expect(message.text).toBe('Ungrounded answer.');
  });
});
