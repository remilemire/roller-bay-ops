# Solver service and backend wrapper

`apps/solver` is an independently runnable Python HTTP app. It owns strict request validation, execution capacity, solver subprocesses, and cancellation. Its `SolverProvider` interface currently has an `OrToolsProvider` implementation using OR-Tools' Python API; the Nest backend does not install Python, start the service, or locate worker scripts.

`apps/api/src/solver` is the top-level Nest wrapper. `SolverModule.register({ baseUrl, apiKey })` provides an injectable `SolverClient`. It validates requests, sends HTTP calls, maps transport errors, and verifies returned assignments against the submitted mathematical model. It has no fabric/allocation types. The allocations module configures a client through `SolverModule.registerAsync()` and passes it to the cutting optimizer. Configure `SOLVER_URL` and `SOLVER_API_KEY` in the API environment. When the key is absent, the API still starts and manual allocations work; optimization previews return 503.

`SOLVER_PROVIDER` selects the implementation inside the Python service and defaults to `or-tools`. The backend knows only the generic solving contract. Additional providers must implement that same contract; fabric-specific optimization lives in the allocations feature.

Python fields and attributes use snake_case. Pydantic aliases translate camelCase JSON at HTTP and subprocess boundaries; wire requests continue to require camelCase.

## Run locally

From the repository root:

```sh
python3 -m venv apps/solver/.venv
apps/solver/.venv/bin/python -m pip install -r apps/solver/requirements-dev.txt
cp apps/solver/.env.example apps/solver/.env
```

Set `SOLVER_API_KEY` in that ignored file to a random value of at least 32 characters. Supply the same key to the backend module's `apiKey` option and set its `baseUrl` to `http://127.0.0.1:8001`. The local service environment has already been created in this workspace; do not overwrite it with the example unless reconfiguring. The key is not committed.

```sh
npm run dev --workspace=@roller-bay/solver
```

The root `npm run dev` also includes the service through the workspace scripts. `SOLVER_HOST` defaults to `127.0.0.1`; `SOLVER_PORT` defaults to `8001`. The app loads its own `.env`. Production can install `requirements.txt` without development tools and run `python -m service.main` from `apps/solver`. Python 3.14/macOS ARM64 was used for validation.

Run a single Uvicorn worker per service instance. Concurrency is enforced by the service, shared across backend clients: one admitted request and one solver thread at a time. Extra requests return HTTP 409 (`busy`), with no hidden queue. Separate deployed instances each have their own capacity. Keep the service on a private network; it is not a browser-facing API.

## HTTP contract

- `GET /health` — public liveness check; it does not prove the solver can complete a request.
- `POST /v1/solve` — requires `Authorization: Bearer <key>` and JSON `{ model, options }`.

The model accepts bounded integer variables, linear constraints (`<=`, `==`, `>=`), optional Boolean enforcement literals, and an optional linear minimize/maximize objective. Enforcement lists are conjunctions; Boolean domains have bounds within 0 and 1. Omitting the objective requests feasibility only.

This is an app-agnostic subset of integer constraint solving, not a universal optimization framework. Max/product equalities, scheduling constraints, multiple objectives, and hints are not exposed yet. The bounded cutting optimizer translates requirements into supported solver models and validates its cutting plans separately; see [allocations](allocations.md).

All numeric model values must be safe JavaScript integers. A conservative sum of absolute term bounds must also fit that range. Variable names are unique ASCII identifiers beginning with a letter, up to 100 characters. Duplicate expression terms must be combined; unknown references and non-Boolean enforcement variables fail validation in both the wrapper and service. The service validates independently even if callers bypass Nest.

Results distinguish `optimal`, `feasible`, `infeasible`, `unknown`, and `model_invalid`. Only feasible/optimal results contain assignments and objective information. Search exhaustion without a solution means `unknown`, not proven infeasibility. Objective values are recomputed exactly from assignments; `bestObjectiveBound` is the provider’s floating-point bound. With no objective, both fields are null. The wrapper verifies assignments, active constraints, and objective values, but does not independently prove optimality or infeasibility.

## Limits and cancellation

Requests and worker output are limited to 4 MiB; the HTTP wrapper also limits response size. Authenticated body uploads have a 10-second deadline. Solver search defaults to five seconds and is configurable up to 60 seconds. The service adds 30 seconds for interpreter imports/model construction; the client adds 35 seconds to allow response overhead. These are process/request deadlines distinct from the solver's search limit. `wallTimeSeconds` reports solver time, not HTTP latency.

The service keeps CPU work in a child process. A deadline or client disconnect cancels execution, kills/reaps the child, and then releases capacity. Client cancellation uses `AbortSignal`; cancellation and Nest shutdown abort HTTP requests. The wrapper no longer owns execution slots or OS processes, so a new request can briefly receive `busy` while the service observes a disconnect and cleans up. No automatic retries occur.

Typed client errors include `invalid_model`, `invalid_options`, `busy`, `unavailable`, `timeout`, `cancelled`, `protocol_error`, and `closed`. Service errors never return worker tracebacks. A process deadline maps to HTTP 504 / `timeout`; malformed inputs to 422 / `invalid_model`; auth and runtime failures to `unavailable` in the wrapper. These limits do not enforce a hard RAM cap; host/container resource limits remain a deployment concern.

## Verification

```sh
npm test --workspace=@roller-bay/solver
npm run lint --workspace=@roller-bay/solver
npm test --workspace=@roller-bay/api
# Requires the standalone service running; loads apps/solver/.env for its key.
npm run test:solver --workspace=@roller-bay/api
```

Python tests cover independent validation, authentication, request limits, shared capacity, cancellation cleanup, and a real solver call. Backend unit tests exercise model/response checks and HTTP failure handling without Python. The explicit backend integration suite calls the running HTTP app for real solving and authentication checks.
