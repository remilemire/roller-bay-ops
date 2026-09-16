import asyncio
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from pydantic import ValidationError

from service.app import create_app
from service.contracts import NoSolutionResult, SolutionResult, SolveRequest, Variable
from service.execution import execute
from service.providers.base import SolverProvider
from service.worker import solve_request

KEY = "test-service-key-" * 3
MODEL = {
    "model": {
        "variables": [{"name": "x", "lowerBound": 0, "upperBound": 10}],
        "constraints": [],
        "objective": {
            "direction": "maximize",
            "terms": [{"variable": "x", "coefficient": 1}],
        },
    },
    "options": {"maxTimeSeconds": 5, "randomSeed": 0},
}


class ContractsTest(unittest.TestCase):
    def test_python_names_and_wire_aliases(self):
        variable = Variable(name="x", lower_bound=0, upper_bound=10)
        self.assertEqual(variable.lower_bound, 0)
        self.assertEqual(
            variable.model_dump(by_alias=True), MODEL["model"]["variables"][0]
        )
        request = SolveRequest.model_validate(MODEL)
        self.assertEqual(request.options.max_time_seconds, 5)
        self.assertEqual(request.model_dump(by_alias=True), MODEL)
        result = SolutionResult(
            status="optimal",
            values={"x": 10},
            objective_value=10,
            best_objective_bound=10,
            wall_time_seconds=0,
        )
        self.assertEqual(
            result.model_dump(by_alias=True),
            {
                "status": "optimal",
                "values": {"x": 10},
                "objectiveValue": 10,
                "bestObjectiveBound": 10,
                "wallTimeSeconds": 0,
            },
        )

    def test_worker_passes_typed_models_to_provider(self):
        class FakeProvider(SolverProvider):
            def solve(self, request):
                return SolutionResult(
                    status="feasible",
                    values={"x": request.model.variables[0].upper_bound},
                    objective_value=10,
                    best_objective_bound=10,
                    wall_time_seconds=0,
                )

        result = solve_request(json.dumps(MODEL).encode(), FakeProvider())
        self.assertEqual(result.values, {"x": 10})
        self.assertEqual(result.objective_value, 10)

    def test_rejects_unsafe_and_ambiguous_models(self):
        for mutation in [
            lambda m: m["model"]["variables"].append(m["model"]["variables"][0]),
            lambda m: m["model"]["variables"][0].update(lowerBound=0.5),
            lambda m: m["model"]["variables"][0].update(lowerBound=True),
            lambda m: m["model"]["variables"][0].update(lowerBound=11),
            lambda m: m["model"]["objective"]["terms"][0].update(variable="missing"),
            lambda m: m["model"]["objective"]["terms"][0].update(coefficient=2**53 - 1),
            lambda m: m["options"].update(maxTimeSeconds=61),
        ]:
            candidate = copy.deepcopy(MODEL)
            mutation(candidate)
            with self.assertRaises(ValidationError):
                SolveRequest.model_validate(candidate)

    def test_enforcement_requires_boolean_variable(self):
        candidate = copy.deepcopy(MODEL)
        candidate["model"]["constraints"] = [
            {
                "terms": [],
                "operator": "==",
                "rhs": 0,
                "onlyEnforceIf": [{"variable": "x"}],
            }
        ]
        with self.assertRaises(ValidationError):
            SolveRequest.model_validate(candidate)


class ServiceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.started = asyncio.Event()
        self.finished = asyncio.Event()
        self.release = asyncio.Event()

        async def executor(payload):
            self.started.set()
            try:
                await self.release.wait()
                return NoSolutionResult(status="unknown", wall_time_seconds=0)
            finally:
                self.finished.set()

        self.app = create_app(KEY, executor)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {KEY}"},
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_authentication_validation_and_body_limits(self):
        self.assertEqual((await self.client.get("/health")).status_code, 200)
        self.assertEqual(
            (
                await self.client.post(
                    "/v1/solve", json=MODEL, headers={"Authorization": "wrong"}
                )
            ).status_code,
            401,
        )
        self.assertEqual(
            (await self.client.post("/v1/solve", json={})).status_code, 422
        )
        self.assertEqual(
            (
                await self.client.post(
                    "/v1/solve",
                    content=b"x" * (4 * 1024 * 1024 + 1),
                    headers={"Content-Type": "application/json"},
                )
            ).status_code,
            413,
        )
        self.assertFalse(self.started.is_set())

    async def test_http_requires_camel_case_and_serializes_aliases(self):
        candidate = copy.deepcopy(MODEL)
        candidate["options"] = {"max_time_seconds": 5}
        self.assertEqual(
            (await self.client.post("/v1/solve", json=candidate)).status_code, 422
        )
        self.assertFalse(self.started.is_set())
        self.release.set()
        response = await self.client.post("/v1/solve", json=MODEL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "unknown", "wallTimeSeconds": 0})

    async def test_one_global_slot_and_request_cancellation(self):
        pending = asyncio.create_task(self.client.post("/v1/solve", json=MODEL))
        await asyncio.wait_for(self.started.wait(), 2)
        self.assertEqual(
            (await self.client.post("/v1/solve", json=MODEL)).status_code, 409
        )
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertTrue(self.finished.is_set())
        self.release.set()
        self.assertEqual(
            (await self.client.post("/v1/solve", json=MODEL)).status_code, 200
        )

    async def test_execution_error_mapping(self):
        async def failure(payload):
            raise TimeoutError()

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app(KEY, failure)),
            base_url="http://test",
            headers={"Authorization": f"Bearer {KEY}"},
        ) as client:
            self.assertEqual(
                (await client.post("/v1/solve", json=MODEL)).status_code, 504
            )


class ExecutionTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_solver(self):
        result = await execute(
            SolveRequest.model_validate(MODEL), provider_name="or-tools"
        )
        self.assertEqual(result.status, "optimal")
        self.assertEqual(result.values["x"], 10)

    async def test_worker_is_reaped_on_cancellation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "service"
            root.mkdir()
            (root / "__init__.py").write_text("")
            (root / "worker.py").write_text(
                'import os,time\nfrom pathlib import Path\nPath(__file__).with_suffix(".pid").write_text(str(os.getpid()))\ntime.sleep(60)\n'
            )
            with patch("service.execution.__file__", str(root / "execution.py")):
                pending = asyncio.create_task(
                    execute(
                        SolveRequest.model_validate(MODEL), provider_name="or-tools"
                    )
                )
                try:
                    for _ in range(100):
                        if (root / "worker.pid").exists():
                            break
                        await asyncio.sleep(0.01)
                    self.assertTrue((root / "worker.pid").exists())
                    pid = int((root / "worker.pid").read_text())
                finally:
                    pending.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await pending
                import os

                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
