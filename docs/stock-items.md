# Stock items API

`StockItemsModule` owns physical rolls and retained remnants. The database table is `fabric_stock_items`; each item's UUID is also its external identifier. The table was introduced in `0005_add_stock_items.sql`. Apply `0006_add_stock_receipts.sql` for the [stock-receipt line reference](stock-receipts.md) before running the updated API.

## Endpoints and permissions

| Method | Path                               | Result                                        |
| ------ | ---------------------------------- | --------------------------------------------- |
| GET    | `/api/stock-items`                 | 200, paginated stock list                     |
| GET    | `/api/stock-items/:id`             | 200, one stock item, including consumed items |
| POST   | `/api/stock-items`                 | 201, created stock item                       |
| POST   | `/api/stock-items/:id/corrections` | 200, audited correction result                |
| POST   | `/api/stock-items/:id/void`        | 200, audited void result                      |
| GET    | `/api/stock-items/:id/history`     | 200, paginated history                        |

All reads require an active signed-in user. Creation, correction, and voiding require admin or owner permissions and the configured Origin header. Global rate limits apply. These are administrative maintenance endpoints. [Stock-receipt submission](stock-receipts.md) provides the employee receiving workflow; [allocation completion](allocations.md) records cutting results. See [corrections and audit](corrections-and-audit.md) for finalized corrections and rollout requirements.

## Create and update

Creation requires `fabricColorId`, `widthMm`, `initialLengthMm`, and `locationId`. `isRemnant` and `isUsed` default to false. Optional `sourceStockItemId`, `consumedAt`, and measurement inputs default to null. A retained remnant requires `isRemnant: true` and `explicitLengthMm`. Its optional source must exist and have the same fabric color; source records may already be consumed.

```json
{
  "fabricColorId": "11111111-1111-4111-8111-111111111111",
  "widthMm": 2000,
  "initialLengthMm": 50000,
  "locationId": "22222222-2222-4222-8222-222222222222"
}
```

The correction endpoint accepts `changes` containing a nonempty subset of `isUsed`, `widthMm`, `initialLengthMm`, `explicitLengthMm`, `radialDepthMm`, `tubeOuterDiameterMm`, `locationId`, and `consumedAt`. Color, roll/remnant type, and source linkage are fixed after creation. Unknown fields are rejected. Validation uses the resulting complete record, so partial updates cannot create inconsistent measurement inputs. Concurrent updates lock the affected row before reading and changing it.

Dimensions are JSON numbers in millimetres with at most three decimal places, up to 999,999,999.999. Width and initial length must be positive. Tube diameter must be positive. Explicit length and radial depth may be zero.

- Remnants require explicit length and cannot have roll depth or a tube diameter, regardless of `isUsed`. A new remnant starts unused independently of its source.
- Unused rolls (`isUsed: false`) cannot have a tube diameter or depth. Used rolls (`isUsed: true`) require a tube diameter. Submit `isUsed` and the tube diameter together when first recording use. No first-use date is required or stored.
- Every item requires a location. Consumed items retain their last assigned location.
- Rolls cannot have explicit length. Before measurement, remaining length equals initial length.
- A measured roll must be marked used and requires radial depth and tube diameter. The API copies the current catalog thickness into `measurementThicknessMm`; PostgreSQL calculates remaining length.
- Updating depth to a non-null value captures current catalog thickness, even if the submitted depth equals the previous value. Other updates preserve the snapshot. A later measurement can reuse the stored tube diameter.
- Clearing depth clears the thickness snapshot and restores the initial-length basis. It preserves `isUsed` and the tube diameter. This is an admin correction, not a cutting workflow.
- Setting `consumedAt` to an ISO UTC timestamp makes remaining length zero. Clearing it restores the balance derived from the stored inputs.

`remainingLengthMm`, `measurementThicknessMm`, `stockReceiptItemId`, IDs, and creation/update timestamps are server-controlled. The nullable stock-receipt item reference identifies the receipt line that created a roll; admin CRUD cannot set or change it. Invalid measurements, including calculated lengths outside the supported range, return 400 without partially updating the record.

Voiding preserves the record, its history, and relationships while excluding it from availability. Reserved stock and stock with downstream use cannot be voided. Receipt- and completion-created stock must be voided through the originating workflow. The old PATCH and DELETE routes are removed.

## Queries and responses

Lists accept `fabricColorId`, `locationId`, `sectionId`, `zoneId`, `isRemnant`, `isConsumed`, `isVoided`, `minWidthMm`, `minRemainingLengthMm`, `search`, `page`, and `pageSize`. Filters combine with AND. Boolean query values must be the strings `true` or `false`. `isConsumed` defaults to false; use true to list consumed records. Search matches a literal, case-insensitive substring of the fabric color code, the material name, or the stock item ID.

Pagination defaults to page 1 and 25 items, with at most 100 items per page. Results sort by creation time, then UUID. Page items and totals use the same database snapshot. The response is `{ items, total, page, pageSize }`.

Each item includes its dimensions, measurement inputs, generated remaining length, source reference, usage flag, consumed timestamp, and creation/update timestamps. It also includes color code, material and manufacturer IDs/names, and location/section/zone labels and IDs. Location hierarchy fields are always present. Decimals are returned as JSON numbers and timestamps as ISO strings.

Missing items or referenced records return 404. Unauthenticated requests return 401, inactive or unauthorized users return 403, referenced deletions return 409, and storage failures return a generic 503.

## Current scope and verification

Existing stock can be registered through the admin create endpoint without knowing its first-use date. Register an existing used roll with `isUsed: true`, its tube diameter, current radial depth, and location. For opening inventory, `initialLengthMm` is the length at registration, which can be the calculated current length; it need not represent an unknown original purchase length. The API still requires that value explicitly. Register existing remnants with their current explicit length and location; their source reference can remain null if unknown.

All stock writes now record audit history and advance an integer revision. Current-stock corrections require the expected revision, a reason and an idempotency key. They report active orders requiring replanning. Independently registering a remnant does not subtract its dimensions from its source; cutting completion coordinates those changes. See [correction behavior](corrections-and-audit.md).

`stock-items.integration.test.ts` runs in its own throwaway database ([testing](testing.md)). It tests role and Origin enforcement, generated balances, remnant validation, snapshot preservation/refresh, rollback on invalid updates, concurrent corrections, consumption/restoration, filters, pagination, hierarchy responses, and deletion protection.
