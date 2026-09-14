# Roller Bay Ops product brief

## Purpose

Help a window covering company locate, allocate, and accurately track its fabric stock at the level of individual physical items.

The current system tracks theoretical stock. Cutting introduces unplanned losses from flaws, uneven edges, and other waste, so calculated balances drift away from what is actually on the shelf. Roller Bay Ops will update stock from measurements of the fabric returned after cutting.

Tracking covers rolls, remnants, scrap pieces, and fully consumed stock. An item must remain traceable after it stops being available for production.

## Required workflows

- **Incoming stock:** Enter purchase orders to record incoming fabric and establish its stock records.
- **Inventory:** Identify each physical stock item, its fabric type, dimensions, measured remaining quantity, lifecycle state, and current location where applicable. Preserve records of fully consumed items and scrap.
- **Allocation:** Before production, help an employee find suitable fabric, plan the cuts, and associate specific stock items and estimated usage with an order. Reserve the planned quantity for that order.
- **Cutting completion:** Re-measure every stock item returning to a shelf and update its recorded balance to the actual remainder. Record remnants, scrap, and fully consumed items as well. Reconcile the completed order's reservations against the actual outcome.

Cut planning assistance is part of the intended product. The first implementation can record an employee's plan and estimate; automated optimization can follow once the cutting constraints are understood.

## Vocabulary and quantity rules

The following distinctions are proposed design rules to validate before implementing the domain models.

| Concept             | Meaning                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Fabric definition   | The material or variant shared by multiple stock items; exact identifying attributes remain to be agreed.             |
| Stock item          | One individually identifiable roll, remnant, or scrap piece, with a record that survives its consumption or disposal. |
| Location            | The shelf or other place where a stock item can be found.                                                             |
| Purchase order      | A record of fabric being purchased; it is distinct from a production order.                                           |
| Production order    | Work that requires fabric to be selected and cut. How these orders enter the app is undecided.                        |
| Allocation          | An order's reservation of estimated consumption from specific stock items.                                            |
| Measured stock      | The last observed quantity of a physical stock item, with the measurement time.                                       |
| Projected remainder | What should remain after planned cuts; it is an estimate, not a new measurement.                                      |

- Keep ordered quantities separate from received stock. Proposed receiving behavior: creating a purchase order records expected stock; confirming receipt creates the individual allocatable items. Confirm this distinction with the business.
- Allocating fabric reserves it without reducing its measured balance. Where a single length measure is sufficient, unreserved quantity is measured quantity minus outstanding reservations.
- An unreserved quantity does not by itself prove an order can be cut. Width, defects, orientation, and cut layout may affect suitability; the applicable constraints still need to be established.
- Preserve the relationship between a source item and pieces produced from it. Proposed behavior: separately tracked remnants and scraps have their own identities linked to their source; quantities must not be counted on both the source and its resulting pieces.
- Track lifecycle and usability separately from quantity. Fully consumed or disposed items remain in history but are unavailable for allocation. Record scrap even when it cannot be reused; agree on the rules for classifying any reusable pieces before including them in availability.
- Completing cutting replaces the old balance with the measured remainder and settles that order's reservation. Do not subtract the estimated usage again.
- If a new measurement leaves insufficient stock for other reservations, flag those orders for review. Do not silently discard reservations or continue presenting them as covered.
- Keep a history of receipts, measurements, moves, and reservation changes, including who recorded them and when. During cutting, the previous measurement must not imply that the item is still sitting on its shelf.
- Availability checks and reservation writes must be coordinated so two employees cannot reserve the same available stock simultaneously. Measurement updates and reservation settlement also need a consistent, atomic outcome.

**Example, assuming length-based stock:** A roll measures 100 m and an order reserves 30 m. The projected remainder is 70 m. After cutting, the returned roll measures 66 m. Record 66 m and settle the 30 m reservation; do not subtract 30 m from 66 m. The 4 m difference is a discrepancy to record, not automatically proof of a particular cause of waste.

## Proposed feature boundaries

These are application modules within the existing monorepo, not separate services.

| Feature                | Owns                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fabric catalog         | Fabric definitions and the attributes used to find compatible stock.                                                     |
| Purchasing / receiving | Purchase orders, incoming quantities, and receipt records. Uses inventory operations to register received items.         |
| Inventory              | Physical stock identities, dimensions, locations, measured balances, lifecycle, source-piece relationships, and history. |
| Orders / allocation    | Production requirements, stock selection, reservations, and estimated usage.                                             |
| Cutting                | Cut plans and completion workflow. Coordinates inventory measurements and reservation settlement.                        |

Inventory remains the authority for measured balances. Other features use its operations instead of independently changing those balances. Shared Zod contracts describe public inputs and outputs; database tables stay with their owning backend feature.

## Recommended starting point

Start by defining the physical stock item's identity, measurements, and lifecycle, including how cutting produces remnants and scrap and how consumption is recorded. Then build **receive and locate a stock item** as the first vertical slice.

1. Settle the minimum rules: what counts as an item, how it is measured, how splitting and full consumption affect its record, when received stock becomes available, and how a shelf is identified. Walk through one receipt, one cut with remnants and scrap, and one fully consumed roll before choosing tables.
2. Implement just enough fabric, purchase-order receipt, stock-item, and location models for one receipt. Define that use case's Zod contracts and API alongside its business rules.
3. Build the receiving form and inventory lookup. Verify that a received item has a unique identity, a measured quantity, a purchase-order origin, and a location that can be found later.
4. Add manual allocation against production orders, including releasing or changing reservations and preventing over-allocation.
5. Add cutting completion, measured returns, source-linked remnants and scrap, full consumption, and reconciliation of remaining reservations. This closes the accuracy and traceability loop that motivates the product.
6. Add cutting-plan assistance and optimization using confirmed production constraints and representative real orders.

This sequence gives each step a working UI → API → database path. It avoids designing the entire database first or building an optimizer on top of unreliable stock records. The first slice establishes inventory; allocation and measured returns are still necessary to deliver the core business outcome.

## Decisions still needed

- **Physical stock and measurement:** Which dimensions, units, and measurement precision are needed for rolls, remnants, and scrap? Are irregular pieces retained? Which scraps can be reused, and how is disposal recorded? All items, including consumed rolls and scrap, must remain tracked; the recording detail is still to be agreed.
- **Fabric compatibility:** Which attributes identify suitable fabric, and do batch, shade, defects, or direction impose selection or cutting restrictions?
- **Receiving and initial stock:** Are purchase orders recorded before delivery? Can deliveries be partial? How will the existing shelves be measured and entered when the app is introduced?
- **Orders and production:** Where do production orders and required cut dimensions come from? Can several orders reserve one item, and can orders be cut or completed in stages?
- **Physical workflow:** How are items identified and tagged today, who measures returned fabric, and how is a move from shelf to cutting and back recorded?

These questions are unresolved requirements, not implemented behavior. The notes example in the repository demonstrates technical wiring only.
