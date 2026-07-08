---
name: No-theme-app-extension storefront setup
description: How Boko Reco installs storefront widgets/pages without `shopify app deploy` — used when a theme-app-extension approach must be avoided or reversed.
---

Shopify storefront features can be installed server-side, purely through Admin API calls triggered from app routes, without ever running `shopify app deploy` or shipping a theme-app-extension:

- **Theme files** (sections/templates): write them with the Admin REST Asset API (`PUT /admin/api/{version}/themes/{id}/assets.json`) against the shop's `role: "main"` theme (from `GET themes.json`). This requires the `write_themes` scope, which merchants must re-consent to (existing installs won't have it until they reopen the app from Shopify Admin and go through OAuth again).
- **Storefront scripts** (product-page rails, cart-drawer widgets, etc.): register a `ScriptTag` (via `scriptTagCreate` GraphQL mutation) pointing at a route the app serves as `application/javascript`. Toggle on/off by creating/deleting the ScriptTag rather than editing theme files.
- Do not auto-create Shopify Pages via API on behalf of the merchant — instruct them to create the page and assign the installed template manually, since page creation is a more visible/destructive action merchants should control.

**Why:** This app previously had (and may again have) a theme-app-extension-based delivery path. When switching between the two approaches, any existing "cleanup" logic that deletes ScriptTags matching your script's filename (e.g. run on every OAuth token refresh) must be removed or scoped carefully — otherwise it silently undoes the merchant's own enable/disable choice made through the dashboard, since token refreshes happen automatically and frequently.

**How to apply:** Before adding automatic ScriptTag/theme-asset cleanup tied to token lifecycle events in this app, check for and reconcile it against any dashboard toggle that intentionally creates the same resource.
