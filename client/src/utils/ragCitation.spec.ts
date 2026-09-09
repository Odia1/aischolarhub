import { buildRagCitationSnippet, isInstitutionManagedCitation } from './ragCitation';

describe('institutional RAG citation presentation', () => {
  it('normalizes and bounds an authorized retrieval excerpt', () => {
    expect(buildRagCitationSnippet('  first\n\nsecond  ', '', 12)).toBe('first second');
    expect(buildRagCitationSnippet('1234567890', '', 7)).toBe('123456…');
  });

  it('uses fallback text when no retrieved excerpt exists', () => {
    expect(buildRagCitationSnippet(undefined, 'Page 3')).toBe('Page 3');
  });

  it('suppresses originals only for explicitly institution-managed citations', () => {
    expect(isInstitutionManagedCitation({ institutionManaged: true })).toBe(true);
    expect(isInstitutionManagedCitation({ institutionManaged: false })).toBe(false);
    expect(isInstitutionManagedCitation()).toBe(false);
  });
});
