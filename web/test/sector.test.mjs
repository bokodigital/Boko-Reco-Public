// Unit tests for the sector engine. Run: node test/sector.test.mjs
import { recommendForShop, inferRole, compatible, getPlaybook } from "../sector/engine.js";
import { recommend } from "../recommendations.js";

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("  FAIL:", msg); } }
const ids = (arr) => arr.map((p) => p.id);
const now = Date.now();
const day = 86400000;
const P = (id, o = {}) => ({ id, title: o.title || ("P" + id), price: o.price || 50, category: o.category || "", tags: o.tags || [], createdAt: new Date(now - (o.age || id) * day).toISOString(), available: o.available !== false, region_ok: o.region_ok !== false, role: o.role || null, rating: o.rating || 0, attrs: o.attrs || {} });

// ---------- 1. SAFETY: no industry => identical to the current engine ----------
{
  const products = Array.from({ length: 10 }, (_, i) => P(i + 1, { category: ["a", "b", "c"][i % 3], age: i }));
  const anchor = { id: 99, title: "Anchor", price: 55, category: "a", tags: [] };
  const base = await recommend({ products, anchor, limit: 6, useLLM: false });
  const via = await recommendForShop({ products, anchor, limit: 6, useLLM: false }); // industry unset
  ok(JSON.stringify(ids(base)) === JSON.stringify(ids(via)), "no industry -> identical to recommend()");
  const viaNull = await recommendForShop({ products, anchor, industry: "NotASector", limit: 6 });
  ok(JSON.stringify(ids(base)) === JSON.stringify(ids(viaNull)), "unknown industry -> falls back to recommend()");
}

// ---------- 2. Beauty: fills later routine steps, never a second same-role ----------
{
  const anchor = P(1, { role: "cleanse", title: "Gel Cleanser", attrs: { skin_type: "oily" } });
  const products = [
    P(2, { role: "cleanse", title: "Cream Cleanser" }),            // same role -> must NOT appear
    P(3, { role: "tone", title: "Toner" }),
    P(4, { role: "treat", title: "Vitamin C Serum" }),
    P(5, { role: "moisturise", title: "Gel Moisturiser" }),
    P(6, { role: "protect", title: "SPF 50" }),
  ];
  const r = await recommendForShop({ products, anchor, industry: "Beauty", limit: 8 });
  ok(!ids(r).includes(2), "beauty: excludes a second cleanser (same role)");
  ok(ids(r).includes(3) && ids(r).includes(5) && ids(r).includes(6), "beauty: fills tone/moisturise/protect");
  ok(new Set(r.map((p) => p.role)).size === r.length, "beauty: one product per role");
}

// ---------- 3. Beauty cart-aware: skip a role already in the cart ----------
{
  const anchor = P(1, { role: "cleanse", title: "Cleanser" });
  const cart = [P(5, { role: "moisturise", title: "Moisturiser (in cart)" })];
  const products = [P(3, { role: "tone" }), P(5, { role: "moisturise" }), P(6, { role: "protect" })];
  const r = await recommendForShop({ products, anchor, cart, industry: "Beauty", limit: 8 });
  ok(!ids(r).includes(5), "cart-aware: does not re-recommend the cart's moisturiser");
  ok(ids(r).includes(6), "cart-aware: still fills the missing protect role");
}

// ---------- 4. Electronics: compatibility is a HARD gate ----------
{
  const anchor = P(1, { role: "peripheral", title: "iPhone 15", attrs: { model_family: "iphone-15", connector: "usb-c", os: "ios" } });
  const products = [
    P(2, { role: "protect", title: "iPhone 15 Case", attrs: { compatible_models: ["iphone-15"] } }),   // fits -> keep
    P(3, { role: "protect", title: "Galaxy Case", attrs: { compatible_models: ["galaxy-s24"] } }),      // wrong model -> drop
    P(4, { role: "power", title: "USB-C Cable", attrs: { connector: "usb-c" } }),                       // matches -> keep
    P(5, { role: "power", title: "Lightning Cable", attrs: { connector: "lightning" } }),               // wrong port -> drop
  ];
  const r = await recommendForShop({ products, anchor, industry: "Electronics", limit: 8 });
  ok(ids(r).includes(2) && !ids(r).includes(3), "electronics: keeps fitting case, drops wrong-model case");
  ok(ids(r).includes(4) && !ids(r).includes(5), "electronics: keeps USB-C cable, drops Lightning cable");
}

// ---------- 5. Jewellery: metal gate, relaxed only for mixed-metal ----------
{
  const anchor = P(1, { role: "necklace", title: "Gold Necklace", attrs: { metal: "gold", style: "classic" } });
  const products = [
    P(2, { role: "earrings", title: "Gold Earrings", attrs: { metal: "gold", style: "classic" } }),      // keep
    P(3, { role: "bracelet", title: "Silver Bracelet", attrs: { metal: "silver", style: "classic" } }),  // drop (metal)
    P(4, { role: "ring", title: "Mixed Ring", attrs: { metal: "silver", is_mixed_metal: true, style: "classic" } }), // keep (mixed)
  ];
  const r = await recommendForShop({ products, anchor, industry: "Jewellery", limit: 8 });
  ok(ids(r).includes(2), "jewellery: keeps same-metal earrings");
  ok(!ids(r).includes(3), "jewellery: drops mismatched-metal bracelet");
  ok(ids(r).includes(4), "jewellery: allows mixed-metal piece");
}

// ---------- 6. Food & Beverage: dietary hard gate ----------
{
  const anchor = P(1, { role: "main", title: "Vegan Pasta", attrs: { dietary_flags: ["vegan"] } });
  const products = [
    P(2, { role: "pairing", title: "Vegan Sauce", attrs: { dietary_flags: ["vegan"] } }),   // keep
    P(3, { role: "accompaniment", title: "Parmesan", attrs: { dietary_flags: [] } }),        // drop (not vegan)
  ];
  const r = await recommendForShop({ products, anchor, industry: "Food & Beverage", limit: 8 });
  ok(ids(r).includes(2) && !ids(r).includes(3), "food: vegan anchor never pulls non-vegan");
}

// ---------- 7. Role inference from title when no metafield role ----------
{
  const pb = getPlaybook("Travel");
  ok(inferRole({ title: "Anti-theft Backpack" }, pb) === "carry", "infer: backpack -> carry");
  ok(inferRole({ title: "Packing Cubes Set" }, pb) === "pack", "infer: packing cubes -> pack");
}

// ---------- 8. Never returns more than limit; one-per-role ----------
{
  const anchor = P(1, { role: "carry", title: "Backpack", attrs: { is_travel: true } });
  const products = Array.from({ length: 8 }, (_, i) => P(i + 2, { role: ["pack", "organise", "secure", "power", "comfort"][i % 5], title: "T" + i, attrs: { is_travel: true } }));
  const r = await recommendForShop({ products, anchor, industry: "Travel", limit: 4 });
  ok(r.length <= 4, "respects limit");
  ok(new Set(r.map((p) => p.role)).size === r.length, "travel: one product per role");
}

// ---------- 9. Beauty rules: time-of-day drives SPF ----------
{
  const anchor = P(1, { role: "cleanse", title: "Cleanser", attrs: { skin_type: "normal" } });
  const products = [P(3, { role: "tone" }), P(5, { role: "moisturise" }), P(6, { role: "protect", title: "SPF 50" })];
  const pm = await recommendForShop({ products, anchor, industry: "Beauty", limit: 8, timeOfDay: "PM" });
  ok(!ids(pm).includes(6), "beauty PM: excludes SPF/protect at night");
  const am = await recommendForShop({ products, anchor, industry: "Beauty", limit: 8, timeOfDay: "AM" });
  ok(ids(am).includes(6), "beauty AM: keeps SPF/protect in the morning");
}

// ---------- 10. Beauty rules: anchor already has SPF -> no separate protect ----------
{
  const anchor = P(1, { role: "moisturise", title: "Day Cream", attrs: { spf: "30" } });
  const products = [P(3, { role: "tone" }), P(6, { role: "protect", title: "SPF 50" })];
  const r = await recommendForShop({ products, anchor, industry: "Beauty", limit: 8 });
  ok(!ids(r).includes(6), "beauty: anchor with SPF suppresses a separate protect step");
}

// ---------- 11. Food & Beverage rules: consumable anchor surfaces the refill ----------
{
  const anchor = P(1, { role: "main", title: "Coffee Beans", attrs: { is_consumable: true, dietary_flags: [] } });
  const products = [
    P(2, { role: "tool", title: "Filters" }),
    P(3, { role: "refill", title: "Value Pack", attrs: { dietary_flags: [] } }),
    P(4, { role: "accompaniment", title: "Biscuits", attrs: { dietary_flags: [] } }),
  ];
  const r = await recommendForShop({ products, anchor, industry: "Food & Beverage", limit: 1 });
  ok(ids(r).includes(3), "food: consumable anchor surfaces the refill first (limit 1)");
}

// ---------- 12. Jewellery rules: gift signal surfaces gift + care ----------
{
  const anchor = P(1, { role: "necklace", title: "Gold Necklace", attrs: { metal: "gold", style: "classic" } });
  const products = [
    P(2, { role: "earrings", attrs: { metal: "gold", style: "classic" } }),
    P(3, { role: "bracelet", attrs: { metal: "gold", style: "classic" } }),
    P(7, { role: "gift", title: "Gift Box" }),
    P(8, { role: "care", title: "Care Kit" }),
  ];
  const withGift = await recommendForShop({ products, anchor, industry: "Jewellery", limit: 2, giftSignal: true });
  ok(ids(withGift).includes(7) && ids(withGift).includes(8), "jewellery: gift signal surfaces gift+care first");
  const noGift = await recommendForShop({ products, anchor, industry: "Jewellery", limit: 2, giftSignal: false });
  ok(!ids(noGift).includes(7) && !ids(noGift).includes(8), "jewellery: without gift signal, jewellery pieces come first");
}

// ---------- 13. Home & Living rules: decor is ordered last ----------
{
  const anchor = P(1, { role: "anchor", title: "Sofa", attrs: { style: "scandi", colour_palette: "neutral", indoor_outdoor: "indoor" } });
  const products = [
    P(2, { role: "support", title: "Coffee Table", attrs: { style: "scandi", indoor_outdoor: "indoor" } }),
    P(3, { role: "lighting", title: "Floor Lamp", attrs: { style: "modern", indoor_outdoor: "indoor" } }),
    P(4, { role: "decor", title: "Vase", attrs: { style: "minimalist", indoor_outdoor: "indoor" } }),
  ];
  const r = await recommendForShop({ products, anchor, industry: "Home & Living", limit: 2 });
  ok(ids(r).includes(2) && ids(r).includes(3), "home: fills support + lighting first");
  ok(!ids(r).includes(4), "home: decor ordered last (dropped when limit is tight)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
