# Turn on AI suggestions (your own GPT or Claude)

The app already includes LLM re-ranking — it's just off until you add a key. When on, the
heuristic engine builds a shortlist, then your LLM curates/reorders it per recommendation
type (up-sell, down-sell, bestseller, etc.). If the LLM call ever fails, it silently falls
back to the heuristic order, so the widget never breaks.

> The LLM runs on the **app backend only** (so your API key stays secret). It does not work
> in the free storefront-only section — storefront JS is public and would leak the key.
> Use the app + the `theme-section/boko-recommendations.liquid` (proxy) section to get LLM
> suggestions.

## Enable it — set these env vars on your host (Replit Secrets, Render env, etc.)

### Option A — OpenAI / GPT (or any OpenAI-compatible endpoint)
```
LLM_PROVIDER=openai
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_API_KEY=sk-...                 # from platform.openai.com
LLM_MODEL=gpt-4o-mini              # cheap + fast; gpt-4o for best quality
```

### Option B — Anthropic / Claude
```
LLM_PROVIDER=anthropic
LLM_API_URL=https://api.anthropic.com/v1/messages
LLM_API_KEY=sk-ant-...            # from console.anthropic.com
LLM_MODEL=claude-3-5-haiku-latest  # fast/cheap; claude-3-5-sonnet for best quality
```

Save → the host restarts → AI is live. Nothing else to change; the proxy endpoint
(`/proxy/recommend`) already passes candidates through the LLM.

## How to verify it's working
- Open a product page with the widget; switch tabs. Ordering should look more "curated"
  than pure bestseller/price order.
- Check your host logs. On failure you'll see `[reco] LLM refine failed: <reason>`
  (then it used the heuristic) — usually a bad key, wrong URL, or no model access.

## Cost & performance notes
- Each tab load = one short LLM call (~a few hundred tokens). `gpt-4o-mini` /
  `claude-3-5-haiku` cost a fraction of a cent per call — pennies a day for most stores.
- To cut cost/latency, cache results per (product, type) for a few hours, or only enable
  the LLM for the up-sell/down-sell tabs (bestsellers/most-viewed are fine on heuristics).
  Ask and I'll add a simple cache + per-tab toggle.

## Which "AI" is which
- **Free widget** → Shopify's built-in recommendation ML (no key). Already on.
- **This LLM layer** → your own GPT/Claude curation on top of your catalog + sales signals.
  Best when you want brand-specific logic ("pair premium knitwear with denim", etc.) —
  you can edit the guidance text in `web/recommendations.js` (`buildPrompt`) to steer it.
