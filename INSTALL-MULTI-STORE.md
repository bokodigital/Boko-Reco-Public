# Install on multiple stores (custom / unlisted distribution)

This app is built to run **once** and install on **many stores**. Each store authorises
via OAuth and gets its own saved session, so installs are fully independent. You don't
list it on the App Store — you install it on stores you choose using an install link.

## One-time setup (you do this once)

### 1. Prerequisites
- Free **Shopify Partner account** — https://partners.shopify.com
- **Node 18+** and **Shopify CLI**: `npm i -g @shopify/cli`
- A **public host** for the backend with a persistent disk (Render, Fly.io, Railway, a VPS).
  Avoid pure serverless unless you swap SQLite for a hosted DB session store (see note at bottom).

### 2. Create the app
```bash
cd boko-reco-app
shopify app config link      # creates the app in your Partner account, writes client_id
cd web && npm install
```

### 3. Configure environment
Copy `.env.example` to `web/.env` and fill in:
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` — Partner dashboard → your app → API credentials
- `HOST` — your public backend URL (e.g. `https://boko-reco.onrender.com`)
- `SCOPES` — leave as `read_products,read_orders`
- `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` — optional, for AI ranking

### 4. Deploy the backend + extension
- Deploy the `web/` server to your host. Set the same env vars there.
- In the Partner dashboard → App setup, set:
  - **App URL**: `https://<your-host>/`
  - **Allowed redirection URL**: `https://<your-host>/api/auth/callback`
  - **App proxy**: Subpath prefix `apps`, Subpath `reco`, URL `https://<your-host>/proxy`
- Publish the theme app extension (the storefront widget):
  ```bash
  shopify app deploy
  ```

### 5. Make distribution "custom"
Partner dashboard → your app → **Distribution** → choose **Custom distribution** (or
**Unlisted**). This generates install links and skips App Store review.

## Installing on each store (repeat per store)

1. From the Partner dashboard, **generate an install link** for the target store
   (Distribution → custom distribution → enter the store's `.myshopify.com` domain →
   you get a one-click install URL). For stores you don't own, send that link to the
   merchant; they approve the OAuth screen.
2. After install, open the app from the store's admin → **Apps** → Boko AI Recommendations
   → set products-per-row, bundle discount, default type.
3. In that store: **Online Store → Themes → Customize → Add block → AI Recommendations**,
   place it on the product (or cart/home) template, save.

That's it — the widget now pulls recommendations from *that store's* catalog and orders,
and add-to-cart / bundle add-to-cart use that store's cart.

## Notes

- **Independent stores:** uninstalling on one store only clears that store's sessions
  (handled by the `app/uninstalled` webhook). Other stores are unaffected.
- **Session durability:** SQLite lives on the server's disk. On Render/Fly/Railway attach
  a persistent disk/volume. On serverless (Vercel functions), swap `SQLiteSessionStorage`
  for `@shopify/shopify-app-session-storage-postgresql` (or redis/mysql) — one line in
  `server.js` — so sessions survive between invocations.
- **Scopes change:** if you later add scopes, merchants re-approve on next load automatically.
- **Going public later:** to list on the App Store you'll additionally need the GDPR
  compliance webhooks, a billing flow, and to pass Shopify review. Ask and I'll add those.
