"""In-memory MongoDB stand-in for local dev when MongoDB is not installed."""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional


def _strip_id(doc: Optional[dict], projection: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    out = copy.deepcopy(doc)
    if projection and projection.get("_id") == 0:
        out.pop("_id", None)
    return out


def _matches(doc: dict, query: dict) -> bool:
    for key, value in query.items():
        if doc.get(key) != value:
            return False
    return True


def _apply_update(doc: dict, update: dict) -> None:
    if "$set" in update:
        doc.update(update["$set"])
    if "$inc" in update:
        for key, delta in update["$inc"].items():
            doc[key] = doc.get(key, 0) + delta


class _Cursor:
    def __init__(self, docs: List[dict], projection: Optional[dict]):
        self._docs = docs
        self._projection = projection
        self._sort_key: Optional[str] = None
        self._sort_dir = 1
        self._limit: Optional[int] = None

    def sort(self, key: str, direction: int):
        self._sort_key = key
        self._sort_dir = direction
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    async def to_list(self, length: int) -> List[dict]:
        docs = list(self._docs)
        if self._sort_key:
            docs.sort(key=lambda d: d.get(self._sort_key, 0), reverse=self._sort_dir < 0)
        cap = self._limit if self._limit is not None else length
        return [_strip_id(d, self._projection) or {} for d in docs[:cap]]


class InMemoryCollection:
    def __init__(self):
        self._docs: List[dict] = []
        self._next_id = 1

    async def find_one(self, query: dict, projection: Optional[dict] = None) -> Optional[dict]:
        for doc in self._docs:
            if _matches(doc, query):
                return _strip_id(doc, projection)
        return None

    async def insert_one(self, doc: dict) -> None:
        stored = copy.deepcopy(doc)
        stored["_id"] = self._next_id
        self._next_id += 1
        self._docs.append(stored)

    async def update_one(self, query: dict, update: dict, upsert: bool = False) -> None:
        for doc in self._docs:
            if _matches(doc, query):
                _apply_update(doc, update)
                return
        if upsert and "$set" in update:
            await self.insert_one(update["$set"])

    async def delete_one(self, query: dict) -> None:
        self._docs = [d for d in self._docs if not _matches(d, query)]

    def find(self, query: dict, projection: Optional[dict] = None) -> _Cursor:
        matched = [d for d in self._docs if _matches(d, query)]
        return _Cursor(matched, projection)

    async def create_index(self, *args, **kwargs) -> None:
        return None


class InMemoryDatabase:
    def __init__(self):
        self._collections: Dict[str, InMemoryCollection] = {}

    def __getitem__(self, name: str) -> InMemoryCollection:
        if name not in self._collections:
            self._collections[name] = InMemoryCollection()
        return self._collections[name]

    def __getattr__(self, name: str) -> InMemoryCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


def make_dev_db() -> InMemoryDatabase:
    return InMemoryDatabase()
