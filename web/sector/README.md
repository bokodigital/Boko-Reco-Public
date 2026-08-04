# Sector engine (multi-sector expansion) — scaffold

This folder adds **sector-aware** recommendations on top of the existing engine
**without changing today's behaviour**. It is dormant until a shop is explicitly
opted in, so it is safe to ship to production ahead of any rollout.

## Files
- `playbooks.json` — the seven sector playbooks (roles, gates, weights, role-inference hints, rules). Fashion is intentionally absent; it stays on the current generic engine.
- `engine.js` — `recommendForShop({ products, anchor, cart, industry, limit, useLLM })`. Pure/data-driven and unit-testable. **Falls back to the current `recommend()` whenever `industry` is unset, the playbook is missing, or anything throws.**
- `loader.js` — maps Shopify `boko.*` product metafields (with a tag fallback) into the shape the engine expects. Needs no scope beyond the existing `read_products`.

## How to wire it in (do this only when ready to test on a dev/pilot store)

The live call path is **not** modified by this scaffold. To activate it, guard the
call in `server.js`'s `/proxy/recommend` handler with the shop's industry flag:

```js
import { recommendForShop } from "./sector/engine.js";
// ...
const industry = await db.get("boko_industry:" + shop);   // unset for every live shop today
const picks = industry
  ? await recommendForShop({ products, anchor, cart, industry, limit, useLLM })
  : await recommend({ products, anchor, limit, useLLM });  // unchanged path
```

Because `boko_industry:<shop>` is unset for every existing store, this line behaves
exactly like today until you set the flag on a specific store. Setting/clearing the
flag is the on/off switch and is fully reversible.

## Rollout order (summary)
1. Prove on **development stores** via a separate staging app + Replit deployment.
2. Merge to production **dark** (this scaffold; dormant by default).
3. Opt in one **pilot** store, watch, then broaden.

See the Implementation & Rollout Plan document for the full plan.
