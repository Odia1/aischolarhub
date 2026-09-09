"""One-time, fail-closed migration of institutional vector scope metadata."""

import asyncio

import asyncpg
from pymongo import MongoClient

from app.config import ATLAS_MONGO_DB_URI, COLLECTION_NAME, DSN, POSTGRES_SCHEMA
from app.scope import normalize_knowledge_scope_key
from app.services.vector_store.factory import _build_search_path, _parse_schemas


async def main():
    mongo = MongoClient(ATLAS_MONGO_DB_URI, serverSelectionTimeoutMS=3000)
    try:
        files = mongo.get_default_database()["files"].find(
            {
                "embedded": True,
                "enabled": {"$ne": False},
                "published": {"$ne": False},
                "knowledgeScope.type": {"$exists": True},
                "knowledgeScope.targetId": {"$exists": True},
            },
            {"_id": 0, "file_id": 1, "tenantId": 1, "knowledgeScope": 1},
        )
        active = []
        for document in files:
            knowledge_scope = document.get("knowledgeScope") or {}
            key = normalize_knowledge_scope_key(
                f"{knowledge_scope.get('type', '')}:{knowledge_scope.get('targetId', '')}"
            )
            file_id = str(document.get("file_id") or "").strip()
            tenant_id = str(document.get("tenantId") or "").strip()
            if key and file_id and tenant_id:
                active.append((key, file_id, tenant_id))

        connect_args = {"dsn": DSN}
        if POSTGRES_SCHEMA:
            schemas = _parse_schemas(POSTGRES_SCHEMA)
            if schemas:
                connect_args["server_settings"] = {
                    "search_path": _build_search_path(schemas)
                }
        conn = await asyncpg.connect(**connect_args)
        try:
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_lc_embedding_tenant_scope "
                "ON langchain_pg_embedding "
                "((cmetadata->>'tenant_id'), (cmetadata->>'knowledge_scope_key'))"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_lc_embedding_tenant_owner_file "
                "ON langchain_pg_embedding "
                "((cmetadata->>'tenant_id'), (cmetadata->>'user_id'), custom_id)"
            )
            async with conn.transaction():
                collection_id = await conn.fetchval(
                    "SELECT uuid FROM langchain_pg_collection WHERE name = $1",
                    COLLECTION_NAME,
                )
                if collection_id is None:
                    raise RuntimeError("Vector collection does not exist")
                data_type = await conn.fetchval(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name='langchain_pg_embedding' AND column_name='cmetadata' "
                    "AND table_schema=current_schema()"
                )
                if data_type not in {"json", "jsonb"}:
                    raise RuntimeError("Unsupported vector metadata column type")
                cast_back = "" if data_type == "jsonb" else "::json"
                cleared = await conn.execute(
                    "UPDATE langchain_pg_embedding SET cmetadata = "
                    f"(cmetadata::jsonb - 'knowledge_scope_key'){cast_back} "
                    "WHERE collection_id = $1 AND cmetadata::jsonb ? 'knowledge_scope_key'",
                    collection_id,
                )
                updated = 0
                for key, file_id, tenant_id in active:
                    status = await conn.execute(
                        "UPDATE langchain_pg_embedding SET cmetadata = "
                        f"jsonb_set(cmetadata::jsonb, '{{knowledge_scope_key}}', to_jsonb($1::text), true){cast_back} "
                        "WHERE collection_id=$2 AND custom_id=$3 "
                        "AND cmetadata->>'tenant_id'=$4",
                        key,
                        collection_id,
                        file_id,
                        tenant_id,
                    )
                    updated += int(status.rsplit(" ", 1)[-1])
            print(f"PASS: active_scopes={len(active)} vector_chunks_updated={updated} cleared={cleared}")
        finally:
            await conn.close()
    finally:
        mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
