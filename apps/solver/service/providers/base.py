"""Provider contract for the service's bounded integer optimization capability."""

from abc import ABC, abstractmethod

from service.contracts import SolveRequest, SolveResult


class SolverProvider(ABC):
    @abstractmethod
    def solve(self, request: SolveRequest) -> SolveResult:
        raise NotImplementedError
