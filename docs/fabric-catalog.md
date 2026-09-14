# Fabric catalog API

The catalog is organized as manufacturer → material → color. Each material belongs to one manufacturer, and each color belongs to one material. Physical stock, receiving, and allocation are separate features.

All routes require a valid session. Every signed-in role can read. Only `admin` can create, update, or delete; `owner` does not implicitly inherit admin privileges. Permissions use the current user role from PostgreSQL on every request. Writes also require the configured `WEB_ORIGIN` as the request's Origin header.

## Module structure

`FabricCatalogModule` groups three child modules: `ManufacturersModule`, `FabricMaterialsModule`, and `FabricColorsModule`. Each lives in its own `manufacturers/`, `materials/`, or `colors/` directory and owns its controller, service, repository, and table. Each imports `DatabaseModule`; providers remain private to their owning module. Catalog error handling and shared integration checks stay at the catalog level.

## Routes

All resources are namespaced under `/api/fabric-catalog`. Each resource supports the same methods:

| Method | Path                                 | Result                      |
| ------ | ------------------------------------ | --------------------------- |
| GET    | `/api/fabric-catalog/{resource}`     | 200 with a paginated list   |
| GET    | `/api/fabric-catalog/{resource}/:id` | 200 with a single record    |
| POST   | `/api/fabric-catalog/{resource}`     | 201 with the created record |
| PATCH  | `/api/fabric-catalog/{resource}/:id` | 200 with the updated record |
| DELETE | `/api/fabric-catalog/{resource}/:id` | 204 with no body            |

| Resource        | Create fields                       | Additional list filters        |
| --------------- | ----------------------------------- | ------------------------------ |
| `manufacturers` | `name`                              | None                           |
| `materials`     | `name`, `manufacturerId`            | `manufacturerId`               |
| `colors`        | `code`, `materialId`, `thicknessMm` | `materialId`, `manufacturerId` |

PATCH accepts a nonempty subset of the create fields. IDs are UUIDs. Unknown body fields and query parameters are rejected.

Names are trimmed and must contain 1–120 characters. Color codes are trimmed, uppercased, globally unique, and contain 1–10 ASCII letters, digits, or hyphens. Thickness is a JSON number in millimetres, greater than zero, at most 9,999,999.999, with at most three decimal places. Excess precision is rejected rather than rounded by the endpoint. PostgreSQL stores it as `thickness_mm numeric(10,3)`; JSON numbers need not display trailing zeroes.

For example, creating a color uses:

```json
{
  "code": "AB-12",
  "materialId": "11111111-1111-4111-8111-111111111111",
  "thicknessMm": 0.425
}
```

## Reading and pagination

All lists accept `search`, `page` (default 1), and `pageSize` (default 25, maximum 100). Page numbers are limited to 1,000,000. Search is a case-insensitive literal substring of the manufacturer/material name or color code; `%` and `_` are not wildcards. Filters combine with AND.

List responses contain `items`, `total`, `page`, and `pageSize`. `total` counts all matching records before pagination. Lists sort by name or color code, then ID, and read the page and total from the same database snapshot.

All records include `id` and `createdAt` as an ISO timestamp. Material responses include `manufacturerId` and `manufacturerName`. Color responses include `materialId`, `materialName`, `manufacturerId`, and `manufacturerName`. Shared request and response schemas are exported through `@roller-bay/shared/fabric-catalog`.

## Errors and deletion

- 400: invalid input, UUID, query, or empty PATCH.
- 401: missing or expired session.
- 403: insufficient role or untrusted/missing Origin on a write.
- 404: missing target or referenced manufacturer/material.
- 409: duplicate color code or deletion blocked by a reference.
- 503: catalog storage unavailable.

Deleting a manufacturer with materials or a material with colors is blocked by foreign keys. There is no cascading deletion. Colors can currently be deleted because stock-item references have not been implemented.

## Setup and verification

Apply the existing `0001_add_fabric_catalog.sql` migration with `npm run db:migrate` before using these endpoints against the application database. The endpoint implementation does not require another migration.

`npm run test:integration`, with the test URLs described in [authentication](authentication.md#tests), exercises real session authorization and catalog CRUD. Apply pending migrations to the test database first. It copies the migrated application table structures into the suite's disposable PostgreSQL schema, leaves application tables unchanged, and cleans up its own schema and Redis keys. Coverage includes all three resources, owner/user write denial, immediate role changes, invalid inputs, duplicate codes, missing references, blocked deletions, hierarchy responses, search, and pagination.
