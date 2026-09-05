import asyncio
from typing import Iterable, List, Set, Tuple

from bson import ObjectId
from pymongo import MongoClient

from app.config import ATLAS_MONGO_DB_URI


def _strings(values: Iterable) -> Set[str]:
    return {
        str(v).strip()
        for v in (values or [])
        if v is not None and str(v).strip()
    }


def _oid(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def _partition_sync(
    user_id: str,
    tenant_id: str,
    requested_file_ids: List[str],
) -> Tuple[List[str], List[str]]:
    requested = list(dict.fromkeys(
        str(x).strip() for x in requested_file_ids if str(x).strip()
    ))

    if not requested or not user_id or not tenant_id:
        return [], []

    client = MongoClient(ATLAS_MONGO_DB_URI)

    try:
        db = client.get_default_database()

        files = db["files"]
        rag_groups = db["ragGroups"]
        groups = db["groups"]
        group_courses = db["group_courses"]
        group_departments = db["group_departments"]
        course_instructors = db["course_instructors"]

        # Files must belong to the tenant from the verified JWT.
        file_docs = list(files.find(
            {
                "tenantId": tenant_id,
                "file_id": {"$in": requested},
            },
            {
                "_id": 0,
                "file_id": 1,
                "ragGroupIds": 1,
            },
        ))

        legacy_ids: List[str] = []
        candidate_files = []

        for f in file_docs:
            fid = str(f.get("file_id") or "")
            rag_ids = _strings(f.get("ragGroupIds"))

            if not rag_ids:
                # Legacy/personal RAG remains owner-authorized later by
                # ScopeFilter.predicate().
                legacy_ids.append(fid)
            else:
                candidate_files.append((fid, rag_ids))

        if not candidate_files:
            return legacy_ids, []

        # --------------------------------------------------------
        # Determine organizational scope for this user.
        # --------------------------------------------------------

        direct_group_ids: Set[str] = set()

        for g in groups.find(
            {
                "tenantId": tenant_id,
                "memberIds": user_id,
            },
            {
                "_id": 1,
                "parentGroupId": 1,
            },
        ):
            direct_group_ids.add(str(g["_id"]))

        # Include ancestor groups so membership in a class/subgroup can
        # satisfy a RAG Group granted to a parent organizational group.
        effective_group_ids = set(direct_group_ids)
        frontier = set(direct_group_ids)

        while frontier:
            object_ids = [_oid(x) for x in frontier]
            object_ids = [x for x in object_ids if x is not None]

            if not object_ids:
                break

            next_frontier: Set[str] = set()

            for g in groups.find(
                {
                    "tenantId": tenant_id,
                    "_id": {"$in": object_ids},
                },
                {
                    "parentGroupId": 1,
                },
            ):
                parent = g.get("parentGroupId")
                if parent:
                    parent_s = str(parent)
                    if parent_s not in effective_group_ids:
                        effective_group_ids.add(parent_s)
                        next_frontier.add(parent_s)

            frontier = next_frontier

        course_ids: Set[str] = set()
        department_ids: Set[str] = set()

        if effective_group_ids:
            group_oid_values = [_oid(x) for x in effective_group_ids]
            group_oid_values = [x for x in group_oid_values if x is not None]

            group_match_values = list(effective_group_ids) + group_oid_values

            for row in group_courses.find(
                {
                    "tenantId": tenant_id,
                    "groupId": {"$in": group_match_values},
                },
                {"courseId": 1},
            ):
                if row.get("courseId") is not None:
                    course_ids.add(str(row["courseId"]))

            for row in group_departments.find(
                {
                    "tenantId": tenant_id,
                    "groupId": {"$in": group_match_values},
                },
                {"departmentId": 1},
            ):
                if row.get("departmentId") is not None:
                    department_ids.add(str(row["departmentId"]))

        # Instructor/course relationship is another legitimate course scope.
        for row in course_instructors.find(
            {
                "tenantId": tenant_id,
                "userId": user_id,
            },
            {"courseId": 1},
        ):
            if row.get("courseId") is not None:
                course_ids.add(str(row["courseId"]))

        # --------------------------------------------------------
        # Determine enabled RAG Groups visible to the user.
        # --------------------------------------------------------

        candidate_rag_group_ids = set()

        for _, file_rag_ids in candidate_files:
            candidate_rag_group_ids.update(file_rag_ids)

        candidate_oids = [_oid(x) for x in candidate_rag_group_ids]
        candidate_oids = [x for x in candidate_oids if x is not None]

        authorized_rag_group_ids: Set[str] = set()

        if candidate_oids:
            for rg in rag_groups.find(
                {
                    "_id": {"$in": candidate_oids},
                    "tenantId": tenant_id,
                    "enabled": {"$ne": False},
                },
                {
                    "_id": 1,
                    "accessMode": 1,
                    "groupIds": 1,
                    "departmentIds": 1,
                    "courseIds": 1,
                    "userIds": 1,
                },
            ):
                rg_id = str(rg["_id"])
                mode = str(rg.get("accessMode") or "GROUP_ONLY").upper()

                rg_users = _strings(rg.get("userIds"))
                rg_groups = _strings(rg.get("groupIds"))
                rg_courses = _strings(rg.get("courseIds"))
                rg_departments = _strings(rg.get("departmentIds"))

                direct_user_match = user_id in rg_users
                group_match = bool(rg_groups & effective_group_ids)
                course_match = bool(rg_courses & course_ids)
                department_match = bool(rg_departments & department_ids)

                allowed = False

                if mode == "SELECTED_USERS":
                    allowed = direct_user_match
                elif mode in {
                    "GROUP_ONLY",
                    "GROUP_AND_DESCENDANTS",
                    "SELECTED_GROUPS",
                }:
                    allowed = (
                        direct_user_match
                        or group_match
                        or course_match
                        or department_match
                    )
                else:
                    # Unknown future mode: fail closed except for an explicit
                    # direct user grant.
                    allowed = direct_user_match

                if allowed:
                    authorized_rag_group_ids.add(rg_id)

        rag_ids: List[str] = []

        for fid, file_rag_ids in candidate_files:
            if file_rag_ids & authorized_rag_group_ids:
                rag_ids.append(fid)

        return legacy_ids, rag_ids

    finally:
        client.close()


async def partition_file_access(
    user_id: str,
    tenant_id: str,
    requested_file_ids: List[str],
) -> Tuple[List[str], List[str]]:
    """
    Partition requested files into:

      legacy_ids:
          Personal/legacy files. Callers must still apply owner scope.

      rag_ids:
          Files assigned to at least one enabled same-tenant RAG Group
          authorized for this user. Ownership must not be re-applied, but
          tenant scope must remain enforced.
    """
    return await asyncio.to_thread(
        _partition_sync,
        str(user_id or ""),
        str(tenant_id or ""),
        list(requested_file_ids or []),
    )
