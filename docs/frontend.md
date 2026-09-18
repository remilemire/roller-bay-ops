# Frontend workspace

The Next.js App Router app in `apps/web` provides the operational workspace. It uses the existing Nest API and shared Zod contracts; it does not store business records in Next.js or connect directly to the database.

## Organization

| Directory under `apps/web/src` | Responsibility                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `app/`                         | Thin route entries, layouts, providers, loading and error boundaries.                                                 |
| `features/`                    | Domain screens, API operations, query keys, form conversion, and tests.                                               |
| `components/ui/`               | Locally owned shadcn-style primitives using Radix, CVA, and Tailwind, adapted to the workspace theme.                 |
| `components/layout/`           | Dashboard shell, navigation, account menu, and theme control.                                                         |
| `lib/`                         | Credentialed HTTP client, error descriptions, query defaults, formatting, measurement conversion, and pending keys.   |
| `styles/`                      | Semantic light/dark tokens in `theme.css`; shared layout, components, responsive styles, and motion in `globals.css`. |

The `(auth)` and `(dashboard)` route groups select layouts without changing URLs. Layouts remain server components; authenticated workflows mount inside a client authentication boundary. Shared components accept data and callbacks without importing domain features. Features can consume another feature's exported API queries or lookup functions.

`components.json` configures the local shadcn component directory and aliases. Shared public schemas remain in `packages/shared`; UI components remain in the web app. See [shadcn's Next.js setup](https://ui.shadcn.com/docs/installation/next).

## Implemented workflows

| Route                                                           | Behavior                                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/login`                                                        | Microsoft sign-in and authentication errors.                                                                                                                                                     |
| `/`                                                             | Stock and allocation counts, shared draft counts, recent arrivals, and workflow links from existing list APIs.                                                                                   |
| `/fabric-catalog`                                               | Manufacturer → material → color tree; manufacturer search and admin create/edit/delete dialogs.                                                                                                  |
| `/locations`                                                    | Levels, sections, and zones; searchable lists and admin create/edit/delete dialogs.                                                                                                              |
| `/stock-items`, `/stock-items/:id`                              | Stock search, lifecycle filters, detail, source links, and admin opening-stock/correction forms.                                                                                                 |
| `/stock-receipts`, `/stock-receipts/new`, `/stock-receipts/:id` | Shared draft entry, revision-aware saves/deletion, confirmation, and resulting stock links.                                                                                                      |
| `/allocations`, `/allocations/new`, `/allocations/:id`          | Requirements, cutting rules, manual cuts/assignments, generated/validated plan previews, shared drafts, confirmation, active-plan replacement, cancellation, printing, and cutting-result entry. |
| `/users`                                                        | Admin/owner user directory: search by name or email, role changes, deactivation and reactivation, and owner-only ownership transfer, each behind a confirmation dialog.                          |
| `/settings`                                                     | Current account, per-field measurement units, and appearance preference.                                                                                                                         |

Admins and the owner can modify catalog, locations, and stock records. All active employees can manage receipt and allocation workflows. The backend authorizes every request. The Users link and directory are shown only to admins and the owner; other roles see a notice and the list is not requested. The directory offers no actions on the owner or on the signed-in user's own row, so ownership changes only through a transfer and nobody locks themselves out from this screen. A transfer refreshes the session so the previous owner's role updates immediately. Dashboard figures use existing paginated totals.

## Authentication and API requests

`NEXT_PUBLIC_API_URL` is the public API base URL, including `/api`, and is embedded at build time. It defaults to `http://localhost:3001/api`. The browser navigates to `/auth/login`; OAuth, domain restrictions, HttpOnly cookies, and Redis sessions stay in the backend. `/auth/me` supplies the current user. The web app never reads access tokens or session cookies.

Every API call uses `credentials: 'include'`. Mutation requests send JSON and, where required, `Idempotency-Key`. Response schemas validate successful API data. A 401 from a protected request ends the client session and clears private queries, mutation results, and pending submission payloads. The session query handles its own signed-out response without cancelling itself. A deactivated account receives an access error. An ordinary 403 on a feature operation remains a permission error. Error bodies are parsed with the shared [error envelope](errors.md); `ApiError` carries `status`, `message`, optional `retryAfterMs`, and `issues`. `ErrorNotice` shows the API's curated message and lists field issues with readable labels; text from any other exception is replaced by generic copy.

TanStack Query owns server data. Queries stay fresh for 30 seconds by default; session data uses 15 seconds and refreshes on window focus. Network, 429, and server failures receive at most two query retries with backoff; `Retry-After` is respected when supplied. Mutations never retry automatically. Successful writes invalidate affected feature queries. There are no optimistic stock, reservation, or submission updates.

Configure the backend's `WEB_ORIGIN` to the actual browser origin. Normal development uses `http://localhost:3000`; browser tests use an isolated server at port 3100 with intercepted API responses. If testing manually on another port, update local backend configuration accordingly. Production requires the same-site HTTPS setup described in [authentication](authentication.md).

## Forms, measurements, and drafts

Search, filters, tabs, and pagination live in URL parameters. React Hook Form owns unsaved input. Form strings convert to shared Zod request schemas near the feature boundary; unfinished dimensions, quantities, and selections remain null. Drafts use the existing typed draft APIs and keep their IDs on submission.

- Each signed-in user chooses a unit per measurement field in Settings: inches, feet, yards, millimetres, centimetres, or metres. The fields are roll width, roll length, blind width, finished drop, drop allowance, cut length, edge trim, minimum reusable width and length, fabric thickness, radial depth, and tube outer diameter. The choice is stored on the user record (`measurementUnits` on `/auth/me`, changed through `PATCH /users/me/measurement-units`) and applies to inputs and displays everywhere.
- Defaults are **inches** for widths, drops, allowances, trimming, and minimum reusable sizes, **yards** for roll length, and **millimetres** for thickness, radial depth, and tube outer diameter. Settings groups the fields into stock dimensions, blind dimensions, cutting and remnants, and roll measurements, and can reset every field to its default.
- All API dimensions remain millimetres with the existing precision constraints. Editable values in any unit preserve a round trip to 0.001 mm; display values may be abbreviated. An open editor keeps the units it started with, so a background session refresh cannot relabel or reinterpret unsaved input.
- Stock creation/corrections distinguish unused rolls, measured used rolls, and remnants. Explicit remaining length is reserved for remnants.

Saving a draft is explicit. An editor retains the record and revision it opened with, even if background queries see a newer revision or a confirmed record. A temporary background failure displays an error without unmounting the draft. Conflicts preserve input; reloading saved draft contents requires an explicit discard confirmation. Active-plan edits and cutting results likewise retain their original allocation/stock revisions. Confirmation requires a saved, complete draft, and the backend revalidates current stock atomically.

New draft creation and cutting completion keep their request key and exact payload in user/workflow-scoped session storage until success. Retrying an uncertain response uses the same key and payload; changed input cannot silently become a duplicate request. The editor can restore the earlier pending payload. This is submission retry support, not autosave or offline editing. Receipt/allocation draft submission retries use the saved revision as defined by their API.

Unsaved long forms warn before document unload and ordinary in-app link navigation. Browser history navigation is not intercepted; save a draft before leaving. Background refetches do not replace dirty values. Completion forms are not drafts, and active allocations cannot be reopened as drafts.

Optimization calls the existing backend optimizer. It is a preview until confirmation and makes no global-optimality claim. Returned plans can be edited and validated before saving. The browser supports cancelling an optimization request. Completion records consumed stock, measured returned rolls, returned remnants, and retained scraps, then shows any affected allocations flagged for replanning.

## Theme and responsiveness

[next-themes](https://github.com/pacocoursey/next-themes) applies light, dark, or system appearance before paint and stores the preference locally. Theme-dependent controls wait for hydration. The Appearance card in Settings offers five color palettes: Sage, Slate (the default), Ocean, Sand, and Plum. Each preview card uses the actual palette tokens and follows the current light/dark mode. Palette selection is independent of light/dark/system mode: `roller-bay-color-theme` stores the palette and the existing `roller-bay-theme` key stores the mode in local storage. A head script applies the saved palette before paint; invalid or missing values fall back to Slate. Existing saved selections are preserved. Palette changes sync across tabs and remain usable for the current page if storage is blocked. Appearance preferences are stored only in the browser; measurement units are stored on the user record. Semantic surface, foreground, border, accent, shadow, and glass tokens are shared across features.

Color, surface, border, and shadow transitions use a short coordinated duration. Reduced-motion preferences disable them; layout is not animated. Glass surfaces fall back to solid surfaces when backdrop filtering is unavailable. The desktop sidebar becomes a touch-accessible navigation dialog on tablet and smaller displays. Forms reflow and tables can scroll horizontally without forcing the page wider. Dialogs use Radix focus handling and Escape dismissal.

## Verification

From the repository root, build shared contracts before running the web workspace alone:

```sh
npm run build --workspace=@roller-bay/shared
npm run typecheck --workspace=@roller-bay/web
npm run lint --workspace=@roller-bay/web
npm run test --workspace=@roller-bay/web
npm run build --workspace=@roller-bay/web
npx playwright install chromium
npm run test:e2e --workspace=@roller-bay/web
```

Vitest and React Testing Library cover API errors, error envelope parsing, issue labelling, the error notice, cache clearing, query retries, unit conversions and per-field unit preferences, nullable drafts, assignment validation, submission-key reuse, retained completion results, and preservation of dirty forms/revisions during background updates. Playwright covers desktop and tablet navigation, theme persistence/transitions/reduced motion, session expiry/logout/deactivation, permissions, catalog editing, receipt conflicts and submission retries, allocation optimization/draft confirmation, and completion measurements.

Browser tests intercept API requests using fixtures shaped by the real shared contracts. They verify the browser's behavior and outgoing requests without changing a database. They do not replace the backend's PostgreSQL/Redis/solver integration suites or live Microsoft tenant testing. Trace files, screenshots, and browser reports are ignored by Git.

Allocation forms collect finished blind sizes and quantities. Edge trimming, reusable-remnant thresholds, and extra drop allowance are server configuration, not editable form fields. Saved allocation details still display their recorded rules and allowances in the user’s preferred units.

## Corrections and history

Stock, submitted receipts and completed allocations expose admin correction actions and employee-readable history. Forms pin their opening revisions and units, require a reason and review, preserve input on conflicts, and retain the exact payload/key for uncertain retries. Receipt and completion contexts explain blocked records and link to related orders. Voided stock has a separate list filter; corrected printed allocation details identify their correction date. See [corrections and audit](corrections-and-audit.md) for operational rules and schema rollout.
