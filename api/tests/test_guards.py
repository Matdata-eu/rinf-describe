"""What keeps the API from overloading ERA's endpoint: the cache, the limit on queries in
flight and the circuit breaker."""
import threading
import time

import httpx
import pytest

from app import live
from app.cache import TTLCache


def test_cache_keeps_and_expires():
    c = TTLCache(10)
    calls = []
    assert c.get(("a",), 60, lambda: calls.append(1) or "x") == "x"
    assert c.get(("a",), 60, lambda: calls.append(1) or "y") == "x"
    assert len(calls) == 1
    assert c.get(("b",), lambda v: 0, lambda: "first") == "first"
    assert c.get(("b",), 60, lambda: "second") == "second"  # kept for 0 s


def test_full_cache_drops_expired_then_least_recently_used():
    c = TTLCache(3)
    c.get(("day",), 86400, lambda: 1)
    c.get(("gone",), lambda v: -1, lambda: 2)
    c.get(("page", 1), 600, lambda: 3)
    c.get(("day",), 86400, lambda: 0)  # used again: most recent
    c.get(("page", 2), 600, lambda: 4)
    assert ("gone",) not in c and ("day",) in c and len(c) == 3
    c.get(("page", 3), 600, lambda: 5)
    assert ("page", 1) not in c and ("day",) in c
    assert c[("day",)][1] == 1


def test_cache_builds_a_cold_key_once_for_concurrent_callers():
    c = TTLCache(10)
    started, calls, out = threading.Event(), [], []

    def build():
        calls.append(1)
        started.set()
        time.sleep(0.2)
        return "page"
    threads = [threading.Thread(target=lambda: out.append(c.get(("k",), 60, build))) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert out == ["page"] * 5 and len(calls) == 1


def test_cache_keeps_no_failure():
    c = TTLCache(10)

    def boom():
        raise RuntimeError("ERA down")
    with pytest.raises(RuntimeError):
        c.get(("k",), 60, boom)
    assert c.get(("k",), 60, lambda: "ok") == "ok"


@pytest.fixture
def endpoint(monkeypatch):
    """live.sparql against a fake endpoint whose answer the test sets."""
    state = {"status": 200, "calls": 0}

    def handle(req):
        state["calls"] += 1
        if state["status"] == "timeout":
            raise httpx.ReadTimeout("slow", request=req)
        return httpx.Response(state["status"], json={"results": {"bindings": []}})
    monkeypatch.setattr(live, "_client", httpx.Client(transport=httpx.MockTransport(handle)))
    live.reset_guards()
    yield state
    live.reset_guards()


def test_breaker_opens_after_failures_in_a_row(endpoint):
    url = "https://era.example/sparql"
    endpoint["status"] = 503
    for _ in range(live.BREAKER_FAILURES):
        with pytest.raises(httpx.HTTPStatusError):
            live.sparql(url, "ASK {}")
    with pytest.raises(live.Unavailable):
        live.sparql(url, "ASK {}")
    assert endpoint["calls"] == live.BREAKER_FAILURES  # the last one was not sent
    endpoint["status"] = 200
    assert live.sparql("https://other.example/sparql", "ASK {}") == []  # per endpoint


def test_breaker_ignores_bad_queries_and_resets_on_success(endpoint):
    url = "https://era.example/sparql"
    endpoint["status"] = 400
    for _ in range(live.BREAKER_FAILURES + 2):
        with pytest.raises(httpx.HTTPStatusError):
            live.sparql(url, "nonsense")
    endpoint["status"] = "timeout"
    for _ in range(live.BREAKER_FAILURES - 1):
        with pytest.raises(httpx.ReadTimeout):
            live.sparql(url, "ASK {}")
    endpoint["status"] = 200
    assert live.sparql(url, "ASK {}") == []
    endpoint["status"] = "timeout"
    with pytest.raises(httpx.ReadTimeout):
        live.sparql(url, "ASK {}")  # the count started again


def test_queries_in_flight_are_limited(endpoint, monkeypatch):
    monkeypatch.setattr(live, "_slots", threading.BoundedSemaphore(1))
    monkeypatch.setattr(live, "QUEUE_SECONDS", 0.05)
    live._slots.acquire()
    try:
        with pytest.raises(live.Busy):
            live.sparql("https://era.example/sparql", "ASK {}")
    finally:
        live._slots.release()
    assert live.sparql("https://era.example/sparql", "ASK {}") == []
