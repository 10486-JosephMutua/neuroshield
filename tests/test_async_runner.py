import asyncio
import threading

import pytest

from backend.async_runner import run_sync


def test_returns_the_coroutine_result():
    async def work():
        return 42

    assert run_sync(work()) == 42


def test_uses_one_loop_for_every_call():
    async def loop_id():
        return id(asyncio.get_running_loop())

    assert run_sync(loop_id()) == run_sync(loop_id())


def test_works_from_several_threads():
    async def work(n):
        await asyncio.sleep(0.01)
        return n * 2

    results = {}

    def call(n):
        results[n] = run_sync(work(n))

    threads = [threading.Thread(target=call, args=(n,)) for n in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == {n: n * 2 for n in range(5)}


def test_exceptions_reach_the_caller():
    async def boom():
        raise ValueError("nope")

    with pytest.raises(ValueError, match="nope"):
        run_sync(boom())
