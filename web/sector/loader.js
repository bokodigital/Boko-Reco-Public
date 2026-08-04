// sector/loader.js
// Maps Shopify product data (with boko.* metafields) into the shape the sector
// engine expects: { id, title, price, available, region_ok, role, attrs, ... }.
// Used only on the sector path in production; the engine itself stays I/O-free.

// GraphQL fragment to fetch the boko namespace metafields for a product.
// Add this alongside the existing product fields in loadProducts when (and only
// when) the shop has an industry set. Reading product metafields needs no new
// scope beyond the app's existing read_products.
export const BOKO_METAFIELD_FRAGMENT = `
  metafields(namespace: "boko", first: 30) { edges { node { key value type } } }
`;

// Keys we treat as lists (comma-separated string OR JSON array in the metafield).
const LIST_KEYS = new Set(["compatible_models", "dietary_flags", "allergens", "avoid_allergens", "pairs_with", "value_flags"]);
// Keys we treat as booleans.
const BOOL_KEYS = new Set(["is_travel", "is_mixed_metal", "is_consumable", "subscription_eligible", "region_available", "bundle_eligible", "in_box_charger", "warranty_eligible"]);

function coerce(key, raw) {
  if (raw == null) return undefined;
  if (BOOL_KEYS.has(key)) return raw === true || /^(true|1|yes)$/i.test(String(raw));
  if (LIST_KEYS.has(key)) {
    if (Array.isArray(raw)) return raw.map((s) => String(s).trim());
    const s = String(raw).trim();
    if (s.startsWith("[")) { try { return JSON.parse(s).map((x) => String(x).trim()); } catch (e) {} }
    return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  }
  return raw;
}

// Read boko.* metafields (with a tag fallback of `boko:key:value` or `key:value`)
// into a flat attrs object. Metafield wins; tag is the fallback — same precedence
// the app already uses for its days / gift logic.
export function readBokoAttrs(product, metafieldEdges) {
  const attrs = {};
  for (const e of (metafieldEdges || [])) {
    const n = e.node || e;
    if (n && n.key) attrs[n.key] = coerce(n.key, n.value);
  }
  // tag fallback for anything the metafields didn't set
  for (const t of (product.tags || [])) {
    const m = String(t).match(/^(?:boko:)?([a-z_]+):(.+)$/i);
    if (m) { const k = m[1].toLowerCase(); if (attrs[k] === undefined) attrs[k] = coerce(k, m[2]); }
  }
  return attrs;
}

// Turn a base product (as produced by the app's loadProducts) plus its boko
// metafields into an engine-ready product.
export function toEngineProduct(baseProduct, metafieldEdges) {
  const attrs = readBokoAttrs(baseProduct, metafieldEdges);
  return {
    ...baseProduct,
    role: attrs.role || baseProduct.role || null,
    available: baseProduct.available !== false,
    region_ok: attrs.region_available !== false,
    rating: baseProduct.rating != null ? baseProduct.rating : (attrs.rating != null ? Number(attrs.rating) : 0),
    attrs,
  };
}
