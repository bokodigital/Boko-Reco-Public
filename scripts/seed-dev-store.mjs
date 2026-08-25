#!/usr/bin/env node
// seed-dev-store.mjs — seed a Shopify DEVELOPMENT store with sample products and
// boko.* metafields so you can test each sector playbook end to end.
//
// SAFETY:
//   • Creates products as DRAFT (never published to a storefront).
//   • Refuses to run without --confirm.
//   • Intended for a DEVELOPMENT store only. Do not point it at a live store.
//
// Usage:
//   SHOP=your-dev-store.myshopify.com ADMIN_TOKEN=shpat_xxx \
//     node scripts/seed-dev-store.mjs --confirm [--sector Beauty] [--publish]
//
// ADMIN_TOKEN is an Admin API access token for a custom app on the DEV store with
// write_products (+ read_products). This script talks to the store's Admin API
// directly; it is a testing tool and is not part of the app runtime.

const API = "2024-10";
const SHOP = process.env.SHOP;
const TOKEN = process.env.ADMIN_TOKEN;
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const PUBLISH = args.includes("--publish");
const ONLY = (args.find((a) => a.startsWith("--sector=")) || (args.includes("--sector") ? "--sector=" + args[args.indexOf("--sector") + 1] : "")).split("=")[1];

if (!SHOP || !TOKEN) { console.error("Set SHOP and ADMIN_TOKEN env vars."); process.exit(1); }
if (!/myshopify\.com$/.test(SHOP)) { console.error("SHOP must be a *.myshopify.com domain."); process.exit(1); }
if (!CONFIRM) {
  console.error(`\nThis will create DRAFT products + metafields on:\n    ${SHOP}\nUse a DEVELOPMENT store. Re-run with --confirm to proceed.\n`);
  process.exit(1);
}

async function gql(query, variables) {
  const r = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const TEXT = new Set(["role", "price_tier", "brand", "collection", "compatibility_key", "skin_type", "time_of_day", "metal", "style", "occasion", "model_family", "connector", "os", "indoor_outdoor", "colour_palette", "handling", "concern", "flavour_profile"]);
const BOOL = new Set(["region_available", "is_consumable", "is_mixed_metal", "is_travel", "subscription_eligible", "bundle_eligible", "warranty_eligible", "in_box_charger", "age_restricted"]);
const NUM = new Set(["rating"]);
const LIST = new Set(["dietary_flags", "allergens", "compatible_models", "pairs_with", "value_flags"]);
function mfType(k) { if (BOOL.has(k)) return "boolean"; if (NUM.has(k)) return "number_decimal"; if (LIST.has(k)) return "list.single_line_text_field"; return "single_line_text_field"; }
function mfValue(k, v) { if (BOOL.has(k)) return v ? "true" : "false"; if (LIST.has(k)) return JSON.stringify(Array.isArray(v) ? v : [v]); return String(v); }

// ---- sample catalogue: anchor + complements per sector ----
const SECTORS = {
  Beauty: [
    ["Gel Cleanser", "Skincare", 28, { role: "cleanse", skin_type: "oily", time_of_day: "AM" }],
    ["Balancing Toner", "Skincare", 24, { role: "tone", skin_type: "oily" }],
    ["Vitamin C Serum", "Skincare", 45, { role: "treat", concern: "brightening", time_of_day: "AM" }],
    ["Oil-Free Moisturiser", "Skincare", 34, { role: "moisturise", skin_type: "oily" }],
    ["Daily SPF 50", "Skincare", 30, { role: "protect", spf: "50", time_of_day: "AM" }],
  ],
  Travel: [
    ["Cabin Backpack", "Bags", 120, { role: "carry", is_travel: true, brand: "Antler" }],
    ["Packing Cubes Set", "Travel Accessories", 35, { role: "pack", is_travel: true }],
    ["Toiletry Bag", "Travel Accessories", 29, { role: "organise", is_travel: true }],
    ["Luggage Tag", "Travel Accessories", 12, { role: "identify", is_travel: true }],
    ["RFID Passport Holder", "Travel Accessories", 22, { role: "secure", is_travel: true }],
  ],
  "Home & Living": [
    ["Scandi 3-Seat Sofa", "Furniture", 1200, { role: "anchor", style: "scandi", colour_palette: "neutral", indoor_outdoor: "indoor" }],
    ["Oak Coffee Table", "Furniture", 320, { role: "support", style: "scandi", indoor_outdoor: "indoor" }],
    ["Arc Floor Lamp", "Lighting", 180, { role: "lighting", style: "modern", indoor_outdoor: "indoor" }],
    ["Wool Area Rug", "Textiles", 240, { role: "textiles", style: "scandi", colour_palette: "neutral", indoor_outdoor: "indoor" }],
    ["Ceramic Vase", "Decor", 45, { role: "decor", style: "minimalist", indoor_outdoor: "indoor" }],
  ],
  Electronics: [
    ["Smartphone X15", "Phones", 999, { role: "peripheral", model_family: "x15", connector: "usb-c", os: "android", in_box_charger: false }],
    ["X15 Protective Case", "Accessories", 29, { role: "protect", compatible_models: ["x15"] }],
    ["Tempered Screen Protector", "Accessories", 15, { role: "protect", compatible_models: ["x15"] }],
    ["USB-C Fast Charger", "Accessories", 39, { role: "power", connector: "usb-c" }],
    ["Wireless Earbuds", "Audio", 129, { role: "audio", connector: "usb-c" }],
  ],
  "Food & Beverage": [
    ["Single-Origin Coffee Beans", "Coffee", 22, { role: "main", is_consumable: true, subscription_eligible: true, flavour_profile: "chocolate" }],
    ["Paper Filters", "Coffee", 8, { role: "tool" }],
    ["Ceramic Pour-Over Mug", "Coffee", 18, { role: "tool" }],
    ["Oat Milk", "Coffee", 6, { role: "accompaniment", dietary_flags: ["vegan"] }],
    ["Shortbread Biscuits", "Coffee", 9, { role: "accompaniment" }],
  ],
  Jewellery: [
    ["Gold Chain Necklace", "Jewellery", 240, { role: "necklace", metal: "gold", style: "classic", occasion: "everyday" }],
    ["Gold Stud Earrings", "Jewellery", 120, { role: "earrings", metal: "gold", style: "classic", occasion: "everyday" }],
    ["Gold Bracelet", "Jewellery", 160, { role: "bracelet", metal: "gold", style: "classic", occasion: "everyday" }],
    ["Gold Band Ring", "Jewellery", 140, { role: "ring", metal: "gold", style: "classic", occasion: "everyday" }],
    ["Jewellery Care Kit", "Jewellery", 25, { role: "care" }],
  ],
  Others: [
    ["2-Person Tent", "Camping", 220, { role: "core", compatibility_key: "camp", is_consumable: false }],
    ["Sleeping Bag", "Camping", 90, { role: "companion", compatibility_key: "camp" }],
    ["Camp Stove", "Camping", 70, { role: "accessory", compatibility_key: "camp" }],
    ["Gas Canister", "Camping", 12, { role: "consumable", compatibility_key: "camp", is_consumable: true, subscription_eligible: true }],
    ["Waterproof Cover", "Camping", 30, { role: "protection", compatibility_key: "camp" }],
  ],
};

const CREATE = `mutation($input:ProductInput!){ productCreate(input:$input){ product{ id variants(first:1){edges{node{id}}} } userErrors{ field message } } }`;
const VARPRICE = `mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid, variants:$v){ userErrors{ field message } } }`;
const MFSET = `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`;

async function seedProduct(sector, [title, ptype, price, attrs]) {
  const tags = [`boko-sector:${sector}`, `role:${attrs.role || ""}`];
  const d = await gql(CREATE, { input: { title, productType: ptype, status: PUBLISH ? "ACTIVE" : "DRAFT", tags } });
  const errs = d.productCreate.userErrors; if (errs.length) throw new Error(title + ": " + JSON.stringify(errs));
  const pid = d.productCreate.product.id;
  const vid = d.productCreate.product.variants.edges[0].node.id;
  await gql(VARPRICE, { pid, v: [{ id: vid, price: String(price) }] });
  const metafields = Object.entries(attrs).map(([k, v]) => ({ ownerId: pid, namespace: "boko", key: k, type: mfType(k), value: mfValue(k, v) }));
  metafields.push({ ownerId: pid, namespace: "boko", key: "bundle_eligible", type: "boolean", value: "true" });
  const ms = await gql(MFSET, { m: metafields });
  if (ms.metafieldsSet.userErrors.length) throw new Error(title + " mf: " + JSON.stringify(ms.metafieldsSet.userErrors));
  return title;
}

(async () => {
  const sectors = ONLY ? { [ONLY]: SECTORS[ONLY] } : SECTORS;
  if (ONLY && !SECTORS[ONLY]) { console.error("Unknown sector:", ONLY, "\nOptions:", Object.keys(SECTORS).join(", ")); process.exit(1); }
  console.log(`Seeding ${SHOP} (${PUBLISH ? "ACTIVE" : "DRAFT"} products)...\n`);
  for (const [sector, items] of Object.entries(sectors)) {
    console.log(`— ${sector}`);
    for (const it of items) {
      try { const t = await seedProduct(sector, it); console.log(`   ✓ ${t}`); }
      catch (e) { console.error(`   ✗ ${it[0]}: ${e.message}`); }
    }
  }
  console.log(`\nDone. In the dev store, set boko_industry for this shop to a sector to test it, then open a seeded product's page.`);
})();
