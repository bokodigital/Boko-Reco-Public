// recommendations.js
// Single-mode recommendation engine: "Recommended" picks, optionally curated by an LLM.
// (Up-sell / down-sell / bestseller helpers remain available but the app uses "recommended".)
//
// LLM refinement (optional): set LLM_API_URL + LLM_API_KEY (+ LLM_PROVIDER, LLM_MODEL).
//   provider "openai"    -> OpenAI-compatible /chat/completions (GPT, Groq, OpenRouter…)
//   provider "anthropic" -> Claude messages API (https://api.anthropic.com/v1/messages)
//   Auto-detected from the URL if LLM_PROVIDER unset. Fails safe to the heuristic order.

const HEURISTIC = {
  // General "recommended": popular products, boosted when they share the anchor's category.
  recommended(products, anchor) {
    return products
      .filter((p) => !anchor || p.id !== anchor.id)
      .map((p) => {
        const rel = anchor && p.category === anchor.category ? 1.3 : 1;
        return { p, score: rel * ((p.orders || 0) * 0.6 + (p.views || 0) * 0.2) };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  },
  byPurchased(products) {
    return products.slice().sort((a, b) => (b.orders || 0) - (a.orders || 0));
  },
  byViewed(products) {
    return products.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
  },
};

function rankHeuristic(type, products, anchor) {
  if (type === "purchased") return HEURISTIC.byPurchased(products);
  if (type === "viewed") return HEURISTIC.byViewed(products);
  return HEURISTIC.recommended(products, anchor); // default + "recommended"
}

function bundlePricing(items, discountPct = 0) {
  const subtotal = items.reduce((s, p) => s + (p.price || 0), 0);
  const discount = (subtotal * discountPct) / 100;
  return { subtotal, discount, total: subtotal - discount };
}

function buildPrompt(type, candidates, anchor) {
  const sys =
    "You are a merchandising assistant for an e-commerce store. Given an anchor product " +
    "and a candidate list, choose and order the products most worth recommending to a " +
    "shopper viewing the anchor. Respond ONLY with JSON: {\"ids\":[<id>,<id>,...]}.";
  const user = {
    anchor: anchor
      ? { id: anchor.id, title: anchor.title, price: anchor.price, category: anchor.category }
      : null,
    candidates: candidates.map((p) => ({
      id: p.id, title: p.title, price: p.price, category: p.category, orders: p.orders, views: p.views,
    })),
    guidance:
      "Recommend products that genuinely complement or appeal to a buyer of the anchor — " +
      "mix complementary items and strong sellers; avoid near-duplicates of the anchor.",
  };
  return { sys, userStr: JSON.stringify(user) };
}

function parseIds(txt, candidates) {
  if (!txt) return null;
  const m = String(txt).match(/\{[\s\S]*\}/);
  let parsed;
  try { parsed = JSON.parse(m ? m[0] : txt); } catch (e) { return null; }
  if (!Array.isArray(parsed.ids)) return null;
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const ordered = parsed.ids.map((id) => byId.get(id)).filter(Boolean);
  return ordered.length ? ordered : null;
}

async function refineWithLLM({ candidates, anchor }) {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  if (!url || !key) return null;
  const provider = (process.env.LLM_PROVIDER || (/anthropic\.com/.test(url) ? "anthropic" : "openai")).toLowerCase();
  const { sys, userStr } = buildPrompt("recommended", candidates, anchor);
  try {
    let txt;
    if (provider === "anthropic") {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 512, system: sys, messages: [{ role: "user", content: userStr }] }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      txt = data.content && data.content[0] && data.content[0].text;
    } else {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0.2, response_format: { type: "json_object" },
          messages: [{ role: "system", content: sys }, { role: "user", content: userStr }],
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    }
    return parseIds(txt, candidates);
  } catch (e) {
    console.error("[reco] LLM refine failed:", e.message);
    return null;
  }
}

async function recommend({ products, anchor = null, limit = 8, useLLM = true }) {
  const heuristic = rankHeuristic("recommended", products, anchor).slice(0, Math.max(limit, 12));
  let ordered = heuristic;
  if (useLLM) {
    const refined = await refineWithLLM({ candidates: heuristic, anchor });
    if (refined && refined.length) ordered = refined;
  }
  return ordered.slice(0, limit);
}

export { recommend, rankHeuristic, bundlePricing, refineWithLLM, parseIds, HEURISTIC };
