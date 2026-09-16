"""Runs the selected provider in an isolated process using the generic wire contract."""

import argparse
import json
import sys

from pydantic import TypeAdapter

from service.contracts import SolveRequest, SolveResult
from service.providers.base import SolverProvider
from service.providers.registry import create_provider


def solve_request(payload: bytes, provider: SolverProvider) -> SolveResult:
    request = SolveRequest.model_validate(
        json.loads(payload), by_alias=True, by_name=False
    )
    return TypeAdapter(SolveResult).validate_python(provider.solve(request))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", required=True)
    arguments = parser.parse_args()
    try:
        result = solve_request(
            sys.stdin.buffer.read(4 * 1024 * 1024 + 1),
            create_provider(arguments.provider),
        )
        print(result.model_dump_json(by_alias=True))
    except (KeyError, ValueError, TypeError, RuntimeError):
        print("Solver worker failed.", file=sys.stderr)
        sys.exit(1)
