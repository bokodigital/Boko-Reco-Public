// boko-settings.js — merchant customizer settings, backed by Replit DB.
// Shape: { global:{ excludedCollections:[gid,...] }, rail:{...}, cart:{...}, sfy:{...} }
// Each component (rail = product rail, cart = cart drawer carousel, sfy = Selected For You)
// shares the same field set so the dashboard Customizer can render one form per component.

import Database from "@replit/database";

const db = new Database();
const KEY = "boko_settings";

function componentDefaults() {
  return {
    headingFont: "assistant_n4",
    bodyFont: "assistant_n4",
    headingSize: 24,
    titleSize: 13,
    priceSize: 13,
    headingColor: "#1f1f1f",
    titleColor: "#1f1f1f",
    priceColor: "#1f1f1f",
    saleColor: "#8a8a8a",
    addBg: "#1f1f1f",
    addText: "#ffffff",
    count: 8,
    columns: 4,
  };
}

function defaults() {
  return {
    global: { excludedCollections: [], bundle: { enabled: false, percentage: 10, minItems: 2 } },
    rail: componentDefaults(),
    cart: componentDefaults(),
    sfy: componentDefaults(),
  };
}

function unwrap(r) {
  if (r && typeof r === "object" && "ok" in r) return r.ok ? r.value : null;
  return r == null ? null : r;
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    if (isPlainObject(patch[key]) && isPlainObject(base[key])) {
      out[key] = mergeDeep(base[key], patch[key]);
    } else if (patch[key] !== undefined) {
      out[key] = patch[key];
    }
  }
  return out;
}

async function loadSettings() {
  try {
    const raw = unwrap(await db.get(KEY));
    if (isPlainObject(raw)) return mergeDeep(defaults(), raw);
  } catch (e) {}
  return defaults();
}

async function saveSettings(next) {
  const current = await loadSettings();
  const merged = mergeDeep(current, next || {});
  await db.set(KEY, merged);
  return merged;
}

// Only fields the storefront actually needs are exposed — this seam keeps any
// future private/admin-only fields from leaking through the public app proxy.
function publicConfig(s) {
  const settings = s || defaults();
  return {
    global: { excludedCollections: (settings.global && settings.global.excludedCollections) || [], design: (settings.global && settings.global.design) || {}, bundle: { enabled: !!(settings.global && settings.global.bundle && settings.global.bundle.enabled), percentage: (settings.global && settings.global.bundle && settings.global.bundle.percentage) || 0, minItems: (settings.global && settings.global.bundle && settings.global.bundle.minItems) || 2 } },
    rail: settings.rail,
    cart: settings.cart,
    sfy: settings.sfy,
  };
}

// Resolves collection handles (as configured on a block, or passed via ?exclude=)
// to their collection GIDs using an already-fetched handle->gid index (see
// loadProducts' `collectionsIndex`), avoiding an extra Admin API round trip.
function handlesToCollectionGids(handles, index) {
  const map = index || {};
  return (handles || [])
    .map((h) => String(h || "").trim())
    .filter(Boolean)
    .map((h) => map[h])
    .filter(Boolean);
}

export { loadSettings, saveSettings, publicConfig, handlesToCollectionGids, defaults };
