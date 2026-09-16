"""Private HTTP boundary: authenticates, validates, and admits one solve at a time."""

import asyncio
import json
import secrets
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError

from .contracts import SolveRequest, SolveResult
from .execution import MAX_BYTES


def create_app(
    api_key: str, executor: Callable[[SolveRequest], Awaitable[SolveResult]]
) -> FastAPI:
    if len(api_key) < 32:
        raise ValueError("SOLVER_API_KEY must contain at least 32 characters")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    lock = asyncio.Lock()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/v1/solve")
    async def solve(request: Request):
        if not secrets.compare_digest(
            request.headers.get("authorization", "").encode(),
            f"Bearer {api_key}".encode(),
        ):
            raise HTTPException(401, "Unauthorized")
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            raise HTTPException(415, "Expected application/json")
        if lock.locked():
            raise HTTPException(409, "Solver busy")
        # A single ASGI event loop admits the request before another can acquire this lock.
        async with lock:
            body = bytearray()
            try:
                async with asyncio.timeout(10):
                    async for chunk in request.stream():
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            raise HTTPException(413, "Model too large")
            except TimeoutError:
                raise HTTPException(408, "Request timed out") from None
            try:
                payload = SolveRequest.model_validate(
                    json.loads(body), by_alias=True, by_name=False
                )
            except (ValidationError, json.JSONDecodeError, UnicodeDecodeError):
                raise HTTPException(422, "Invalid solver model or options") from None

            async def disconnected():
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        return

            work = asyncio.create_task(executor(payload))
            connection = asyncio.create_task(disconnected())
            try:
                completed, _ = await asyncio.wait(
                    [work, connection], return_when=asyncio.FIRST_COMPLETED
                )
                if connection in completed:
                    raise HTTPException(499, "Client disconnected")
                result = await work
                return result.model_dump(by_alias=True)
            except TimeoutError:
                raise HTTPException(504, "Solver process timed out") from None
            except HTTPException:
                raise
            except OSError, RuntimeError, ValueError:
                raise HTTPException(503, "Solver unavailable") from None
            finally:
                work.cancel()
                connection.cancel()
                await asyncio.gather(work, connection, return_exceptions=True)

    return app
