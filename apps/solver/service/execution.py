"""Owns a bounded solver child process and kills it on timeout or cancellation."""

import asyncio
import json
import sys
from pathlib import Path

from pydantic import TypeAdapter

from .contracts import SolveRequest, SolveResult

MAX_BYTES = 4 * 1024 * 1024


async def execute(payload: SolveRequest, *, provider_name: str) -> SolveResult:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-u",
        "-m",
        "service.worker",
        "--provider",
        provider_name,
        cwd=Path(__file__).resolve().parents[1],
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    total = 0

    async def read_bounded(stream):
        nonlocal total
        chunks = []
        while chunk := await stream.read(65536):
            total += len(chunk)
            if total > MAX_BYTES:
                raise RuntimeError("Worker output exceeds limit")
            chunks.append(chunk)
        return b"".join(chunks)

    async def send():
        process.stdin.write(
            payload.model_dump_json(by_alias=True, exclude_none=True).encode()
        )
        await process.stdin.drain()
        process.stdin.close()

    tasks = [
        asyncio.create_task(send()),
        asyncio.create_task(read_bounded(process.stdout)),
        asyncio.create_task(read_bounded(process.stderr)),
        asyncio.create_task(process.wait()),
    ]
    try:
        async with asyncio.timeout(payload.options.max_time_seconds + 30):
            _, output, _, code = await asyncio.gather(*tasks)
        if code != 0:
            raise RuntimeError("Worker failed")
        return TypeAdapter(SolveResult).validate_python(
            json.loads(output), by_alias=True, by_name=False
        )
    finally:
        if process.returncode is None:
            process.kill()
        await process.wait()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
