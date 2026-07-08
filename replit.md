# Boko AI Recommendations

Multi-tenant Shopify app (Node.js/Express) that provides AI-powered product recommendation widgets for merchants: a product-page rail, a cart-drawer carousel, and a "Selected For You" page/collection. Includes a merchant-facing dashboard (Performance stats, a Customizer for widget styling, and a Storefront setup panel) embedded in Shopify Admin via App Bridge.

Two delivery paths for storefront widgets exist side by side:
- **Theme-app-extension** (`extensions/reco-widget/`) — traditional blocks/app-embeds installed via the theme editor, deployed with `shopify app deploy`.
- **No-theme-app-extension** (server-only) — widgets installed purely through Admin API calls from the app itself (Admin REST Asset API for theme files, ScriptTag for storefront JS), with no `shopify app deploy` step required. Controlled from the dashboard's "Storefront setup" tab.

## Structure
- `web/server.js` — Express app: OAuth/token exchange, dashboard HTML, settings/customizer API, stats, and the no-extension storefront setup routes (`/setup-theme`, `/storefront.js`, `/enable-widgets`, `/disable-widgets`, `/storefront-status`).
- `web/theme-assets.js` — Liquid section + JSON template pushed to the merchant's main theme by `/setup-theme`.
- `web/storefront-script.js` — vanilla JS served at `/storefront.js` via ScriptTag (PDP rail + cart-drawer carousel).
- `web/boko-settings.js` — shared settings shape/loader used by both the Customizer and the widgets.
- `extensions/reco-widget/` — theme-app-extension blocks (reference/alternate delivery path; keep intact).
- `shopify.app.toml` — app config incl. `access_scopes` (must match the `SCOPES` env var).

## User preferences
(none recorded yet)
