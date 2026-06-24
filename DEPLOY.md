# One-time deploy — step by step

Goal: create the app in your Partner account, host the backend, wire up the dashboard,
and publish the storefront widget. Do this **once**; afterwards you install on stores
via links (see `INSTALL-MULTI-STORE.md`).

Estimated time: ~30–45 min. You need: a computer with Node 18+, a free Shopify Partner
account, a free GitHub account, and a Render account (free to create; the persistent-disk
plan is paid — see step 3 notes).

---

## Step 0 — Get the code on your computer

Unzip `Boko-Reco-App.zip` into a folder, then put it in a GitHub repo (Render deploys
from GitHub):

```bash
cd boko-reco-app
git init
git add .
git commit -m "Boko AI Recommendations app"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/boko-reco-app.git
git push -u origin main
```

Install the Shopify CLI globally:
```bash
npm install -g @shopify/cli
```

---

## Step 1 — Create the app in your Partner account

```bash
cd boko-reco-app
shopify app config link
```
- Log in when the browser opens. Choose **Create a new app** → name it "Boko AI Recommendations".
- This writes your real `client_id` into `shopify.app.toml`.
- In the Partner dashboard (partners.shopify.com → Apps → your app → **API credentials**),
  copy the **API key** and **API secret key** — you'll paste them into Render in Step 3.

---

## Step 2 — Deploy the storefront widget (theme app extension)

```bash
shopify app deploy
```
This publishes the `reco-widget` extension so it becomes available as an "AI Recommendations"
block in merchants' theme editors. (You can re-run this any time you change the widget.)

---

## Step 3 — Host the backend on Render

1. Go to https://dashboard.render.com → **New + → Blueprint**.
2. Connect your GitHub repo. Render detects `render.yaml` and proposes the service + disk.
3. Click **Apply**. (Note: the persistent disk needs the **Starter** plan or higher. On the
   free plan there's no disk and the instance sleeps — fine for testing, but switch to
   Starter for real multi-store use so sessions survive restarts.)
4. When it finishes, copy your service URL, e.g. `https://boko-reco-app.onrender.com`.
5. In Render → your service → **Environment**, fill the blank vars:
   - `SHOPIFY_API_KEY` = API key from Step 1
   - `SHOPIFY_API_SECRET` = API secret from Step 1
   - `HOST` = your Render URL (with `https://`)
   - `LLM_API_URL` / `LLM_API_KEY` = optional, for AI ranking
   Save — Render redeploys automatically.

> Prefer Fly.io or Railway? Same idea: deploy `web/`, attach a volume, set the same env
> vars, point `SESSION_DB_PATH` at the volume. Render is the quickest because of `render.yaml`.

---

## Step 4 — Point the Partner dashboard at your host

Partner dashboard → your app → **Configuration / App setup**:
- **App URL**: `https://boko-reco-app.onrender.com/`
- **Allowed redirection URL(s)**: `https://boko-reco-app.onrender.com/api/auth/callback`
- **App proxy**:
  - Subpath prefix: `apps`
  - Subpath: `reco`
  - Proxy URL: `https://boko-reco-app.onrender.com/proxy`

Then sync the same values from your local config (optional but tidy):
```bash
shopify app deploy   # re-deploys config + extension with the final URLs
```

---

## Step 5 — Set distribution to Custom

Partner dashboard → your app → **Distribution** → **Custom distribution**. This lets you
install on chosen stores via links, with no App Store review.

---

## You're done

The app is live and hosted. To put it on a store, follow `INSTALL-MULTI-STORE.md`:
generate an install link → merchant approves → add the "AI Recommendations" block in the
theme editor.

### Quick health check
- Visit `https://<your-host>/api/auth?shop=<yourstore>.myshopify.com` → should start OAuth.
- After installing on a dev store, open a product page with the block added → the widget
  should fetch from `/apps/reco/recommend` and render cards.

### Troubleshooting
- **Widget empty?** Check the browser network tab for the `/apps/reco/recommend` call. A 5xx
  usually means the App Proxy URL or env vars are wrong.
- **OAuth loops / "app couldn't be loaded"?** App URL or redirect URL doesn't exactly match
  the Render URL (watch for trailing slashes / http vs https).
- **Sessions lost after redeploy?** You're on a plan without a disk — upgrade to Starter so
  `/var/data` persists.
