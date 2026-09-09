"""Backend-neutral, single-call vector retrieval boundary.

Authorization predicates are complete before they reach this service.  A future
Azure AI Search adapter can implement the same contract without changing route
or authorization semantics.
"""

from typing import Any, Dict, List, Tuple

from langchain_core.documents import Document

from app.services.vector_store.async_pg_vector import AsyncPgVector


async def search_authorized(
    *, request, vector_store, embedding: List[float], predicate: Dict[str, Any], k: int
) -> List[Tuple[Document, float]]:
    if isinstance(vector_store, AsyncPgVector):
        return await vector_store.asimilarity_search_with_score_by_vector(
            embedding,
            k=k,
            filter=predicate,
            executor=request.app.state.thread_pool,
        )
    return vector_store.similarity_search_with_score_by_vector(
        embedding, k=k, filter=predicate
    )
