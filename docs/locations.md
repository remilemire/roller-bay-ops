# Locations API

Storage addresses follow zone → section → level. `location_zones` stores zone names, `location_sections` stores labels within zones, and `locations` stores level labels within sections. A Contracts section uses one ordinary named level. Labels can contain letters or numbers; `sortOrder` controls physical ordering independently of those labels.

`LocationsModule` groups `LocationZonesModule`, `LocationSectionsModule`, and `LocationLevelsModule`. Each owns its controller, service, repository, and table definition under `zones/`, `sections/`, or `levels/`. Levels use the `locations` database table and `/api/locations` endpoints.

## Endpoints

| Resource           | Base path                 | Additional list filters |
| ------------------ | ------------------------- | ----------------------- |
| Zones              | `/api/locations/zones`    | None                    |
| Sections           | `/api/locations/sections` | `zoneId`                |
| Locations (levels) | `/api/locations`          | `sectionId`, `zoneId`   |

Each base path supports GET for listing and POST for creation. Append `/:id` for GET, PATCH, or DELETE. IDs are UUIDs. Active signed-in users can read; admins and the owner can write. Mutations require the configured Origin header. Global API rate limits apply.

Creation fields:

- Zone: `name`, optional `sortOrder`.
- Section: `zoneId`, `label`, optional `sortOrder`.
- Location: `sectionId`, `label`, optional `sortOrder`.

PATCH accepts only name/label and `sortOrder`, and requires at least one field. Parent relationships cannot be changed through these endpoints. Unknown body or query fields are rejected.

Zone names are trimmed and limited to 1–120 characters. Section and level labels are trimmed and limited to 1–40 characters. Case is preserved for display, but uniqueness is case-insensitive: globally for zone names, within the parent for section and level labels. `sortOrder` defaults to zero and must be an integer from zero to 2,147,483,647. Ties are permitted.

## Reordering in the workspace

Admins reorder zones, sections, and levels by dragging their row handles. Sibling rows animate into place; the dragged branch retains its children. Handles also support Space to pick up/drop, Up/Down to move, and Escape to cancel. Reduced-motion preferences disable the transitions. Forms do not expose numeric ordering, and editing a label preserves its saved order.

Zones and child lists support loading more siblings before dragging across page boundaries. Zone reordering is disabled during search. Rows stay within their current parent, and failed saves restore the server order and display an error.

`POST <base path>/:id/move` accepts `{ targetId, position: "before" | "after" }` and returns 204. It requires admin/owner access and the configured Origin. The server orders the complete sibling list, including unloaded rows, and normalizes its internal `sortOrder` values in one transaction. A short table write lock serializes moves with other moves and existing CRUD writes; readers remain unblocked. A missing source returns 404; a missing destination or destination in another parent returns 409. Repeating a placement leaves the row adjacent to the same target.

## Responses and ordering

Creation returns 201; reads and updates return 200. All records include `id`, `sortOrder`, `createdAt`, and `updatedAt`. Sections additionally include `zoneId` and `zoneName`. Locations include `sectionId`, `sectionLabel`, `zoneId`, and `zoneName`, so clients can display the complete address. Names reflect the current parent records.

Lists return `{ items, total, page, pageSize }`. All support `search`, `page` (default 1), and `pageSize` (default 25, maximum 100). Search is a case-insensitive literal substring of the resource's own name or label; a level also matches its section label and zone name, the path a lookup shows. Filters combine with AND. Sort order is `sortOrder`, then name/label, then ID; page data and totals use the same database snapshot.

Deletion returns 204. Zones containing sections, sections containing locations, and locations referenced by stock items return 409. Duplicate names/labels return 409; missing records or parents return 404; invalid input returns 400. Storage failures return a generic 503.

`updatedAt` is maintained for API writes through Drizzle's update hook; direct SQL updates must set it explicitly.

## Setup and tests

Apply `0004_add_locations.sql` before using the endpoints or running integration tests. The endpoints require no additional migration. No zones, sections, or levels are seeded automatically.

The [auth integration suite](authentication.md#tests) copies the migrated location tables into its disposable schema. It covers role and activation checks, Origin checks, CRUD, parent immutability, scoped uniqueness, concurrent duplicate creation, hierarchy names, sorting, pagination, literal search, and deletion protection. It never executes migration files.
