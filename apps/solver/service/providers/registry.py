"""Selects a provider from service configuration, never from HTTP request data."""

from service.providers.base import SolverProvider
from service.providers.or_tools import OrToolsProvider

PROVIDERS: dict[str, type[SolverProvider]] = {"or-tools": OrToolsProvider}


def create_provider(name: str) -> SolverProvider:
    provider = PROVIDERS.get(name)
    if provider is None:
        raise ValueError(f"Unknown solver provider: {name}")
    return provider()
