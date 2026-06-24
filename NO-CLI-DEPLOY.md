# Deploy with NO Shopify CLI and NO Git (upload code only)

Everything here is done in the browser by uploading the code and clicking through
dashboards. The only part that normally needs the CLI — the theme app extension — is
replaced by a **paste-in theme section** (`theme-section/boko-recommendations.liquid`).

Three things to do: (A) host the backend, (B) create the app in the browser, (C) add the
widget to your theme. ~30 minutes.

---

## A. Host the backend by uploading the code (Replit)

Replit lets you upload a folder and run it — no Git, no CLI, no local Node.

1. Go to https://replit.com → sign up/in → **Create Repl** → choose **Node.js** →
   create it.
2. In the file panel, **drag the unzipped `boko-reco-app` folder** (or the files) into the
   repl. The included `.replit` file tells it how to run.
3. Click the **Secrets** panel (lock icon) and add:
   - `SHOPIFY_API_KEY` — (from step B below)
   - `SHOPIFY_API_SECRET` — (from step B below)
   - `HOST` — your repl's public URL, e.g. `https://boko-reco.<you>.repl.co`
     (you'll see the URL once you press Run; come back and paste it here)
   - optional: `LLM_API_URL`, `LLM_API_KEY`
4. Press **Run**. Replit installs dependencies and starts the server; a webview URL appears.
   Copy that URL — that's your `HOST`. Put it in Secrets and Run again.
5. For always-on hosting (so it doesn't sleep), enable Replit's **Reserved VM /
   Autoscale Deployment** (their "Deploy" button). The repl's filesystem is persistent,
   so the SQLite session DB survives.

> Prefer not to use Replit? Glitch (glitch.com → New project → Import → upload) works the
> same way. Any host where you can upload files, set env vars, and expose a port is fine.

---

## B. Create the app in the Partner dashboard (browser only)

1. https://partners.shopify.com → sign up/in → **Apps → Create app → Create app manually**.
   Name it "Boko AI Recommendations".
2. On the app's **API credentials** page, copy the **Client ID (API key)** and **Client
   secret** → paste them into Replit Secrets (step A3) → Run again.
3. On **App setup / Configuration**, set:
   - **App URL**: `https://<your-host>/`
   - **Allowed redirection URL(s)**: `https://<your-host>/api/auth/callback`
   - **App proxy**: Subpath prefix `apps` · Subpath `reco` · Proxy URL `https://<your-host>/proxy`
4. **Distribution** → choose **Custom distribution**. Enter your store's
   `.myshopify.com` domain to generate a **one-click install link**.
5. Open that install link → approve the permission screen. The app is now installed on
   your store (this is the OAuth step — all in the browser).

---

## C. Add the widget to your theme (browser only — the paste-in section)

1. **Online Store → Themes → ⋯ → Edit code**.
2. Under **Sections**, click **Add a new section**, name it `boko-recommendations`.
3. Delete the starter content, then paste the **entire** contents of
   `theme-section/boko-recommendations.liquid`. **Save.**
4. Go back → **Customize** → open a product page (or home/cart) → **Add section** →
   **AI Recommendations**.
5. In the section settings choose products-per-row, number of products, bundle discount,
   default type, and whether shoppers can switch tabs. **Save.**

Done. The section calls `/apps/reco/recommend` (your hosted backend via the App Proxy),
renders the cards, and add-to-cart / bundle add-to-cart use the store's real cart.

---

## Installing on more stores later

Repeat **B4–B5** (generate an install link for the new store, approve it) and **C** (paste
the section in that store's theme). The same hosted backend serves every store.

## Quick checks / troubleshooting
- Visit `https://<your-host>/api/auth?shop=<store>.myshopify.com` → should start OAuth.
- Widget empty? Open the page, check the browser Network tab for `/apps/reco/recommend`.
  A 5xx usually means the App Proxy URL or the `HOST`/keys in Secrets are wrong.
- "App couldn't load"? The App URL or redirect URL doesn't exactly match your host
  (watch http vs https and trailing slashes).
- Recommendations look generic? That's expected until the store has real orders/views;
  up-sell/down-sell still work off price, and bestsellers fill in as orders arrive.
