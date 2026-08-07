#!/usr/bin/env node
// update-images.mjs — replace the placeholder image on every seeded product with a
// real, free-to-use Pexels photo matched to the product's category.
//
// Usage (staging Repl Shell, ADMIN_TOKEN secret set):
//   SHOP=boko-development.myshopify.com node update-images.mjs --confirm
//
// It paginates all "Boko Studio" products, reads the `col:<handle>` tag to find the
// category, deletes existing media, and adds a category-matched image.

const API = "2024-10";
const SHOP = process.env.SHOP || "boko-development.myshopify.com";
const TOKEN = process.env.ADMIN_TOKEN;
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const LIMIT = (() => { const a = args.find((x) => x.startsWith("--limit=")); return a ? parseInt(a.split("=")[1], 10) : Infinity; })();
if (!TOKEN) { console.error("ERROR: ADMIN_TOKEN not set."); process.exit(1); }
if (!CONFIRM) { console.error(`Will update product images on ${SHOP}. Re-run with --confirm.`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gql(query, variables, attempt = 0) {
  const r = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 429) { if (attempt > 8) throw new Error("429"); await sleep(1500 * (attempt + 1)); return gql(query, variables, attempt + 1); }
  const j = await r.json();
  if (j.errors) {
    if (/THROTTLED/i.test(JSON.stringify(j.errors)) && attempt < 8) { await sleep(1500 * (attempt + 1)); return gql(query, variables, attempt + 1); }
    throw new Error(JSON.stringify(j.errors));
  }
  const c = j.extensions && j.extensions.cost && j.extensions.cost.throttleStatus;
  if (c && c.currentlyAvailable < 300) await sleep(1200);
  return j.data;
}

const P = "https://images.pexels.com/photos/";
const j = (id) => `${P}${id}/pexels-photo-${id}.jpeg`;
const png = (id) => `${P}${id}/pexels-photo-${id}.png`;

const GROUPS = {
  dress: [20544951, 31772344, 6675408, 33897823, 14741291, 31649562, 16612608, 16814117, 35086830, 15641099, 19152364, 19895977, 8669224].map(j).concat([png(8034077), png(8034081)]),
  blouse: [7716929, 30957211, 37415219, 29538467, 14247257, 8289271, 31622597, 22670642, 17640130, 18685528].map(j),
  sweater: [6248697, 6184939, 6518687, 5618175, 6549251, 6691608, 6691247, 6946422, 6874386, 10593686].map(j),
  coat: [7653719, 19542392, 9930079, 11508431, 7653711, 7653714, 19481284, 31300230, 6532108, 9393922].map(j),
  denimjacket: [36607477, 12083001, 6770027, 5524406, 30765819, 6770037, 16478897, 32500809].map(j),
  jeans: [6764142, 1082526, 6764133, 10133278, 2129970, 10133273, 10133274, 10133275, 17751918].map(j).concat(["https://images.pexels.com/photos/6898/jeans-hipster-urban-will-milne.jpg"]),
  trousers: [9464625, 2897539, 17082930, 19995460, 32275954, 7890401, 7205905, 2897533].map(j),
  skirt: [18516286, 37466308, 14436296, 8960832, 15146363, 32376791, 10731972, 25466377, 20376533, 36730400].map(j),
  shorts: [9353581, 6076008, 6076012, 11311403, 27433191, 13966436].map(j).concat([png(7099151), png(7099139)]),
  jumpsuit: [2699250, 31094915, 13219628, 33466528, 38023312, 32815518, 6279558, 16611996].map(j),
  loungewear: [37220883, 37220887, 37220941, 6976280, 37220863, 6976790, 37220916, 37220860].map(j),
  pajamas: [6976782, 8497487, 8416047, 6443431, 8416240, 18820123, 8416052, 10566197].map(j),
  handbag: [5352628, 7953286, 22432991, 22434759, 9327162, 35666033, 8989582, 18601568, 36933384, 21897141].map(j),
  necklace: [13924051, 10862233, 7514818, 29080968, 15925159, 8003772, 8776984, 6467703, 9645737, 20601213].map(j),
  scarf: [3204622, 36455711, 2120584, 27408060, 7396145, 36455723, 32446984].map(j).concat([png(8312961)]),
  sunglasses: [5202048, 15735139, 34978681, 2767694, 8989491, 5465834, 5202046, 11882776, 5201935, 121795].map(j),
  heels: [36212466, 34294446, 17826424, 23385346, 26850888, 18466079, 7760567, 13229857, 13862209, 8147764].map(j),
  hairclip: [6188294, 8468179, 8468016, 20166056, 33617637, 7450295, 17949487, 7450827].map(j),
};
const HANDLE2GROUP = {
  "mini-dresses": "dress", "midi-dresses": "dress", "maxi-dresses": "dress", "formal-occasion": "dress", "casual-dresses": "dress", "curvy-dresses": "dress",
  "tops-shirts": "blouse", "knitwear": "sweater", "coats-jackets": "coat", "denim-jackets": "denimjacket",
  "jeans-denim": "jeans", "pants": "trousers", "skirts": "skirt", "shorts": "shorts", "jumpsuits": "jumpsuit",
  "loungewear": "loungewear", "sleepwear": "pajamas", "bags": "handbag", "jewellery": "necklace",
  "belts-scarves": "scarf", "sunglasses": "sunglasses", "shoes": "heels", "hair-accessories": "hairclip",
};
const sized = (u) => u.split("?")[0] + "?auto=compress&cs=tinysrgb&fit=crop&w=800&h=1000";
const counters = {};
function nextImage(handle) {
  const g = HANDLE2GROUP[handle]; if (!g || !GROUPS[g]) return null;
  const arr = GROUPS[g]; const i = (counters[g] = (counters[g] || 0) + 1) - 1;
  return sized(arr[i % arr.length]);
}

const Q = `query($cursor:String){ products(first:40, after:$cursor, query:"vendor:'Boko Studio'"){ pageInfo{ hasNextPage endCursor } edges{ node{ id title tags media(first:15){ edges{ node{ id } } } } } } }`;
const M_DEL = `mutation($productId:ID!,$ids:[ID!]!){ productDeleteMedia(productId:$productId, mediaIds:$ids){ deletedMediaIds mediaUserErrors{ field message } } }`;
const M_ADD = `mutation($productId:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$productId, media:$media){ media{ id status } mediaUserErrors{ field message } } }`;

(async () => {
  console.log(`Updating images on ${SHOP}\n`);
  let cursor = null, done = 0, skipped = 0, failed = 0, processed = 0;
  do {
    const d = await gql(Q, { cursor });
    const conn = d.products;
    for (const e of conn.edges) {
      if (processed >= LIMIT) { cursor = null; break; }
      processed++;
      const p = e.node;
      const colTag = (p.tags || []).find((t) => t.startsWith("col:"));
      const handle = colTag ? colTag.slice(4) : null;
      const url = handle ? nextImage(handle) : null;
      if (!url) { skipped++; console.log(`  ~ skip ${p.title} (no category)`); continue; }
      try {
        const oldIds = (p.media.edges || []).map((m) => m.node.id);
        if (oldIds.length) {
          const dd = await gql(M_DEL, { productId: p.id, ids: oldIds });
          const de = dd.productDeleteMedia.mediaUserErrors; if (de.length) console.log(`  ! del ${p.title}: ${de.map((x) => x.message).join(";")}`);
          await sleep(150);
        }
        const ad = await gql(M_ADD, { productId: p.id, media: [{ originalSource: url, alt: p.title, mediaContentType: "IMAGE" }] });
        const ae = ad.productCreateMedia.mediaUserErrors;
        if (ae.length) { failed++; console.log(`  x ${p.title}: ${ae.map((x) => x.message).join(";")}`); }
        else { done++; if (done % 10 === 0) console.log(`  ...${done} updated`); }
      } catch (err) { failed++; console.log(`  x ${p.title}: ${err.message}`); }
      await sleep(300);
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  console.log(`\nDone. Updated: ${done}, skipped: ${skipped}, failed: ${failed}.`);
})();
