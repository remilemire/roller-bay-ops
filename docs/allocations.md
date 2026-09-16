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

Migration `0008_add_allocations` creates the five allocation tables. No allocation endpoints or reservation-writing workflow have been added.
