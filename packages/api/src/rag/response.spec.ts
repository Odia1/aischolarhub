import { getKnowledgeSourceLabel, RETRIEVAL_RESPONSE_POLICY } from './response';

describe('retrieval response policy', () => {
  it.each([
    ['INSTITUTION:SEEDS', 'Institutional knowledge'],
    ['DEPARTMENT:science', 'Department knowledge'],
    ['COURSE:biology-101', 'Course knowledge'],
    ['GROUP:cohort-a', 'Group knowledge'],
    [undefined, 'Personal or attached file'],
    ['', 'Personal or attached file'],
    ['UNTRUSTED:value', 'Personal or attached file'],
  ])('labels %s without exposing its target identifier', (scopeKey, expected) => {
    expect(getKnowledgeSourceLabel(scopeKey)).toBe(expected);
  });

  it('makes direct institutional lookup an explicit exception to Socratic teaching', () => {
    expect(RETRIEVAL_RESPONSE_POLICY).toContain(
      'answer directly and concisely from retrieved evidence with citations',
    );
    expect(RETRIEVAL_RESPONSE_POLICY).toContain(
      'Do not append a Socratic question, quiz, reflective exercise, or tutoring prompt',
    );
  });

  it('preserves Socratic pedagogy for learning intent and puts facts first for mixed intent', () => {
    expect(RETRIEVAL_RESPONSE_POLICY).toContain(
      'For academic learning and problem-solving requests, continue using the persona pedagogical method.',
    );
    expect(RETRIEVAL_RESPONSE_POLICY).toContain(
      'For mixed requests, provide the requested factual answer first',
    );
  });

  it('forbids misleading upload requests when institutional retrieval is available', () => {
    expect(RETRIEVAL_RESPONSE_POLICY).toContain(
      'Do not ask the user to upload or paste a document when authorized institutional knowledge is available',
    );
  });
});
