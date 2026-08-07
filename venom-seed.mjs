#!/usr/bin/env node
// venom-seed.mjs — seed boko-development with an ORIGINAL women's-fashion catalogue
// inspired by (not copied from) venomemilio.com.au: ~120 products across ~30
// collections, published live, with size/colour variants and images.
//
// Usage (from the staging Repl Shell, with ADMIN_TOKEN set as a Replit Secret):
//   SHOP=boko-development.myshopify.com node venom-seed.mjs --confirm
// Optional: --limit=N (cap products, for a dry test), --collections-only
//
// The token is read from process.env.ADMIN_TOKEN and never printed.

const API = "2024-10";
const SHOP = process.env.SHOP || "boko-development.myshopify.com";
const TOKEN = process.env.ADMIN_TOKEN;
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const COLLECTIONS_ONLY = args.includes("--collections-only");
const LIMIT = (() => { const a = args.find((x) => x.startsWith("--limit=")); return a ? parseInt(a.split("=")[1], 10) : Infinity; })();

const PREVIEW = args.includes("--preview");
if (!PREVIEW) {
  if (!TOKEN) { console.error("ERROR: set ADMIN_TOKEN (Replit Secret) for the dev store."); process.exit(1); }
  if (!/myshopify\.com$/.test(SHOP)) { console.error("SHOP must be a *.myshopify.com domain."); process.exit(1); }
  if (!CONFIRM) { console.error(`\nWill create products + collections on:\n  ${SHOP}\nRe-run with --confirm to proceed.\n`); process.exit(1); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables, attempt = 0) {
  const r = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 429) { if (attempt > 8) throw new Error("429 rate limit"); await sleep(1500 * (attempt + 1)); return gql(query, variables, attempt + 1); }
  const j = await r.json();
  if (j.errors) {
    const throttled = JSON.stringify(j.errors).match(/THROTTLED|throttled/i);
    if (throttled && attempt < 8) { await sleep(1500 * (attempt + 1)); return gql(query, variables, attempt + 1); }
    throw new Error(JSON.stringify(j.errors));
  }
  // proactively slow down if we're burning the cost bucket
  const cost = j.extensions && j.extensions.cost && j.extensions.cost.throttleStatus;
  if (cost && cost.currentlyAvailable < 300) await sleep(1200);
  return j.data;
}

// ---------- palette / helpers ----------
const COLOURS = ["Black", "Cream", "Navy", "Sage", "Chocolate", "Blush", "Emerald", "Rust", "Ivory", "Charcoal", "Rose", "Camel", "Cobalt", "Olive"];
const STD_SIZES = ["XS", "S", "M", "L", "XL"];
const CURVY_SIZES = ["14", "16", "18", "20", "22", "24"];
const pick = (arr, i) => arr[i % arr.length];
const pick2 = (arr, i) => [arr[i % arr.length], arr[(i + 3) % arr.length]];
const money = (n) => n.toFixed(2);
const enc = (s) => encodeURIComponent(s).replace(/%20/g, "+");
function placeholder(title, cat) {
  const bg = { dress: "E9FFA3", top: "EAEAFE", bottom: "E6E7EB", lounge: "F3E9FF", acc: "FFEFD6" }[cat] || "EEEEEE";
  return `https://placehold.co/800x1000/${bg}/31343C.png?text=${enc(title)}`;
}

// image URLs injected per-category (AI where available); falls back to placeholder.
const IMAGES = /*__IMAGES__*/ {};

// ---------- category definitions ----------
// group: umbrella tag; kind: image bucket; sizes: size set
const CATS = [
  { h: "mini-dresses",     t: "Mini Dresses",            group: "dresses",     kind: "dress",  type: "Mini Dress",     pr: [79, 130],  adjs: ["Ruched", "Wrap", "Halter", "Cutout", "Puff Sleeve", "Bandeau", "Tie Front"], mats: ["Satin", "Linen", "Crepe", "Rib Knit"], noun: "Mini Dress" },
  { h: "midi-dresses",     t: "Midi Dresses",            group: "dresses",     kind: "dress",  type: "Midi Dress",     pr: [99, 150],  adjs: ["Bias", "Shirred", "Pleated", "Twist Waist", "Slip", "Cowl Neck", "Button Front"], mats: ["Satin", "Georgette", "Poplin", "Jersey"], noun: "Midi Dress" },
  { h: "maxi-dresses",     t: "Maxi Dresses",            group: "dresses",     kind: "dress",  type: "Maxi Dress",     pr: [110, 170], adjs: ["Tiered", "Halterneck", "Off Shoulder", "Empire", "Wrap", "Kaftan"], mats: ["Linen", "Chiffon", "Satin", "Voile"], noun: "Maxi Dress" },
  { h: "formal-occasion",  t: "Formal & Occasion",       group: "dresses",     kind: "dress",  type: "Occasion Dress", pr: [130, 180], adjs: ["Sweetheart", "Sequin", "Draped", "One Shoulder", "Corset", "Column"], mats: ["Velvet", "Satin", "Lace", "Tulle"], noun: "Gown" },
  { h: "casual-dresses",   t: "Casual Dresses",          group: "dresses",     kind: "dress",  type: "Casual Dress",   pr: [59, 110],  adjs: ["Smock", "Tiered", "Shirt", "T-Shirt", "Denim", "Pinafore"], mats: ["Cotton", "Chambray", "Jersey", "Linen"], noun: "Day Dress" },
  { h: "curvy-dresses",    t: "Curvy Dresses",           group: "dresses",     kind: "dress",  type: "Curvy Dress",    pr: [89, 150],  adjs: ["Wrap", "Ruched Side", "Empire", "Faux Wrap", "Shirred"], mats: ["Ponte", "Jersey", "Satin", "Crepe"], noun: "Curvy Dress", curvy: true },
  { h: "tops-shirts",      t: "Tops & Shirts",           group: "tops",        kind: "top",    type: "Top",            pr: [39, 90],   adjs: ["Poplin", "Blouson", "Peplum", "Wrap", "Tie Neck", "Oversized", "Shell"], mats: ["Poplin", "Satin", "Linen", "Modal"], noun: "Shirt" },
  { h: "knitwear",         t: "Knitwear",                group: "tops",        kind: "top",    type: "Knit",           pr: [59, 120],  adjs: ["Fluffy", "Cable", "Ribbed", "Boucle", "Longline", "Crew"], mats: ["Wool Blend", "Mohair Blend", "Cotton Knit", "Alpaca Blend"], noun: "Cardigan" },
  { h: "coats-jackets",    t: "Coats & Jackets",         group: "tops",        kind: "top",    type: "Jacket",         pr: [99, 180],  adjs: ["Funnel Neck", "Windproof", "Longline", "Cropped", "Belted", "Quilted"], mats: ["Wool Blend", "Pleather", "Twill", "Puffer"], noun: "Jacket" },
  { h: "denim-jackets",    t: "Denim Jackets",           group: "tops",        kind: "top",    type: "Denim Jacket",   pr: [79, 120],  adjs: ["Classic", "Oversized", "Cropped", "Contrast Stitch", "Washed"], mats: ["Rigid Denim", "Stretch Denim", "Acid Wash"], noun: "Denim Jacket" },
  { h: "jeans-denim",      t: "Denim",                   group: "bottoms",     kind: "bottom", type: "Jeans",          pr: [69, 130],  adjs: ["Barrel", "Wide Leg", "Straight", "Mom", "Bootcut", "Slim"], mats: ["Washed Denim", "Rigid Denim", "Stretch Denim"], noun: "Jeans" },
  { h: "pants",            t: "Pants & Trousers",        group: "bottoms",     kind: "bottom", type: "Pants",          pr: [59, 120],  adjs: ["Barrel", "Tailored", "Wide Leg", "Paperbag", "Cargo", "Pull On"], mats: ["Cotton Stretch", "Ponte", "Twill", "Linen Blend"], noun: "Pant" },
  { h: "skirts",           t: "Skirts",                  group: "bottoms",     kind: "bottom", type: "Skirt",          pr: [49, 100],  adjs: ["Bias", "Pleated", "Denim", "Wrap", "Midi", "Mini"], mats: ["Satin", "Denim", "Poplin", "Jersey"], noun: "Skirt" },
  { h: "shorts",           t: "Shorts",                  group: "bottoms",     kind: "bottom", type: "Shorts",         pr: [39, 80],   adjs: ["Tailored", "Denim", "Paperbag", "Linen", "Bermuda"], mats: ["Cotton", "Denim", "Linen Blend"], noun: "Shorts" },
  { h: "jumpsuits",        t: "Jumpsuits",               group: "bottoms",     kind: "bottom", type: "Jumpsuit",       pr: [89, 150],  adjs: ["Wide Leg", "Utility", "Wrap", "Halter", "Boiler"], mats: ["Linen", "Crepe", "Twill", "Jersey"], noun: "Jumpsuit" },
  { h: "loungewear",       t: "Loungewear",              group: "lounge",      kind: "lounge", type: "Lounge",         pr: [39, 90],   adjs: ["Rib", "Waffle", "Fleece", "Slouch", "Cropped"], mats: ["Cotton", "Modal", "French Terry"], noun: "Lounge Set" },
  { h: "sleepwear",        t: "Sleepwear",               group: "lounge",      kind: "lounge", type: "Sleepwear",      pr: [39, 90],   adjs: ["Satin", "Piped", "Cami", "Long Sleeve", "Short"], mats: ["Satin", "Cotton", "Modal"], noun: "PJ Set" },
  { h: "bags",             t: "Bags",                    group: "accessories", kind: "acc",    type: "Bag",            pr: [45, 140],  adjs: ["Slouch", "Tote", "Crossbody", "Bucket", "Shoulder", "Mini"], mats: ["Pleather", "Nubuck", "Woven", "Nylon"], noun: "Bag", noSize: true },
  { h: "jewellery",        t: "Jewellery",               group: "accessories", kind: "acc",    type: "Jewellery",      pr: [19, 70],   adjs: ["Gold Plated", "Pearl", "Textured", "Chunky", "Fine"], mats: ["Necklace", "Hoop Earrings", "Bracelet", "Ring Set"], noun: "", noSize: true, matsAreNoun: true },
  { h: "belts-scarves",    t: "Belts & Scarves",         group: "accessories", kind: "acc",    type: "Accessory",      pr: [19, 60],   adjs: ["Woven", "Silky", "Wide", "Braided", "Fringe"], mats: ["Belt", "Scarf", "Neck Tie"], noun: "", noSize: true, matsAreNoun: true },
  { h: "sunglasses",       t: "Sunglasses",              group: "accessories", kind: "acc",    type: "Sunglasses",     pr: [25, 70],   adjs: ["Oversized", "Cat Eye", "Round", "Rectangle", "Wayfarer"], mats: ["Acetate", "Metal"], noun: "Sunglasses", noSize: true },
  { h: "shoes",            t: "Shoes",                   group: "accessories", kind: "acc",    type: "Shoes",          pr: [59, 150],  adjs: ["Block Heel", "Strappy", "Loafer", "Ankle Boot", "Ballet Flat", "Slide"], mats: ["Leather Look", "Suede Look", "Patent"], noun: "", noSize: false, shoeSizes: true, matsAreNoun: false, shoeNoun: true },
  { h: "hair-accessories", t: "Hair Accessories",        group: "accessories", kind: "acc",    type: "Hair Accessory", pr: [12, 40],   adjs: ["Satin", "Claw", "Padded", "Pearl", "Set of 3"], mats: ["Scrunchie", "Claw Clip", "Headband"], noun: "", noSize: true, matsAreNoun: true },
];

const GIVEN = ["Aria", "Noa", "Isla", "Mila", "Harper", "Liza", "Eastwick", "Romano", "Selma", "Alanna", "Abbie", "Hannah", "Amelia", "Olympia", "Mira", "Delta", "Juno", "Wren", "Faye", "Etta", "Rue", "Sena", "Cleo", "Vada"];

function descHtml(title, cat, mat) {
  const notes = {
    dress: `Meet the <strong>${title}</strong> — a versatile ${mat.toLowerCase()} dress cut for an easy, flattering line from brunch to night out.`,
    top: `The <strong>${title}</strong> is your new layering hero in a soft ${mat.toLowerCase()} finish that works back with denim or tailoring.`,
    bottom: `Everyday-ready <strong>${title}</strong> in a comfortable ${mat.toLowerCase()} with a fit that moves with you.`,
    lounge: `Wind down in the <strong>${title}</strong> — relaxed ${mat.toLowerCase()} made for slow mornings and cosy nights.`,
    acc: `Finish the look with the <strong>${title}</strong>, the kind of piece that quietly elevates everything.`,
  }[cat];
  return `<p>${notes}</p><ul><li>Inclusive, true-to-size fit</li><li>Designed in Melbourne</li><li>Easy care &mdash; cold gentle wash</li></ul>`;
}

// ---------- build product list ----------
const PER_CAT = 5; // ~5 per category -> ~115; a few cats get 6
const products = [];
let gi = 0;
for (const c of CATS) {
  const n = ["mini-dresses", "midi-dresses", "tops-shirts", "jeans-denim", "pants"].includes(c.h) ? 6 : PER_CAT;
  for (let k = 0; k < n; k++, gi++) {
    const adj = pick(c.adjs, k);
    const mat = pick(c.mats, k + 1);
    const given = pick(GIVEN, gi);
    let title;
    if (c.matsAreNoun) title = `${given} ${adj} ${mat}`;            // jewellery / belts / hair
    else if (c.shoeNoun) title = `${given} ${adj} ${pick(["Heels", "Boots", "Flats", "Sandals", "Loafers"], k)}`;
    else title = `${given} ${adj} ${mat} ${c.noun}`.replace(/\s+/g, " ").trim();
    const colours = pick2(COLOURS, gi);
    const [lo, hi] = c.pr;
    let price = lo + Math.round(((hi - lo) * ((k * 37 + gi * 13) % 100)) / 100);
    price = Math.min(hi, Math.max(lo, price)) - 0.05 + 0; // ends .95
    const priceStr = money(Math.floor(price) + 0.95);
    const onSale = gi % 6 === 0;
    const compareAt = onSale ? money(Math.floor(price * 1.4) + 0.95) : null;
    const flags = [];
    if (gi % 4 === 0) flags.push("new");
    if (gi % 5 === 0) flags.push("bestseller");
    if (onSale) flags.push("sale");
    if (gi % 7 === 0) flags.push("gift");
    const sizes = c.noSize ? ["One Size"] : c.shoeSizes ? ["6", "7", "8", "9", "10"] : c.curvy ? CURVY_SIZES : STD_SIZES;
    const imgs = (IMAGES[c.h] && IMAGES[c.h].length) ? IMAGES[c.h] : null;
    const image = imgs ? imgs[k % imgs.length] : placeholder(title, c.kind);
    const tags = [
      `col:${c.h}`, `group:${c.group}`, ...flags.map((f) => f),
      ...flags.map((f) => `flag:${f}`), c.type.toLowerCase().replace(/\s+/g, "-"), ...colours.map((x) => x.toLowerCase()),
    ];
    products.push({
      title, type: c.type, kind: c.kind, mat, priceStr, compareAt, sizes, colours, tags, image,
      desc: descHtml(title, c.kind, mat),
    });
  }
}
const finalProducts = products.slice(0, LIMIT === Infinity ? products.length : LIMIT);

// ---------- collections ----------
const CATCOLS = CATS.map((c) => ({ handle: c.h, title: c.t, tag: `col:${c.h}` }));
const GROUPCOLS = [
  { handle: "dresses", title: "Dresses", tag: "group:dresses" },
  { handle: "tops", title: "Tops", tag: "group:tops" },
  { handle: "bottoms", title: "Bottoms", tag: "group:bottoms" },
  { handle: "accessories", title: "Accessories", tag: "group:accessories" },
];
const FLAGCOLS = [
  { handle: "new-arrivals", title: "New Arrivals", tag: "flag:new" },
  { handle: "best-sellers", title: "Best Sellers", tag: "flag:bestseller" },
  { handle: "sale", title: "Sale", tag: "flag:sale" },
  { handle: "gifts", title: "Gifts", tag: "flag:gift" },
];
const ALLCOLS = [...CATCOLS, ...GROUPCOLS, ...FLAGCOLS];

// ---------- mutations ----------
const Q_PUBLICATIONS = `{ publications(first:20){ edges{ node{ id name } } } }`;
const M_COLLECTION = `mutation($input: CollectionInput!){ collectionCreate(input:$input){ collection{ id title handle } userErrors{ field message } } }`;
const M_PUBLISH = `mutation($id: ID!, $pubs: [PublicationInput!]!){ publishablePublish(id:$id, input:$pubs){ userErrors{ field message } } }`;
const M_PRODUCTSET = `mutation($input: ProductSetInput!){ productSet(synchronous:true, input:$input){ product{ id handle } userErrors{ field message } } }`;

function variantInputs(p) {
  const vs = [];
  for (const s of p.sizes) for (const col of p.colours) {
    const optionValues = [];
    if (!(p.sizes.length === 1 && p.sizes[0] === "One Size")) optionValues.push({ optionName: "Size", name: s });
    optionValues.push({ optionName: "Colour", name: col });
    const v = { optionValues, price: p.priceStr, inventoryItem: { tracked: false } };
    if (p.compareAt) v.compareAtPrice = p.compareAt;
    vs.push(v);
  }
  return vs;
}
function productOptions(p) {
  const opts = [];
  if (!(p.sizes.length === 1 && p.sizes[0] === "One Size")) opts.push({ name: "Size", values: p.sizes.map((s) => ({ name: s })) });
  opts.push({ name: "Colour", values: p.colours.map((c) => ({ name: c })) });
  return opts;
}

if (PREVIEW) {
  console.log(`PREVIEW — products: ${finalProducts.length}, collections: ${ALLCOLS.length}`);
  console.log(`Collections: ${ALLCOLS.map((c) => c.title).join(", ")}`);
  const byCat = {}; for (const p of finalProducts) byCat[p.type] = (byCat[p.type] || 0) + 1;
  console.log(`Per type:`, byCat);
  console.log(`\nSamples:`);
  for (const i of [0, 6, 12, 30, 60, 90, 110, finalProducts.length - 1]) {
    const p = finalProducts[i]; if (!p) continue;
    console.log(`  [${i}] ${p.title} | ${p.type} | $${p.priceStr}${p.compareAt ? " (was $" + p.compareAt + ")" : ""} | sizes ${p.sizes.join("/")} | ${p.colours.join("/")} | variants ${variantInputs(p).length} | tags ${p.tags.slice(0, 5).join(",")} | img ${p.image.slice(0, 60)}`);
  }
  process.exit(0);
}

(async () => {
  console.log(`\nSeeding ${SHOP}\n  products: ${finalProducts.length}  collections: ${ALLCOLS.length}\n`);
  const pubData = await gql(Q_PUBLICATIONS);
  const pubs = (pubData.publications.edges || []).map((e) => e.node);
  const online = pubs.find((p) => /online store/i.test(p.name)) || pubs[0];
  const pubInput = pubs.filter((p) => /online store|point of sale/i.test(p.name)).map((p) => ({ publicationId: p.id }));
  console.log(`Publishing to: ${pubInput.length ? pubInput.length + " channel(s)" : "(none found)"}\n`);

  // collections first
  console.log("Collections:");
  for (const c of ALLCOLS) {
    try {
      const d = await gql(M_COLLECTION, { input: { title: c.title, handle: c.handle, ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: c.tag }] } } });
      const errs = d.collectionCreate.userErrors;
      if (errs.length) { console.log(`  ~ ${c.title}: ${errs.map((e) => e.message).join("; ")}`); continue; }
      const id = d.collectionCreate.collection.id;
      if (pubInput.length) await gql(M_PUBLISH, { id, pubs: pubInput }).catch(() => {});
      console.log(`  + ${c.title}`);
    } catch (e) { console.log(`  x ${c.title}: ${e.message}`); }
    await sleep(250);
  }
  if (COLLECTIONS_ONLY) { console.log("\nCollections-only done."); return; }

  // products
  console.log("\nProducts:");
  let ok = 0, fail = 0;
  for (const p of finalProducts) {
    const input = {
      title: p.title, descriptionHtml: p.desc, productType: p.type, vendor: "Boko Studio",
      status: "ACTIVE", tags: p.tags,
      productOptions: productOptions(p), variants: variantInputs(p),
      files: [{ originalSource: p.image, contentType: "IMAGE", alt: p.title }],
    };
    try {
      const d = await gql(M_PRODUCTSET, { input });
      const errs = d.productSet.userErrors;
      if (errs.length) { fail++; console.log(`  x ${p.title}: ${errs.map((e) => e.message).join("; ")}`); continue; }
      const id = d.productSet.product.id;
      if (pubInput.length) await gql(M_PUBLISH, { id, pubs: pubInput }).catch(() => {});
      ok++; if (ok % 10 === 0) console.log(`  ...${ok} created`);
    } catch (e) { fail++; console.log(`  x ${p.title}: ${e.message}`); }
    await sleep(350);
  }
  console.log(`\nDone. Products created: ${ok}, failed: ${fail}. Collections: ${ALLCOLS.length}.`);
})();
