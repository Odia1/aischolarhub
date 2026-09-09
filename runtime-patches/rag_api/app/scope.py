"""The one place a request's scope becomes a store predicate.

Files and their chunks are owner-scoped and carry raw content, so scope is
enforced structurally rather than remembered by each caller. Every route that
reads or removes stored content builds its predicate from :class:`ScopeFilter`.
Drift between hand-written scope clauses is the realistic failure mode; one
builder makes it impossible rather than merely reviewable.

The predicate is always ``(owner, file)`` and always goes into the store query
*before* ranking. Nothing downstream re-derives authorization from what the
store returned.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import Request

PUBLIC_OWNER = "public"

OWNER_METADATA_KEY = "user_id"
KNOWLEDGE_SCOPE_METADATA_KEY = "knowledge_scope_key"
KNOWLEDGE_SCOPE_TYPES = frozenset({"INSTITUTION", "DEPARTMENT", "COURSE", "GROUP"})


def normalize_knowledge_scope_key(value: Any) -> Optional[str]:
    """Return a canonical hierarchy key, rejecting malformed signed claims."""
    raw = str(value or "").strip()
    if ":" not in raw:
        return None
    scope_type, target_id = raw.split(":", 1)
    scope_type = scope_type.strip().upper()
    target_id = target_id.strip()
    if scope_type not in KNOWLEDGE_SCOPE_TYPES or not target_id:
        return None
    return f"{scope_type}:{target_id}"


def knowledge_scopes_clause(scope_keys: Sequence[str]) -> Dict[str, Any]:
    normalized = list(
        dict.fromkeys(
            key for key in (normalize_knowledge_scope_key(v) for v in scope_keys) if key
        )
    )
    if len(normalized) == 1:
        return {KNOWLEDGE_SCOPE_METADATA_KEY: {"$eq": normalized[0]}}
    return {
        "$or": [
            {KNOWLEDGE_SCOPE_METADATA_KEY: {"$eq": key}} for key in normalized
        ]
    }


def effective_knowledge_scope_keys(
    signed_scope_keys: Sequence[str], requested_scope_keys: Optional[Sequence[str]] = None
) -> Tuple[str, ...]:
    """Intersect a user selection with signed authority; omission means all signed."""
    signed = {
        key
        for key in (normalize_knowledge_scope_key(v) for v in signed_scope_keys)
        if key
    }
    if requested_scope_keys is None:
        return tuple(sorted(signed))
    requested = {
        key
        for key in (normalize_knowledge_scope_key(v) for v in requested_scope_keys)
        if key
    }
    return tuple(sorted(signed.intersection(requested)))


@dataclass(frozen=True)
class ScopeFilter:
    """The owners a request may read, as a store-query clause."""

    owners: Tuple[str, ...]
    tenant_id: Optional[str] = None

    def owner_clause(self) -> Dict[str, Any]:
        return {OWNER_METADATA_KEY: {"$in": list(self.owners)}}

    def predicate(self, *clauses: Dict[str, Any]) -> Dict[str, Any]:
        """Combine caller clauses (e.g. file id) with the owner clause."""
        predicates = [*clauses, self.owner_clause()]
        if self.tenant_id:
            predicates.append({"tenant_id": {"$eq": self.tenant_id}})
        return {"$and": predicates}

    def preauthorized_predicate(
        self, *clauses: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Apply tenant scope after file authorization was established upstream.

        Used only for RAG-group files already authorized by
        partition_file_access(). Unlike predicate(), this deliberately does
        not add the personal owner clause.
        """
        predicates = list(clauses)
        if self.tenant_id:
            predicates.append({"tenant_id": {"$eq": self.tenant_id}})
        return {"$and": predicates}

    def owns(self, owner: Optional[str]) -> bool:
        """Whether a stored row's recorded owner falls inside this scope.

        A row with no recorded owner is *not* in scope. Before this release an
        absent ``user_id`` read as "belongs to everyone", which made any such
        chunk readable by every caller.
        """
        return owner in self.owners


def file_clause(file_id: str) -> Dict[str, Any]:
    return {"file_id": {"$eq": file_id}}


def files_clause(file_ids: Sequence[str]) -> Dict[str, Any]:
    return {"file_id": {"$in": list(file_ids)}}


def resolve_scope(request: Request, entity_id: Optional[str] = None) -> ScopeFilter:
    """Resolve the owners this request may read.

    The caller's own identity always comes from the verified token — never from
    the query string, the body, or the rows the store returned.

    A caller-supplied ``entity_id`` *widens* the owner set rather than replacing
    it, which is the change that closes the read paths below. It remains
    caller-asserted: this release does not yet carry a claim that proves the
    caller may act for that entity, so a deployment that exposes this API to
    untrusted callers must still authorize entity access upstream. See
    ``README.md``.
    """
    user = getattr(request.state, "user", None)

    if user is None:
        # No signing key configured anywhere: preserve the unauthenticated
        # deployment's single-owner behaviour rather than opening the store.
        return ScopeFilter(owners=(entity_id or PUBLIC_OWNER,))

    owners = {user.get("id") or PUBLIC_OWNER}
    if entity_id:
        owners.add(entity_id)

    return ScopeFilter(
        owners=tuple(sorted(owners)),
        tenant_id=user.get("tenantId"),
    )


def scope_owners(scope: ScopeFilter) -> List[str]:
    return list(scope.owners)
