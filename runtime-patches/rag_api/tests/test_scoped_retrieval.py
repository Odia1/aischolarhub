from app.scope import (
    ScopeFilter,
    effective_knowledge_scope_keys,
    knowledge_scopes_clause,
    normalize_knowledge_scope_key,
)


def test_scope_keys_are_canonical_and_reject_unknown_types():
    assert normalize_knowledge_scope_key(" institution:SEEDS ") == "INSTITUTION:SEEDS"
    assert normalize_knowledge_scope_key("UNKNOWN:SEEDS") is None
    assert normalize_knowledge_scope_key("INSTITUTION:") is None


def test_scoped_predicate_combines_tenant_personal_and_institutional_authority():
    scope = ScopeFilter(owners=("agent-1", "user-1"), tenant_id="SEEDS")
    branches = {
        "$or": [
            {
                "$and": [
                    {"file_id": {"$in": ["personal-1"]}},
                    scope.owner_clause(),
                ]
            },
            knowledge_scopes_clause(["INSTITUTION:SEEDS", "GROUP:g1"]),
        ]
    }
    assert scope.preauthorized_predicate(branches) == {
        "$and": [
            branches,
            {"tenant_id": {"$eq": "SEEDS"}},
        ]
    }


def test_scope_clause_deduplicates_values():
    assert knowledge_scopes_clause(["GROUP:g1", "GROUP:g1"]) == {
        "knowledge_scope_key": {"$eq": "GROUP:g1"}
    }


def test_user_selection_can_only_narrow_signed_authority():
    assert effective_knowledge_scope_keys(
        ["INSTITUTION:SEEDS", "GROUP:g1"],
        ["GROUP:g1", "GROUP:forged"],
    ) == ("GROUP:g1",)
    assert effective_knowledge_scope_keys(["INSTITUTION:SEEDS"], []) == ()
