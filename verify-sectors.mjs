// verify-sectors.mjs  pull the live dev-store catalogue and run the REAL sector
// engine per sector, exactly as /proxy/recommend would. Prints anchor + picks.
import { toEngineProduct } from "./web/sector/loader.js";
import { recommendForShop } from "./web/sector/engine.js";

const S = process.env.SHOP, T = process.env.ADMIN_TOKEN;
const BOKO = `metafields(namespace:"boko",first:30){edges{node{key value type}}}`;
const q = `query($n:Int!){products(first:$n,query:"status:active"){edges{node{id title productType tags publishedAt createdAt featuredImage{url} variants(first:1){edges{node{price availableForSale}}} ${BOKO}}}}}`;

async function gql() {
  const r = await fetch(`https://${S}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": T },
    body: JSON.stringify({ query: q, variables: { n: 250 } }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data.products.edges.map((e) => e.node);
}

function toBase(n) {
  const v = n.variants.edges[0] && n.variants.edges[0].node;
  return {
    id: n.id, title: n.title, productType: n.productType || "",
    category: (n.productType || "").toLowerCase(), tags: n.tags || [],
    price: v ? parseFloat(v.price) : 0, available: !!(v && v.availableForSale),
    img: (n.featuredImage && n.featuredImage.url) || "",
    createdAt: n.publishedAt || n.createdAt || null,
    bokoMf: (n.metafields && n.metafields.edges) || [],
  };
}

const ANCHORS = {
  Beauty: "Gel Cleanser", Travel: "Cabin Backpack", "Home & Living": "Scandi 3-Seat Sofa",
  Electronics: "Smartphone X15", "Food & Beverage": "Single-Origin Coffee Beans",
  Jewellery: "Gold Chain Necklace", Others: "2-Person Tent",
};

const raw = await gql();
const seeded = raw.filter((n) => (n.tags || []).some((t) => String(t).startsWith("boko-sector:")));
console.log(`\nACTIVE products pulled: ${raw.length}  (seeded/tagged: ${seeded.length}, availableForSale: ${seeded.filter((n)=>n.variants.edges[0]&&n.variants.edges[0].node.availableForSale).length})`);

const eng = raw.map((n) => toEngineProduct(toBase(n)));
for (const [industry, anchorTitle] of Object.entries(ANCHORS)) {
  const anchor = eng.find((p) => p.title === anchorTitle);
  console.log(`\n=== ${industry} ===  anchor: ${anchorTitle}${anchor ? "" : "  [MISSING]"}`);
  if (!anchor) continue;
  const picks = await recommendForShop({ products: eng, anchor, cart: [], industry, limit: 6 });
  if (!picks.length) { console.log("  (no picks)"); continue; }
  for (const p of picks) console.log(`  - ${p.title}   [role:${p.attrs ? p.attrs.role || "?" : "?"}]  $${p.price}`);
}
console.log("");
