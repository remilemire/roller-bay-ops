# Allocations

`allocations` identifies the production order using `order_number` (1–50 characters, nonempty, with no leading or trailing whitespace). It records the creating user, creation/update timestamps, and nullable completion/cancellation timestamps. The persisted `is_draft` boolean identifies drafts. For non-drafts, completion/cancellation timestamps determine the API state (`active`, `completed`, or `cancelled`). Header checks require an order number and confirmation timestamp outside draft state, prohibit lifecycle timestamps while drafting, and keep completion and cancellation mutually exclusive. Order numbers are indexed; uniqueness has not been enforced pending confirmation of the order-number rules.

`allocation_items` records selected stock and, after confirmation, a positive `reserved_length_mm` reservation. Draft selections have null reservation lengths and may have no stock selected yet. Length is stored in millimetres as `numeric(12,3)`. A unique index on `(allocation_id, stock_item_id)` allows one combined reservation per stock item in an allocation. Each line has creation/update timestamps. Foreign keys restrict deletion of referenced users, allocations, and stock items.

Color, width, and current location come from the linked stock item. Reservations do not change its measured remaining length. Available length is calculated as remaining length minus reservations belonging to active allocations. The service locks stock items and validates aggregate reservations in a transaction; these table checks alone do not prevent over-allocation or reservations against consumed stock.

Completion means cutting results have been entered and reconciled. Cancellation releases the reservation without deleting its history.

## Plan tables

The feature defines five tables in `features/allocations/tables/`:

| Table                     | Responsibility                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `allocations`             | Order number, creator, and lifecycle                                                    |
| `allocation_requirements` | Required color, finished width/drop, extra drop allowance, and quantity                 |
| `allocation_items`        | Selected stock and its aggregate reservation                                            |
| `allocation_cuts`         | Full-width drops from a selected stock item, planned length, and per-edge trim snapshot |
| `allocation_cut_items`    | Requirements assigned to each drop and their quantities                                 |

All dimensions use `numeric(12,3)` millimetres with non-NaN checks. Unfinished draft business fields may be null. Supplied widths, lengths, trim allowances, and quantities are positive; extra drop allowance may be zero. Draft API writes explicitly preserve missing quantities and allowances as null; submission requires complete values. Foreign keys restrict deletion. Cut assignments have a composite primary key on cut and requirement, preventing duplicate assignments of the same requirement within a drop.

Cuts have unique positive `position` values within each allocation item. Cut items have unique positive positions within each cut, preserving left-to-right layout. Positions are one-based and may have gaps. Each assignment's copies are adjacent. `edge_trim_mm` is the saved allowance for one outside edge, matching the validator; it is not the total of both edges. `planned_length_mm` is validated against the longest assigned adjusted drop. Roll reservations equal summed drop lengths; remnant reservations cover the entire selected piece.

The allocation service validates that assigned requirements belong to the same allocation as the cut, that colors match, and that quantities and geometry satisfy the cutting validator. Ordinary foreign keys only enforce reference existence; they do not enforce those cross-table relationships or aggregate totals. The allocation service persists the header, requirements, reservations, cuts, and assignments atomically as described below.

The cutting-plan validator belongs to the allocations feature as a pure domain function: it validates order requirements and their proposed use of available stock. It does not belong to stock persistence or to the solver; both manually prepared and optimized plans should use it. A separate Nest module is unnecessary at this stage.

Migration `0008_add_allocations` creates the five allocation tables. Migration `0009_allocation_workflow` extends the header with revision, planning snapshots, idempotency records, and completion results.

## Cutting-plan validation

`validateCuttingPlan(context, plan)` is a pure backend function. Shared Zod contracts are exported from `@roller-bay/shared/allocations`. The context contains requirements, an application-supplied stock availability snapshot, and explicit universal trim and minimum reusable-remnant dimensions. The plan contains ordered full-width drops and their ordered requirement quantities. The bounded cutting optimizer described below proposes plans; the app-agnostic [Solver service and backend wrapper](solver.md) are separate from allocations.

The backend implementation and its tests live in `features/allocations/cutting-plan/`. The validator follows three stages: resolve inputs, check rules, then calculate a summary. Resolution parses the inputs, rejects duplicate or unknown IDs, and produces a named `ResolvedCuttingPlan` containing stock/requirement references, exact dimensions, and planned lengths per stock. Resolution failures return issues without forwarding a partial plan or generating secondary geometry errors.

Requirement validation owns color matching, repeated assignments, and quantity coverage. Drop validation owns width/length geometry and outside trims. Stock validation owns consumed/reserved stock checks and available-length capacity. All three return only issue arrays. They neither create leftovers nor return partial accounting totals. Once every rule passes, accounting independently calculates reservations, offcuts, reuse classification, and area totals from the resolved plan. Accounting has no dependency on validation functions or their return types. Exact dimension conversion is a separate utility shared by resolution, checks, and accounting. These are plain functions, not Nest providers or a separate module.

Each requirement specifies finished width, finished length, quantity, and extra length allowance. The allowance includes drop straightening, bottom bars, and tube attachment. A drop must equal the largest assigned length plus its allowance. Widths cannot rotate; they are cut after the full-width drop, then shorter pieces are trimmed individually. Only full straight cuts across the current separated piece are represented. Newly created offcuts cannot supply other drops in the same plan.

The positive `edgeTrimMm` applies to each original outside edge, not to each blind. Width fit requires the sum of blind widths plus two trims; shared internal edges need no extra allowance. The canonical layout places one trim-width strip on the left and all remaining width on the right. Existing remnants use the same conservative edge rule. There is no separate blade-kerf allowance in this model.

The validator requires exact requirement quantities, matching colors, known unique identifiers, unconsumed stock, and enough remaining length after active reservations. It aggregates all drops per stock item. A remnant with any positive reservation is unavailable; a selected remnant reserves its entire remaining length. Multiple drops may come from the same selected remnant. The allocation service supplies authoritative reservation totals and revalidates under stock locks when saving; this function cannot guarantee that a snapshot is still current.

Leftovers are reconstructed as left/right strips, shortening offcuts, and remnant tails. Each physical rectangle is reusable when its width and length both meet the configured inclusive thresholds without rotation; quantities do not combine separate pieces into a larger remnant. Thresholds refer to the physical offcut dimensions, not guaranteed finished-blind dimensions after a future trim. No drop allowance is added again when classifying leftovers. Actual usability remains an estimate for cutters to confirm.

All geometry and area accounting use integer thousandths of a millimetre and `bigint`. Successful results include reservations, leftover rectangles, drop/stock/new-roll counts, and exact decimal-string areas in square millimetres. Input area equals required cutting-piece area (including allowance), reusable area, and waste area. Uncut roll balance is excluded; selected remnants include their whole area and classify the tail. Invalid results contain structured issue codes and paths and no usable summary. Solver-provided totals and unsupported layout fields are rejected rather than trusted.

Input limits are 1,000 requirement lines, 10,000 candidate stock items, 10,000 drops, 1,000 entries per drop, and quantity 10,000 per entry. Dimensions retain the stock contract's maximum of 999,999,999.999 mm. These are validation bounds, not solver performance guarantees. The integer constraint solving adapter independently guards its safe-integer arithmetic; this validator's exact `bigint` accounting has no such solver limitation.

## Bounded cutting optimization

`features/allocations/optimizer/` contains the concrete `CuttingPlanOptimizer`, which receives the generic `SolverClient` directly. It accepts an authoritative `CuttingContext` snapshot and returns proposed cuts without writing reservations. The Python service retains the mathematical solver provider interface; fabric-specific model construction stays in the backend. The allocations module exposes this through the optimization preview endpoint.

The optimizer supports at most 100 individual blinds, counting quantities. It validates schemas, normalized identifier uniqueness, and reservation totals before generating candidates. Consumed stock and reserved remnants are excluded, and roll reservations reduce available length. A requirement that fits no eligible stock proves infeasibility without calling the solver. Otherwise aggregate stock capacity is checked by the mathematical model.

### Patterns and mathematical model

A pattern is one full-width drop containing quantities of compatible requirements. Patterns respect fixed orientation, both outside trims, and the maximum adjusted requirement length. Single-blind patterns seed the search, followed by greedy combinations ordered by descending adjusted length and width, then bounded enumeration. Width groups take turns within each fabric color. Each pattern gets a stock candidate before receiving another; remnants and used rolls are considered before new rolls when candidate selection is limited.

Pattern generation and stock assignment selection have internal limits of 2,000 patterns, 100,000 generation steps, and 6,000 stock-pattern assignments, divided across required fabric colors. Generation yields periodically for cancellation. These limits intentionally trade exhaustive coverage for bounded work; 100 blinds is an input limit, not a guarantee of finding a plan within the search budget.

The integer model selects counts of each stock-pattern assignment, requires exact requirement quantities, and enforces aggregate available length. Boolean variables track selected stock. Selected remnants account for their entire remaining length: a tail is calculated after all drops, and its waste is charged once, only when it fails the inclusive reuse thresholds. Unselected remnants have no modeled tail. Drop scoring and final accounting share pure offcut geometry and reuse classification in `cutting-plan/cutting-offcuts.ts`. New offcuts cannot feed additional drops within the same plan.

All dimensions and area coefficients are constructed with exact integer arithmetic. Length and area coefficients are divided by exact common factors before conversion to solver numbers. Unsafe integer ranges raise an explicit error rather than rounding. Models exceeding the existing variable, constraint, or request-size limits return `unknown` with reason `model_limit`.

### Objectives, results, and deadlines

The optimizer minimizes, in order: discarded area, new rolls opened, full-width drops, and stock items handled. Reusable offcuts do not count as waste; therefore this objective may create reusable scraps to reduce discarded material. There is no additional preference for remnant consumption beyond these objectives.

A separate solve is used for each nonconstant tie-breaker. Only an objective proven optimal within the generated model is locked before advancing. A feasible-but-unproven result ends refinement. `maxTimeSeconds` defaults to five seconds, accepts up to 60 seconds, and is shared across passes using reported solver time. Candidate generation is separately bounded; network and worker-startup overhead add elapsed time. `AbortSignal` cancellation is observed during generation and solving. A later unknown result or solver deadline preserves an already validated incumbent.

A `feasible` result contains a complete `CuttingPlan` and independently validated `CuttingPlanSummary`. It makes no global-optimality claim. `infeasible` is returned only for a necessary feasibility failure or solver proof after complete pattern and stock-assignment coverage. When truncated candidates or the search deadline prevent establishing a result, the optimizer returns `unknown` with reason `search_limit`. It never returns a partial order. Invalid input/options, cancellation, unsafe numbers, invalid models/solutions, and operational solver failures remain exceptions; a solver deadline without an incumbent returns `unknown`. Over HTTP, only order-level input problems (blind count, duplicate identifiers, over-reserved stock, unsafe numbers) return 400 with their message; schema failures on server-built context or options, invalid models or solutions, and solver transport faults return 503 `Optimization is unavailable.` with the detail logged, as described in [error responses](errors.md).

Model building returns explicit assignment metadata for decoding. Each returned plan passes `validateCuttingPlan()`, and all four modeled objectives are compared against its independently calculated summary. Saving an allocation revalidates availability under stock locks.

### Verification

Unit tests cover candidate limits, deterministic selection, cancellation, objective locking, search budgets, result/error handling, and numeric/model limits. `npm run test:solver --workspace=@roller-bay/api` runs serial HTTP integration tests against the standalone solver, including the allocator example, a 100-blind order, and tiny exhaustive reference searches that independently partition blinds and try stock assignments. These compare the complete objective priority order, including remnant-tail accounting, decimal allowances, and reservations.

## Allocation workflow API

All routes are under `/api/allocations`, require an active authenticated user, and allow users, admins, and the owner. Mutations use the existing Origin/CSRF checks and shared rate limiting. Direct creation confirms the plan and reserves stock; the draft endpoints below save incomplete plans without reservations. Reservations affect availability, not measured stock length.

| Method | Route                       | Behavior                                                                                                                                      |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/allocations`              | Paginated list with optional `search` (order number) and `state` (`draft`, `active`, `completed`, `cancelled`); defaults exclude drafts.      |
| GET    | `/allocations/:id`          | Requirements, saved plan/settings/summary, reservations, current stock locations and measurements, completion results, and `needsReplanning`. |
| POST   | `/allocations/optimize`     | Suggest a plan using a database availability snapshot; no writes.                                                                             |
| POST   | `/allocations/validate`     | Validate an edited plan against current stock; no writes. Returns `valid`, summary or issues, and selected stock details.                     |
| POST   | `/allocations`              | Create the allocation and reservations atomically; requires `Idempotency-Key`.                                                                |
| PUT    | `/allocations/:id`          | Replace an active allocation's order number, requirements, settings, and plan atomically.                                                     |
| POST   | `/allocations/:id/cancel`   | Cancel an active allocation and release reservations. Repeating cancellation is safe.                                                         |
| POST   | `/allocations/:id/complete` | Apply observed stock outcomes, create retained scraps, and complete atomically; requires `Idempotency-Key`.                                   |

Creation takes `{ orderNumber, requirements, settings, plan }`. Requirement IDs are client-generated UUIDs, allowing plans to reference unsaved form rows; they become persisted requirement IDs on submission. Replacement includes the same complete payload plus `expectedRevision`. Cancellation takes `{ expectedRevision }`. The header starts at revision 1 and each successful replacement, cancellation, or completion increments it. Completed and cancelled allocations cannot be edited or completed again. Stale revisions and unavailable reservations return 409. Order numbers remain nonunique; the retry key protects repeated submissions, not independently entered duplicate orders.

Previews accept `requirements` and `settings`; validation also requires `plan`. Optimization optionally accepts `maxTimeSeconds`. When revising an existing allocation, provide both `allocationId` and `expectedRevision` so its own reservations are excluded. Request bodies cannot supply stock measurements or reservation totals. Preview reads use a consistent database snapshot, then release the transaction before solver work. A preview never guarantees availability at submission time. Valid plans are saved only after locking the header and involved stock rows and rechecking reservations. All stock locks are acquired in sorted ID order.

Optimization requires `SOLVER_URL` (defaults to `http://127.0.0.1:8001`) and `SOLVER_API_KEY` in the API environment, using the same key configured in the Python service. Missing configuration returns 503 only from optimization; manual workflow endpoints remain available. A disconnected preview request cancels its solver request. Solver busy responses become 409; optimizer search/model limits retain their `unknown` result and reason.

### Cutting completion

Completion takes `{ expectedRevision, items }`, with exactly one outcome per allocated stock item. Every item includes `stockItemId`, `expectedUpdatedAt` from the current stock response, and optionally `scraps`. A stock timestamp mismatch returns 409 so results cannot silently overwrite a newer measurement.

- `outcome: "returned-roll"`: positive `radialDepthMm`, `locationId`, and `tubeOuterDiameterMm` if not already known. Depth is the one-sided reading `(outer − tube) / 2`. The current catalog thickness is saved with the measurement and the database calculates remaining length.
- `outcome: "returned-remnant"`: positive `widthMm`, `explicitLengthMm`, and `locationId`. Width cannot exceed the original width. Roll measurement fields are not accepted.
- `outcome: "consumed"`: marks the existing stock item consumed. A previously unused roll still requires its tube diameter, including when fully consumed, to satisfy the established used-roll invariant. Its remaining length becomes zero; its last location remains recorded.
- `scraps`: retained pieces, each with positive `widthMm`, `lengthMm`, `locationId`, and optional `quantity` (default 1). Each piece becomes a distinct used remnant with the source fabric color and `sourceStockItemId`. At most 1,000 pieces may be created by one completion.

Known tube diameters cannot change through completion and must be positive multiples of 5 mm. To turn a remaining roll into flat pieces, mark the roll consumed and enter the pieces as scraps. Estimated cut lengths are never subtracted from measured balances, and calculated plan leftovers are never automatically added to inventory.

Completion records actual measurements even when they are below other active reservations. Its report includes `affectedAllocationIds`, and list/detail responses dynamically expose `needsReplanning` for active allocations referencing consumed or over-reserved stock. All allocations sharing a shortage are flagged because the app has no production-priority policy for selecting a winner. Revising or cancelling reservations clears the flag when availability is sufficient again. Current flags are derived; the completion report preserves which allocations were affected at submission time.

### Retries, persistence, and verification

Creation keys are UUIDs scoped to the submitting user. Completion keys are scoped to the allocation and completing user. Identical normalized requests replay without additional writes; reusing a key with a changed payload returns 409. Replays return the allocation's current detail, including live stock fields, while saved planning and completion snapshots remain unchanged. Failed transactions do not consume retry keys. Every stock write and retained scrap is rolled back if any part of completion fails.

The header saves planning settings and the estimated summary, plus completion outcomes and created remnant IDs. Snapshot columns are nullable for older records; no historical settings or measurements are invented. List and detail use repeatable-read transactions. The workflow is designed for one completion form per allocation; partial completion, production priority, correction of finalized records, and substitution of different stock at completion are not implemented.

Contract tests run in the normal backend suite. Database/HTTP cases are part of `npm run test:integration` and use the migrated schema with isolated rows, real sessions, and real PostgreSQL transactions. They cover normal-user access, authoritative previews, concurrent reservation conflicts, same-key replay, stale edits, rollback, measurement entry, retained scraps, and replanning flags. The preview optimizer is stubbed in this workflow suite; actual solver behavior is covered separately by `npm run test:solver`.

## Shared typed drafts

Apply `0010_typed_drafts` before running the draft APIs.

Drafts are new allocations with `is_draft = true` and null `confirmed_at`, sharing the same header and child tables as confirmed allocations. No separate draft table or JSON draft payload is used. Any active employee can resume a draft; the original creator remains recorded. Active allocation edits and cutting-completion forms do not have drafts.

| Method | Path                           | Behavior                                                                   |
| ------ | ------------------------------ | -------------------------------------------------------------------------- |
| POST   | `/api/allocations/drafts`      | Create from `{ data }`; UUID `Idempotency-Key` required.                   |
| GET    | `/api/allocations?state=draft` | List shared drafts by latest update.                                       |
| GET    | `/api/allocations/:id`         | Draft metadata plus `data`, or confirmed allocation detail.                |
| PUT    | `/api/allocations/:id/draft`   | Replace form with `{ expectedRevision, data }`.                            |
| DELETE | `/api/allocations/:id/draft`   | Delete draft header and children with `{ expectedRevision }`; returns 204. |
| POST   | `/api/allocations/:id/submit`  | Validate and confirm saved form with `{ expectedRevision }`; returns 200.  |

`data` contains `orderNumber`, `requirements`, `settings`, and `plan`. Unfinished business fields may be omitted or null; arrays may be empty. Blank controls should send null. Each requirement must have a unique UUID, and each assignment must identify a requirement within the same draft. A drop may be unassigned or have no assignments yet. Supplied IDs must exist, numeric precision/ranges still apply, and duplicate assignments within a drop are rejected. Full replacement turns omitted fields into null and omitted arrays into empty arrays rather than retaining old values. Missing quantities and allowances are not defaulted. Complete geometry and stock availability are checked on submission, not draft saves.

Requirements use saved positions. Cuts use a whole-plan position in addition to their existing per-stock positions; this preserves interleaved and unassigned drops. Drops selecting the same stock share an allocation item, while each unassigned drop has its own placeholder item. All draft reservation lengths stay null. Header settings retain their existing typed JSON representation, with unfinished fields allowed to be null.

Only non-draft allocations with neither completion nor cancellation timestamps count in reservation totals and shortage queries, including correlated SQL. Drafts never reserve stock and always report `needsReplanning: false`. Validation/optimization previews accept a draft ID plus its current revision; preview input must still satisfy the complete validator/optimizer contract.

All saves lock the header and check its revision. Confirmation revalidates the entire saved plan against current stock under sorted stock locks, calculates reservations and summary, sets `is_draft = false` and `confirmed_at`, and increments the revision atomically. Incomplete forms return 400; unavailable stock and stale revisions return 409. Failed confirmation leaves the draft unchanged. The allocation and requirement IDs are retained. Other internal planning-row IDs may be regenerated when replacing or confirming the plan.

Submission records the prior draft revision. Retrying that revision returns the current allocation without additional reservations, even if it has subsequently progressed through its lifecycle. Other revisions and direct-created allocations return 409. Drafts cannot use active replacement, cancellation, or completion endpoints; confirmed records cannot use draft editing/deletion. Shared contracts expose `allocationRecordSchema` for state-discriminated detail; the existing confirmed-detail schema retains strict fields.

### Migration and database enforcement

`0010_typed_drafts` backfills existing `confirmed_at` from `created_at` and sets `is_draft = false`, preserving completion/cancellation timestamps, revisions, and stock links. Requirement positions follow UUID order per allocation; whole-plan cut positions follow the previous stock-ID/per-stock-position order. Positions become required after backfill, and submitted-draft revisions start null. Receipt metadata and ordering are backfilled in the same migration.

Header checks enforce lifecycle consistency. Deferred constraint triggers enforce the previously required requirement, selected-stock, cut, and assignment fields whenever the parent is confirmed. Child changes write an unchanged parent revision to serialize against concurrent confirmation without incrementing the public revision. The checks inspect final transaction contents, so replacing a confirmed plan remains atomic. Service validation still owns complete settings, geometry, availability, and useful input errors. The hand-written trigger definitions live in the migration, outside Drizzle's generated table metadata.

Unit tests cover partial contracts, lifecycle rules, and SQL filtering out drafts. Database/HTTP tests cover partial typed rows, placeholders, ordering, shared access, idempotency, revisions, concurrent reservation conflicts, deletion, and submission rollback. Raw-SQL tests verify each conditionally required planning field and reject confirming incomplete children. Fixtures copy the real migrated tables and triggers, with no test-only schema alterations.
