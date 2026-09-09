# app/models.py
import hashlib
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class DocumentResponse(BaseModel):
    page_content: str
    metadata: dict


class DocumentModel(BaseModel):
    page_content: str
    metadata: Optional[dict] = {}

    def generate_digest(self):
        return hashlib.md5(self.page_content.encode()).hexdigest()


class StoreDocument(BaseModel):
    filepath: str
    filename: str
    file_content_type: str
    file_id: str


class QueryRequestBody(BaseModel):
    query: str
    file_id: str
    k: int = 4
    entity_id: Optional[str] = None


class CleanupMethod(str, Enum):
    incremental = "incremental"
    full = "full"


class QueryMultipleBody(BaseModel):
    query: str
    file_ids: List[str]
    k: int = 4
    entity_id: Optional[str] = None


class QueryScopedBody(BaseModel):
    """One retrieval request across explicit files and signed hierarchy scopes."""

    query: str = Field(min_length=1, max_length=4096)
    file_ids: List[str] = Field(default_factory=list, max_length=100)
    requested_scope_keys: Optional[List[str]] = Field(default=None, max_length=256)
    k: int = Field(default=10, ge=1, le=50)
    entity_id: Optional[str] = None
