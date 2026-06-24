# Boko AI Product Recommendations — Shopify App

An embedded Shopify app (like Runa AI) that shows AI-picked product recommendations on
your storefront. Shoppers choose how many products show per row, add any product to cart,
or add the whole **bundle** to cart at a combined, discounted price. Products are selected
automatically by **most purchased**, **most viewed**, **up-sells**, and **down-sells**,
ranked by a heuristic engine and refined by an LLM.

## What's in here

```
boko-reco-app/
├─ shopify.app.toml          App + App Proxy config (fill in client_id, host)
├─ .env.example              Environment variables (Shopify keys + LLM key)
├─ web/
│  ├─ server.js              Express backend: OAuth, App Proxy /proxy/recommend, settings API
│  ├─ recommendations.js     Ranking engine + optional LLM refinement
│  ├─ package.json           Backend dependencies
│  ├─ frontend/index.html    Embedded admin settings page (App Bridge)
│  └─ test/engine.test.mjs   Engine unit tests (run: npm test)
└─ extensions/reco-widget/   Theme app extension (the storefront widget)
   ├─ shopify.extension.toml
   ├─ blocks/reco.liquid      The block merchants add in the theme editor
   └─ assets/reco.js, reco.css
```

A standalone, clickable preview of the widget (no backend needed) ships separately as
`reco-widget-preview.html` — use it to demo and fine-tune the design.

## How recommendations are chosen

The engine (`recommendations.js`) ranks the catalog per type:

- **Most purchased** — by lifetime sales count.
- **Most viewed** — by product views (from a `custom.views` metafield kept by a web pixel, or your analytics).
- **Up-sells** — same/related category, priced above the anchor product, weighted by popularity.
- **Down-sells** — same category, priced below the anchor (a smart cheaper alternative).

If `LLM_API_URL` + `LLM_API_KEY` are set, the shortlist is sent to an OpenAI-compatible
chat endpoint that re-orders/filters it for relevance. No key → heuristic order is used.
The call fails safe: any error falls back to the heuristic ranking.

## Prerequisites (you provide these)

1. A **Shopify Partner account** and a development or live store.
2. **Node 18+** and the **Shopify CLI** (`npm i -g @shopify/cli`).
3. A **public host** for the backend (Vercel, Fly.io, Render, Cloudflare, etc.).
4. (Optional) an **LLM API key** for the refinement pass.

> I can't create the Partner app, run OAuth, host the server, or hold your API keys —
> those steps need your accounts and are done by you below.

## Setup

1. **Install deps**
   ```bash
   cd web && npm install
   ```

2. **Create the app**
   ```bash
   cd ..              # repo root (where shopify.app.toml is)
   shopify app config link      # creates/links the app, fills client_id
   ```

3. **Configure env** — copy `.env.example` to `web/.env` and fill in:
   - `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` (Partner dashboard → App setup)
   - `HOST` = your public backend URL
   - `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` (optional)

4. **Set the App Proxy** (Partner dashboard → App setup → App proxy):
   - Subpath prefix: `apps`  ·  Subpath: `reco`  ·  Proxy URL: `https://<your-host>/proxy`
   - This makes the storefront call `https://<shop>/apps/reco/recommend` reach your backend.

5. **Run locally**
   ```bash
   shopify app dev
   ```
   Install on your dev store when prompted, then open the app — the settings page loads.

6. **Add the widget to your theme**
   - Online Store → Themes → Customize.
   - On a product (or home/cart) template, **Add block → AI Recommendations**.
   - Set products-per-row, number of products, bundle discount, and whether shoppers can switch tabs.

7. **Deploy**
   ```bash
   shopify app deploy     # publishes the theme app extension
   ```
   Deploy the backend (`web/`) to your host and point `application_url` + redirect URLs at it.

## Add-to-cart behaviour

- Per-product button → `POST /cart/add.js` with that variant.
- Bundle button → one `POST /cart/add.js` with all selected variants. The displayed bundle
  total reflects the configured discount; to make the discount actually apply at checkout,
  create an automatic discount / Shopify Function targeting the bundle (a follow-up step —
  the widget already shows the discounted price and adds the items together).

## Tests

```bash
cd web && node test/engine.test.mjs
```

## Notes & limitations

- Product **views** aren't exposed by the Admin API directly; this scaffold reads a
  `custom.views` metafield. Maintain it with a small web pixel or sync from your analytics.
- The settings store in `server.js` is in-memory for clarity — move it to a DB or shop
  metafields before production.
- Bundle discount is presentational at the cart line level until you add a discount
  function; the recommendation, layout, row-count, and add-to-cart flows are fully working.
