export const RAG_CONFIGURABLE_TYPES = new Set([
  "DEPARTMENT",
  "COURSE",
  "GROUP"
]);

export const RAG_INGESTION_TYPES = new Set([
  "INSTITUTION",
  ...RAG_CONFIGURABLE_TYPES
]);

export function knowledgeScopeKey(location) {
  const type = String(location?.type || "").trim().toUpperCase();
  const targetId = String(location?.targetId || "").trim();
  if (!RAG_INGESTION_TYPES.has(type) || !targetId) {
    throw new Error("RAG Access Point scope is invalid");
  }
  return `${type}:${targetId}`;
}
