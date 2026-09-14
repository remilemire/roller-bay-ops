# Roller Bay Ops product brief

## Purpose

Track individual fabric stock items for a window covering company, help employees allocate fabric to production orders, and update stock after cutting from the physical fabric that remains.

The existing system tracks theoretical consumption. Flaws, uneven edges, and other cutting waste cause its balances to drift. This app will start with the known length of a received roll, then use physical measurements to calculate its remaining length after cutting. Calculated roll length is an estimate grounded in measurements, not an exact direct measurement of the unwound fabric.

Tracking includes rolls, retained remnants, scrap, and fully consumed items. Records remain traceable after an item is no longer available.

## Confirmed terminology and stock structure

| Concept          | Meaning and known attributes                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color            | The company's unique identifier for a fabric type, beneath manufacturer and material in the catalog hierarchy. It is closer to a catalog code than a literal visual color. Use the business term in the app.                                       |
| Fabric catalog   | Organized as manufacturer → material → unique color, with fabric thickness recorded for each color. Pricing is deferred and is not required for the current functionality.                                                                         |
| Stock item       | An individual roll or piece associated with a color. The same color can exist in different widths; width is not a single fixed attribute of the color.                                                                                             |
| Received roll    | A physical roll listed on a purchase order with its color, width, and known length/yardage.                                                                                                                                                        |
| Tube diameter    | A property of the individual roll, recorded after its first cut for subsequent length calculations. It remains unchanged for the rest of that roll's life. Use the outside diameter of the tube where the fabric begins; see the measurement note. |
| Location         | Where the physical item is currently stored, including warehouse locations and shelves near the cutters.                                                                                                                                           |
| Production order | The work being allocated and cut, identified by an order number and accompanied by a paper form.                                                                                                                                                   |
| Allocation       | A reservation of estimated fabric usage from specific stock items for a production order.                                                                                                                                                          |

The unique identifier for a physical roll is separate from its color. Exact database table names and API shapes are not yet implemented.

### Catalog table proposal — not yet approved

If each material belongs to one manufacturer, represent the hierarchy with `manufacturers`, `fabric_materials`, and `fabric_colors`. A material references its manufacturer; a color references its material. The color code is unique across the catalog as currently described. Physical stock items reference the color and retain their own widths and dimensions.

The manufacturer is then obtained through the material relationship, so a separate manufacturer field on each color would duplicate that relationship and allow conflicting values. Keep thickness on the color as currently specified. Whether it is actually shared by every color of a material can be revisited with a concrete catalog example.

Confirm what the business means by material before approving this structure. A manufacturer-specific product line fits the stated hierarchy; a generic composition such as polyester may be shared across manufacturers and needs a different relationship. These table names and relationships remain recommendations, not implemented models.

## Operational workflow

### 1. Receive a shipment

An employee enters the purchase-order details when the shipment is received. Each listed roll supplies its color, width, and known length/yardage. Record each physical roll and where it is placed.

About 90% of incoming stock goes to the warehouse. Treat the warehouse as a likely default that the employee can change, not a mandatory destination. Recording purchase orders before delivery and handling partial deliveries are not yet specified.

### 2. Allocate an order

An employee reviews the order, determines suitable fabric and a cutting plan, and locates the stock. They usually look on the shelves near the cutters first; if suitable fabric is unavailable there, they retrieve a new roll from the warehouse. These are operating preferences, not restrictions on which location can supply an order.

The paper form attached to the order contains:

- Order number.
- Fabric/color and the width needed to identify suitable stock.
- Stock location.
- Amount required and estimated usage, kept as separate concepts until their exact meanings are confirmed.
- A possible roll identifier in the proposed company workflow. **Recommendation: make a stock-item identifier required for each allocated item**, because color, width, and location may match multiple rolls.

The app should reserve the planned usage for the order and assist with cutting plans. Whether the app generates the form, or employees fill it independently and enter the allocation, remains undecided. Reservations need to be recorded before production; the paper form alone cannot reserve stock in the system.

### 3. Cut and record the outcome

Cutters use the form to find the selected fabric. After cutting, they record:

- Rolls that were fully consumed.
- Scrap/remnant pieces large enough to keep.
- Measurements needed to establish the remaining length of each returned roll.
- Where each remaining roll or retained piece is placed.

Previously used stock is commonly kept on shelves near the cutters, including rolls that remain fairly large, but this is not universal. Record the actual destination of each item rather than deriving its location from whether it has been used.

All scrap must remain tracked, as previously specified. The exact method for recording discarded scrap, beyond the retained pieces listed on the form, is still to be agreed.

### 4. Enter the completed form

The completed form is entered into the app. For each remaining roll, use the recorded depth, that roll's tube diameter, and the thickness from its color's catalog entry to calculate remaining length. The tube diameter is recorded after the first cut and reused for later cuts; it is not needed to establish the known received length.

Record retained pieces, consumed items, and destination locations, then reconcile the order's reservations. Flat remnants and scraps need their own dimension-recording rules; the wound-roll formula does not apply to them.

The confirmed depth is the one-sided distance from the outside of the tube to the outside of the fabric: `(roll outside diameter − tube outside diameter) / 2`. See [roll measurement](roll-measurement.md) for the formula and units.

## Proposed inventory rules

These recommendations are distinct from the confirmed workflow above.

- Keep received length, later calculated balances, reserved usage, and projected remainders distinct. Record the basis and time of each balance.
- Allocation reserves stock without subtracting from its recorded physical balance. Where length is sufficient, unreserved length is the current recorded balance minus outstanding reservations; cut fit also depends on width and other production constraints.
- On completion, replace the roll's balance with the newly calculated remainder and settle that order's reservation. Do not subtract estimated consumption again.
- Give separately retained pieces their own identities linked to the source roll. Avoid counting their material on both the source and the resulting pieces.
- Fully consumed and disposed items stay in history but cannot be allocated. Scrap is not automatically available stock; its usability must be explicit.
- Preserve raw measurements, their units, the tube diameter and fabric thickness used, the resulting length, and who recorded the entry and when. Later catalog edits must not silently alter previous calculations.
- Record measurement/cutting time separately from form-entry time where needed. Until a completed form is entered, the system may have an old balance or location; represent outstanding production/return information explicitly rather than presenting it as freshly confirmed stock.
- If the revised balance cannot cover other reservations, flag the affected orders. Prevent simultaneous over-allocation and apply completion changes consistently. Re-entering the same form must not duplicate pieces or settle reservations twice.

## Proposed feature boundaries

| Feature                | Owns                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fabric catalog         | Manufacturers, materials, unique color identifiers, and thickness. Pricing is deferred.                                                           |
| Purchasing / receiving | Purchase-order details, receipts, and registration of incoming rolls through inventory operations.                                                |
| Inventory              | Physical identities, widths/dimensions, locations, roll-specific tube diameters, balance history, lifecycle, and source-piece relationships.      |
| Orders / allocation    | Production requirements, selected stock, reservations, and allocation details for the paper form.                                                 |
| Cutting / returns      | Cut planning and completed-form entry; coordinates measurements, calculated balances, resulting pieces, destinations, and reservation settlement. |

These are modules within the monorepo. Inventory owns stock balances; other features use its operations. Shared Zod contracts expose public inputs and outputs, while Drizzle tables stay within their owning backend feature.

## Recommended implementation sequence

The catalog and receiving workflow are now sufficiently described to begin a focused model design. Resolve the remaining field-level questions as they become relevant.

1. **Catalog and receiving:** Model the manufacturer/material/color catalog, individual stock items, purchase-order receipts, and locations. Build one receipt-entry and inventory-lookup workflow end to end, using the received length as its initial balance.
2. **Allocation and form:** Select individual items, record required amounts and planned usage, reserve stock, and establish how the paper form carries those selections to the cutters.
3. **Completed-form entry:** Using the confirmed one-sided depth convention, implement roll-length calculations, consumed rolls, retained pieces, destinations, and reservation reconciliation. Validate calculations with representative real rolls before relying on them for allocation.
4. **Cutting-plan assistance:** Add optimization once the actual order inputs and cutting constraints are known.

## Remaining decisions

- **Measurements:** Confirm the units and precision of radial depth, tube outside diameter, fabric thickness, width, and yardage. Define how retained pieces are measured.
- **Allocation:** Clarify the distinction between amount required and estimated usage; confirm item identification and when allocation is entered relative to form preparation.
- **Forms and orders:** Decide whether forms are generated by the app, who enters completed forms, how orders enter the system, and how partial completion, substitutions, or corrections are handled.
- **Catalog and receiving:** Clarify whether material denotes a manufacturer-specific product line or a generic composition, partial-receipt handling if needed, and how existing stock will be entered at rollout. Pricing can be revisited later and does not block the initial models.
- **Availability:** Define which scraps are reusable and any batch, shade, defect, or orientation constraints that affect selection and cutting.

The repository currently contains a technical notes example only. These fabric workflows are documented requirements and proposals, not implemented functionality.
