import test from "node:test";
import assert from "node:assert/strict";
import { validateEnabledRagGroupPolicy } from "./rag-policy.js";

test("rejects an enabled policy with no RAG Access Point", () => {
  assert.throws(
    () => validateEnabledRagGroupPolicy({
      enabled: true,
      accessMode: "GROUP_ONLY",
      groupIds: ["group-1"],
      ragLocationIds: [],
    }),
    /at least one RAG Access Point/,
  );
});

test("rejects an enabled group policy with no audience", () => {
  assert.throws(
    () => validateEnabledRagGroupPolicy({
      enabled: true,
      accessMode: "GROUP_ONLY",
      groupIds: [],
      ragLocationIds: ["institution:SEEDS"],
    }),
    /at least one organizational group/,
  );
});

test("rejects Selected users mode with no selected users", () => {
  assert.throws(
    () => validateEnabledRagGroupPolicy({
      enabled: true,
      accessMode: "SELECTED_USERS",
      userIds: [],
      ragLocationIds: ["institution:SEEDS"],
    }),
    /at least one user/,
  );
});

test("accepts a complete enabled group policy", () => {
  assert.doesNotThrow(() => validateEnabledRagGroupPolicy({
    enabled: true,
    accessMode: "GROUP_ONLY",
    groupIds: ["group-1"],
    ragLocationIds: ["institution:SEEDS"],
  }));
});

test("allows an incomplete policy while it is disabled", () => {
  assert.doesNotThrow(() => validateEnabledRagGroupPolicy({
    enabled: false,
    accessMode: "GROUP_ONLY",
    groupIds: [],
    ragLocationIds: [],
  }));
});
