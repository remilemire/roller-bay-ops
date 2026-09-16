"""Standalone service entry point; never imported or launched by the Nest backend."""

import os
from functools import partial
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

from .app import create_app
from .execution import execute
from .providers.registry import create_provider


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    provider_name = os.environ.get("SOLVER_PROVIDER", "or-tools")
    create_provider(provider_name)
    app = create_app(
        os.environ.get("SOLVER_API_KEY", ""),
        partial(execute, provider_name=provider_name),
    )
    uvicorn.run(
        app,
        host=os.environ.get("SOLVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SOLVER_PORT", "8001")),
        workers=1,
        access_log=False,
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
