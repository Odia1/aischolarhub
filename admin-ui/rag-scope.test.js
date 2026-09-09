import test from "node:test";
import assert from "node:assert/strict";
import {
  RAG_CONFIGURABLE_TYPES,
  knowledgeScopeKey
} from "./rag-scope.js";

test("allows automatic institution scope for managed ingestion", () => {
  assert.equal(
    knowledgeScopeKey({ type: "INSTITUTION", targetId: "SEEDS" }),
    "INSTITUTION:SEEDS"
  );
});

test("retains configurable hierarchy scopes", () => {
  assert.deepEqual(
    [...RAG_CONFIGURABLE_TYPES],
    ["DEPARTMENT", "COURSE", "GROUP"]
  );
  assert.equal(
    knowledgeScopeKey({ type: "DEPARTMENT", targetId: "department-id" }),
    "DEPARTMENT:department-id"
  );
});

test("rejects personal and malformed managed-ingestion scopes", () => {
  assert.throws(
    () => knowledgeScopeKey({ type: "PERSONAL", targetId: "user-id" }),
    /scope is invalid/
  );
  assert.throws(
    () => knowledgeScopeKey({ type: "INSTITUTION", targetId: "" }),
    /scope is invalid/
  );
});
