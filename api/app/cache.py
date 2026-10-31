"""A small in-memory cache for answers built from ERA's endpoint.

Entries expire after their own number of seconds. When the cache is full, expired entries go
first and then the least recently used, so a crawler walking thousands of pages does not
push out the answers kept for a day (start-page examples, sitemaps, national lines). Two
requests for the same cold key share one build instead of querying ERA twice.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from typing import Any


class TTLCache:
    def __init__(self, max_entries: int = 2000):
        self.max_entries = max_entries
        self._data: OrderedDict[tuple, tuple[float, Any]] = OrderedDict()
        self._building: dict[tuple, Future] = {}
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self._data)

    def __contains__(self, key: tuple) -> bool:
        return key in self._data

    def __getitem__(self, key: tuple) -> tuple[float, Any]:
        """(expiry as a time.time() value, value)."""
        return self._data[key]

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def get(self, key: tuple, seconds: float | Callable[[Any], float], build: Callable[[], Any]) -> Any:
        """build(), kept for `seconds` under key (or for as long as `seconds(value)` says).
        Concurrent callers of a key that is being built wait for that build; if it fails,
        they all get its exception and nothing is kept."""
        with self._lock:
            hit = self._data.get(key)
            if hit and time.time() < hit[0]:
                self._data.move_to_end(key)
                return hit[1]
            fut = self._building.get(key)
            owner = fut is None
            if owner:
                fut = self._building[key] = Future()
        if not owner:
            return fut.result()
        try:
            value = build()
        except BaseException as e:
            with self._lock:
                del self._building[key]
            fut.set_exception(e)
            raise
        ttl = seconds(value) if callable(seconds) else seconds
        with self._lock:
            self._data[key] = (time.time() + ttl, value)
            self._data.move_to_end(key)
            self._evict()
            del self._building[key]
        fut.set_result(value)
        return value

    def _evict(self) -> None:
        if len(self._data) <= self.max_entries:
            return
        now = time.time()
        for k in [k for k, (exp, _) in self._data.items() if exp <= now]:
            del self._data[k]
        while len(self._data) > self.max_entries:
            self._data.popitem(last=False)
