# Allocations

`allocations` identifies the production order using `order_number` (1–50 characters, nonempty, with no leading or trailing whitespace). It records the creating user, creation/update timestamps, and nullable completion/cancellation timestamps. Both lifecycle timestamps being null means active; a check prohibits setting both. Order numbers are indexed; uniqueness has not been enforced pending confirmation of the order-number rules.

`allocation_items` reserves a positive `reserved_length_mm` amount from a specific stock item. Length is stored in millimetres as `numeric(12,3)`. A unique index on `(allocation_id, stock_item_id)` allows one combined reservation per stock item in an allocation. Each line has creation/update timestamps. Foreign keys restrict deletion of referenced users, allocations, and stock items.

Color, width, and current location come from the linked stock item. Reservations do not change its measured remaining length. Available length will be calculated as remaining length minus reservations belonging to active allocations. The future service must lock stock items and validate aggregate reservations in a transaction; these table checks alone do not prevent over-allocation or reservations against consumed stock.

Completion means cutting results have been entered and reconciled. Cancellation releases the reservation without deleting its history.

## Plan tables

The feature defines five tables:

| Table                     | Responsibility                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `allocations`             | Order number, creator, and lifecycle                                                    |
| `allocation_requirements` | Required color, finished width/drop, extra drop allowance, and quantity                 |
| `allocation_items`        | Selected stock and its aggregate reservation                                            |
| `allocation_cuts`         | Full-width drops from a selected stock item, planned length, and per-edge trim snapshot |
| `allocation_cut_items`    | Requirements assigned to each drop and their quantities                                 |

All dimensions use `numeric(12,3)` millimetres with non-NaN checks. Widths, lengths, trim allowances, and quantities are positive; extra drop allowance may be zero. Requirement quantities default to one and extra drop allowance to zero. Foreign keys restrict deletion. Cut assignments have a composite primary key on cut and requirement, preventing duplicate assignments of the same requirement within a drop.

Cuts have unique positive `position` values within each allocation item. Cut items have unique positive positions within each cut, preserving left-to-right layout. Positions are one-based and may have gaps. Each assignment's copies are adjacent. `edge_trim_mm` is the saved allowance for one outside edge, matching the validator; it is not the total of both edges. `planned_length_mm` is validated against the longest assigned adjusted drop. Roll reservations equal summed drop lengths; remnant reservations cover the entire selected piece.

The future allocation service must validate that assigned requirements belong to the same allocation as the cut, that colors match, and that quantities and geometry satisfy the cutting validator. Ordinary foreign keys only enforce reference existence; they do not enforce those cross-table relationships or aggregate totals. Saving the header, requirements, reservations, cuts, and assignments must be atomic. No persistence service or endpoint has been implemented yet.

The cutting-plan validator belongs to the allocations feature as a pure domain function: it validates order requirements and their proposed use of available stock. It does not belong to stock persistence or to the solver; both manually prepared and optimized plans should use it. A separate Nest module is unnecessary at this stage.

Migration `0008_add_allocations` creates the five allocation tables. No allocation endpoints or reservation-writing workflow have been added.

## Cutting-plan validation

`validateCuttingPlan(context, plan)` is a pure backend function. Shared Zod contracts are exported from `@roller-bay/shared/allocations`. The context contains requirements, an application-supplied stock availability snapshot, and explicit universal trim and minimum reusable-remnant dimensions. The plan contains ordered full-width drops and their ordered requirement quantities. No optimizer or Python dependency is installed.

The backend implementation and its tests live in `features/allocations/cutting-plan/`. The validator follows three stages: resolve inputs, check rules, then calculate a summary. Resolution parses the inputs, rejects duplicate or unknown IDs, and produces a named `ResolvedCuttingPlan` containing stock/requirement references, exact dimensions, and planned lengths per stock. Resolution failures return issues without forwarding a partial plan or generating secondary geometry errors.

Requirement validation owns color matching, repeated assignments, and quantity coverage. Drop validation owns width/length geometry and outside trims. Stock validation owns consumed/reserved stock checks and available-length capacity. All three return only issue arrays. They neither create leftovers nor return partial accounting totals. Once every rule passes, accounting independently calculates reservations, offcuts, reuse classification, and area totals from the resolved plan. Accounting has no dependency on validation functions or their return types. Exact dimension conversion is a separate utility shared by resolution, checks, and accounting. These are plain functions, not Nest providers or a separate module.

Each requirement specifies finished width, finished length, quantity, and extra length allowance. The allowance includes drop straightening, bottom bars, and tube attachment. A drop must equal the largest assigned length plus its allowance. Widths cannot rotate; they are cut after the full-width drop, then shorter pieces are trimmed individually. Only full straight cuts across the current separated piece are represented. Newly created offcuts cannot supply other drops in the same plan.

The positive `edgeTrimMm` applies to each original outside edge, not to each blind. Width fit requires the sum of blind widths plus two trims; shared internal edges need no extra allowance. The canonical layout places one trim-width strip on the left and all remaining width on the right. Existing remnants use the same conservative edge rule. There is no separate blade-kerf allowance in this model.

The validator requires exact requirement quantities, matching colors, known unique identifiers, unconsumed stock, and enough remaining length after active reservations. It aggregates all drops per stock item. A remnant with any positive reservation is unavailable; a selected remnant reserves its entire remaining length. Multiple drops may come from the same selected remnant. The future caller must supply authoritative reservation totals and revalidate under stock locks when saving; this function cannot guarantee that a snapshot is still current.

Leftovers are reconstructed as left/right strips, shortening offcuts, and remnant tails. Each physical rectangle is reusable when its width and length both meet the configured inclusive thresholds without rotation; quantities do not combine separate pieces into a larger remnant. Thresholds refer to the physical offcut dimensions, not guaranteed finished-blind dimensions after a future trim. No drop allowance is added again when classifying leftovers. Actual usability remains an estimate for cutters to confirm.

All geometry and area accounting use integer thousandths of a millimetre and `bigint`. Successful results include reservations, leftover rectangles, drop/stock/new-roll counts, and exact decimal-string areas in square millimetres. Input area equals required cutting-piece area (including allowance), reusable area, and waste area. Uncut roll balance is excluded; selected remnants include their whole area and classify the tail. Invalid results contain structured issue codes and paths and no usable summary. Solver-provided totals and unsupported layout fields are rejected rather than trusted.

Input limits are 1,000 requirement lines, 10,000 candidate stock items, 10,000 drops, 1,000 entries per drop, and quantity 10,000 per entry. Dimensions retain the stock contract's maximum of 999,999,999.999 mm. These are validation bounds, not optimizer performance guarantees. A future CP-SAT adapter must independently guard its signed-64-bit arithmetic; this validator's exact `bigint` accounting has no such solver limitation.
