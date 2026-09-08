export function validateEnabledRagGroupPolicy(policy = {}) {
  if (policy.enabled === false) return;

  const accessMode = String(
    policy.accessMode || "GROUP_ONLY"
  ).trim().toUpperCase();

  const groupIds = Array.isArray(policy.groupIds)
    ? policy.groupIds.filter(Boolean)
    : [];
  const userIds = Array.isArray(policy.userIds)
    ? policy.userIds.filter(Boolean)
    : [];
  const ragLocationIds = Array.isArray(policy.ragLocationIds)
    ? policy.ragLocationIds.filter(Boolean)
    : [];

  if (!ragLocationIds.length) {
    throw new Error(
      "Select at least one RAG Access Point before enabling this policy"
    );
  }

  if (accessMode === "SELECTED_USERS") {
    if (!userIds.length) {
      throw new Error(
        "Select at least one user for Selected users mode"
      );
    }
    return;
  }

  if (!groupIds.length) {
    throw new Error(
      "Select at least one organizational group for this access mode"
    );
  }
}
