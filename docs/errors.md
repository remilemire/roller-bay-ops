# Error responses

Every non-2xx JSON response from the API has one shape, defined in `packages/shared/src/errors/index.ts` and imported as `@roller-bay/shared/errors`:

```json
{
  "statusCode": 409,
  "message": "Stock availability changed or is insufficient.",
  "issues": [
    {
      "code": "length_capacity",
      "path": "plan.cuts.0",
      "message": "Cut exceeds remaining length."
    }
  ]
}
```

`message` is always curated copy an operator can act on. `issues` is optional and lists field-level details: Zod issues about the request body (array `path`) or cutting-plan validator issues (dotted string `path`). Nothing else leaves the API; internal detail stays in the API log.

## Translation

`apps/api/src/common/errors/` owns the translation. `translateError()` is a pure function with no Nest runtime dependency beyond `HttpException`. `HttpErrorFilter` applies it to every request, registered globally by `ErrorsModule`, which `AppModule` and the integration harnesses both import. `PassthroughExpressAdapter` disables Nest's own mapping of body-parser and path-decoding errors, which would otherwise turn them into 400s that echo the parser's text before the filter runs; the filter translates them by their status code instead.

| Thrown value                                                                                        | Response                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpException` (`NotFoundException`, `ConflictException`, …)                                       | Its status. `message` is the exception's string message; `issues` pass through only when every entry matches the shared issue schema. Any other payload key is dropped. |
| Express request error with a 4xx `statusCode` (malformed JSON, oversized body, unsupported charset) | That status with a fixed message. The parser text is never returned.                                                                                                    |
| Anything else (plain `Error`, driver errors, third-party 5xx)                                       | 500 with a generic message.                                                                                                                                             |

Unknown routes under `/api` return a 404 envelope; the global prefix keeps its leading slash because Nest mounts that handler at the raw prefix string. The rate limiter writes its own 429 body from middleware in the same shape. Login and callback routes use `LoginRedirectFilter`, which redirects with a safe code instead of returning a body.

## Logging

`logServerFault()` records statuses of 500 and above as `METHOD /path -> status` followed by the full `cause` chain with stack traces; both filters use it. The query string, headers, cookies, and request body are never logged. Feature code therefore passes `{ cause: error }` when it converts a domain or driver error into an `HttpException`; without it, a 503 has nothing to explain it. Client errors are not logged.

## Rules for feature code

- Throw Nest `HttpException`s with literal, curated messages and `{ cause }`. Never interpolate driver, provider, schema, or user-supplied text into a message.
- Keep domain-to-HTTP mapping inside the feature (`operation()` wrappers, `allocationOperation`, and similar). The global filter is a safety net, not the home of feature messages.
- Structured details belong in `issues` as `{ code, path, message }`.
- Optimization: only `invalid_input` and `numeric_range` describe the order and return 400 with their message. Schema failures on server-built options or context, invalid models or solutions, and solver transport faults return 503 `Optimization is unavailable.` with the detail logged.

## Frontend

`apps/web/src/lib/api.ts` parses error bodies with the shared schema; `ApiError` carries `status`, `message`, optional `retryAfterMs`, and `issues`. `apps/web/src/lib/errors.ts` turns any error into a message plus readable detail lines (`plan.cuts.0.items.1.widthMm` becomes `Plan › cut 1 › item 2 › width`), and `ErrorNotice` renders them. Text from any other exception is replaced by generic copy.

## Tests

`apps/api/src/common/errors/*.test.ts` cover the translation rules, the filter's logging and `headersSent` handling, and an in-process Nest app without PostgreSQL or Redis that proves malformed JSON, oversized bodies, thrown errors, and unknown routes all produce the envelope. `apps/api/src/features/allocations/allocation-planning.service.test.ts` covers the optimizer's 400/503 split. `apps/web/src/lib/errors.test.ts`, `apps/web/src/lib/api.test.ts`, and `apps/web/src/components/ui/feedback.test.tsx` cover the client.
