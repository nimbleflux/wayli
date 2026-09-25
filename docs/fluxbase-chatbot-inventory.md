# Fluxbase AI Chatbot Inventory — `wayli/wayli-assistant`

Single source of truth for the Wayli assistant chatbot and the Wayli-side
integration points. All facts below are derived from
`fluxbase/chatbots/wayli-assistant.ts` (the only file in `fluxbase/chatbots/`).

> The original `location-assistant.ts` / `trip-planner.ts` pair was replaced by
> the unified `wayli-assistant` supervisor chatbot. The old MCP-tool files
> (`fluxbase/mcp-tools/*`) no longer exist: custom tools were migrated to
> Fluxbase RPCs and the Pelias discovery moved to the `discover-places` edge
> function.

## 1. Chatbot definition

| Field                  | Value (from `@fluxbase:*` annotations)                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File                   | `fluxbase/chatbots/wayli-assistant.ts`                                                                                                                                           |
| Namespace / name       | `wayli` / `wayli-assistant`                                                                                                                                                      |
| Version                | `1`                                                                                                                                                                              |
| Reasoning mode         | `supervisor` (page-contexts adapt it per page)                                                                                                                                   |
| Response language      | `auto` (responds in the user's language; SQL/RPC concepts in English)                                                                                                            |
| Web search             | enabled, with supervisor web triggers for current-info questions ("this weekend", "currently", "in 2026", …)                                                                     |
| Rate limit             | `0/min` (unlimited by default; configurable in server admin settings)                                                                                                            |
| Daily limit            | `0` (unlimited by default)                                                                                                                                                       |
| Token budget           | `0/day` (unlimited by default)                                                                                                                                                   |
| Max turns / iterations | `50` / `50`                                                                                                                                                                      |
| Conversations          | persisted, TTL 30 days                                                                                                                                                           |
| Allowed tables (9)     | `my_trips`, `my_pending_trips`, `my_trip_entries`, `my_place_visits`, `my_poi_summary`, `trip_plan_items`, `country_name_aliases`, `public_trip_entries`, `want_to_visit_places` |
| Allowed operations     | `SELECT` on schema `public` (writes are proposed as JSON chips the user accepts, executed via RPCs client-side)                                                                  |
| MCP tools              | `execute_sql`, `invoke_rpc`, `invoke_function`, `vector_search`                                                                                                                  |
| Knowledge base (RAG)   | `wayli-pois` (max 5 chunks, similarity ≥ 0.7)                                                                                                                                    |

## 2. Page contexts (supervisor mode)

| Page            | Agents               | Notes                                                                        |
| --------------- | -------------------- | ---------------------------------------------------------------------------- |
| `default`       | sql, kb, action      | History Q&A, aggregations, journal/feed search                               |
| `plan`          | sql, kb, action, web | Trip planning; must end proposals with a fenced ```json plan-items block     |
| `want-to-visit` | sql, action, web     | Wishlist read + create/delete proposals via JSON chips                       |
| `trips`         | sql, action, web     | List trips + pending detections; create/update/approve/reject via JSON chips |

## 3. RPCs & functions invoked by the assistant

Custom MCP tools were migrated to Fluxbase RPCs (callable through `invoke_rpc`;
each lives in `fluxbase/rpc/*.sql`):

- `search-visits`, `visits-for-trip`, `aggregate-visits`, `get-visit-summary`
- `get-trip-summary`, `search-journal-entries`, `search-feed-posts`
- `get-trip-plan`, `create-trip`, `update-trip`, `approve-detected-trip`, `reject-detected-trip`

Place discovery ("recommend", "near me") goes through `invoke_function` → the
`discover-places` edge function (`fluxbase/functions/discover-places.ts`,
Pelias-backed). The chatbot no longer calls Pelias over HTTP directly, so the
old `wayli.pelias_endpoint` setting / HTTP domain allowlist no longer applies.

## 4. Intent rules (15)

Declared via `@fluxbase:intent-rules`. 9 constrain tables (e.g. food/leisure
keywords → `requiredTable: my_place_visits`, trip keywords → `my_trips`),
6 force `requiredTool: invoke_rpc` (journal, trip-summary/recap, feed, wishlist,
trip-scoped recall, and trip composition actions). The old vector-search
keyword rule was replaced — semantic similarity is routed via the
`vector_search` tool in the prompt's tool-selection table.

## 5. Knowledge base — per-user scoping (IMPORTANT)

The `wayli-pois` KB holds per-user behavioral documents produced by the
`sync-poi-embeddings` job (`fluxbase/jobs/sync-poi-embeddings.ts`), which stamps
`metadata.user_id` on every document; retrieval filters by the calling user.

> **Warning:** the old boot-time table exports (exporting `place_visits` /
> `user_preferences` rows into the instance-global KB at container startup) were
> **removed** — they wrote real user rows into a global KB with no user scoping,
> so the chatbot RAG could serve one user's visits to another. Do not
> reintroduce global KB exports; new KB documents must always be stamped with
> `metadata.user_id` and filtered per caller.

## 6. Wayli-side integration points

- `web/src/lib/components/ai/AiDrawer.svelte` — mounts the drawer with
  `CHATBOT = 'wayli-assistant'` (page-aware context).
- `web/src/lib/services/chat.service.ts` — wraps the `FluxbaseAIChat` SDK
  callbacks (`onDone` accepts `(usage, extras?)`, resolves usage via
  `lookupChatbot` + `getUsage`); default chatbot name `'wayli-assistant'`.
- `web/src/routes/(user)/dashboard/server-admin-settings/` — admin UI pushes
  rate-limit/daily-limit/token-budget to the live `wayli-assistant` record
  (`0 = unlimited`).
- Deploy/sync: `bun run sync:chatbots` from `web/`
  (`fluxbase chatbots sync --namespace wayli --dir ../fluxbase/chatbots/`);
  the production container runs the same sync in `startup.sh`.
