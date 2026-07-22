// boko-tracker.js — durable, PER-SHOP funnel counters backed by Replit DB.
//
// Tracks lightweight events (impression / click / add_to_cart / ...) per source
// bucket (pdp | cart_drawer | sfy) per day, PER SHOP, so the dashboard can show a
// funnel over any date range without re-scanning orders.
//
// Durability / multi-tenant design:
//   - Every shop's data is namespaced:  trk:<shop>:<YYYY-MM-DD> -> { bucket:{ event:count } }
//     One store's events never touch another's (fixes the old single global key).
//   - Writes are committed to Replit DB IMMEDIATELY on every event — there is no
//     in-memory buffer or debounce, so a republish / redeploy / abrupt Autoscale
//     shutdown cannot lose buffered counts. Replit DB persists across deploys.
//   - Each write only reads+writes ONE small per-shop-per-day object, so concurrent
//     Autoscale instances can at most race on the same shop's same-day counter
//     (a rare, self-limited loss of a single increment) instead of clobbering the
//     entire global dataset the way the previous whole-object overwrite did.
//
// NOTE: Replit DB has no atomic increment, so a tiny read-modify-write race remains
// for very high-frequency events on the same shop+day. If you later need exact
// counts under heavy concurrency, move these counters to a store with atomic
// increments (e.g. Postgres `UPDATE ... SET n = n + 1`). The key scheme below maps
// cleanly onto such a table (shop, day, bucket, event, count).

import Database from "@replit/database";

const db = new Database();
const PREFIX = "trk:";

function unwrap(r) {
  if (r && typeof r === "object" && "ok" in r) return r.ok ? r.value : null;
  return r == null ? null : r;
}

function normSource(source) {
  const s = String(source || "").toLowerCase();
  if (s.indexOf("sfy") >= 0 || s.indexOf("selected-for-you") >= 0 || s.indexOf("selected_for_you") >= 0) return "sfy";
  if (s.indexOf("cart") >= 0) return "cart_drawer";
  if (s.indexOf("pdp") >= 0 || s.indexOf("product") >= 0 || s.indexOf("rail") >= 0) return "pdp";
  return "pdp";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dayKey(shop, day) {
  return PREFIX + shop + ":" + day;
}

// List all storage keys for a shop. Handles both @replit/database return styles
// (plain array of keys, or the { ok, value } wrapper).
async function listShopKeys(shop) {
  try {
    const r = await db.list(PREFIX + shop + ":");
    const v = unwrap(r);
    if (Array.isArray(v)) return v;
    if (Array.isArray(r)) return r;
    return [];
  } catch (e) {
    return [];
  }
}

// Record one event for a shop. Commits to the DB immediately (no buffering).
async function track(shop, event, source) {
  if (!shop) return;
  const bucket = normSource(source);
  const day = todayKey();
  const ev = String(event || "unknown").toLowerCase().slice(0, 40);
  const key = dayKey(shop, day);
  try {
    let obj = unwrap(await db.get(key));
    if (!obj || typeof obj !== "object") obj = {};
    if (!obj[bucket] || typeof obj[bucket] !== "object") obj[bucket] = {};
    obj[bucket][ev] = (obj[bucket][ev] || 0) + 1;
    await db.set(key, obj);
  } catch (e) {
    // Never let tracking break the request that triggered it.
  }
}

// Aggregate a shop's events over the last `days` days into { bucket: { event: count } }.
async function funnelCounts(shop, days = 30) {
  const out = { pdp: {}, cart_drawer: {}, sfy: {} };
  if (!shop) return out;
  const prefix = PREFIX + shop + ":";
  const since = new Date(Date.now() - Math.max(1, days) * 864e5).toISOString().slice(0, 10);
  const keys = (await listShopKeys(shop)).filter((k) => {
    const day = String(k).slice(prefix.length);
    return day && day >= since; // YYYY-MM-DD strings sort chronologically
  });
  await Promise.all(keys.map(async (k) => {
    try {
      const obj = unwrap(await db.get(k));
      if (!obj || typeof obj !== "object") return;
      for (const bucket of Object.keys(obj)) {
        if (!out[bucket]) out[bucket] = {};
        const evs = obj[bucket] || {};
        for (const ev of Object.keys(evs)) {
          out[bucket][ev] = (out[bucket][ev] || 0) + (Number(evs[ev]) || 0);
        }
      }
    } catch (e) {}
  }));
  return out;
}

export { track, funnelCounts, normSource };
