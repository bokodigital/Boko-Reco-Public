// boko-tracker.js — persistent funnel counters backed by Replit DB.
// Tracks lightweight events (impression / click / add_to_cart / ...) per source
// bucket (pdp | cart_drawer | sfy) per day, so the dashboard can show a funnel
// over any date range without re-scanning orders.

import Database from "@replit/database";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const db = new Database();
const KEY = "boko_track";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_FILE = path.join(__dirname, "boko-track.json");
const SAVE_DELAY_MS = 4000;

let state = { pdp: {}, cart_drawer: {}, sfy: {} };
let loaded = false;
let loadingPromise = null;
let dirty = false;
let saveTimer = null;

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

async function loadState() {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    let fromDb = null;
    try { fromDb = unwrap(await db.get(KEY)); } catch (e) {}
    if (fromDb && typeof fromDb === "object" && Object.keys(fromDb).length) {
      state = fromDb;
    } else {
      try {
        if (fs.existsSync(LEGACY_FILE)) {
          const raw = fs.readFileSync(LEGACY_FILE, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") { state = parsed; dirty = true; }
        }
      } catch (e) {}
    }
    if (!state.pdp) state.pdp = {};
    if (!state.cart_drawer) state.cart_drawer = {};
    if (!state.sfy) state.sfy = {};
    loaded = true;
  })();
  return loadingPromise;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await flush();
  }, SAVE_DELAY_MS);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}

async function flush() {
  if (!dirty) return;
  dirty = false;
  try { await db.set(KEY, state); } catch (e) {}
}

async function track(event, source) {
  await loadState();
  const bucket = normSource(source);
  const day = todayKey();
  const ev = String(event || "unknown").slice(0, 40);
  if (!state[bucket]) state[bucket] = {};
  if (!state[bucket][day]) state[bucket][day] = {};
  state[bucket][day][ev] = (state[bucket][day][ev] || 0) + 1;
  dirty = true;
  scheduleSave();
}

async function funnelCounts(days = 30) {
  await loadState();
  const since = new Date(Date.now() - Math.max(1, days) * 864e5).toISOString().slice(0, 10);
  const out = {};
  for (const bucket of Object.keys(state)) {
    const totals = {};
    const byDay = state[bucket] || {};
    for (const day of Object.keys(byDay)) {
      if (day < since) continue;
      const dayData = byDay[day] || {};
      for (const ev of Object.keys(dayData)) {
        totals[ev] = (totals[ev] || 0) + dayData[ev];
      }
    }
    out[bucket] = totals;
  }
  return out;
}

async function shutdownFlush() {
  try { await flush(); } catch (e) {}
}
process.on("SIGTERM", async () => { await shutdownFlush(); process.exit(0); });
process.on("SIGINT", async () => { await shutdownFlush(); process.exit(0); });

export { track, funnelCounts, normSource };
