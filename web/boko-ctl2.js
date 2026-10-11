// boko-ctl2.js - "Complete the Look" v2 engine + colour coordination (Boko AI Recommendations, multi-tenant Live app)
//
// Registers ONE storefront route:  GET /proxy/ctl   (storefront: /apps/reco/ctl via the signed App Proxy)
// /proxy/recommend, the AI Recommendations rail, the cart drawer, Klaviyo and /stats are NOT changed.
//
// Spec: "boko-complete-the-look-logic-v2-with-color.md" (approved).
//   - slot templates per collection; sec.2 non-negotiables (stock, curvy 12+, lounge/sleep containment,
//     formal elevation, denim jacket casual-only, never self / colour variant, one per slot)
//   - colour layer: family / temperature / brightness, pairing ladder, clash guard, 1 accent on a bold
//     anchor, 3-colour rule, one metal, one print per look, missing colour = neutral-eligible (QA flag)
//   - ranking: new arrival -> best seller -> colour harmony -> closest price -> newest
//
// Multi-tenant: products are mapped to canonical outfit categories from their collection handles,
// product type, title and tags, so it works for any fashion store (not only Venom's collection names).
// Applies to FASHION shops (business category Fashion / unset). Shops with a sector category
// (Beauty, Electronics, Jewellery ...) are handed to the existing /proxy/recommend logic unchanged.
// Safe to remove: delete the import + mountCtl2(...) line in server.js.

/* ===== ENGINE START (pure, no I/O) ===== */

// ---------- colour map ----------
const FAMILIES = ["red", "orange", "yellow", "green", "blue", "purple", "pink"]; // colour wheel (cyclic)
const COMPLEMENT = { blue: "orange", orange: "blue", red: "green", green: "red", pink: "green", yellow: "purple", purple: "yellow" };

// keyword -> [family, temperature (w|c|b=bridge), brightness (p|m|B), metal?]
const COLOR_WORDS = [
  ["rose gold", "metallic", "w", "m", "rose-gold"], ["gold", "metallic", "w", "m", "gold"], ["silver", "metallic", "c", "m", "silver"],
  ["bronze", "metallic", "w", "m", "gold"], ["champagne", "metallic", "w", "p", "gold"], ["pearl", "neutral", "b", "p"],
  ["crystal", "metallic", "c", "m", "silver"], ["graphite", "neutral", "c", "m"], ["pewter", "metallic", "c", "m", "silver"],
  ["black", "neutral", "b", "m"], ["nero", "neutral", "b", "m"], ["white", "neutral", "b", "p"], ["ivory", "neutral", "b", "p"],
  ["off white", "neutral", "b", "p"], ["milk", "neutral", "b", "p"], ["cream", "neutral", "w", "p"], ["oat", "neutral", "w", "p"],
  ["oatmeal", "neutral", "w", "p"], ["tobacco", "neutral", "w", "m"], ["rosewood", "pink", "w", "m"],
  ["natural", "neutral", "w", "p"], ["ecru", "neutral", "w", "p"], ["vanilla", "neutral", "w", "p"], ["bone", "neutral", "w", "p"],
  ["dark chocolate", "neutral", "w", "m"], ["chocolate", "neutral", "w", "m"], ["choc", "neutral", "w", "m"], ["brown", "neutral", "w", "m"],
  ["mocha", "neutral", "w", "m"], ["latte", "neutral", "w", "p"], ["coffee", "neutral", "w", "m"], ["espresso", "neutral", "w", "m"],
  ["tan", "neutral", "w", "m"], ["camel", "neutral", "w", "m"], ["beige", "neutral", "w", "p"], ["nude", "neutral", "w", "p"],
  ["sand", "neutral", "w", "p"], ["stone", "neutral", "w", "p"], ["taupe", "neutral", "w", "p"], ["mushroom", "neutral", "w", "p"],
  ["almond", "neutral", "w", "p"], ["desert", "neutral", "w", "p"], ["khaki", "neutral", "w", "m"], ["coconut", "neutral", "w", "p"],
  ["biscuit", "neutral", "w", "p"], ["tort", "neutral", "w", "m"], ["tortoiseshell", "neutral", "w", "m"], ["walnut", "neutral", "w", "m"],
  ["cognac", "neutral", "w", "m"],
  ["charcoal", "neutral", "c", "m"], ["grey", "neutral", "c", "m"], ["gray", "neutral", "c", "m"], ["marle", "neutral", "c", "m"],
  ["smoke", "neutral", "c", "m"], ["navy", "neutral", "c", "m"], ["denim", "neutral", "c", "m"], ["indigo", "neutral", "c", "m"],
  ["wash", "neutral", "c", "m"], ["chambray", "neutral", "c", "m"],
  ["burgundy", "red", "w", "m"], ["wine", "red", "w", "m"], ["red wine", "red", "w", "m"], ["maroon", "red", "w", "m"],
  ["cherry", "red", "w", "B"], ["ruby", "red", "w", "B"], ["brick", "red", "w", "m"], ["red", "red", "w", "B"], ["berry", "red", "c", "m"],
  ["scarlet", "red", "w", "B"], ["pomodoro", "red", "w", "B"],
  ["terracotta", "orange", "w", "m"], ["rust", "orange", "w", "m"], ["ginger", "orange", "w", "m"], ["copper", "orange", "w", "m"],
  ["tangarine", "orange", "w", "B"], ["tangerine", "orange", "w", "B"], ["clementine", "orange", "w", "B"], ["orange", "orange", "w", "B"],
  ["coral", "orange", "w", "B"], ["apricot", "orange", "w", "p"], ["peach", "orange", "w", "p"], ["melon", "orange", "w", "p"],
  ["mustard", "yellow", "w", "m"], ["lemon", "yellow", "w", "p"], ["butter", "yellow", "w", "p"], ["yellow", "yellow", "w", "B"],
  ["olive", "green", "w", "m"], ["moss", "green", "w", "m"], ["sage", "green", "c", "p"], ["pistachio", "green", "w", "p"],
  ["mint", "green", "c", "p"], ["lime", "green", "w", "B"], ["emerald", "green", "c", "B"], ["forest", "green", "c", "m"],
  ["jade", "green", "c", "m"], ["teal", "blue", "c", "m"], ["petrol", "blue", "c", "m"], ["green", "green", "c", "m"],
  ["aqua", "blue", "c", "m"], ["acqua", "blue", "c", "m"], ["turquoise", "blue", "c", "B"], ["torquo", "blue", "c", "B"],
  ["cobalt", "blue", "c", "B"], ["royal", "blue", "c", "B"], ["electric", "blue", "c", "B"], ["bright blue", "blue", "c", "B"],
  ["peacock", "blue", "c", "B"], ["ocean", "blue", "c", "m"], ["sky", "blue", "c", "p"], ["baby blue", "blue", "c", "p"],
  ["cornflower", "blue", "c", "m"], ["dusty blue", "blue", "c", "p"], ["powder", "blue", "c", "p"], ["blue", "blue", "c", "m"],
  ["lilac", "purple", "c", "p"], ["lavender", "purple", "c", "p"], ["violet", "purple", "c", "B"], ["plum", "purple", "c", "m"],
  ["purple", "purple", "c", "m"], ["mauve", "purple", "c", "p"], ["magenta", "pink", "c", "B"],
  ["hot pink", "pink", "c", "B"], ["fuscia", "pink", "c", "B"], ["fuchsia", "pink", "c", "B"], ["baby pink", "pink", "c", "p"],
  ["pale pink", "pink", "c", "p"], ["blush", "pink", "w", "p"], ["rose", "pink", "w", "m"], ["pink", "pink", "c", "m"],
  ["dusty pink", "pink", "w", "p"],
];
COLOR_WORDS.sort((a, b) => b[0].length - a[0].length); // "rose gold" beats "rose"
const PRINT_RE = /\b(print|floral|flower|stripe|striped|stripes|dots?|spot|check|checkered|plaid|tartan|gingham|paisley|geometric|tweed|marble|daisy|heart|fruit|books|birds?|dragonfly|tulip|multi|multicolou?r|mix|patchwork|tie.?dye|camo|abstract)\b/;
const ANIMAL_RE = /\b(leo|leopard|animal|zebra|snake|python|croc|cheetah|tiger|cow)\b/;
const TITLE_PRINT_RE = /\b(print|printed|floral|stripe|striped|stripes|polka|dot|dots|check|checked|checkered|plaid|tartan|gingham|paisley|leopard|leo|animal|zebra|snake|tie dye|camo|houndstooth|geometric)\b/;
const _colorCache = new Map();

// No Colour option -> read an explicit colour / print word from the title. Otherwise colour stays missing.
function colorFromTitle(title) {
  const s = " " + String(title || "").toLowerCase().replace(/[^a-z ]+/g, " ") + " ";
  const animal = s.match(ANIMAL_RE); if (animal) return animal[1];
  let best = null, pos = Infinity;
  for (const w of COLOR_WORDS) { const i = s.indexOf(" " + w[0] + " "); if (i >= 0 && i < pos) { best = w[0]; pos = i; } }
  if (best) return best;
  const pr = s.match(PRINT_RE); return pr && !/^(multi|mix|heart|books|birds?|fruit)$/.test(pr[1]) ? pr[1] : "";
}
function colorInfo(raw) {
  const s = String(raw || "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return { family: null, temp: null, bright: null, metal: null, print: false, animal: false, missing: true, raw: "" };
  if (_colorCache.has(s)) return _colorCache.get(s);
  if (/\b(wash|washed|denim|chambray|acid|stonewash)\b/.test(s) && !PRINT_RE.test(s) && !/\//.test(s)) { // denim washes pair like neutrals
    const d = { family: "neutral", temp: "c", bright: "m", metal: null, print: false, animal: false, missing: false, raw: s };
    _colorCache.set(s, d); return d;
  }
  const animal = ANIMAL_RE.test(s);
  const print = animal || PRINT_RE.test(s) || /\//.test(s) || /\b(b&w|&)\b/.test(s);
  let best = null, bestPos = Infinity, outTwo = false;
  for (const w of COLOR_WORDS) {
    const m = new RegExp("(^|[^a-z])" + w[0] + "([^a-z]|$)").exec(s);
    if (m && m.index < bestPos) { best = w; bestPos = m.index; }
  }
  if (best && !print) {
    for (const w of COLOR_WORDS) {
      if (w[1] === "metallic" || w[1] === best[1] || best[0].includes(w[0]) || w[0].includes(best[0])) continue;
      if (new RegExp("(^|[^a-z])" + w[0] + "([^a-z]|$)").test(s) && !(w[1] === "neutral" && best[1] === "neutral")) { outTwo = true; break; }
    }
  }
  let out;
  if (animal) out = { family: "neutral", temp: "w", bright: "m", metal: null, print: true, animal: true };
  else if (best) out = { family: best[1], temp: best[2], bright: best[3], metal: best[4] || null, print, animal: false };
  else if (print) out = { family: "multi", temp: "b", bright: "m", metal: null, print: true, animal: false };
  else out = { family: null, temp: null, bright: null, metal: null, print: false, animal: false, missing: true };
  if (best && /\b(multi|multicolou?r)\b/.test(s) && !/^(black|white|navy|cream)/.test(s)) out.print = true;
  if (outTwo) out.print = true;
  out.raw = s; out.missing = !!out.missing;
  if (/\b(bright|neon|hot|electric|vivid)\b/.test(s)) out.bright = "B";
  if (/\b(pale|pastel|baby|dusty|soft|light)\b/.test(s) && out.bright === "B") out.bright = "m";
  _colorCache.set(s, out);
  return out;
}
const isNeutralish = ci => !ci || ci.missing || ci.family === "neutral" || ci.family === "metallic";

// pairing ladder (sec.4.2). "weak" pairings are used only when nothing better fills the slot (sorted below
// neutral / tonal / analogous / complementary, above clashes) - sec.4.2 step 5.
// pairing ladder (sec.4.2): candidate colour vs anchor colour -> rule + score
function colorRule(a, c) {
  if (!c || c.missing) return { rule: "neutral", score: 3, missing: true };
  if (a && a.print && c.print) return { rule: "clash", score: 0, why: "print_on_print" };
  if (!a || a.missing) return { rule: isNeutralish(c) ? "neutral" : "weak", score: isNeutralish(c) ? 3 : 2 };
  if (c.family === "metallic") return { rule: "neutral", score: 3 };
  if (isNeutralish(c) || isNeutralish(a)) return { rule: "neutral", score: 3 };
  if (a.family === "multi" || c.family === "multi") return { rule: "weak", score: 1 };
  if (c.family === a.family) return { rule: "tonal", score: 3 };
  const ia = FAMILIES.indexOf(a.family), ic = FAMILIES.indexOf(c.family);
  const d = Math.min((ia - ic + 7) % 7, (ic - ia + 7) % 7);
  if (d === 1) return { rule: "analogous", score: 2 };
  if (COMPLEMENT[a.family] === c.family) return { rule: "complementary_accent", score: 2 };
  if (a.bright === "B" && c.bright === "B" && a.temp !== c.temp && a.temp !== "b" && c.temp !== "b")
    return { rule: "clash", score: 0, why: "bold_opposite_temp" };
  return { rule: "weak", score: 1 };
}

// ---------- canonical outfit categories (multi-tenant) ----------
// Each product gets canonical category keys derived from its collection handles, product type, title and tags.
const HANDLE_ALIAS = {
  "jewellery": "jewelry", "jewelry": "jewelry", "outerwear": "coats-and-jackets", "coats": "coats-and-jackets", "jackets": "coats-and-jackets",
  "coats-jackets": "coats-and-jackets", "coats-and-jackets": "coats-and-jackets", "blazers": "coats-and-jackets",
  "tees": "t-shirts", "t-shirts": "t-shirts", "trousers": "pants", "pants": "pants", "jeans": "denim", "denim": "denim",
  "knitwear": "knits", "knits": "knits", "cardigans": "cardigans", "footwear": "shoes", "shoes": "shoes", "hats": "headwear", "headwear": "headwear",
  "handbags": "bags", "bags": "bags", "belts": "belts", "scarves": "scarves", "sunglasses": "sunglasses", "skirts": "skirts", "shorts": "shorts",
  "shirts": "shirts", "tops": "tops", "dresses": "dresses", "jumpsuits": "jumpsuits", "playsuits": "jumpsuits", "sleepwear": "sleepwear",
  "intimates": "intimates", "lingerie": "intimates", "loungewear": "lounge-tops", "homewares": "homewares", "home": "homewares",
  "hair-accessories": "hair-accessories", "formal-dresses": "formal-dresses", "maxi-dresses": "maxi-dresses", "mini-dresses": "mini-dresses",
  "midi-dresses": "midi-dresses", "casual-dresses": "casual-dresses", "smock-dresses": "smock-dresses", "womens-denim-jackets": "womens-denim-jackets",
  "denim-jackets": "womens-denim-jackets", "special-occassion-dresses": "special-occassion-dresses", "special-occasion-dresses": "formal-dresses",
  "curvy-dresses": "curvy-dresses", "curvy-tops": "curvy-tops", "curvy-knits": "curvy-knits",
  "lounge-tops": "lounge-tops", "lounge-tees": "lounge-tees", "lounge-pants": "lounge-pants", "lounge-joggers": "lounge-joggers", "lounge-knits": "lounge-knits",
};
function dressKind(s) {
  if (/\b(gown|formal|evening|cocktail|occasion|bridesmaid|prom|wedding|ball)\b/.test(s)) return "formal-dresses";
  if (/\bmaxi\b/.test(s)) return "maxi-dresses";
  if (/\bmini\b/.test(s)) return "mini-dresses";
  if (/\bmidi\b/.test(s)) return "midi-dresses";
  if (/\bsmock\b/.test(s)) return "smock-dresses";
  return "casual-dresses";
}
function loungeKind(s) {
  if (/\b(jogger|joggers|trackpants?|track pants?|sweatpants?)\b/.test(s)) return "lounge-joggers";
  if (/\b(pant|pants|short|shorts|legging|leggings)\b/.test(s)) return "lounge-pants";
  if (/\b(tee|t-shirt|tshirt)\b/.test(s)) return "lounge-tees";
  if (/\b(knit|jumper|sweater|cardigan)\b/.test(s)) return "lounge-knits";
  return "lounge-tops";
}
// ordered: first match wins (dress before shirt, skirt/shorts/jacket before denim, apparel before accessories)
const TYPE_RULES = [
  [/\b(denim|jean)\s+jacket|\btrucker\s+jacket/, s => ["womens-denim-jackets"]],
  [/\b(sleepwear|pyjamas?|pajamas?|nightie|nightgown|nightdress|sleep\s?shirt|robe)\b/, s => ["sleepwear"]],
  [/\b(lingerie|bra|bras|bralette|briefs?|knickers|undies|intimates)\b/, s => ["intimates"]],
  [/\b(lounge|loungewear)\b/, s => [loungeKind(s)]],
  [/\b(jogger|joggers|trackpants?|sweatpants?)\b/, s => ["lounge-joggers"]],
  [/\b(dress|dresses|gown)\b/, s => [dressKind(s), "dresses"]],
  [/\b(jumpsuit|playsuit|romper|overalls?)\b/, s => ["jumpsuits"]],
  [/\b(coat|jacket|blazer|trench|puffer|parka|bomber|shacket|outerwear|gilet)\b/, s => ["coats-and-jackets"]],
  [/\b(cardigan|cardi)\b/, s => ["cardigans"]],
  [/\b(knit|knitwear|jumper|sweater|pullover|crewneck)\b/, s => ["knits"]],
  [/\b(t-shirt|tshirt|tee|tees)\b/, s => ["t-shirts"]],
  [/\b(shirt|shirts|blouse|blouses)\b/, s => ["shirts"]],
  [/\b(skirt|skirts|skort)\b/, s => ["skirts"]],
  [/\b(shorts)\b/, s => ["shorts"]],
  [/\b(jean|jeans|denim)\b/, s => ["denim"]],
  [/\b(pant|pants|trouser|trousers|legging|leggings|chino|chinos|culottes?)\b/, s => ["pants"]],
  [/\b(top|tops|cami|camisole|tank|bodysuit|singlet|tunic|bustier|corset)\b/, s => ["tops"]],
  [/\b(necklace|earrings?|bracelet|bangle|ring|rings|pendant|anklet|brooch|choker|jewellery|jewelry|cuff|hoops?|studs?)\b/, s => ["jewelry"]],
  [/\b(bag|bags|tote|clutch|crossbody|backpack|purse|wallet|satchel|handbag|pouch)\b/, s => ["bags"]],
  [/\b(belt|belts)\b/, s => ["belts"]],
  [/\b(scarf|scarves|shawl|pashmina|bandana)\b/, s => ["scarves"]],
  [/\b(sunglass|sunglasses|eyewear|shades)\b/, s => ["sunglasses"]],
  [/\b(hat|hats|cap|beanie|beret|fedora|visor|headwear)\b/, s => ["headwear"]],
  [/\b(scrunchie|headband|hair|claw|barrette)\b/, s => ["hair-accessories"]],
  [/\b(shoe|shoes|boot|boots|sandal|sandals|heel|heels|sneaker|sneakers|trainer|trainers|loafer|loafers|mule|mules|slides?|pumps?|espadrilles?|flats|ballet)\b/, s => ["shoes"]],
  [/\b(candle|homewares?|cushion|mug|diffuser|vase|throw)\b/, s => ["homewares"]],
];
function typeCats(text) {
  const s = " " + String(text || "").toLowerCase().replace(/[^a-z0-9\- ]+/g, " ") + " ";
  for (const [re, fn] of TYPE_RULES) if (re.test(s)) return fn(s);
  return [];
}
function canonicalCols(handles, productType, title, tags) {
  const out = new Set();
  const hs = (handles || []).map(h => String(h || "").toLowerCase());
  for (const h of hs) {
    out.add(h);
    if (HANDLE_ALIAS[h]) out.add(HANDLE_ALIAS[h]);
    if (/(^|-)new(-arrivals?|-in)?($|-)|just-?landed/.test(h)) out.add("new-arrivals");
    if (/best-?sell/.test(h)) out.add("best-seller");
  }
  // product type is the most reliable signal, then title, then tags
  let cats = typeCats(productType);
  if (!cats.length) cats = typeCats(title);
  if (!cats.length) cats = typeCats((tags || []).join(" "));
  // refine sub-kind with the full text (type "Dresses" + title "Evening Gown" -> formal-dresses)
  const full = " " + String((productType || "") + " " + (title || "") + " " + (tags || []).join(" ")).toLowerCase().replace(/[^a-z0-9\- ]+/g, " ") + " ";
  if (cats.includes("dresses")) {
    cats = [dressKind(full), "dresses"];
    if (hs.some(h => /formal|occasion|evening|cocktail|wedding-guest|race-?day/.test(h))) cats.push("formal-dresses");
  } else if (cats.some(c => /^lounge-/.test(c))) cats = [loungeKind(full)];
  cats.forEach(c => out.add(c));
  const tagsLc = (tags || []).map(t => String(t).toLowerCase());
  const curvy = hs.some(h => /curvy|plus-?size/.test(h)) || tagsLc.some(t => /^(curvy|plus|plus size|plus-size)$/.test(t));
  if (curvy) {
    if ([...out].some(c => /dresses$/.test(c))) out.add("curvy-dresses");
    if (out.has("tops") || out.has("shirts") || out.has("t-shirts")) out.add("curvy-tops");
    if (out.has("knits") || out.has("cardigans")) out.add("curvy-knits");
  }
  if (tagsLc.some(t => /best.?sell/.test(t))) out.add("best-seller");
  if (tagsLc.some(t => /^new( arrivals?| in)?$/.test(t))) out.add("new-arrivals");
  return [...out];
}

// ---------- slot templates (sec.3, unchanged from v1) ----------
const T = {
  dressCasual: [
    { name: "jacket", targets: ["coats-and-jackets", "womens-denim-jackets"] },
    { name: "jewelry", targets: ["jewelry"] },
    { name: "bag", targets: ["bags"] },
    { name: "accessory", targets: ["headwear", "scarves", "hair-accessories", "sunglasses"] },
  ],
  dressMaxi: [
    { name: "jacket", targets: ["coats-and-jackets"] },
    { name: "jewelry", targets: ["jewelry"] },
    { name: "bag", targets: ["bags"] },
    { name: "belt", targets: ["belts"] },
  ],
  dressFormal: [
    { name: "shoes", targets: ["shoes"] },
    { name: "jewelry", targets: ["jewelry"] },
    { name: "bag", targets: ["bags"] },
    { name: "jacket", targets: ["coats-and-jackets"] },
  ],
  topStd: [
    { name: "bottom", targets: ["skirts", "denim", "pants"] },
    { name: "accessory", targets: ["jewelry", "bags"] },
    { name: "jacket", targets: ["coats-and-jackets", "womens-denim-jackets"] },
    { name: "layer", targets: ["knits", "cardigans", "curvy-knits"] },
  ],
  knitStd: [
    { name: "bottom", targets: ["skirts", "denim", "pants"] },
    { name: "accessory", targets: ["jewelry", "scarves"] },
    { name: "jacket", targets: ["coats-and-jackets"] },
    { name: "bag", targets: ["bags"] },
  ],
  bottomStd: [
    { name: "top", targets: ["shirts", "t-shirts", "tops", "knits"] },
    { name: "accessory", targets: ["belts", "jewelry"] },
    { name: "jacket", targets: ["coats-and-jackets", "womens-denim-jackets"] },
    { name: "bag", targets: ["bags"] },
  ],
  skirtStd: [
    { name: "top", targets: ["shirts", "tops", "knits"] },
    { name: "jewelry", targets: ["jewelry"] },
    { name: "jacket", targets: ["coats-and-jackets"] },
    { name: "bag", targets: ["bags", "belts"] },
  ],
  jumpsuit: [
    { name: "jacket", targets: ["coats-and-jackets", "womens-denim-jackets"] },
    { name: "accessory", targets: ["jewelry", "belts"] },
    { name: "extra", targets: ["bags", "shoes"] },
  ],
  coats: [
    { name: "top", targets: ["shirts", "t-shirts", "tops", "knits"] },
    { name: "bottom", targets: ["denim", "pants", "skirts"] },
    { name: "accessory", targets: ["jewelry", "bags"] },
  ],
  denimJacket: [
    { name: "top", targets: ["t-shirts", "shirts", "tops", "knits"] },
    { name: "bottom", targets: ["denim", "shorts", "skirts"] },
    { name: "accessory", targets: ["jewelry", "bags"] },
  ],
  loungeTop: [{ name: "bottom", targets: ["lounge-pants", "lounge-joggers"] }, { name: "accessory", targets: ["headwear"] }],
  loungeBottom: [{ name: "top", targets: ["lounge-tops", "lounge-tees", "lounge-knits"] }],
  loungeKnit: [{ name: "bottom", targets: ["lounge-pants", "lounge-joggers"] }],
  sleep: [{ name: "sleep", targets: ["intimates", "sleepwear"] }],
  accessoryAnchor: [
    { name: "dress", targets: ["casual-dresses", "mini-dresses", "midi-dresses", "smock-dresses", "maxi-dresses"] },
    { name: "top", targets: ["knits", "shirts", "tops"] },
    { name: "bottom", targets: ["denim", "pants", "skirts"] },
  ],
};
const SOURCE_MAP = {
  "formal-dresses": "dressFormal", "special-occassion-dresses": "dressFormal",
  "curvy-dresses": "dressCasual", "maxi-dresses": "dressMaxi",
  "mini-dresses": "dressCasual", "midi-dresses": "dressCasual", "casual-dresses": "dressCasual", "smock-dresses": "dressCasual",
  "dresses": "dressCasual",
  "shirts": "topStd", "t-shirts": "topStd", "curvy-tops": "topStd", "tops": "topStd",
  "knits": "knitStd", "curvy-knits": "knitStd", "cardigans": "knitStd",
  "denim": "bottomStd", "pants": "bottomStd", "shorts": "bottomStd", "bottoms": "bottomStd",
  "skirts": "skirtStd", "jumpsuits": "jumpsuit",
  "coats-and-jackets": "coats", "womens-denim-jackets": "denimJacket",
  "lounge-tops": "loungeTop", "lounge-tees": "loungeTop", "lounge-pants": "loungeBottom", "lounge-joggers": "loungeBottom",
  "lounge-knits": "loungeKnit", "sleepwear": "sleep", "intimates": "sleep",
  "jewelry": "accessoryAnchor", "bags": "accessoryAnchor", "belts": "accessoryAnchor", "scarves": "accessoryAnchor",
  "headwear": "accessoryAnchor", "hair-accessories": "accessoryAnchor", "sunglasses": "accessoryAnchor", "shoes": "accessoryAnchor",
};
const SOURCE_PRIORITY = [
  "formal-dresses", "special-occassion-dresses", "curvy-dresses", "maxi-dresses", "mini-dresses", "midi-dresses",
  "casual-dresses", "smock-dresses", "jumpsuits",
  "lounge-tops", "lounge-tees", "lounge-pants", "lounge-joggers", "lounge-knits", "sleepwear", "intimates",
  "curvy-tops", "curvy-knits", "womens-denim-jackets", "shirts", "t-shirts", "knits", "cardigans", "tops",
  "skirts", "denim", "pants", "shorts",
  "coats-and-jackets", "dresses", "bottoms",
  "jewelry", "bags", "belts", "scarves", "headwear", "hair-accessories", "sunglasses", "shoes",
];
const LOUNGE_TPL = new Set(["loungeTop", "loungeBottom", "loungeKnit", "sleep"]);
const LOUNGE_COLS = h => /^lounge-/.test(h) || h === "sleepwear" || h === "intimates";
const MAIN_APPAREL = new Set(["tops", "shirts", "t-shirts", "knits", "cardigans", "curvy-tops", "curvy-knits", "pants", "denim",
  "skirts", "shorts", "dresses", "casual-dresses", "mini-dresses", "midi-dresses", "maxi-dresses", "smock-dresses", "curvy-dresses",
  "coats-and-jackets", "jumpsuits"]);
const FORMAL_SOURCES = new Set(["formal-dresses", "special-occassion-dresses"]);
const ELEVATED_POOL = new Set(["shoes", "jewelry", "bags", "coats-and-jackets"]);
const NEW_DAYS = 30;

// ---------- product accessors ----------
const cols = p => p.cols || [];
const inAny = (p, hs) => { const c = cols(p); for (const h of hs) if (c.includes(h)) return true; return false; };
const isNewArrival = (p, now) => cols(p).includes("new-arrivals") || (p.createdAt && now - Date.parse(p.createdAt) <= NEW_DAYS * 864e5);
const isBestSeller = p => cols(p).includes("best-seller");
const isLoungeOnly = p => cols(p).some(LOUNGE_COLS) && !cols(p).some(h => MAIN_APPAREL.has(h));
const baseTitle = t => String(t || "").toLowerCase().replace(/\s*[-–|(].*$/, "").replace(/[^a-z0-9 ]+/g, " ")
  .split(" ").filter(w => w && !COLOR_WORDS.some(c => c[0] === w)).join(" ").trim();
function metalOf(p) {
  const t = (p.title || "").toLowerCase() + " " + (p.color || "");
  if (/rose\s*gold/.test(t)) return "rose-gold";
  if (/\bgold\b/.test(t)) return "gold";
  if (/\bsilver\b|sterling/.test(t)) return "silver";
  return null;
}
function hasSize12Plus(p) {
  const sizes = p.sizes || [];
  if (!sizes.length) return true; // no size data -> can't verify, allow (QA)
  let anySmall = false, anyAmb = false;
  for (const val of sizes) {
    const nums = (String(val).match(/\d+/g) || []).map(Number).filter(n => n <= 40);
    if (nums.length) { if (Math.max(...nums) >= 12) return true; anySmall = true; continue; }
    if (/one\s*-?\s*size|^o\/?s$|free\s*size/i.test(val)) return true;
    if (/\b(l|xl|xxl|xxxl|ml|lxl|[1-4]x)\b/i.test(val)) return true;
    if (/\b(xs|s|sm)\b/i.test(val)) { anySmall = true; continue; }
    anyAmb = true;
  }
  return !(anySmall && !anyAmb);
}
function resolveTemplate(anchor) {
  const c = cols(anchor);
  for (const h of SOURCE_PRIORITY) if (c.includes(h)) return { key: SOURCE_MAP[h], source: h };
  return { key: "topStd", source: "default" };
}
function expandCurvy(targets, curvy) {
  if (!curvy) return targets;
  const out = targets.slice();
  if (out.includes("knits") && !out.includes("curvy-knits")) out.push("curvy-knits");
  if ((out.includes("shirts") || out.includes("t-shirts") || out.includes("tops")) && !out.includes("curvy-tops")) out.push("curvy-tops");
  return out;
}
function asPrintable(ci) {
  return { ...ci, print: true, missing: false, family: ci.missing ? "multi" : ci.family, temp: ci.temp || "b", bright: ci.bright || "m" };
}
function buildContext(anchor, tpl, acolorRaw) {
  const c = cols(anchor), tags = anchor.tagsLc || [];
  let ci = colorInfo(acolorRaw || anchor.color);
  if (anchor.pattern && !ci.print) ci = asPrintable(ci);
  return {
    anchorId: String(anchor.id), anchorHandle: anchor.handle, anchorPrice: anchor.price, anchorBase: baseTitle(anchor.title),
    tplKey: tpl.key, source: tpl.source,
    isFormal: c.some(h => FORMAL_SOURCES.has(h)),
    isLounge: LOUNGE_TPL.has(tpl.key),
    curvy: c.some(h => /^curvy-/.test(h)) || tags.includes("curvy") || tags.includes("plus"),
    color: ci,
    // bold colour anchor, or a (non-animal) print anchor: lead with neutrals/tonal + at most ONE accent (sec.4.3 / 4.6)
    anchorBold: !!(ci && !ci.missing && ((!isNeutralish(ci) && ci.bright === "B") || (ci.print && !ci.animal))),
  };
}

// sec.2 non-negotiables 1-8 (hard gates; colour never empties a slot, so colour is NOT here)
function allowed(p, ctx) {
  const c = cols(p);
  if (c.includes("homewares")) return false;
  if (String(p.id) === ctx.anchorId || (p.handle && p.handle === ctx.anchorHandle)) return false;
  if (ctx.anchorBase && ctx.anchorBase.length > 3 && baseTitle(p.title) === ctx.anchorBase) return false; // colour-variant of the anchor
  if (!p.available) return false;
  if (ctx.isLounge) { if (!c.some(LOUNGE_COLS)) return false; }
  else if (isLoungeOnly(p)) return false;
  if (ctx.isFormal) {
    if (!c.some(h => ELEVATED_POOL.has(h))) return false;
    if (c.includes("womens-denim-jackets") || c.includes("headwear") || c.includes("sunglasses") || c.includes("denim")) return false;
  }
  if (ctx.curvy && !hasSize12Plus(p)) return false;
  return true;
}

function newOutfit(ctx) {
  const fam = new Set();
  if (ctx.color && !isNeutralish(ctx.color) && ctx.color.family !== "multi") fam.add(ctx.color.family);
  return { families: fam, accents: 0, metal: null, prints: ctx.color && ctx.color.print ? 1 : 0 };
}
function evalColor(p, ctx, outfit) {
  let ci = colorInfo(p.color);
  if (p.pattern && !ci.print) ci = asPrintable(ci);
  const r = colorRule(ctx.color, ci);
  let blocked = r.rule === "clash", why = r.why || null;
  // an accent = any coloured (non-neutral, non-metal) item that is not tonal to the anchor
  const isAccent = !!(ci && !isNeutralish(ci) && r.rule !== "tonal");
  if (!blocked && isAccent) {
    if (ctx.anchorBold && outfit.accents >= 1) { blocked = true; why = "accent_cap"; }
    const fams = new Set(outfit.families); if (ci.family !== "multi") fams.add(ci.family);
    if (fams.size > 3) { blocked = true; why = "three_colour_rule"; }
  }
  if (!blocked && ci && ci.print && outfit.prints >= 1) { blocked = true; why = "one_print_per_look"; }
  const m = metalOf(p);
  if (!blocked && m && outfit.metal && m !== outfit.metal) { blocked = true; why = "mixed_metals"; }
  let score = r.score;
  if (m && ctx.color && !ctx.color.missing) {
    if ((m === "gold" || m === "rose-gold") && ctx.color.temp === "w") score += 0.5;
    if (m === "silver" && ctx.color.temp === "c") score += 0.5;
  }
  return { ci, rule: r.rule, score, blocked, why, isAccent, metal: m, missing: !!(ci && ci.missing) };
}
function placeInOutfit(outfit, ev) {
  if (ev.isAccent) outfit.accents++;
  if (ev.ci && !isNeutralish(ev.ci) && ev.ci.family !== "multi") outfit.families.add(ev.ci.family);
  if (ev.ci && ev.ci.print) outfit.prints++;
  if (ev.metal && !outfit.metal) outfit.metal = ev.metal;
}
function rankPool(pool, ctx, outfit, now) {
  return pool.map(p => {
    const ev = evalColor(p, ctx, outfit);
    return {
      p, ev,
      n: isNewArrival(p, now) ? 1 : 0,
      b: isBestSeller(p) ? 1 : 0,
      d: ctx.anchorPrice != null && p.price != null ? Math.abs(p.price - ctx.anchorPrice) : Infinity,
      t: p.createdAt ? Date.parse(p.createdAt) : 0,
    };
  }).sort((a, b) =>
    (a.ev.blocked - b.ev.blocked) || (a.ev.rule === "weak") - (b.ev.rule === "weak") || b.n - a.n || b.b - a.b || b.ev.score - a.ev.score || a.d - b.d || b.t - a.t);
}
function reasonFor(x) {
  if (x.n) return "new_arrival";
  if (x.b) return "best_seller";
  if (x.ev.score >= 3 && !x.ev.missing) return "color_match";
  if (isFinite(x.d)) return "price_band";
  return "category_pair";
}
function formatItem(x, slotName, targets) {
  const p = x.p;
  return {
    id: p.gid || ("gid://shopify/Product/" + p.id), handle: p.handle, variantId: p.variantId, available: true,
    title: p.title, vendor: p.vendor || "", tags: p.tags || [], category: p.category || "", price: p.price, img: p.img || "",
    options: p.options || [], variants: p.variants || [], createdAt: p.createdAt || null,
    slot: slotName, source_collection: (cols(p).find(h => targets.includes(h))) || cols(p)[0] || "",
    reason: reasonFor(x),
    color: p.color || "", color_family: x.ev.ci && !x.ev.ci.missing ? x.ev.ci.family : "unknown",
    color_rule: x.ev.blocked ? "clash" : x.ev.rule, color_note: x.ev.why || (x.ev.missing ? "missing_colour_qa" : undefined),
  };
}

/**
 * Complete the Look v2 + colour.
 * @param {Array} catalog compact products
 * @param {Object} anchor compact product being viewed
 * @param {Object} opts { total=12, days=0, acolor="" (selected variant colour), now }
 */
function completeTheLook(catalog, anchor, opts = {}) {
  const total = Number.isFinite(opts.total) ? opts.total : 12;
  const now = opts.now || Date.now();
  const tpl = resolveTemplate(anchor);
  const template = T[tpl.key];
  const ctx = buildContext(anchor, tpl, opts.acolor);
  const outfit = newOutfit(ctx);
  const used = new Set([String(anchor.id)]);
  const daysOk = p => !(opts.days > 0) || !p.createdAt || now - Date.parse(p.createdAt) <= opts.days * 864e5;
  const eligible = catalog.filter(p => allowed(p, ctx));
  const out = [];
  // Pass 1 - one pick per slot. Colour never empties a slot: blocked items only sort last.
  for (const slot of template) {
    const targets = expandCurvy(slot.targets, ctx.curvy);
    let pool = eligible.filter(p => !used.has(String(p.id)) && inAny(p, targets));
    const inWindow = pool.filter(daysOk); if (inWindow.length) pool = inWindow;
    const ranked = rankPool(pool, ctx, outfit, now);
    if (ranked.length) {
      const x = ranked[0];
      used.add(String(x.p.id)); placeInOutfit(outfit, x.ev); out.push(formatItem(x, slot.name, targets));
    }
  }
  // Pass 2 - backfill only from the outfit's own complementary categories (non-blocked first), interleaved by slot.
  if (out.length < total) {
    const all = [...new Set(template.flatMap(s => expandCurvy(s.targets, ctx.curvy)))];
    let pool = eligible.filter(p => !used.has(String(p.id)) && inAny(p, all));
    const inWindow = pool.filter(daysOk); if (inWindow.length >= total - out.length) pool = inWindow;
    const ranked = rankPool(pool, ctx, outfit, now);
    const bySlot = template.map(s => ({ s, targets: expandCurvy(s.targets, ctx.curvy), q: [] }));
    const blocked = [];
    for (const x of ranked) {
      if (x.ev.blocked) { blocked.push(x); continue; }
      const b = bySlot.find(b => inAny(x.p, b.targets)); if (b) b.q.push(x);
    }
    let added = true;
    while (out.length < total && added) {
      added = false;
      for (const b of bySlot) {
        if (out.length >= total) break;
        const x = b.q.shift(); if (!x) continue;
        used.add(String(x.p.id)); out.push(formatItem(x, b.s.name, b.targets)); added = true;
      }
    }
    // clash / over-cap items only as a last resort so the section is never near-empty
    for (const x of blocked) { if (out.length >= Math.min(total, 4)) break; out.push(formatItem(x, "more", all)); }
  }
  return {
    items: out.slice(0, total),
    meta: { template: tpl.key, source: tpl.source, curvy: ctx.curvy, formal: ctx.isFormal, lounge: ctx.isLounge,
      anchor_color: ctx.color.raw || "", anchor_family: ctx.color.missing ? "unknown" : ctx.color.family,
      anchor_bold: ctx.anchorBold, eligible: eligible.length, outfit_metal: outfit.metal, accents: outfit.accents },
  };
}

/* ===== ENGINE END ===== */

// ---------- catalogue (Shopify Bulk Operation) ----------
const COLOR_OPT = /^(colou?r|shade)$/i;
const SIZE_OPT = /size/i;
const numId = gid => { const m = String(gid || "").match(/(\d+)$/); return m ? m[1] : String(gid || ""); };

// n: product node; colls: [{id, handle}]; variants: variant nodes; options: [{name, values}]
function compactProduct(n, colls, variants, options, cp) { // BOKO CTL3LIVE: + cp = Shopify colour/pattern labels
  const tags = (n.tags || []).map(String);
  const tagsLc = tags.map(t => t.toLowerCase());
  const pt = (n.productType || "").toLowerCase();
  const handles = colls.map(c => String(c.handle || "").toLowerCase());
  if (n.isGiftCard || /gift\s*cards?/.test(pt) || tagsLc.some(t => /gift\s*cards?/.test(t)) || handles.some(h => /gift-?cards?/.test(h))) return null;
  if (!n.publishedAt) return null; // not on the online store
  const av = variants.filter(v => v.availableForSale);
  if (!av.length) return null;
  const first = av[0];
  const opt = (v, re) => { const o = (v.selectedOptions || []).find(o => re.test(o.name)); return o ? String(o.value) : ""; };
  const sizes = [...new Set(av.map(v => opt(v, SIZE_OPT)).filter(Boolean))];
  const rawOpts = (options || []).filter(o => !(o.name === "Title" && o.values && o.values.length === 1 && o.values[0] === "Default Title"));
  return {
    id: numId(n.id), gid: n.id, handle: n.handle, title: n.title, vendor: n.vendor || "", category: pt, tags, tagsLc,
    cols: canonicalCols(handles, n.productType, n.title, tags), collGids: colls.map(c => c.id).filter(Boolean),
    createdAt: n.publishedAt || n.createdAt, price: parseFloat(first.price) || 0,
    img: (n.featuredImage && n.featuredImage.url) || "", variantId: numId(first.id), available: true,
    color: shownColour(n, variants, first, opt) || colorFromTitle(n.title), sizes, // BOKO CTL3LIVE (FIX3)
    pattern: TITLE_PRINT_RE.test(String(n.title || "").toLowerCase()),
    cp: cp || [], // BOKO CTL3LIVE
    colours: (() => { const seen = new Set(), out = []; for (const v of av) { const c = opt(v, COLOR_OPT).toLowerCase(); if (!c || seen.has(c)) continue; seen.add(c); out.push({ color: c, variantId: numId(v.id), img: (v.image && v.image.url) || "", price: parseFloat(v.price) || 0 }); } return out; })(), // BOKO CTL3LIVE
    options: rawOpts.map(o => ({ name: o.name, values: o.values || [] })),
    variants: variants.map(v => ({
      id: parseInt(numId(v.id), 10), title: v.title, price: parseFloat(v.price), available: !!v.availableForSale,
      options: rawOpts.map(o => { const so = (v.selectedOptions || []).find(s => s.name === o.name); return so ? so.value : null; }),
    })),
  };
}

const BULK_QUERY = `{ products(query: "status:active") { edges { node {
  id handle title vendor productType tags createdAt publishedAt isGiftCard featuredImage { url } options { name values }
  collections { edges { node { id handle } } }
  variants { edges { node { id title price availableForSale image { url } selectedOptions { name value } } } }
} } } }`;

function parseJsonl(text) {
  const prods = new Map(), colls = new Map(), vars = new Map(), cps = new Map(); // BOKO CTL3LIVE
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    const id = String(o.id || "");
    if (!o.__parentId && id.includes("/Product/")) { prods.set(id, o); continue; }
    if (id.includes("/Collection/")) { if (!colls.has(o.__parentId)) colls.set(o.__parentId, []); colls.get(o.__parentId).push({ id, handle: o.handle }); continue; }
    if (id.includes("/Metaobject/")) { const v = o.field && o.field.value; if (v) { if (!cps.has(o.__parentId)) cps.set(o.__parentId, []); cps.get(o.__parentId).push(String(v).trim()); } continue; } // BOKO CTL3LIVE
    if (id.includes("/ProductVariant/")) { if (!vars.has(o.__parentId)) vars.set(o.__parentId, []); vars.get(o.__parentId).push(o); }
  }
  const out = [];
  for (const [id, n] of prods) { const p = compactProduct(n, colls.get(id) || [], vars.get(id) || [], n.options || [], cps.get(id) || []); if (p) out.push(p); }
  return out;
}

const ANCHOR_QUERY = `query($id: ID!) { product(id: $id) {
  id handle title vendor productType tags createdAt publishedAt isGiftCard featuredImage { url } options { name values }
  collections(first: 50) { nodes { id handle } }
  variants(first: 100) { nodes { id title price availableForSale image { url } selectedOptions { name value } } }
} }`;

/**
 * deps: { verifyProxy, getToken, gql, db, billingOK, getIndustry, loadSettings, fallback }
 *   fallback(req, res) = the existing /proxy/recommend handler (used for non-fashion shops and while the
 *   catalogue is building, so the section is never blank).
 */
// ===== BOKO CTL3LIVE: Complete the Look v3 (stylist engine, no guessing) =====
import { completeTheLook3 } from "./boko-ctl3.js";
const CTL_DEFAULT_ENGINE = 3; // 3 = stylist engine for the section + Klaviyo. Set to 2 to roll back (no other change needed).
// FIX3: judge a product by the colour its PHOTO shows (variant whose image is the featured image)
function shownColour(n, variants, first, opt) {
  const strip = u => String(u || "").split("?")[0];
  const fi = strip(n.featuredImage && n.featuredImage.url);
  if (fi) {
    const hit = (variants || []).find(v => v.image && strip(v.image.url) === fi && opt(v, COLOR_OPT));
    if (hit) return opt(hit, COLOR_OPT).toLowerCase();
  }
  return opt(first, COLOR_OPT).toLowerCase();
}
// Shopify standard category metafield "Colour/Pattern" (fills products that have no Colour option)
const CP_BULK = 'metafield(namespace: "shopify", key: "color-pattern") { references { edges { node { ... on Metaobject { id field(key: "label") { value } } } } } }';
const CP_ONE = 'metafield(namespace: "shopify", key: "color-pattern") { references(first: 10) { nodes { ... on Metaobject { id field(key: "label") { value } } } } }';
const BULK_QUERY_CP = BULK_QUERY.replace(/\}\s*\}\s*\}\s*\}\s*$/, "  " + CP_BULK + "\n} } } }");
const ANCHOR_QUERY_CP = ANCHOR_QUERY.replace(/\}\s*\}\s*$/, "  " + CP_ONE + "\n} }");
if (BULK_QUERY_CP === BULK_QUERY || ANCHOR_QUERY_CP === ANCHOR_QUERY) console.warn("[ctl3] colour/pattern query not built - check BULK_QUERY / ANCHOR_QUERY endings");
const noCp = {}; // shop -> true when Shopify refuses the colour/pattern field (plain query is used instead)
// LIVE ADD-ON 1: gender containment (mixed men's/women's stores). Women's product never gets men's-only items and vice versa.
function ctl3Gender(p) {
  const w = [...(p.tagsLc || []), ...(p.cols || [])].map(x => String(x).toLowerCase());
  const has = re => w.some(x => re.test(x));
  if (has(/(^|-)unisex($|-)/)) return "u";
  const f = has(/^(women|womens|women's|womenswear|ladies|female)$|(^|-)(women|womens|ladies)($|-)/);
  const m = has(/^(men|mens|men's|menswear|male)$|(^|-)(men|mens)($|-)/);
  return f && !m ? "f" : m && !f ? "m" : null;
}
function ctl3GenderPool(pool, anchor) {
  const g = ctl3Gender(anchor);
  if (g !== "f" && g !== "m") return pool;
  return pool.filter(p => { const pg = ctl3Gender(p); return !pg || pg === "u" || pg === g; });
}
// LIVE ADD-ON 2: the theme-app-extension block needs options/variants for size pickers; add them (with each colour's photo).
function ctl3Enrich(items, cat) {
  return items.map(it => {
    const src = cat && cat.byId && cat.byId.get(String(it.id).split("/").pop());
    if (!src || !src.variants) return it;
    const ci = (src.options || []).findIndex(o => /^(colou?r|shade)$/i.test(o.name));
    const img = {}; (src.colours || []).forEach(c => { if (c.img) img[c.color] = c.img; });
    const variants = src.variants.map(v => (ci >= 0 && v.options && img[String(v.options[ci] || "").toLowerCase()]) ? { ...v, img: img[String(v.options[ci]).toLowerCase()] } : v);
    return { ...it, options: src.options || [], variants };
  });
}
// ===== /BOKO CTL3LIVE =====

export function mountCtl2(app, { verifyProxy, getToken, gql, db, billingOK, getIndustry, loadSettings, fallback }) {
  const TTL = 30 * 60 * 1000, OP_MAX = 20 * 60 * 1000;
  const mem = {}; // shop -> { at, products, byId }
  const ops = {}; // shop -> { id, startedAt, lastPoll }
  const kCat = s => "ctl2:cat:" + s, kOp = s => "ctl2:op:" + s;
  const dbGet = async k => { try { const r = await db.get(k); if (r && typeof r === "object" && "ok" in r) return r.ok ? r.value : null; return r || null; } catch (e) { return null; } };
  const dbSet = async (k, v) => { try { await db.set(k, v); } catch (e) {} };
  const index = c => { c.byId = new Map(c.products.map(p => [p.id, p])); return c; };

  async function startOp(shop, token) {
    const j = await gql(shop, token, `mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`, { q: noCp[shop] ? BULK_QUERY : BULK_QUERY_CP }); // BOKO CTL3LIVE
    let r = j && j.data && j.data.bulkOperationRunQuery;
    if (!noCp[shop] && !(r && r.bulkOperation)) { noCp[shop] = true; const j2 = await gql(shop, token, "mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }", { q: BULK_QUERY }); r = j2 && j2.data && j2.data.bulkOperationRunQuery; }
    if (r && r.bulkOperation) { ops[shop] = { id: r.bulkOperation.id, startedAt: Date.now(), lastPoll: 0, cp: !noCp[shop] }; await dbSet(kOp(shop), ops[shop]); return ops[shop]; }
    ops[shop] = { id: null, startedAt: Date.now(), lastPoll: Date.now(), error: JSON.stringify((r && r.userErrors) || (j && j.errors) || "unknown").slice(0, 300) };
    return null;
  }
  async function pollOp(shop, token) {
    const op = ops[shop];
    if (!op || !op.id) return null;
    if (Date.now() - op.lastPoll < 2500) return null;
    op.lastPoll = Date.now();
    const j = await gql(shop, token, `query($id: ID!) { node(id: $id) { ... on BulkOperation { id status errorCode objectCount url } } }`, { id: op.id });
    const n = j && j.data && j.data.node;
    if (!n) return null;
    op.status = n.status; op.objectCount = n.objectCount;
    if (n.status === "COMPLETED") {
      let products = [];
      if (n.url) { const txt = await fetch(n.url).then(r => r.text()); products = parseJsonl(txt); }
      const cat = index({ at: Date.now(), products });
      mem[shop] = cat; delete ops[shop];
      await dbSet(kOp(shop), null);
      // Replit DB values are capped (~5MB): drop per-variant detail from the persisted copy of large catalogues
      let persist = { at: cat.at, products };
      try { if (JSON.stringify(persist).length > 4500000) persist = { at: cat.at, products: products.map(({ variants, ...p }) => p) }; } catch (e) {}
      await dbSet(kCat(shop), persist);
      return cat;
    }
    if (n.status === "FAILED" && op.cp) noCp[shop] = true; // BOKO CTL3LIVE: no access to the colour field -> plain query next time
    if (["FAILED", "CANCELED", "EXPIRED"].includes(n.status) || Date.now() - op.startedAt > OP_MAX) { delete ops[shop]; await dbSet(kOp(shop), null); }
    return null;
  }
  async function refresh(shop, token) {
    if (!ops[shop]) { const saved = await dbGet(kOp(shop)); if (saved && saved.id && Date.now() - saved.startedAt < OP_MAX) ops[shop] = { ...saved, lastPoll: 0 }; }
    const op = ops[shop];
    if (op && !op.id && Date.now() - op.startedAt < 60000) return null; // recent start error -> back off 1 min
    if (!op || !op.id) { await startOp(shop, token); return null; }
    return pollOp(shop, token);
  }
  // Freshest catalogue available now (may be stale); refreshes in the background (stale-while-revalidate).
  async function getCatalog(shop, token, waitMs) {
    if (!mem[shop]) { const saved = await dbGet(kCat(shop)); if (saved && saved.products) mem[shop] = index(saved); }
    const cat = mem[shop];
    if (cat && Date.now() - cat.at < TTL) return cat;
    const deadline = Date.now() + (cat ? 0 : waitMs);
    try {
      let fresh = await refresh(shop, token);
      while (!fresh && Date.now() < deadline) { await new Promise(r => setTimeout(r, 1500)); fresh = await refresh(shop, token); }
      if (fresh) return fresh;
    } catch (e) {}
    return cat || null;
  }
  async function fetchAnchor(shop, token, anum) {
    try {
      let j = noCp[shop] ? null : await gql(shop, token, ANCHOR_QUERY_CP, { id: "gid://shopify/Product/" + anum }); // BOKO CTL3LIVE
      if (!j || j.errors || !(j.data && j.data.product)) j = await gql(shop, token, ANCHOR_QUERY, { id: "gid://shopify/Product/" + anum });
      const n = j && j.data && j.data.product;
      if (!n) return null;
      const cpl = ((n.metafield && n.metafield.references && n.metafield.references.nodes) || []).map(x => x && x.field && x.field.value).filter(Boolean).map(v => String(v).trim()); // BOKO CTL3LIVE
      const colls = (n.collections.nodes || []).map(c => ({ id: c.id, handle: c.handle }));
      const p = compactProduct({ ...n, publishedAt: n.publishedAt || n.createdAt }, colls, n.variants.nodes || [], n.options || [], cpl);
      if (p) return p;
      // sold-out anchor is still usable as an anchor
      const v = (n.variants.nodes || [])[0] || {};
      const col = ((v.selectedOptions || []).find(o => COLOR_OPT.test(o.name)) || {}).value || "";
      return { id: anum, handle: n.handle, title: n.title, category: (n.productType || "").toLowerCase(), tags: n.tags || [],
        tagsLc: (n.tags || []).map(t => String(t).toLowerCase()), cols: canonicalCols(colls.map(c => c.handle), n.productType, n.title, n.tags || []),
        price: parseFloat(v.price) || 0, color: String(col).toLowerCase() || colorFromTitle(n.title), sizes: [], createdAt: n.createdAt,
        pattern: TITLE_PRINT_RE.test(String(n.title || "").toLowerCase()), cp: cpl };
    } catch (e) { return null; }
  }

  // BOKO CTL3LIVE (CTL2-COLOR): Complete the Look picks for Klaviyo (sync, post-purchase, feed). Fashion shops only;
  // returns null for sector shops / no result so the Klaviyo code keeps its existing cache logic.
  globalThis.__ctl2Pick = async function (shop, productId, limit, excludeIds) {
    try {
      const anum = String(productId || "").split("/").pop().replace(/\D/g, "");
      if (!shop || !anum) return null;
      if (getIndustry && (await getIndustry(shop))) return null;
      const token = await getToken(shop);
      if (!token) return null;
      if (billingOK && !(await billingOK(shop, token))) return null;
      const cat = await getCatalog(shop, token, 8000);
      if (!cat) return null;
      const anchor = cat.byId.get(anum) || await fetchAnchor(shop, token, anum);
      if (!anchor) return null;
      let pool = cat.products;
      try {
        const st = loadSettings ? await loadSettings(shop) : null;
        const exc = new Set((st && st.global && st.global.excludedCollections) || []);
        if (exc.size) pool = pool.filter(p => !(p.collGids || []).some(id => exc.has(id)));
      } catch (e) {}
      const ex = new Set((excludeIds || []).map(x => String(x).split("/").pop().replace(/\D/g, "")));
      if (ex.size) pool = pool.filter(p => !ex.has(String(p.id)));
      pool = ctl3GenderPool(pool, anchor); // LIVE
      const v3 = CTL_DEFAULT_ENGINE === 3;
      const tot = Math.max(1, Math.min(8, limit || 4));
      const r = v3 ? completeTheLook3(pool, anchor, { total: tot }) : completeTheLook(pool, anchor, { total: tot });
      if (!r.items.length) return null;
      const shape = it => ({ id: String(it.id).split("/").pop(), title: it.title, handle: it.handle, price: it.price, image: it.img || "", url: "https://" + shop + "/products/" + it.handle });
      return { anchor: { id: anum, title: anchor.title || "", handle: anchor.handle || "", price: anchor.price || 0, image: anchor.img || "" }, items: r.items.map(shape), algo: v3 ? "ctl3" : "ctl2-color", at: new Date().toISOString() };
    } catch (e) { return null; }
  };

  app.get("/proxy/ctl", async (req, res) => {
    const q = req.query;
    try {
      if (!verifyProxy(q)) { res.set("Content-Type", "application/json"); return res.status(401).send(JSON.stringify({ items: [], error: "bad signature" })); }
      const shop = q.shop;
      const industry = await getIndustry(shop);
      if (industry) return fallback(req, res); // sector shops keep their business-category playbook
      const token = await getToken(shop);
      res.set("Content-Type", "application/json");
      res.set("Cache-Control", "no-store");
      if (!token) return res.status(200).send(JSON.stringify({ items: [], error: "app not installed for shop" }));
      if (billingOK && !(await billingOK(shop, token))) return res.status(200).send(JSON.stringify({ items: [], error: "subscription required" }));
      const limit = Math.max(1, Math.min(parseInt(q.limit || "12", 10) || 12, 24));
      const days = Math.max(0, parseInt(q.days, 10) || 0);
      const anum = String(q.anchor || "").replace(/\D/g, "");
      const debug = q.debug === "1";
      if (q.refresh === "1" && debug && mem[shop]) mem[shop].at = 0;
      const cat = await getCatalog(shop, token, 6000);
      let anchor = cat && anum ? cat.byId.get(anum) : null;
      if (cat && anum && !anchor) anchor = await fetchAnchor(shop, token, anum);
      if (cat && anchor) {
        let products = cat.products;
        try {
          const st = loadSettings ? await loadSettings(shop) : null;
          const ex = new Set((st && st.global && st.global.excludedCollections) || []);
          if (ex.size) products = products.filter(p => !(p.collGids || []).some(id => ex.has(id)));
        } catch (e) {}
        // BOKO CTL3LIVE: stylist engine (?engine=3 / ?engine=2 to compare; CTL_DEFAULT_ENGINE picks the default)
        if (q.engine === "3" || (q.engine !== "2" && CTL_DEFAULT_ENGINE === 3)) {
          const r3 = completeTheLook3(ctl3GenderPool(products, anchor), anchor, { total: limit, acolor: String(q.acolor || "").toLowerCase() }); // LIVE: gender gate
          const body3 = { engine: "ctl3", items: ctl3Enrich(r3.items, cat) }; // LIVE: options/variants for the block
          if (debug) body3.meta = { ...r3.meta, anchor_cols: anchor.cols, catalog_size: cat.products.length, catalog_age_s: Math.round((Date.now() - cat.at) / 1000), colour_field: !noCp[shop], op: ops[shop] || null };
          return res.status(200).send(JSON.stringify(body3));
        }
        const r = completeTheLook(products, anchor, { total: limit, days, acolor: String(q.acolor || "").toLowerCase() });
        if (r.items.length) {
          const body = { engine: "ctl2", items: r.items };
          if (debug) body.meta = { ...r.meta, anchor_cols: anchor.cols, catalog_size: cat.products.length, catalog_age_s: Math.round((Date.now() - cat.at) / 1000), op: ops[shop] || null };
          else body.items = r.items.map(({ color_note, ...it }) => it);
          return res.status(200).send(JSON.stringify(body));
        }
      }
      if (q.engine === "3" || (q.engine !== "2" && CTL_DEFAULT_ENGINE === 3)) return res.status(200).send(JSON.stringify({ engine: "ctl3", items: [], ...(debug ? { meta: { reason: !cat ? "catalogue building" : "anchor not found", op: ops[shop] || null } } : {}) })); // BOKO CTL3LIVE (P7)
      if (debug) res.set("X-Boko-Ctl", !cat ? "catalogue-building" : !anchor ? "anchor-not-found" : "no-v2-results");
      return fallback(req, res);
    } catch (e) {
      res.set("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ items: [], error: e.message }));
    }
  });
}

export { completeTheLook, colorInfo, colorRule, colorFromTitle, canonicalCols, resolveTemplate, hasSize12Plus, parseJsonl, compactProduct, T as SLOT_TEMPLATES };
