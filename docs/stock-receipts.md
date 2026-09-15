# Stock receipts

Stock receipts record fabric that has arrived. The purchase-order number is a reference to supplier paperwork; it is not the receipt identity. The initial design stores submitted receipts, with no draft or status workflow.

## Tables

`stock_receipts` stores a UUID, a purchase-order number (1–50 characters with no leading or trailing whitespace), the submitting user's ID, and a server-defaulted submission timestamp. Purchase-order numbers are indexed but not unique: separate deliveries can reference the same purchase order.

`stock_receipt_items` stores one line per group of identical rolls: stock receipt, fabric color, width, initial length per roll, quantity, and destination location. Dimensions are positive millimetre values stored as `numeric(12,3)`. Quantity is a positive integer defaulting to 1. Rolls with different dimensions or destination locations belong on separate lines.

Each resulting stock item has a nullable `stock_receipt_item_id` reference. A line with quantity 5 produces five individual stock items referencing that same line. Existing stock and remnants can have no stock-receipt line reference. The link is read-only in the stock API and cannot be supplied or changed through admin CRUD.

Line dimensions and location preserve the original receipt; later stock measurements or movements do not update them. Foreign keys restrict deletion of referenced users, colors, locations, orders, and lines. Submitted-receipt immutability and protection against deleting received stock will need to be enforced by the application workflow; this schema alone does not prevent edits or stock deletion.

## Submission boundary

The planned stock-receipt service will coordinate submission, while the stock-items service owns roll creation. One transaction must save the receipt and lines and create the requested number of unused, non-remnant rolls. Submission must prevent duplicate stock on retries or concurrent requests. A foreign key does not enforce that the stock count matches the line quantity.

The table definitions and stock response link are implemented in `0006_add_stock_receipts.sql`. Apply that migration before running the updated API or database integration tests. Stock-receipt endpoints and receiving logic are not implemented yet.
