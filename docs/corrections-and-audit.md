# Corrections and audit history

Corrections change effective operational records while preserving the original submission and each change in history. Only admins and the owner can correct or void records. Staff/admin/owner accounts can view general history; pending and production accounts cannot. Corrections require a reason, an expected revision, and a UUID `Idempotency-Key`.

## Schema and rollout

The source model adds `audit_events`, `audit_changes`, and `correction_requests`; stock revisions and `voided_at`; receipt-line `voided_at`; receipt and allocation stock-effect baselines; and effective completion/correction timestamps.

The inspected SQL adds `voided_at` before changing the stock balance expression. It uses PostgreSQL 17's [`ALTER COLUMN ... SET EXPRESSION AS`](https://www.postgresql.org/docs/17/sql-altertable.html) to preserve the existing generated column and its dependencies, replacing Drizzle's generated drop/recreate statements. Existing rows, raw measurements, IDs and relationships are retained; existing balances remain unchanged because `voided_at` starts null. Applying this expression change rewrites stored generated values and takes a table lock, so schedule it with production traffic in mind. Run `ANALYZE fabric_stock_items` after application to refresh statistics. Keep SQL and Drizzle metadata together. No runtime schema repair is provided.

Existing rows start at stock revision 1 without invented history. Existing receipt/completion baselines remain null; current stock is not proof of its historical post-submission state. Those forms remain readable but cannot perform stock-affecting corrections. Original timestamp-based completion requests are accepted only for exact successful replays; new writes require stock revisions. Older receipt paperwork references can still be corrected, and admins can adjust current stock separately.

## Endpoints

| Method | Path                                          | Purpose                                                                    |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| POST   | `/api/stock-items/:id/corrections`            | Correct current measurements, dimensions, location or consumption state    |
| POST   | `/api/stock-items/:id/void`                   | Void an erroneous independently registered stock record                    |
| POST   | `/api/stock-receipts/:id/corrections`         | Correct submitted paperwork and selected receipt lines                     |
| POST   | `/api/allocations/:id/completion-corrections` | Correct selected completed source outcomes and their retained pieces       |
| GET    | `/api/stock-receipts/:id/correction-context`  | Admin-only effective receipt, revisions and eligibility blockers           |
| GET    | `/api/allocations/:id/correction-context`     | Admin-only effective completion, snapshots, stock and eligibility blockers |
| GET    | `/api/stock-items/:id/history`                | Employee-readable stock history                                            |
| GET    | `/api/stock-receipts/:id/history`             | Employee-readable receipt history                                          |
| GET    | `/api/allocations/:id/history`                | Employee-readable allocation history                                       |
| GET    | `/api/work-orders/:id/history`                | Employee-readable work order history                                       |

The former stock PATCH and DELETE endpoints are removed. Stock creation remains `POST /api/stock-items`; it records an audit event atomically. History accepts `page` and `pageSize` (defaults 1 and 25, maximum size 100) and sorts newest first. A receipt's or allocation's history begins at its submission or confirmation, whose event has no `before`; draft saves and deletions are not recorded. Audit links do not cascade with operational records, so draft events recorded before this rule remain readable by ID.

Corrections return `{ eventId, recordId, revision, affectedAllocationIds, createdStockItemIds }`. Fetch the record afterward to display its current effective state. Replays return the saved result, even if subsequent activity has advanced the record. Keys are scoped to actor, operation, and record; identical normalized requests replay, changed payloads return 409, and failed transactions do not consume keys. Business reasons are trimmed, required, and limited to 1,000 characters. Actors and timestamps come from the server.

## Stock and historical eligibility

Every application stock mutation advances its integer revision. Cutting submissions use `expectedRevision` per stock outcome in place of `expectedUpdatedAt`. Voided stock preserves its identity, dimensions and links, has zero remaining balance, is excluded from ordinary lists and optimization, and is rejected by cutting validation. Use `isVoided=true` to list voided records. Ordinary consumed filtering is independent; the voided filter includes all voided records regardless of their previous consumed state.

Current-stock corrections keep fabric identity, remnant/roll type, and source links immutable. Supplying depth captures current catalog thickness; other changes preserve the previous thickness. Genuine physical shortages can be recorded even when they invalidate reservations. The current-stock response identifies active orders using that stock; list/detail replanning flags include cutting-width feasibility, consumption, voiding and insufficient length.

Voiding is for mistaken registration, not physical consumption. Reserved records and records with downstream production or descendants cannot be voided. Receipt-created stock and completion-created pieces must be voided through their originating workflow. Independently entered opening remnants can be voided if no downstream use prevents it. Voiding has no restore action; an erroneous void is handled as a separately audited new registration.

Historical corrections require the selected stock to match its last workflow-produced revision. Later changes, reservations, downstream production, and descendants outside that workflow block the correction. Context responses provide blockers with related stock/allocation IDs; submit rechecks eligibility under row locks. Release or reassign reservations first. An ineligible line/outcome does not prevent correcting another, independent line/outcome.

## Receiving

Receipt correction bodies contain `expectedRevision`, `reason`, optional `purchaseOrderNumber` (five digits), `stockVersions`, and `operations`. Omit the purchase-order number to keep the current one; the web client omits it when unchanged so lines on older receipts with other references can still be corrected. Each operation is `add` with complete line `data`, `update` with `lineId`, complete `data` and explicit `removeStockItemIds`, or `remove` with `lineId`. Correct each existing line at most once per request.

Changing fabric, width, initial length or original location affects every nonvoided roll on the line and requires all of them to be eligible. Quantity reductions void exactly the selected eligible rolls, even if other rolls have since changed. Quantity increases create new stock using the effective line attributes. Removed lines retain their original values and links with `voidedAt` set; exclude those lines from totals. Retained stock IDs and receipt submission metadata do not change. The entire request is atomic; active receipt totals remain limited to 100 lines and 1,000 rolls.

## Completed cutting

The original `completion`, completion key/hash, submitter and completion time remain unchanged. Reads and printed forms use `effectiveCompletion` when corrected, and expose `correctedAt`. Each selected source outcome and its existing nonvoided pieces form one eligibility unit. Other source outcomes remain unchanged.

Bodies contain `items: [{ outcome, retainedPieces, removeRetainedPieceIds }]` and current `stockVersions`. The outcome uses the existing cutting-result shape, with an empty `scraps` list. Retained pieces are individual physical records: include `id` to preserve an existing piece; omit it to add one. Identify pieces to void in `removeRetainedPieceIds`. Every existing piece must be explicitly kept or voided. There is no grouped quantity in a correction. Source outcome IDs cannot be substituted, and total effective pieces remain capped at 1,000.

The corrected result is reconstructed from the captured pre-completion measurements. The original calculation thickness and established tube diameter are preserved; a catalog edit cannot reinterpret the old cut. Existing source and surviving remnant IDs remain stable. Corrections do not reopen the allocation, restore its reservations, or change its cutting plan. Repeated corrections retain the same original baseline and track the latest applied stock revisions.

## Audit and transactions

Services pass the authenticated actor and the current transaction to an injected `AuditService`. The audit service owns attribution, snapshot validation and retry/conflict rules; its repository owns database queries. No audit write opens an independent transaction. Receipt/allocation services coordinate workflows; stock-items performs stock writes. Operations lock the workflow header, then affected stock in sorted ID order. Reservation checks run after stock locks without acquiring unrelated allocation-header locks.

Audit storage exposes insertion and reading only, with no HTTP mutation endpoints. Events preserve the actor's name at the time, reason, public before/after snapshots and related record IDs. Actor email, credentials, request hashes and private profile attributes are never included. Failed changes and successful idempotent replays produce no extra audit events.

## Verification

The normal API tests cover contracts, reconstructed measurements, snapshot curation and replay identity. PostgreSQL/Redis integration cases cover role enforcement, immutable history, quantities and IDs, legacy baselines, reservations, later activity, repeated cutting corrections, original retry preservation, concurrent writes and audit-failure rollback. They run in a throwaway database built by applying the migrations.

Frontend unit tests cover review-before-write, pinned forms, conflict preservation, history rendering and exact retries. Playwright covers desktop/tablet stock, receipt and completed cutting correction workflows and employee history access with intercepted API responses. These browser tests do not prove database behavior or real Microsoft sign-in.

Local rollout verification: all pre-existing columns and rows across 15 application tables matched their pre-migration fingerprints, including stored balances and relationship IDs. Legacy correction baselines remained null and no past audit events were invented. The migrated PostgreSQL/Redis suite passed 71 checks; its two solver-only suites were skipped by that command (the separate real solver integration run passed 17 checks). Updated fixtures account for retained voided stock and use a separate, unreferenced user for the authentication deletion test.

## Production attribution and worksheets

The [production workflow](production.md) records milestone completions and admin corrections independently from stock reconciliation. Each completion retains the credited employee ID, name and initials, completion time, entry time and authenticated account. Employee edits and worksheet start, submit, return, abandon and review operations have transactional audit events. Incomplete worksheet draft saves are not audit events. Milestone changes appear in order history; employee/worksheet audit records are stored, without separate history screens. Admin milestone corrections require a reason, expected order revision and UUID idempotency key. Worksheet operations use expected revisions and preserve original submissions; review additionally uses a UUID idempotency key.
