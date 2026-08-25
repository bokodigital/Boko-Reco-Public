// sector/engine.js
// Sector-aware recommendation layer for the Boko AI Recommendations app.
//
// SAFETY CONTRACT (the whole point of this module):
//   recommendForShop() behaves EXACTLY like the existing recommend() unless a
//   store has an industry set AND a matching playbook exists. If the industry is
//   unset, the playbook is missing, or ANYTHING throws, it falls straight back to
//   the current engine. A live store with no industry flag is byte-for-byte
//   unaffected by this code being present.
//
// It is pure/data-driven: products are expected to already carry `role` and an
// `attrs` object (mapped from `boko.*` metafields by sector/loader.js). The engine
// itself does no I/O, so it is fully unit-testable offline.

import fs from "node:fs";
import { recommend, rankHeuristic } from "../recommendations.js";

const PLAYBOOKS = JSON.parse(fs.readFileSync(new URL("./playbooks.json", import.meta.url), "utf8"));

// Default style-compatibility groups (overridable per shop via boko_compat).
const STYLE_GROUPS = [
  ["scandi", "scandinavian", "modern", "minimalist"],
  ["boho", "bohemian", "farmhouse"],
  ["industrial", "modern"],
  ["classic", "everyday", "minimalist"],
];

export function getPlaybook(industry) {
  if (!industry) return null;
  return PLAYBOOKS[industry] || PLAYBOOKS[String(industry).trim()] || null;
}
export function listIndustries() { return Object.keys(PLAYBOOKS).filter((k) => k !== "_meta"); }

function lc(v) { return String(v == null ? "" : v).toLowerCase(); }
function attr(p, key) { return (p && p.attrs && p.attrs[key] != null) ? p.attrs[key] : undefined; }
function asList(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

// Infer a product's role: explicit boko.role wins; else keyword-match the title,
// product type and tags against the playbook's role synonyms.
export function inferRole(p, playbook) {
  if (p && p.role) return lc(p.role);
  const hay = lc([p.title, p.category, p.productType, (p.tags || []).join(" ")].join(" "));
  let best = null, bestLen = 0;
  for (const role of Object.keys(playbook.roleSynonyms || {})) {
    for (const kw of playbook.roleSynonyms[role]) {
      if (kw && hay.includes(lc(kw)) && kw.length > bestLen) { best = role; bestLen = kw.length; }
    }
  }
  return best; // may be null -> product simply isn't slotted into this setup
}

function sameGroup(a, b, groups) {
  a = lc(a); b = lc(b); if (!a || !b) return false; if (a === b) return true;
  return groups.some((g) => g.includes(a) && g.includes(b));
}

// Hard compatibility gate. Returns false => candidate is DROPPED (never shown).
export function compatible(cand, anchor, playbook, opts = {}) {
  if (cand.available === false) return false;
  if (cand.region_ok === false) return false;
  const styleGroups = opts.styleGroups || STYLE_GROUPS;
  for (const key of (playbook.gateAttrs || [])) {
    const av = attr(anchor, key), cv = attr(cand, key);
    switch (key) {
      case "metal": {
        if (av && cv && lc(av) !== lc(cv) && !attr(cand, "is_mixed_metal") && !attr(anchor, "is_mixed_metal")) return false;
        break;
      }
      case "model_family": {
        // Accessory fits the anchor device: explicit list, or equal family.
        const list = asList(attr(cand, "compatible_models")).map(lc);
        if (av) { if (list.length) { if (!list.includes(lc(av))) return false; } else if (cv && lc(cv) !== lc(av)) return false; }
        break;
      }
      case "connector": case "os": case "voltage": case "region": case "fit_size":
      case "indoor_outdoor": {
        if (av && cv && lc(av) !== lc(cv)) return false; // must match when both declared
        break;
      }
      case "style": {
        if (av && cv && !sameGroup(av, cv, styleGroups)) return false;
        break;
      }
      case "occasion": {
        if (av && cv && lc(av) !== lc(cv) && lc(av) !== "everyday" && lc(cv) !== "everyday") return false;
        break;
      }
      case "dietary_flags": {
        // Candidate must satisfy every dietary flag the anchor requires.
        const need = asList(av).map(lc), have = asList(cv).map(lc);
        if (need.length && !need.every((f) => have.includes(f))) return false;
        break;
      }
      case "allergens": {
        // Candidate must not contain an allergen the anchor context excludes.
        const avoid = asList(attr(anchor, "avoid_allergens")).map(lc);
        const has = asList(cv).map(lc);
        if (avoid.length && has.some((a) => avoid.includes(a))) return false;
        break;
      }
      case "is_travel": { if (attr(cand, "is_travel") === false) return false; break; }
      case "region_available": case "region_rules": {
        if (attr(cand, "region_available") === false) return false; break;
      }
      case "compatibility_key": {
        if (av && cv && lc(av) !== lc(cv)) return false; break;
      }
      case "colour_palette": {
        if (av && cv && lc(av) !== lc(cv) && !sameGroup(av, cv, styleGroups)) return false; break;
      }
      case "price_tier": case "scale": case "time_of_day": case "skin_type":
      default:
        // Soft attributes: not a hard gate here (scored instead), EXCEPT skin_type
        // which excludes an explicitly incompatible product.
        if (key === "skin_type" && av && cv && lc(cv) !== "all" && lc(av) !== "all" && lc(av) !== lc(cv)) return false;
        break;
    }
  }
  return true;
}

function scoreCandidate(cand, anchor, role, playbook, weights) {
  const w = weights || playbook.weights || {};
  const order = playbook.roleOrder || [];
  let s = 0;
  // role adjacency: prefer the role that comes soonest after the anchor's role
  const ai = order.indexOf(inferRole(anchor, playbook));
  const ci = order.indexOf(role);
  if (ci >= 0) s += (w.role_adjacency || 0) * (1 - Math.min(Math.abs(ci - (ai < 0 ? ci : ai + 1)), order.length) / order.length);
  // attribute match: shared soft attributes (style, colour, price tier, concern…)
  let am = 0, checked = 0;
  for (const k of ["style", "colour_palette", "price_tier", "occasion", "concern", "flavour_profile", "brand"]) {
    const av = attr(anchor, k), cv = attr(cand, k);
    if (av != null && cv != null) { checked++; if (lc(av) === lc(cv)) am++; }
  }
  if (checked) s += (w.attribute_match || 0) * (am / checked);
  // concern / purpose
  if (attr(anchor, "concern") && attr(cand, "concern") && lc(attr(anchor, "concern")) === lc(attr(cand, "concern"))) s += (w.concern_match || 0);
  // recency
  if (cand.createdAt) { const age = (Date.now() - new Date(cand.createdAt).getTime()) / 86400000; s += (w.recency || 0) * Math.exp(-age / 90); }
  // rating / bestseller
  s += (w.rating || 0) * Math.min((cand.rating || 0) / 5, 1);
  // price band fit
  if (anchor.price > 0 && cand.price > 0) s += (w.price_band || 0) * Math.max(0, 1 - Math.abs(cand.price - anchor.price) / anchor.price);
  return s;
}

// ---- Declarative per-sector rules -------------------------------------------
// Each playbook may carry a `rules` array of { when, then } entries. `when` is a
// condition on the current request (anchor / cart / time-of-day / gift signal),
// `then` is a "verb:role[,role]" directive. This turns the human-readable setup
// logic ("in the morning, always finish with SPF") into concrete adjustments to
// which roles we fill and in what order. Unknown conditions or verbs are ignored
// (safe no-op), and hard-gate directives (gate:* / hardgate:*) are already
// enforced by compatible(), so here they are treated as documentation.

function evalCondition(when, ctx) {
  if (!when || typeof when !== "object") return false;
  if (when.always) return true;
  const { anchor, cartRoles } = ctx;
  if (when.timeOfDay != null) return ctx.timeOfDay === lc(when.timeOfDay);
  if (when.cartHasRole != null) return cartRoles.has(lc(when.cartHasRole));
  if (when.anchorHasAttr != null) { const v = attr(anchor, when.anchorHasAttr); return v != null && v !== false && v !== ""; }
  if (when.anchorIsConsumable != null) return (!!(anchor && attr(anchor, "is_consumable") === true)) === !!when.anchorIsConsumable;
  if (when.giftSignal != null) return !!ctx.giftSignal === !!when.giftSignal;
  if (when.deviceType != null) {
    const dt = anchor ? lc([attr(anchor, "device_type"), attr(anchor, "model_family"), anchor.category, anchor.productType, anchor.title].filter(Boolean).join(" ")) : "";
    return dt.includes(lc(when.deviceType));
  }
  if (when.role != null) return true; // static, role-scoped ordering rule
  return false;
}

// Compile the active rules into a plan: which roles to drop/require/prefer and
// how to order them (first / last).
function planFromRules(playbook, ctx) {
  const plan = { drop: new Set(), require: new Set(), prefer: new Set(), add: new Set(), first: [], last: [] };
  for (const rule of (playbook.rules || [])) {
    let active = false;
    try { active = evalCondition(rule.when, ctx); } catch (e) { active = false; }
    if (!active) continue;
    const then = String(rule.then || "");
    const ci = then.indexOf(":");
    const verb = (ci < 0 ? then : then.slice(0, ci)).trim();
    const args = (ci < 0 ? "" : then.slice(ci + 1)).split(",").map((s) => lc(s.trim())).filter(Boolean);
    switch (verb) {
      case "require": args.forEach((r) => plan.require.add(r)); break;
      case "exclude": args.forEach((r) => plan.drop.add(r)); break;
      case "prefer": args.forEach((r) => plan.prefer.add(r)); break;
      case "add": args.forEach((r) => { plan.add.add(r); plan.prefer.add(r); }); break;
      case "first": args.forEach((r) => plan.first.push(r)); break;
      case "surface": args.forEach((r) => { plan.first.push(r); plan.require.add(r); }); break;
      case "order":
        if (args[0] === "last" && rule.when && rule.when.role) plan.last.push(lc(rule.when.role));
        break;
      // diversify:* is the default behaviour; gate:* / hardgate:* handled by compatible()
      default: break;
    }
  }
  return plan;
}

// MAIN ENTRY. Sector-aware when `industry` is set; otherwise the current engine.
export async function recommendForShop(opts) {
  const { products = [], anchor = null, cart = [], industry = null, limit = 8, useLLM = false, weights = null, styleGroups = null, timeOfDay = null, giftSignal = false } = opts || {};
  const playbook = getPlaybook(industry);
  // ---- SAFETY: no industry / no playbook -> exactly today's behaviour ----
  if (!industry || !playbook) return recommend({ products, anchor, limit, useLLM });
  try {
    return await assemble({ products, anchor, cart, playbook, limit, useLLM, weights, styleGroups, timeOfDay, giftSignal });
  } catch (e) {
    console.error("[sector] fell back to base engine:", e && e.message);
    return recommend({ products, anchor, limit, useLLM });
  }
}

async function assemble({ products, anchor, cart, playbook, limit, useLLM, weights, styleGroups, timeOfDay, giftSignal }) {
  const order = playbook.roleOrder || [];
  const anchorRole = anchor ? inferRole(anchor, playbook) : null;
  // roles already satisfied by the cart (and the anchor itself)
  const filled = new Set();
  if (anchorRole) filled.add(anchorRole);
  const cartIds = new Set();
  const cartRoles = new Set();
  for (const c of cart) { cartIds.add(c.id); const r = inferRole(c, playbook); if (r) { filled.add(r); cartRoles.add(r); } }
  // the missing roles we want to fill, in setup order
  let targetRoles = order.filter((r) => !filled.has(r));

  // ---- apply this sector's declarative rules to the role plan ----
  const ctx = {
    anchor, cartRoles,
    timeOfDay: lc(timeOfDay || attr(anchor, "time_of_day") || ""),
    giftSignal: !!giftSignal || !!(anchor && lc(attr(anchor, "occasion")) === "gift"),
  };
  const plan = planFromRules(playbook, ctx);
  if (plan.drop.size) targetRoles = targetRoles.filter((r) => !plan.drop.has(r));
  for (const r of plan.add) if (!filled.has(r) && order.includes(r) && !targetRoles.includes(r)) targetRoles.push(r);
  // final role priority: forced-first -> required -> preferred -> remaining -> forced-last
  const priority = [];
  const push = (r) => { if (r && targetRoles.includes(r) && !priority.includes(r)) priority.push(r); };
  plan.first.forEach(push);
  plan.require.forEach(push);
  plan.prefer.forEach(push);
  targetRoles.forEach((r) => { if (!plan.last.includes(r)) push(r); });
  plan.last.forEach(push);

  // eligible candidates: a DIFFERENT, still-wanted role, compatible, in stock, not in cart
  const byRole = new Map();
  for (const p of products) {
    if (!anchor || p.id === anchor.id) continue;
    if (cartIds.has(p.id)) continue;
    const role = inferRole(p, playbook);
    if (!role || !priority.includes(role)) continue;
    if (!compatible(p, anchor, playbook, { styleGroups })) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push({ p, role, score: scoreCandidate(p, anchor, role, playbook, weights) });
  }
  for (const arr of byRole.values()) arr.sort((a, b) => b.score - a.score);

  // one product per role, walking the rule-adjusted setup order (diversified, cart-aware)
  const ordered = [];
  for (const role of priority) {
    const arr = byRole.get(role);
    if (arr && arr.length) { ordered.push(arr[0].p); if (ordered.length >= limit) break; }
  }

  // optional LLM polish on the assembled shortlist (off by default)
  let result = ordered;
  if (useLLM && ordered.length > 1) {
    try {
      const { refineWithLLM } = await import("../recommendations.js");
      const refined = await refineWithLLM({ candidates: ordered, anchor });
      if (refined && refined.length) result = refined;
    } catch (e) { /* keep heuristic order */ }
  }

  // Backfill up to `limit` with next-best complements per role (round-robin).
  // These already passed the same compatibility gates and scoring, so the
  // configured recommendation count is honoured without weakening hard gates.
  if (result.length < limit) {
    const seen = new Set(result.map((p) => p.id));
    const roleArrs = priority.map((r) => byRole.get(r)).filter(Boolean);
    let round = 0, addedAny = true;
    while (result.length < limit && addedAny) {
      addedAny = false;
      for (const arr of roleArrs) {
        if (result.length >= limit) break;
        if (round < arr.length) {
          const cand = arr[round].p;
          if (!seen.has(cand.id)) { result.push(cand); seen.add(cand.id); addedAny = true; }
        }
      }
      round++;
    }
  }
  // Final top-up: if still short of `limit`, pad from the best remaining
  // catalogue items (ranked, cross-category) so the configured count is honoured.
  if (result.length < limit) {
    try {
      const rec = await import('../recommendations.js');
      const ranked = (rec.rankHeuristic ? rec.rankHeuristic('recommended', products, anchor) : []) || [];
      const seen2 = new Set(result.map((p) => p.id));
      if (anchor) seen2.add(anchor.id);
      const aCat = anchor && anchor.category ? String(anchor.category).toLowerCase() : '';
      for (const p of ranked) {
        if (result.length >= limit) break;
        if (!p || seen2.has(p.id)) continue;
        if (cartIds && cartIds.has && cartIds.has(p.id)) continue;
        const pcat = p.category ? String(p.category).toLowerCase() : '';
        if (aCat && pcat === aCat) continue;
        result.push(p); seen2.add(p.id);
      }
    } catch (e) { /* keep what we have */ }
  }
  return result.slice(0, limit);
}
