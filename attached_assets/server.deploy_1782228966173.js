// server.js — Boko AI Product Recommendations (token mode + dashboard)
// Reads the store via a custom-app Admin API token. Endpoints:
//   GET /recommend   → recommended products (used by the storefront widgets)
//   GET /stats        → purchase + revenue attribution JSON (orders tagged _boko_reco)
//   GET /dashboard    → HTML dashboard: items + revenue by source + product
// Requires Secrets: SHOP, SHOPIFY_ADMIN_TOKEN (read_products + read_orders), optional LLM_*.

import express from "express";
import { recommend } from "./recommendations.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const SHOP = (process.env.SHOP || "").replace(/^https?:\/\//, "");
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";
const API = process.env.SHOPIFY_API_VERSION || "2024-10";

const app = express();
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  next();
});

async function gql(query, variables) {
  if (!SHOP || !TOKEN) throw new Error("Missing SHOP or SHOPIFY_ADMIN_TOKEN secret");
  const r = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function loadProducts(limit = 100) {
  const query = `query($n:Int!){ products(first:$n){ edges{ node{ id title productType vendor featuredImage{url} variants(first:1){ edges{ node{ id price } } } } } } }`;
  const j = await gql(query, { n: limit });
  const edges = (j.data && j.data.products && j.data.products.edges) || [];
  return edges.map((e, i) => {
    const n = e.node;
    const v = n.variants && n.variants.edges[0] && n.variants.edges[0].node;
    return { id: n.id, variantId: v && v.id, title: n.title, vendor: n.vendor,
      category: (n.productType || "").toLowerCase(), price: v ? parseFloat(v.price) : 0,
      img: (n.featuredImage && n.featuredImage.url) || "", orders: Math.max(0, limit - i) * 3, views: 0 };
  });
}

app.get("/recommend", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "8", 10), 24);
    const products = await loadProducts();
    const anchor = req.query.anchor ? products.find((p) => p.id.endsWith(req.query.anchor)) : null;
    const items = await recommend({ products, anchor, limit });
    res.set("Content-Type", "application/json").status(200).send(JSON.stringify({ items }));
  } catch (e) {
    console.error("[reco]", e.message);
    res.set("Content-Type", "application/json").status(200).send(JSON.stringify({ items: [], error: e.message }));
  }
});

// ---- Purchase + revenue attribution from order line items tagged _boko_reco ----
async function loadStats(days) {
  const since = new Date(Date.now() - (days || 90) * 864e5).toISOString().slice(0, 10);
  const query = `query($n:Int!,$q:String){ orders(first:$n, reverse:true, query:$q){ edges{ node{ lineItems(first:50){ edges{ node{ title quantity discountedTotalSet{ shopMoney{ amount currencyCode } } customAttributes{ key value } } } } } } } }`;
  const j = await gql(query, { n: 100, q: "created_at:>=" + since });
  if (j.errors) return { error: JSON.stringify(j.errors), pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] } };
  const orders = (j.data && j.data.orders && j.data.orders.edges) || [];
  const src = { pdp: { items: {}, rev: 0 }, cart_drawer: { items: {}, rev: 0 } };
  let currency = "";
  orders.forEach((o) => {
    (o.node.lineItems.edges || []).forEach((le) => {
      const li = le.node;
      let tag = null;
      (li.customAttributes || []).forEach((a) => { if (a.key === "_boko_reco") tag = a.value; });
      if (tag && src[tag]) {
        const m = li.discountedTotalSet && li.discountedTotalSet.shopMoney;
        const amt = m ? parseFloat(m.amount) : 0;
        if (m && m.currencyCode) currency = m.currencyCode;
        const it = src[tag].items[li.title] || { count: 0, rev: 0 };
        it.count += li.quantity; it.rev += amt;
        src[tag].items[li.title] = it;
        src[tag].rev += amt;
      }
    });
  });
  function pack(s) {
    const items = Object.keys(s.items)
      .map((k) => ({ title: k, count: s.items[k].count, revenue: Math.round(s.items[k].rev * 100) / 100 }))
      .sort((a, b) => b.count - a.count);
    return { total: items.reduce((x, i) => x + i.count, 0), revenue: Math.round(s.rev * 100) / 100, items };
  }
  const pdp = pack(src.pdp), cd = pack(src.cart_drawer);
  return {
    ordersScanned: orders.length, since, currency,
    totalRevenue: Math.round((pdp.revenue + cd.revenue) * 100) / 100,
    totalItems: pdp.total + cd.total,
    pdp, cart_drawer: cd,
  };
}

app.get("/stats", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || "90", 10), 365);
    res.set("Content-Type", "application/json").status(200).send(JSON.stringify(await loadStats(days)));
  } catch (e) {
    res.set("Content-Type", "application/json").status(200).send(JSON.stringify({ error: e.message, pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] } }));
  }
});

const DASHBOARD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Boko Recommendations — Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#1f1f1f;--muted:#6b7280;--line:#e6e6e6;--lime:#BFFC00;--bg:#f0f2f5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:"Jost",-apple-system,sans-serif;color:var(--ink)}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:24px;font-weight:600;margin:0 0 4px}.sub{color:var(--muted);font-size:14px;margin:0 0 22px}
.row{display:flex;gap:8px;align-items:center;margin-bottom:18px}
select{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#fff}
.hero{background:#0a0a0a;color:#fff;border-radius:14px;padding:22px 24px;margin-bottom:16px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.hero .v{font-size:40px;font-weight:700;letter-spacing:-1px}
.hero .lime{color:var(--lime)}
.hero .x{color:#bdbdbd;font-size:14px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:720px){.cards{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 2px 16px rgba(0,0,0,.05)}
.big{font-size:34px;font-weight:700;letter-spacing:-1px;margin:0}
.rev{font-size:15px;color:#1f7a45;font-weight:600;margin:2px 0 0}
.pill{display:inline-block;background:var(--lime);color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 10px;border-radius:99px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600}
td.n{text-align:right;font-weight:600}td.r{text-align:right;color:#1f7a45}
.empty{color:var(--muted);font-size:13px;padding:14px 0}
.err{background:#fdeceb;border:1px solid #f6cdc8;color:#7a1d13;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:16px}
.foot{color:var(--muted);font-size:12px;margin-top:20px;text-align:center}
</style></head><body><div class="wrap">
<h1>Boko AI Recommendations — Performance</h1>
<p class="sub">Items and revenue from products added via your recommendation widgets.</p>
<div class="row"><label class="sub" style="margin:0">Period</label>
<select id="days"><option value="30">Last 30 days</option><option value="90" selected>Last 90 days</option><option value="365">Last 12 months</option></select>
<span id="meta" class="sub" style="margin:0 0 0 auto"></span></div>
<div id="err"></div>
<div class="hero">
  <div><div class="v lime" id="revTotal">–</div><div class="x">total revenue from recommendations</div></div>
  <div style="margin-left:auto"><div class="v" id="itemTotal">–</div><div class="x">items purchased</div></div>
</div>
<div class="cards">
  <div class="card"><span class="pill">Product page rail</span><div class="big" id="pdpTotal">–</div><div class="rev" id="pdpRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="pdpRows"></tbody></table></div>
  <div class="card"><span class="pill">Cart drawer carousel</span><div class="big" id="cdTotal">–</div><div class="rev" id="cdRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="cdRows"></tbody></table></div>
</div>
<p class="foot" id="foot"></p>
</div>
<script>
var CUR="";
function fmt(n){ try{ return new Intl.NumberFormat(undefined,{style:"currency",currency:CUR||"USD"}).format(n||0);}catch(e){ return "$"+(Number(n||0)).toFixed(2);} }
function rows(tb, items){ tb.innerHTML = (items&&items.length)? items.map(function(i){return "<tr><td>"+i.title+"</td><td class='n'>"+i.count+"</td><td class='r'>"+fmt(i.revenue)+"</td></tr>";}).join("") : "<tr><td colspan='3' class='empty'>No purchases yet from this source.</td></tr>"; }
function load(){
  var days=document.getElementById("days").value;
  fetch("/stats?days="+days).then(function(r){return r.json();}).then(function(d){
    CUR=d.currency||"USD";
    document.getElementById("err").innerHTML = d.error ? "<div class='err'>Couldn’t read orders: "+d.error+". Make sure the app token has <b>read_orders</b> scope.</div>" : "";
    document.getElementById("revTotal").textContent = fmt(d.totalRevenue);
    document.getElementById("itemTotal").textContent = (d.totalItems!=null?d.totalItems:0);
    document.getElementById("pdpTotal").textContent = (d.pdp&&d.pdp.total)||0;
    document.getElementById("cdTotal").textContent = (d.cart_drawer&&d.cart_drawer.total)||0;
    document.getElementById("pdpRev").textContent = "Revenue: "+fmt(d.pdp&&d.pdp.revenue);
    document.getElementById("cdRev").textContent = "Revenue: "+fmt(d.cart_drawer&&d.cart_drawer.revenue);
    rows(document.getElementById("pdpRows"), d.pdp&&d.pdp.items);
    rows(document.getElementById("cdRows"), d.cart_drawer&&d.cart_drawer.items);
    document.getElementById("meta").textContent = d.ordersScanned!=null ? (d.ordersScanned+" recent orders scanned") : "";
    document.getElementById("foot").textContent = "Counts reflect orders since "+(d.since||"")+" whose items were added via a Boko recommendation widget.";
  }).catch(function(){ document.getElementById("err").innerHTML="<div class='err'>Couldn’t load stats.</div>"; });
}
document.getElementById("days").addEventListener("change",load); load();
</script></body></html>`;

app.get("/dashboard", (req, res) => res.set("Content-Type", "text/html").status(200).send(DASHBOARD));
app.get("/", (req, res) => res.send('Boko Reco app running (token mode). See <a href="/dashboard">/dashboard</a> or /recommend'));
app.listen(PORT, () => console.log("Boko Reco token mode listening on " + PORT));
