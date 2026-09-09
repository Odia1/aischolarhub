FROM registry.librechat.ai/danny-avila/librechat-rag-api-dev@sha256:d64a4d17314472712e375456e12d6d6ca71fc729240aebbfb625f5249da58b1f

COPY app/scope.py /app/app/scope.py
COPY app/models.py /app/app/models.py
COPY app/routes/document_routes.py /app/app/routes/document_routes.py
COPY app/services/rag_authorization.py /app/app/services/rag_authorization.py
COPY app/services/retrieval.py /app/app/services/retrieval.py
COPY scripts/backfill_knowledge_scopes.py /app/scripts/backfill_knowledge_scopes.py
