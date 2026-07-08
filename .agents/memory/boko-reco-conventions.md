---
name: Boko Reco app conventions
description: Replit DB storage keys, collection-exclusion approach, and workflow/port setup for the Boko AI Recommendations Shopify app.
---

## Storage
- Replit DB (`@replit/database`) is used as a lightweight persistence layer (no separate SQL DB in this app).
- Funnel tracking and merchant customizer settings are stored under single global keys (`boko_track`, `boko_settings`), not shop-scoped, even though the app is otherwise multi-tenant.
- **Why:** the app in practice serves effectively one active store; the spec asked for these literally as global keys rather than per-shop, and over-engineering multi-tenancy here wasn't requested.
- **How to apply:** if the app is later onboarded to multiple real merchants who need independent settings/tracking, these keys must be migrated to shop-scoped keys (e.g. `boko_settings:<shop>`).

## Collection exclusion filtering
- Products need a `collectionGids` array (from the Admin GraphQL `collections(first:20){edges{node{id handle}}}` query) attached per product, plus a handle→GID index, to correctly filter out products in excluded collections.
- **Why:** naively comparing product IDs against collection GIDs (as a literal spec pseudocode suggested) is a bug — collection membership must be checked via the product's own collection GID list, not its own ID.
- **How to apply:** any new exclusion/filter feature on products by collection must resolve handles to GIDs first (via the index) and intersect against each product's `collectionGids`.

## Dev workflow
- No workflow existed by default in this Repl; had to be created via `configureWorkflow` (command `cd web && npm install && npm start`, port 3000, outputType `console`) since `.replit` already mapped port 3000→80 for this app (not the default 5000 webview port).
- Deployment for this project is server-only Replit Republish (no separate `shopify app deploy` needed) for backend/dashboard changes; theme-extension liquid files require a separate `shopify app deploy` step and should not be touched in server-only tasks.
