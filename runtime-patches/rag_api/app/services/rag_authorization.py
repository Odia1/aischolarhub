import asyncio
import time
from typing import Iterable, List, Set, Tuple

from pymongo import MongoClient

from app.config import ATLAS_MONGO_DB_URI, logger


# MongoClient is thread-safe and owns its own connection pool.
# Keep one process-wide client rather than reconnecting for every RAG query.
_MONGO_CLIENT = MongoClient(
    ATLAS_MONGO_DB_URI,
    maxPoolSize=50,
    minPoolSize=1,
    connect=False,
    serverSelectionTimeoutMS=3000,
)

_MONGO_DB = _MONGO_CLIENT.get_default_database()


def _strings(values: Iterable) -> Set[str]:
    return {
        str(v).strip()
        for v in (values or [])
        if v is not None and str(v).strip()
    }


def _partition_sync(
    user_id: str,
    tenant_id: str,
    requested_file_ids: List[str],
    authorized_file_ids: List[str],
) -> Tuple[List[str], List[str]]:
    """
    Partition requested files into two deliberately simple classes.

    personal_ids
        Files without an institutional knowledgeScope.

        These remain protected by the existing vector-store owner predicate:
            tenant + authenticated owner + file_id

        This includes normal user uploads and existing agent knowledge-base
        files. No institutional hierarchy is reconstructed here.

    institutional_ids
        Files carrying knowledgeScope.

        These are returned ONLY when the file_id is also present in the
        signed authorizedFileIds claim issued by the trusted AI Scholar Hub
        backend.

    SECURITY MODEL
    --------------
    The RAG service does not know what an institution, department, course,
    class, or organizational group means.

    AI Scholar Hub owns that authorization decision.

    The RAG service merely verifies/enforces the resulting signed file
    authorization before vector ranking.

    This prevents authorization-policy drift between Node and Python and
    removes the obsolete parallel ragGroups hierarchy.
    """

    requested = list(
        dict.fromkeys(
            str(x).strip()
            for x in requested_file_ids
            if str(x).strip()
        )
    )

    if not requested or not user_id or not tenant_id:
        return [], []

    authorized = _strings(authorized_file_ids)

    started = time.perf_counter()
    db = _MONGO_DB

    try:
        files = db["files"]

        # Tenant always comes from the verified JWT.
        #
        # We inspect only enough metadata to determine whether a file is
        # personal/legacy or institutionally scoped. No hierarchy or access
        # policy is evaluated in this service.
        file_docs = list(
            files.find(
                {
                    "tenantId": tenant_id,
                    "file_id": {"$in": requested},
                },
                {
                    "_id": 0,
                    "file_id": 1,
                    "knowledgeScope": 1,
                },
            )
        )

        personal_ids: List[str] = []
        institutional_ids: List[str] = []

        for file_doc in file_docs:
            file_id = str(file_doc.get("file_id") or "").strip()
            if not file_id:
                continue

            knowledge_scope = file_doc.get("knowledgeScope")

            if not knowledge_scope:
                # Existing uploads remain owner-scoped by ScopeFilter.
                personal_ids.append(file_id)
                continue

            # Institutional knowledge requires explicit signed authorization.
            if file_id in authorized:
                institutional_ids.append(file_id)

        return personal_ids, institutional_ids

    finally:
        duration_ms = (time.perf_counter() - started) * 1000

        if duration_ms >= 25:
            logger.info(
                "[PERF] component=knowledge-authorization "
                "tenant=%s requestedFiles=%d durationMs=%.1f",
                tenant_id,
                len(requested),
                duration_ms,
            )


async def partition_file_access(
    user_id: str,
    tenant_id: str,
    requested_file_ids: List[str],
    authorized_file_ids: List[str] = None,
) -> Tuple[List[str], List[str]]:
    """
    Return:

      personal_ids
          Files that still require the authenticated owner predicate.

      institutional_ids
          Institutionally scoped files explicitly authorized by the signed
          authorizedFileIds JWT claim.

    The function intentionally contains no institution/group/course/RAG
    hierarchy logic.
    """

    return await asyncio.to_thread(
        _partition_sync,
        str(user_id or ""),
        str(tenant_id or ""),
        list(requested_file_ids or []),
        list(authorized_file_ids or []),
    )
