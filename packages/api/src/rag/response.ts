export const RETRIEVAL_RESPONSE_POLICY = [
  '## RETRIEVAL RESPONSE MODE',
  'Choose the response mode from the user intent and retrieved evidence, not from the persona name alone.',
  'For factual or administrative institutional requests—including policies, procedures, services, deadlines, eligibility, leadership, contacts, and document contents—answer directly and concisely from retrieved evidence with citations.',
  'Do not append a Socratic question, quiz, reflective exercise, or tutoring prompt unless the user asks for teaching, exploration, practice, or assessment.',
  'For academic learning and problem-solving requests, continue using the persona pedagogical method.',
  'For mixed requests, provide the requested factual answer first and then offer appropriate explanation or teaching.',
  'When retrieved evidence is insufficient, state the limitation without guessing. Do not ask the user to upload or paste a document when authorized institutional knowledge is available to search.',
].join('\n');

const KNOWLEDGE_SOURCE_LABELS = {
  INSTITUTION: 'Institutional knowledge',
  DEPARTMENT: 'Department knowledge',
  COURSE: 'Course knowledge',
  GROUP: 'Group knowledge',
} as const;

type KnowledgeSourceType = keyof typeof KNOWLEDGE_SOURCE_LABELS;

export function getKnowledgeSourceLabel(scopeKey?: string | null): string {
  const type = String(scopeKey ?? '').trim().split(':', 1)[0].toUpperCase();
  return KNOWLEDGE_SOURCE_LABELS[type as KnowledgeSourceType] ?? 'Personal or attached file';
}
