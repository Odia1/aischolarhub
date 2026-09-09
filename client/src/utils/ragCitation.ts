export interface RagCitationMetadata {
  institutionManaged?: boolean;
}

export function buildRagCitationSnippet(content: unknown, fallback = '', limit = 900): string {
  const normalized = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return fallback;
  }
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

export function isInstitutionManagedCitation(metadata?: RagCitationMetadata): boolean {
  return metadata?.institutionManaged === true;
}
