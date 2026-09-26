# Frontend consistency audit

## Scope

Reviewed shared controls, error presentation and issue placement, feature-screen layouts, navigation, filter order, action order and entry defaults. The source pass covered authentication, dashboard, catalog, locations, stock, receipts, work orders, allocations, production, employees, users/settings, history and correction forms.

## Changes

| Finding                                                                                                         | Resolution                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Buttons were 42px, inputs 43px, and tablet sizing treated control types differently                             | Shared 44px standard control height and 10px radius; 36px compact controls become 44px on tablet            |
| Repeated exclusive filter markup omitted accessible selection on several lists                                  | Shared `SegmentedControl` across stock, receipts, allocations, work-order views/statuses and station queues |
| Work-order views began with List although Week was the default                                                  | List, Week, Month order; List, the default, comes first                                                     |
| Allocation filter said “All orders”                                                                             | “All allocations” matches the records being filtered                                                        |
| Settings navigation indicated selection only visually                                                           | Same `aria-current` convention as the other navigation links                                                |
| Inline groups could compress controls or overflow; fieldsets repeated resets without a shrinkable minimum width | Wrapping actions and shared `form-fieldset` styling                                                         |
| Employee and milestone correction dialogs differed from the established form spacing/footer                     | 16px field spacing, standard checkbox labels, secondary action before primary save                          |
| Lookup load failures appeared in muted hint styling with a plain retry button                                   | Danger-colored feedback, a shared outline retry button and an accessible control description                |
| ErrorNotice retries could submit an enclosing form                                                              | Explicit non-submit button with consistent spacing                                                          |
| Several detail/correction/production load errors had no recovery action                                         | Explicit refetch actions                                                                                    |
| Wrong-fabric and unavailable-stock checks threw plain exceptions that became generic error copy                 | Expected validation is rendered beside the additional-stock picker and clears with a new selection          |
| Unscheduling hid ship-date issues even though its date field was absent                                         | Only suppress summary details when the date field is rendered                                               |
| Plan validation exposed raw dotted paths and used different list styling                                        | Shared readable issue labels, deduplication/detail limit and notice-list spacing                            |
| Cutting-review abandonment errors appeared among the action buttons                                             | Error placed above the action row                                                                           |
| Employee validation only appeared in a summary; searches could produce a blank table                            | Inline field errors, URL-backed search and a proper empty-search message                                    |

Work-order headers also put destructive/secondary actions before scheduling or allocation, with the primary action rightmost, matching allocation headers.

## Order and defaults retained

- Navigation keeps inventory, orders, production, reference data and administration grouped in the existing sequence; Settings remains at the bottom.
- Stock opens on On hand, receipts on Submitted, allocations on Active, work orders on List (then the view last shown), the order list on Open, and stations on Work queue. Completed/cancelled/voided records remain explicit filters.
- Receipt entry runs from supplier reference to fabric, dimensions, quantity and destination. Allocation entry runs from order and blinds to the cutting plan and confirmation. Completion starts with each stock item's outcome, then the measurements and destinations relevant to that outcome.
- Blank measurements/quantities remain blank. Completion outcomes and employee attribution require deliberate selection. Measurement units retain the account preferences and established defaults.
- Existing destructive-action confirmations, revision checks, uncertain-request recovery and dirty-form protection remain in place.

## Abstractions and intentional differences

The repeated exclusive selectors and fieldset/form spacing now share implementations. Tables, calendar boards, catalog/location trees and correction reviews already use shared primitives but have different data and interaction contracts; combining them into one configurable screen would obscure those contracts. The existing correction submission/review abstraction remains the appropriate shared boundary.

Station measurement fields retain their 48px height for repeated entry. Compact desktop table actions, calendar cells, record rows, full-size form controls and sidebar navigation retain role-appropriate geometry. Theme palettes continue to use semantic tokens, including a distinct warning color for planning feedback and danger color for rejected operations.

## Verification

Verified with Node 24.19.0: shared-contract build, web typecheck and lint, 166 unit tests across 38 files, feature-boundary checks, touched-file formatting and `git diff --check` passed. The production-build browser suite passed 163 tests; its existing touch-only test is intentionally skipped in the desktop project (one skip). Turbopack could not bind its internal port in this environment, so a temporary Playwright configuration used `next build --webpack` with the same test directory, fixtures, projects and isolated port-3100 production server. After the final work-order header adjustment, all 34 focused browser checks for consistency, scheduling and cancellation passed, along with the 15 work-order unit tests and focused lint. The repository's default build and Playwright configuration were not changed.

`frontend-consistency.spec.ts` adds desktop and tablet browser checks for:

- Long API error messages and details on 13 list/detail/management/station routes in both light and dark themes, checking visibility, wrapping and semantic error color.
- Matching standard input/button heights, opening-stock control geometry, default filters and view order.
- Inline employee validation, per-field error clearing, retained input and empty searches.
- Lookup failure/retry and wrong-fabric selection feedback.
- Visible ship-date validation and unscheduling errors when the date field is absent.

The existing browser suite covers authentication failures, permissions, all palettes, navigation, catalog and location editing, receipt conflicts/retries, allocation planning, completion, correction and production workflows, and spacing. Four stale browser tests were updated to the existing station dialogs and shared search label; the error-layout test now exercises the real completion dialog instead of injecting an artificial action link.

The audit uses intercepted API fixtures and Chromium desktop/tablet emulation. It does not establish live backend/solver/Microsoft behavior, physical-device behavior, or every possible backend message and state combination. Screenshots were inspected for representative desktop forms and tablet light/dark errors; assertions cover the broader route matrix.
