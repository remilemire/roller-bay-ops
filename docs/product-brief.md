# Roller Bay Ops product brief

## Purpose

Roller Bay Ops tracks individual fabric rolls and remnants for a window covering company. Employees receive stock, locate fabric, reserve it for production orders, print cutting plans, and record what remains after cutting.

The stock balance starts with the known received length. After cutting, physical measurements establish a roll's remaining length instead of repeatedly subtracting theoretical consumption. The calculated length is an estimate: flaws, material compression, winding, and measurement accuracy still matter.

## Domain terminology

| Concept        | Meaning                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Fabric catalog | Manufacturer → material → color. Materials belong to manufacturers. Each color has a unique company code and fabric thickness.            |
| Color          | The company's fabric identifier, not simply a visual color.                                                                               |
| Stock item     | An individually identified roll or remnant with its own width, location, balance, and lifecycle. Multiple items can share the same color. |
| Stock receipt  | A record of fabric that has arrived. The purchase-order number references supplier paperwork.                                             |
| Location       | A storage level within a section and zone, including warehouse storage and shelves near cutters.                                          |
| Allocation     | A production order's requirements, cutting plan, selected stock items, and reservations.                                                  |
| Remnant        | A retained flat piece with explicit width and length, linked to its source stock when created through cutting completion.                 |

See [fabric catalog](fabric-catalog.md), [locations](locations.md), and [stock items](stock-items.md) for the contracts and access rules.

## Operational workflow

### 1. Receive a shipment

An employee records the purchase-order reference and receipt lines: color, width, known length per roll, quantity, and destination. A shared draft can remain incomplete. Submitting the receipt creates an individually identified stock item for each roll, using the received length as its initial balance. Drafts create no stock.

The destination is recorded explicitly; warehouse storage and shelves near cutters are both valid. See [stock receipts](stock-receipts.md).

### 2. Allocate an order

An employee enters the order number, finished blind dimensions, colors, and quantities. They select individual stock items and prepare a cutting plan manually or request an optimization preview. The backend applies configured drop allowances, edge trimming, and reusable-remnant thresholds.

Saving a draft does not reserve fabric. Confirmation validates the complete plan against current stock and creates reservations atomically. Reservations reduce available length without changing the physical balance. The allocation detail can be printed for the cutters and identifies the selected stock and cuts. Optimization is a bounded search and does not establish global optimality.

See [allocations](allocations.md) for planning constraints, reservations, and lifecycle rules.

### 3. Cut and record the outcome

Cutters use the plan to locate the selected fabric and record consumed items, returned rolls, returned remnants, retained scraps, and destination locations.

A returned roll uses radial depth, its tube outside diameter, and the color's thickness to calculate remaining length. Radial depth is `(roll outside diameter − tube outside diameter) / 2`. The tube diameter is recorded on first use and reused for subsequent cutting completions. The thickness used is saved with the measurement so later catalog edits do not silently change the balance.

Flat remnants use explicit width and length; the wound-roll formula does not apply to them. A fully consumed roll is recorded as consumed rather than represented by a missing measurement. See [roll measurement](roll-measurement.md).

### 4. Complete the allocation

An employee submits the recorded outcomes. Completion updates physical stock, creates individually identified retained pieces linked to their sources, and settles the allocation's reservations in one transaction. It does not subtract the estimated cut length again or automatically turn predicted offcuts into stock. If the new balance cannot support another active allocation, that order is flagged for replanning.

Completion retries preserve the original submission key and payload to avoid duplicate stock changes. Admin corrections require a reason, revision checks, and review; history preserves the original submission. See [corrections and audit](corrections-and-audit.md).

## Measurements and access

The API and database use millimetres. The UI defaults to inches for widths and horizontal trimming, yards for lengths and drop allowances, and millimetres for thickness and radial depth. Each user can choose units per measurement field in Settings. Tube outside diameter always uses millimetres and must be a positive multiple of 5 mm. Blank measurements remain missing values, not zero.

Microsoft work-account sign-in and Redis sessions protect the workspace. All active employees can use receiving and allocation workflows. Admins and the owner maintain catalog, locations, and stock corrections. See [authentication](authentication.md) and the [frontend workspace](frontend.md).

## Current scope and limits

- Receiving records delivered fabric; there is no pre-delivery purchase-order or partial-delivery management workflow.
- Completion records one completed cutting form per allocation. Partial completion, production priority, and substituting different stock at completion are not supported.
- Retained pieces become stock. Predicted waste is reported by the cutting plan; there is no separate discarded-scrap ledger.
- Pricing, batch/shade matching, and defect tracking are outside the current model.
- The frontend has no user directory or user-management screen; activation, roles, and ownership are managed through the documented backend endpoints.
- Roll-length estimates need validation against representative physical rolls before setting an operational tolerance.

The feature documents describe current contracts and constraints. Repository development conventions are maintained in [AGENTS.md](../AGENTS.md).
