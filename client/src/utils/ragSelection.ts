import type { TRagSelection } from 'librechat-data-provider';

const STORAGE_KEY = 'aih.rag-selection.v1';
const PREFERENCE_TTL_MS = 4 * 60 * 60 * 1000;

type StoredRagSelection = TRagSelection & { expiresAt: number };

const defaultSelection = (): TRagSelection => ({
  enabled: true,
  selectedPointKeys: ['PERSONAL'],
});

const storageKey = (userId?: string) => `${STORAGE_KEY}:${userId || 'anonymous'}`;

export function readRagSelection(userId?: string): TRagSelection {
  if (typeof window === 'undefined') {
    return defaultSelection();
  }
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey(userId)) ?? '',
    ) as StoredRagSelection;
    if (
      stored.expiresAt > Date.now() &&
      typeof stored.enabled === 'boolean' &&
      Array.isArray(stored.selectedPointKeys)
    ) {
      return {
        enabled: stored.enabled,
        selectedPointKeys: [
          ...new Set(stored.selectedPointKeys.filter((key) => typeof key === 'string')),
        ],
      };
    }
  } catch {
    // Missing, expired, or malformed browser preference: use the safe product default.
  }
  return defaultSelection();
}

export function writeRagSelection(selection: TRagSelection, userId?: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalized: StoredRagSelection = {
    enabled: selection.enabled,
    selectedPointKeys: [...new Set(selection.selectedPointKeys)],
    expiresAt: Date.now() + PREFERENCE_TTL_MS,
  };
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(normalized));
  } catch {
    // Storage may be unavailable in private/restricted browser contexts.
  }
}
