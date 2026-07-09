// server.mt.js — Boko AI Recommendations: MULTI-TENANT OAuth app.
// One deployment serves many stores. Each store installs via OAuth and gets its own
// access token stored in the key-value DB (keyed by shop domain) — fully isolated:
// installing/uninstalling one store never touches another.
//
// Endpoints:
//   GET  /                        → health / entry (redirects to /auth or /dashboard)
//   GET  /auth                    → start OAuth (redirect to Shopify consent)
//   GET  /auth/callback           → verify + exchange code → store token → register webhook
//   GET  /proxy/recommend         → storefront recommendations (Shopify App Proxy, signed)
//   GET  /stats                   → dashboard data (Authorization: Bearer <session id_token>)
//   GET  /dashboard               → embedded Admin dashboard (App Bridge + session token)
//   POST /webhooks/app_uninstalled→ delete that shop's token (HMAC verified)
//
// Secrets required: SHOPIFY_API_KEY (client id), SHOPIFY_API_SECRET (client secret),
//   HOST (this app's base URL, e.g. https://boko-reco-app--admin7695.replit.app),
//   SCOPES (default read_products,read_orders), optional SHOPIFY_API_VERSION, LLM_*.

import express from "express";
import crypto from "crypto";
import Database from "@replit/database";
import { recommend } from "./recommendations.js";
import { track, funnelCounts } from "./boko-tracker.js";
import { loadSettings, saveSettings, publicConfig, handlesToCollectionGids } from "./boko-settings.js";
import { SFY_SECTION_LIQUID, SFY_PAGE_TEMPLATE } from "./theme-assets.js";
import { STOREFRONT_JS } from "./storefront-script.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.SHOPIFY_API_KEY || "";
const API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES = process.env.SCOPES || "read_orders,read_products,write_discounts,write_script_tags,write_themes";
const HOST = (process.env.HOST || "").replace(/\/+$/, "");
const API = process.env.SHOPIFY_API_VERSION || "2024-10";
const db = new Database();

// ---- token store (per shop) — handles both @replit/database return styles ----
const k = (shop) => "shop:" + shop;
async function rawTok(shop) { const r = await db.get(k(shop)); if (r && typeof r === "object" && "ok" in r) return r.ok ? r.value : null; return r || null; } async function refreshExpiring(shop, t) { if (!t || !t.refresh_token) return t; try { const r = await fetch("https://" + shop + "/admin/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: new URLSearchParams({ client_id: API_KEY, client_secret: API_SECRET, grant_type: "refresh_token", refresh_token: t.refresh_token }) }).then((x) => x.json()); if (r && r.access_token) { const n = { access_token: r.access_token, refresh_token: r.refresh_token || t.refresh_token, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) }; await db.set(k(shop), n); return n; } } catch (e) {} return t; } async function migrateToken(shop, oldToken) { try { const r = await fetch("https://" + shop + "/admin/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: new URLSearchParams({ client_id: API_KEY, client_secret: API_SECRET, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: oldToken, subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: "1" }) }).then((x) => x.json()); if (r && r.access_token) { const n = { access_token: r.access_token, refresh_token: r.refresh_token || null, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) }; await db.set(k(shop), n); return n; } } catch (e) {} return { access_token: oldToken }; } async function getToken(shop) { let t = await rawTok(shop); if (!t) return null; if (typeof t === "string") { t = await migrateToken(shop, t); } if (t.expires_at && Date.now() > (t.expires_at - 120000)) t = await refreshExpiring(shop, t); return (t && t.access_token) || null; } async function setToken(shop, token) { await db.set(k(shop), token); }
async function delToken(shop) { try { await db.delete(k(shop)); } catch (e) {} }

const validShop = (s) => /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(s || "");

async function gql(shop, token, query, variables) {
  const r = await fetch(`https://${shop}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

// ---- Admin REST helper (used for theme file installs — no GraphQL Theme Asset API) ----
async function restCall(shop, token, path, method, body) {
  const r = await fetch(`https://${shop}/admin/api/${API}/${path}`, {
    method: method || "GET",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, json };
}

async function getMainTheme(shop, token) {
  const r = await restCall(shop, token, "themes.json", "GET");
  const themes = (r.json && r.json.themes) || [];
  return themes.find((t) => t.role === "main") || null;
}

async function putThemeAsset(shop, token, themeId, key, value) {
  return restCall(shop, token, `themes/${themeId}/assets.json`, "PUT", { asset: { key, value } });
}

async function getThemeAsset(shop, token, themeId, key) {
  const r = await restCall(shop, token, `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`, "GET");
  return r.ok && r.json && r.json.asset ? r.json.asset : null;
}

// ---- Storefront widgets ScriptTag (rail + cart drawer, no theme-app-extension) ----
async function findStorefrontScriptTag(shop, token) {
  const j = await gql(shop, token, `{ scriptTags(first:20){ edges{ node{ id src } } } }`, {});
  const edges = (j.data && j.data.scriptTags && j.data.scriptTags.edges) || [];
  return edges.map((e) => e.node).find((n) => n.src && n.src.includes("/storefront.js")) || null;
}

// ---- Billing (gated by BILLING_ENABLED env flag) ----
const BILLING_ON = process.env.BILLING_ENABLED === "true";
const PLAN_NAME = process.env.BILLING_PLAN_NAME || "AI Recommendations";
const PLAN_PRICE = process.env.BILLING_PRICE || "99.00";
const PLAN_CURRENCY = process.env.BILLING_CURRENCY || "USD";
const TRIAL_DAYS = parseInt(process.env.BILLING_TRIAL_DAYS || "14", 10);
const BILLING_TEST = process.env.BILLING_TEST !== "false";

const bk = (shop) => "billed:" + shop;
async function isBilled(shop) {
  const r = await db.get(bk(shop));
  if (r && typeof r === "object" && "ok" in r) return r.ok ? r.value === true : false;
  return r === true;
}
async function setBilled(shop, bool) { await db.set(bk(shop), bool); }

async function activeSubscription(shop, token) {
  const q = `{ currentAppInstallation { activeSubscriptions { id name status } } }`;
  const j = await gql(shop, token, q, {});
  const subs = (j.data && j.data.currentAppInstallation && j.data.currentAppInstallation.activeSubscriptions) || [];
  return subs.find((s) => s.status === "ACTIVE") || null;
}

async function startSubscription(shop, token) {
  const returnUrl = HOST + "/billing/callback?shop=" + encodeURIComponent(shop);
  const mutation = `
    mutation appSubscriptionCreate(
      $name: String!
      $returnUrl: URL!
      $test: Boolean
      $trialDays: Int
      $lineItems: [AppSubscriptionLineItemInput!]!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        test: $test
        trialDays: $trialDays
        lineItems: $lineItems
      ) {
        confirmationUrl
        userErrors { field message }
      }
    }
  `;
  const variables = {
    name: PLAN_NAME,
    returnUrl,
    test: Boolean(BILLING_TEST),
    trialDays: TRIAL_DAYS,
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price: { amount: String(PLAN_PRICE), currencyCode: String(PLAN_CURRENCY) },
          interval: "EVERY_30_DAYS",
        },
      },
    }],
  };
  const j = await gql(shop, token, mutation, variables);
  if (j.errors && j.errors.length) {
    console.error("[billing] appSubscriptionCreate top-level errors:", JSON.stringify(j.errors));
  }
  const result = j.data && j.data.appSubscriptionCreate;
  if (result && result.userErrors && result.userErrors.length) {
    console.error("[billing] appSubscriptionCreate userErrors:", JSON.stringify(result.userErrors));
  }
  if (!result || !result.confirmationUrl) {
    console.error("[billing] appSubscriptionCreate full response:", JSON.stringify(j));
  }
  const userErrorMsg = (result && result.userErrors && result.userErrors.length)
    ? result.userErrors.map((e) => e.message).join("; ")
    : null;
  const topErrorMsg = Array.isArray(j.errors) ? j.errors.map((e) => e.message).join("; ") : (j.errors ? (typeof j.errors === "string" ? j.errors : JSON.stringify(j.errors)) : null);
  return {
    confirmationUrl: (result && result.confirmationUrl) || null,
    error: userErrorMsg || topErrorMsg || null,
  };
}

async function billingOK(shop, token) {
  if (!BILLING_ON) return true;
  if (await isBilled(shop)) return true;
  const sub = await activeSubscription(shop, token);
  if (sub) { await setBilled(shop, true); return true; }
  return false;
}

const app = express();
// Raw body only for webhooks (needed for HMAC); JSON for everything else.
app.use("/webhooks", express.raw({ type: "*/*" }));
app.use(express.json());
app.use((req, res, next) => { res.set("Access-Control-Allow-Origin", "*"); res.set("Access-Control-Allow-Methods", "GET,OPTIONS"); next(); });

// ---------- OAuth ----------
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!validShop(shop)) return res.status(400).send("Missing or invalid ?shop");
  const redirectUri = HOST + "/auth/callback";
  const state = crypto.randomBytes(16).toString("hex");
  const url = `https://${shop}/admin/oauth/authorize?client_id=${API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { shop, hmac, code } = req.query;
    if (!validShop(shop)) return res.status(400).send("Invalid shop");
    // Verify HMAC over the query (excluding hmac/signature)
    const params = { ...req.query };
    delete params.hmac; delete params.signature;
    const message = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
    const digest = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
    if (digest !== hmac) return res.status(400).send("HMAC validation failed");
    // Exchange the code for a permanent access token
    const tok = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
    }).then((r) => r.json());
    if (!tok.access_token) return res.status(500).send("Token exchange failed");
    await setToken(shop, tok.access_token);
    // Register the uninstall webhook so we clean up this shop's token automatically
    try {
      await gql(shop, tok.access_token,
        `mutation($u:URL!){ webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription:{ callbackUrl:$u, format: JSON }){ userErrors{ message } } }`,
        { u: HOST + "/webhooks/app_uninstalled" });
    } catch (e) {}
    // Billing gate: redirect to subscription confirmation if not yet billed
    if (BILLING_ON && !(await billingOK(shop, tok.access_token))) {
      const { confirmationUrl } = await startSubscription(shop, tok.access_token);
      if (confirmationUrl) return res.redirect(confirmationUrl);
    }
    // Open the embedded app in admin
    res.redirect(`https://${shop}/admin/apps/${API_KEY}`);
  } catch (e) {
    res.status(500).send("Auth error: " + e.message);
  }
});

// ---------- Billing routes ----------
app.get("/billing/start", async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!validShop(shop)) return res.status(400).send("Invalid shop");
    const token = await getToken(shop);
    if (!token) return res.redirect("/auth?shop=" + encodeURIComponent(shop));
    const { confirmationUrl, error } = await startSubscription(shop, token);
    if (!confirmationUrl) return res.status(500).send("Could not start subscription" + (error ? ": " + error : ""));
    res.redirect(confirmationUrl);
  } catch (e) {
    res.status(500).send("Billing error: " + e.message);
  }
});

app.get("/billing/callback", async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!validShop(shop)) return res.status(400).send("Invalid shop");
    const token = await getToken(shop);
    if (!token) return res.redirect("/auth?shop=" + encodeURIComponent(shop));
    const sub = await activeSubscription(shop, token);
    await setBilled(shop, !!sub);
    res.redirect(`https://${shop}/admin/apps/${API_KEY}`);
  } catch (e) {
    res.status(500).send("Billing callback error: " + e.message);
  }
});

// ---------- Storefront recommendations via Shopify App Proxy ----------
function verifyProxy(query) {
  const { signature, ...rest } = query;
  if (!signature) return false;
  const message = Object.keys(rest).sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(",") : rest[key]}`).join("");
  const digest = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(signature))); }
  catch (e) { return false; }
}

async function loadProducts(shop, token, limit = 100, productType = "") {
  const safe = productType.replace(/[^a-zA-Z0-9 &-]/g, "");
  const qstr = safe ? `status:active product_type:${safe}` : "status:active";
  const query = `query($n:Int!){ products(first:$n, sortKey: PUBLISHED_AT, reverse: true, query:"${qstr}"){ edges{ node{ id title handle productType vendor tags publishedAt createdAt isGiftCard featuredImage{url} options{ name values } collections(first:20){ edges{ node{ id handle } } } variants(first:100){ edges{ node{ id title price availableForSale selectedOptions{ name value } } } } } } } }`;
  const j = await gql(shop, token, query, { n: limit });
  const edges = (j.data && j.data.products && j.data.products.edges) || [];
  const results = [];
  const collectionsIndex = {};
  for (let i = 0; i < edges.length; i++) {
    const n = edges[i].node;
    const giftType = /gift/i.test(n.productType || "");
    const giftTag = (n.tags || []).some((t) => /gift/i.test(t));
    const collEdges = (n.collections && n.collections.edges) || [];
    const collHandles = collEdges.map((ce) => ce.node.handle || "");
    const collGids = collEdges.map((ce) => ce.node.id).filter(Boolean);
    collEdges.forEach((ce) => { if (ce.node.handle && ce.node.id) collectionsIndex[ce.node.handle] = ce.node.id; });
    const giftColl = collHandles.some((h) => /gift/i.test(h));
    if (n.isGiftCard || giftType || giftTag || giftColl) continue;
    const rawOpts = (n.options || []).filter((o) => !(o.name === "Title" && o.values && o.values.length === 1 && o.values[0] === "Default Title"));
    const options = rawOpts.map((o) => ({ name: o.name, values: o.values || [] }));
    const variants = (n.variants && n.variants.edges || []).map((ve) => {
      const vn = ve.node;
      const m = String(vn.id).match(/(\d+)$/);
      return {
        id: m ? parseInt(m[1], 10) : vn.id,
        title: vn.title,
        price: parseFloat(vn.price),
        available: !!vn.availableForSale,
        options: rawOpts.map((opt) => { const so = (vn.selectedOptions || []).find((s) => s.name === opt.name); return so ? so.value : null; }),
      };
    });
    const v = n.variants && n.variants.edges[0] && n.variants.edges[0].node;
    if (!v || !v.availableForSale) continue;
    results.push({ id: n.id, handle: n.handle, variantId: v.id, available: true,
      title: n.title, vendor: n.vendor, tags: n.tags || [], category: (n.productType || "").toLowerCase(),
      price: parseFloat(v.price), img: (n.featuredImage && n.featuredImage.url) || "",
      orders: Math.max(0, limit - i) * 3, views: 0, options, variants,
      collectionGids: collGids,
      createdAt: n.publishedAt || n.createdAt || null });
  }
  results.collectionsIndex = collectionsIndex;
  return results;
}

app.get("/proxy/recommend", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    if (!verifyProxy(req.query)) return res.status(401).send(JSON.stringify({ items: [], error: "bad signature" }));
    const shop = req.query.shop;
    const token = await getToken(shop);
    if (!token) return res.status(200).send(JSON.stringify({ items: [], error: "app not installed for shop" }));
    if (!(await billingOK(shop, token))) return res.status(200).send(JSON.stringify({ items: [], error: "subscription required" }));
    const limit = Math.min(parseInt(req.query.limit || "8", 10), 24);
    const atype = (req.query.atype || "").trim();
    const anum = (req.query.anchor || "").trim();
    let products = await loadProducts(shop, token, 250);
    const settings = await loadSettings();
    const excludeHandles = String(req.query.exclude || "").split(",").map((s) => s.trim()).filter(Boolean);
    const excludeGids = handlesToCollectionGids(excludeHandles, products.collectionsIndex || {});
    const exIds = new Set([...(settings.global.excludedCollections || []), ...excludeGids]);
    if (exIds.size) products = products.filter((p) => !(p.collectionGids || []).some((id) => exIds.has(id)));
    const found = anum ? products.find((p) => p.id.endsWith(anum)) : null;
    const anchor = found || ((atype || req.query.atitle) ? {
      id: "anchor:" + anum,
      title: req.query.atitle || "",
      category: atype.toLowerCase(),
      tags: (req.query.atags || "").split(",").map((s) => s.trim()).filter(Boolean),
      price: parseFloat(req.query.aprice || "0") || 0,
    } : null);
    if (anum) products = products.filter((p) => !p.id.endsWith(anum));
    const items = await recommend({ products, anchor, limit });
    res.status(200).send(JSON.stringify({ items }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ items: [], error: e.message }));
  }
});

// ---------- Public storefront config (theme extensions read component styling) ----------
app.get("/proxy/config", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    if (!verifyProxy(req.query)) return res.status(401).send(JSON.stringify({ error: "bad signature" }));
    const settings = await loadSettings();
    res.status(200).send(JSON.stringify(publicConfig(settings)));
  } catch (e) {
    res.status(200).send(JSON.stringify(publicConfig(await loadSettings().catch(() => null))));
  }
});

// ---------- Public funnel event tracking (impression / click / add_to_cart) ----------
app.post("/proxy/track", express.json({ type: () => true }), async (req, res) => {
  try {
    if (!verifyProxy(req.query)) return res.status(401).end();
    const b = req.body || {};
    await track(b.event, b.source);
  } catch (e) {}
  res.status(204).end();
});

// ---------- Embedded dashboard data (session-token authenticated) ----------
function shopFromSessionToken(idToken) {
  try {
    const [h, p, s] = (idToken || "").split(".");
    if (!h || !p || !s) return null;
    const expected = crypto.createHmac("sha256", API_SECRET).update(h + "." + p).digest("base64url");
    if (expected !== s) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (payload.aud !== API_KEY) return null;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    const shop = (payload.dest || "").replace(/^https?:\/\//, "");
    return validShop(shop) ? shop : null;
  } catch (e) { return null; }
}

async function tokenExchange(shop, idToken) {
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: new URLSearchParams({ client_id: API_KEY, client_secret: API_SECRET, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: idToken, subject_token_type: "urn:ietf:params:oauth:token-type:id_token", requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: "1" }), }).then((x) => x.json()); if (!r || !r.access_token) return null; await setToken(shop, { access_token: r.access_token, refresh_token: r.refresh_token || null, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) });
    try {
      await gql(shop, r.access_token,
        `mutation($u:URL!){ webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription:{ callbackUrl:$u, format: JSON }){ userErrors{ message } } }`,
        { u: HOST + "/webhooks/app_uninstalled" });
    } catch (e) {}
    return r.access_token;
  } catch (e) { return null; }
}

async function loadStats(shop, token, days) {
  const since = new Date(Date.now() - (days || 90) * 864e5).toISOString().slice(0, 10);
  const query = `query($n:Int!,$q:String){ orders(first:$n, reverse:true, query:$q){ edges{ node{ lineItems(first:50){ edges{ node{ title quantity originalTotalSet{ shopMoney{ amount currencyCode } } discountAllocations{ allocatedAmountSet{ shopMoney{ amount } } } customAttributes{ key value } } } } } } } }`;
  const j = await gql(shop, token, query, { n: 100, q: "created_at:>=" + since });
  if (j.errors) { const __es = JSON.stringify(j.errors); const __locked = __es.indexOf("ACCESS_DENIED") >= 0 || __es.indexOf("protected-customer-data") >= 0 || __es.indexOf("not approved to access the Order") >= 0; return { error: __locked ? "orders_locked" : __es, pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] }, sfy_page: { total: 0, revenue: 0, items: [] } }; }
  const orders = (j.data && j.data.orders && j.data.orders.edges) || [];
  const src = { pdp: { items: {}, rev: 0 }, cart_drawer: { items: {}, rev: 0 }, sfy_page: { items: {}, rev: 0 } };
  let currency = "";
  orders.forEach((o) => (o.node.lineItems.edges || []).forEach((le) => {
    const li = le.node; let bokoReco = null, bokoSource = null;
    (li.customAttributes || []).forEach((a) => { if (a.key === "_boko_reco") bokoReco = a.value; if (a.key === "_boko_source") bokoSource = a.value; });
    const tag = bokoReco || (bokoSource === "selected-for-you-page" ? "sfy_page" : null);
    if (tag && src[tag]) {
      const gross = li.originalTotalSet && li.originalTotalSet.shopMoney ? parseFloat(li.originalTotalSet.shopMoney.amount) : 0;
      if (li.originalTotalSet && li.originalTotalSet.shopMoney && li.originalTotalSet.shopMoney.currencyCode) currency = li.originalTotalSet.shopMoney.currencyCode;
      const disc = (li.discountAllocations || []).reduce((s, d) => s + (d.allocatedAmountSet && d.allocatedAmountSet.shopMoney ? parseFloat(d.allocatedAmountSet.shopMoney.amount) : 0), 0);
      const amt = Math.max(0, gross - disc);
      const it = src[tag].items[li.title] || { count: 0, rev: 0 };
      it.count += li.quantity; it.rev += amt; src[tag].items[li.title] = it; src[tag].rev += amt;
    }
  }));
  const pack = (s) => {
    const items = Object.keys(s.items).map((key) => ({ title: key, count: s.items[key].count, revenue: Math.round(s.items[key].rev * 100) / 100 })).sort((a, b) => b.count - a.count);
    return { total: items.reduce((x, i) => x + i.count, 0), revenue: Math.round(s.rev * 100) / 100, items };
  };
  const pdp = pack(src.pdp), cd = pack(src.cart_drawer), sfy = pack(src.sfy_page);
  return { ordersScanned: orders.length, since, currency, totalRevenue: Math.round((pdp.revenue + cd.revenue + sfy.revenue) * 100) / 100, totalItems: pdp.total + cd.total + sfy.total, pdp, cart_drawer: cd, sfy_page: sfy };
}

app.get("/stats", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer /, "");
    const shop = shopFromSessionToken(idToken);
    if (!shop) return res.status(401).send(JSON.stringify({ error: "unauthorized" }));
    let token = await getToken(shop);
    if (!token) token = await tokenExchange(shop, idToken);
    if (!token) return res.status(200).send(JSON.stringify({ error: "not installed", pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] }, sfy_page: { total: 0, revenue: 0, items: [] } }));
    if (!(await billingOK(shop, token))) return res.status(200).send(JSON.stringify({ error: "subscription required", pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] }, sfy_page: { total: 0, revenue: 0, items: [] } }));
    const days = Math.min(parseInt(req.query.days || "90", 10), 365);
    res.status(200).send(JSON.stringify(await loadStats(shop, token, days)));
  } catch (e) {
    res.status(200).send(JSON.stringify({ error: e.message, pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] }, sfy_page: { total: 0, revenue: 0, items: [] } }));
  }
});

app.get("/funnel", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer /, "");
    const shop = shopFromSessionToken(idToken);
    if (!shop) return res.status(401).send(JSON.stringify({ error: "unauthorized" }));
    const days = Math.min(parseInt(req.query.days || "30", 10), 365);
    res.status(200).send(JSON.stringify(await funnelCounts(days)));
  } catch (e) {
    res.status(200).send(JSON.stringify({ error: e.message }));
  }
});

async function loadCollectionsList(shop, token) {
  const query = `query{ collections(first:100){ edges{ node{ id handle title } } } }`;
  const j = await gql(shop, token, query, {});
  const edges = (j.data && j.data.collections && j.data.collections.edges) || [];
  return edges.map((e) => ({ id: e.node.id, handle: e.node.handle, title: e.node.title }));
}

app.get("/settings", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer /, "");
    const shop = shopFromSessionToken(idToken);
    if (!shop) return res.status(401).send(JSON.stringify({ error: "unauthorized" }));
    let token = await getToken(shop);
    if (!token) token = await tokenExchange(shop, idToken);
    const [settings, collections] = await Promise.all([
      loadSettings(),
      token ? loadCollectionsList(shop, token).catch(() => []) : Promise.resolve([]),
    ]);
    res.status(200).send(JSON.stringify({ settings, collections }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ error: e.message }));
  }
});

app.post("/settings", express.json(), async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer /, "");
    const shop = shopFromSessionToken(idToken);
    if (!shop) return res.status(401).send(JSON.stringify({ error: "unauthorized" }));
    const merged = await saveSettings(req.body || {});
    res.status(200).send(JSON.stringify({ settings: merged }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ error: e.message }));
  }
});

// ---------- No-theme-app-extension storefront setup ----------
// Resolves the shop + admin token from either a dashboard session token
// (Authorization: Bearer <id_token>) — used by /setup-theme, /enable-widgets,
// /disable-widgets, /storefront-status.
async function shopAndTokenFromRequest(req) {
  const idToken = (req.headers.authorization || "").replace(/^Bearer /, "");
  const shop = shopFromSessionToken(idToken);
  if (!shop) return { shop: null, token: null };
  let token = await getToken(shop);
  if (!token) token = await tokenExchange(shop, idToken);
  return { shop, token };
}

const SFY_SECTION_KEY = "sections/boko-selected-for-you.liquid";
const SFY_TEMPLATE_KEY = "templates/page.selected-for-you.json";

app.post("/setup-theme", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const { shop, token } = await shopAndTokenFromRequest(req);
    if (!shop) return res.status(401).send(JSON.stringify({ ok: false, error: "unauthorized" }));
    if (!token) return res.status(200).send(JSON.stringify({ ok: false, error: "not installed" }));
    const theme = await getMainTheme(shop, token);
    if (!theme) return res.status(200).send(JSON.stringify({ ok: false, error: "Could not find the shop's main theme." }));
    const sectionRes = await putThemeAsset(shop, token, theme.id, SFY_SECTION_KEY, SFY_SECTION_LIQUID);
    if (!sectionRes.ok) {
      const msg = (sectionRes.json && sectionRes.json.errors) ? JSON.stringify(sectionRes.json.errors) : ("HTTP " + sectionRes.status);
      const needsScope = sectionRes.status === 403 || sectionRes.status === 401;
      return res.status(200).send(JSON.stringify({ ok: false, error: needsScope ? "The store hasn't approved the write_themes permission yet. Reopen the app from Shopify Admin to re-consent, then try again." : ("Could not write the section file: " + msg) }));
    }
    const templateRes = await putThemeAsset(shop, token, theme.id, SFY_TEMPLATE_KEY, JSON.stringify(SFY_PAGE_TEMPLATE, null, 2));
    if (!templateRes.ok) {
      const msg = (templateRes.json && templateRes.json.errors) ? JSON.stringify(templateRes.json.errors) : ("HTTP " + templateRes.status);
      return res.status(200).send(JSON.stringify({ ok: false, error: "Section installed, but the page template failed to write: " + msg }));
    }
    res.status(200).send(JSON.stringify({
      ok: true,
      themeName: theme.name,
      instructions: "Now go to Shopify Admin \u2192 Online Store \u2192 Pages \u2192 Add page (or edit one), name it \u201cSelected For You\u201d, and under Theme template choose \u201cselected-for-you\u201d, then Save.",
    }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ ok: false, error: e.message }));
  }
});

app.get("/storefront-status", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const { shop, token } = await shopAndTokenFromRequest(req);
    if (!shop) return res.status(401).send(JSON.stringify({ error: "unauthorized" }));
    if (!token) return res.status(200).send(JSON.stringify({ error: "not installed" }));
    const theme = await getMainTheme(shop, token);
    const [asset, scriptTag] = await Promise.all([
      theme ? getThemeAsset(shop, token, theme.id, SFY_SECTION_KEY) : Promise.resolve(null),
      findStorefrontScriptTag(shop, token),
    ]);
    res.status(200).send(JSON.stringify({
      themeName: theme ? theme.name : null,
      themeInstalled: !!asset,
      widgetsEnabled: !!scriptTag,
    }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ error: e.message }));
  }
});

app.post("/enable-widgets", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const { shop, token } = await shopAndTokenFromRequest(req);
    if (!shop) return res.status(401).send(JSON.stringify({ ok: false, error: "unauthorized" }));
    if (!token) return res.status(200).send(JSON.stringify({ ok: false, error: "not installed" }));
    const existing = await findStorefrontScriptTag(shop, token);
    if (existing) return res.status(200).send(JSON.stringify({ ok: true, alreadyEnabled: true }));
    const j = await gql(shop, token,
      `mutation($input:ScriptTagInput!){ scriptTagCreate(input:$input){ scriptTag{ id src } userErrors{ field message } } }`,
      { input: { src: HOST + "/storefront.js", displayScope: "ONLINE_STORE", cache: false } });
    const userErrors = j.data && j.data.scriptTagCreate && j.data.scriptTagCreate.userErrors;
    if (userErrors && userErrors.length) return res.status(200).send(JSON.stringify({ ok: false, error: userErrors.map((e) => e.message).join("; ") }));
    if (j.errors) return res.status(200).send(JSON.stringify({ ok: false, error: JSON.stringify(j.errors) }));
    res.status(200).send(JSON.stringify({ ok: true }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ ok: false, error: e.message }));
  }
});

app.post("/disable-widgets", async (req, res) => {
  res.set("Content-Type", "application/json");
  try {
    const { shop, token } = await shopAndTokenFromRequest(req);
    if (!shop) return res.status(401).send(JSON.stringify({ ok: false, error: "unauthorized" }));
    if (!token) return res.status(200).send(JSON.stringify({ ok: false, error: "not installed" }));
    const existing = await findStorefrontScriptTag(shop, token);
    if (!existing) return res.status(200).send(JSON.stringify({ ok: true, alreadyDisabled: true }));
    const j = await gql(shop, token,
      `mutation($id:ID!){ scriptTagDelete(id:$id){ deletedScriptTagId userErrors{ message } } }`,
      { id: existing.id });
    const userErrors = j.data && j.data.scriptTagDelete && j.data.scriptTagDelete.userErrors;
    if (userErrors && userErrors.length) return res.status(200).send(JSON.stringify({ ok: false, error: userErrors.map((e) => e.message).join("; ") }));
    res.status(200).send(JSON.stringify({ ok: true }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ ok: false, error: e.message }));
  }
});

// ---------- Public storefront widgets script (served via ScriptTag, no theme-app-extension) ----------
app.get("/storefront.js", (req, res) => {
  res.set("Content-Type", "application/javascript; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(STOREFRONT_JS);
});

const DASHBOARD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
__APP_BRIDGE__
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
.hero .v{font-size:40px;font-weight:700;letter-spacing:-1px}.hero .lime{color:var(--lime)}.hero .x{color:#bdbdbd;font-size:14px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}@media(max-width:960px){.cards{grid-template-columns:1fr 1fr}}@media(max-width:600px){.cards{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 2px 16px rgba(0,0,0,.05)}
.big{font-size:34px;font-weight:700;letter-spacing:-1px;margin:0}.rev{font-size:15px;color:#1f7a45;font-weight:600;margin:2px 0 0}
.pill{display:inline-block;background:var(--lime);color:#0a0a0a;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 10px;border-radius:99px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600}td.n{text-align:right;font-weight:600}td.r{text-align:right;color:#1f7a45}
.empty{color:var(--muted);font-size:13px;padding:14px 0}.err{background:#fdeceb;border:1px solid #f6cdc8;color:#7a1d13;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:16px}
.foot{color:var(--muted);font-size:12px;margin-top:20px;text-align:center}
.how-to{background:#fff;border:1px solid var(--line);border-radius:14px;padding:0;margin-bottom:20px;overflow:hidden}
.how-to summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;padding:18px 24px;font-size:16px;font-weight:600;letter-spacing:-.2px;user-select:none}
.how-to summary::-webkit-details-marker{display:none}
.how-to summary .chev{display:inline-block;font-style:normal;font-size:13px;transition:transform .2s;color:var(--muted)}
.how-to[open] summary .chev{transform:rotate(90deg)}
.how-to__body{padding:0 24px 20px}
.how-to__list{margin:0 0 14px;padding-left:20px;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.6}
.how-to__list li strong{font-weight:600}
.how-to__code{font-family:ui-monospace,"SFMono-Regular",monospace;font-size:12px;background:#f5f5f5;padding:2px 5px;border-radius:4px;white-space:nowrap}
.how-to__help{font-size:13px;color:var(--muted);margin:0}
.how-to__help a{color:var(--ink);font-weight:500}
.tabs{display:flex;gap:6px;margin-bottom:20px;border-bottom:1px solid var(--line)}
.tab-btn{font:inherit;font-weight:600;font-size:14px;background:none;border:none;padding:10px 4px;margin-right:18px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}
.tab-btn.active{color:var(--ink);border-bottom-color:var(--ink)}
.cz-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}@media(max-width:960px){.cz-grid{grid-template-columns:1fr}}
.cz-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px}
.cz-card h3{margin:0 0 14px;font-size:15px;font-weight:600}
.cz-field{margin-bottom:10px}
.cz-field label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.cz-field input[type=text],.cz-field input[type=number]{width:100%;font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#fff}
.cz-field input[type=color]{width:48px;height:32px;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff}
.cz-row2{display:flex;gap:10px}.cz-row2>div{flex:1}
.cz-global{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px}
.cz-global h3{margin:0 0 6px;font-size:15px;font-weight:600}
.cz-multiselect{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.cz-chip{display:flex;align-items:center;gap:6px;font-size:13px;border:1px solid var(--line);border-radius:99px;padding:5px 12px;cursor:pointer;user-select:none}
.cz-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.cz-save{display:flex;align-items:center;gap:12px}
.cz-save button{font:inherit;font-weight:600;background:var(--ink);color:#fff;border:none;border-radius:8px;padding:10px 20px;cursor:pointer}
.cz-status{font-size:13px;color:var(--muted)}
.sf-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
.sf-card h3{margin:0 0 6px;font-size:15px;font-weight:600}
.sf-card p{margin:0 0 14px}
.sf-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sf-row button{font:inherit;font-weight:600;background:var(--ink);color:#fff;border:none;border-radius:8px;padding:10px 18px;cursor:pointer}
.sf-row button:disabled{opacity:.5;cursor:default}
.sf-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px;background:#f0f2f5;color:var(--muted)}
.sf-status.on{background:#e6f7ea;color:#1f7a45}
.sf-msg{font-size:13px;color:var(--muted);margin-top:10px}
.sf-msg.err{color:#7a1d13}
.switch{position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;inset:0;background:#ccc;border-radius:24px;transition:.15s}
.slider:before{position:absolute;content:"";height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.15s}
input:checked+.slider{background:var(--ink)}
input:checked+.slider:before{transform:translateX(18px)}
input:disabled+.slider{opacity:.5;cursor:default}
</style></head><body><div class="wrap">
<h1>Boko AI Recommendations</h1>
<div class="tabs">
  <button class="tab-btn active" id="tabBtnPerf" type="button">Performance</button>
  <button class="tab-btn" id="tabBtnCz" type="button">Customizer</button>
  <button class="tab-btn" id="tabBtnSf" type="button" style="display:none">Storefront setup</button>
</div>
<div id="tab-performance">
<p class="sub">Items and revenue from products added via your recommendation widgets.</p>
<details class="how-to">
<summary>How to use <span class="chev">&#9658;</span></summary>
<div class="how-to__body">
<ol class="how-to__list">
  <li><strong>Product page recommendations:</strong> Online Store &gt; Themes &gt; Customize &gt; pick a Products template &gt; Add block &gt; choose <em>AI Recommendations</em> (under Apps) &gt; Save.</li>
  <li><strong>Cart drawer recommendations:</strong> In Customize, open App embeds (puzzle icon) &gt; turn ON <em>AI Cart Recommendations</em> &gt; Save. (It shows only when the cart has items.)</li>
  <li><strong>Customise:</strong> Use the Customizer tab above, or click the block/embed in the theme editor, to set heading, products per row, number of products, bundle discount, fonts and layout.</li>
</ol>
<p class="how-to__help">Need help? Contact <a href="mailto:admin@boko.com.au">admin@boko.com.au</a>.</p>
</div>
</details>
<div class="row"><label class="sub" style="margin:0">Period</label>
<select id="days"><option value="30">Last 30 days</option><option value="90" selected>Last 90 days</option><option value="365">Last 12 months</option></select>
<span id="meta" class="sub" style="margin:0 0 0 auto"></span></div>
<div id="err"></div>
<div class="hero"><div><div class="v lime" id="revTotal">–</div><div class="x">total revenue from recommendations</div></div>
<div style="margin-left:auto"><div class="v" id="itemTotal">–</div><div class="x">items purchased</div></div></div>
<div class="cards">
  <div class="card"><span class="pill">Product page rail</span><div class="big" id="pdpTotal">–</div><div class="rev" id="pdpRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="pdpRows"></tbody></table></div>
  <div class="card"><span class="pill">Cart drawer carousel</span><div class="big" id="cdTotal">–</div><div class="rev" id="cdRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="cdRows"></tbody></table></div>
  <div class="card"><span class="pill">Selected For You collection</span><div class="big" id="sfyTotal">–</div><div class="rev" id="sfyRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="sfyRows"></tbody></table></div>
</div><p class="foot" id="foot"></p>
</div>
<div id="tab-customizer" style="display:none">
<p class="sub">Style each recommendation widget and choose which collections to always exclude.</p>
<div id="czErr"></div>
<div class="cz-grid" id="czGrid"></div>
<div class="cz-global">
  <h3>Excluded collections</h3>
  <p class="sub" style="margin:0">Products in these collections never appear in any recommendation widget.</p>
  <div class="cz-multiselect" id="czCollections"></div>
</div>
<div class="cz-save"><button id="czSaveBtn" type="button">Save changes</button><span class="cz-status" id="czStatus"></span></div>
</div>
<div id="tab-storefront" style="display:none">
<p class="sub">Install widgets directly on your storefront — no app-embed or theme editor step required.</p>
<div class="sf-card">
  <h3>Selected For You page <span class="sf-status" id="sfThemeStatus">checking…</span></h3>
  <p class="sub" style="margin:0 0 14px">Adds a page section and template to your current theme (<span id="sfThemeName">–</span>) so shoppers can browse a personalized "Selected For You" page.</p>
  <div class="sf-row"><button id="sfInstallBtn" type="button">Install to my theme</button></div>
  <div class="sf-msg" id="sfThemeMsg"></div>
</div>
<div class="sf-card">
  <h3>Product page rail &amp; cart drawer widgets <span class="sf-status" id="sfWidgetStatus">checking…</span></h3>
  <p class="sub" style="margin:0 0 14px">Adds a small script to your storefront that shows a recommendation rail on product pages and a carousel in the cart drawer — no theme edits needed.</p>
  <div class="sf-row"><label class="switch"><input type="checkbox" id="sfWidgetToggle" disabled><span class="slider"></span></label><span class="sub" style="margin:0">Enable rail &amp; cart widgets</span></div>
  <div class="sf-msg" id="sfWidgetMsg"></div>
</div>
</div>
<script>
var CUR="";
function fmt(n){try{return new Intl.NumberFormat(undefined,{style:"currency",currency:CUR||"USD"}).format(n||0);}catch(e){return "$"+(Number(n||0)).toFixed(2);}}
function rows(tb,items){tb.innerHTML=(items&&items.length)?items.map(function(i){return "<tr><td>"+i.title+"</td><td class='n'>"+i.count+"</td><td class='r'>"+fmt(i.revenue)+"</td></tr>";}).join(""):"<tr><td colspan='3' class='empty'>No purchases yet from this source.</td></tr>";}
async function authedFetch(url){
  var headers={Accept:"application/json"};
  try{ if(window.shopify&&shopify.idToken){ var t=await shopify.idToken(); headers.Authorization="Bearer "+t; } }catch(e){}
  return fetch(url,{headers:headers}).then(function(r){return r.json();});
}
async function authedPost(url){
  var headers={Accept:"application/json","Content-Type":"application/json"};
  try{ if(window.shopify&&shopify.idToken){ var t=await shopify.idToken(); headers.Authorization="Bearer "+t; } }catch(e){}
  return fetch(url,{method:"POST",headers:headers}).then(function(r){return r.json();});
}
function load(){
  var days=document.getElementById("days").value;
  authedFetch("/stats?days="+days).then(function(d){
    CUR=d.currency||"USD";
    var shopParam=new URLSearchParams(window.location.search).get("shop")||"";
    document.getElementById("err").innerHTML=(function(){if(!d.error)return"";if(d.error==="unauthorized")return "<div class='err'>Couldn't verify your session. Open this from Shopify Admin &rarr; Apps.</div>";if(d.error==="subscription required")return "<div class='err'>An active subscription is required. <a href='/billing/start?shop="+encodeURIComponent(shopParam)+"' target='_top'>Subscribe now</a>.</div>";if(d.error==="orders_locked")return "<div style='background:#eef4ff;border:1px solid #c9d8f5;color:#33415c;padding:10px 14px;border-radius:8px;font-size:13px'>Revenue from recommendations will appear once Shopify approves protected customer data access for this app. Your recommendation widgets are fully active.</div>";return "<div class='err'>Couldn't load stats: "+d.error+"</div>";})();
    document.getElementById("revTotal").textContent=fmt(d.totalRevenue);
    document.getElementById("itemTotal").textContent=(d.totalItems!=null?d.totalItems:0);
    document.getElementById("pdpTotal").textContent=(d.pdp&&d.pdp.total)||0;
    document.getElementById("cdTotal").textContent=(d.cart_drawer&&d.cart_drawer.total)||0;
    document.getElementById("sfyTotal").textContent=(d.sfy_page&&d.sfy_page.total)||0;
    document.getElementById("pdpRev").textContent="Revenue: "+fmt(d.pdp&&d.pdp.revenue);
    document.getElementById("cdRev").textContent="Revenue: "+fmt(d.cart_drawer&&d.cart_drawer.revenue);
    document.getElementById("sfyRev").textContent="Revenue: "+fmt(d.sfy_page&&d.sfy_page.revenue);
    rows(document.getElementById("pdpRows"),d.pdp&&d.pdp.items);
    rows(document.getElementById("cdRows"),d.cart_drawer&&d.cart_drawer.items);
    rows(document.getElementById("sfyRows"),d.sfy_page&&d.sfy_page.items);
    document.getElementById("meta").textContent=d.ordersScanned!=null?(d.ordersScanned+" recent orders scanned"):"";
    document.getElementById("foot").textContent="Counts reflect orders since "+(d.since||"")+" whose items were added via a Boko recommendation widget.";
  }).catch(function(){document.getElementById("err").innerHTML="<div class='err'>Couldn't load stats.</div>";});
}
document.getElementById("days").addEventListener("change",load); load();

var CZ_COMPONENTS=[["rail","Product page rail"],["cart","Cart drawer carousel"],["sfy","Selected For You collection"]];
var czState=null, czCollections=[], czLoaded=false;
function czField(comp,key,label,type,extra){
  extra=extra||"";
  return "<div class='cz-field'><label>"+label+"</label><input "+extra+" type='"+type+"' data-comp='"+comp+"' data-key='"+key+"' id='cz-"+comp+"-"+key+"'></div>";
}
function renderCzGrid(){
  var html="";
  CZ_COMPONENTS.forEach(function(pair){
    var comp=pair[0], label=pair[1];
    html+="<div class='cz-card'><h3>"+label+"</h3>"+
      czField(comp,"headingFont","Heading font","text")+
      czField(comp,"bodyFont","Body font","text")+
      "<div class='cz-row2'>"+czField(comp,"headingSize","Heading size (px)","number")+czField(comp,"count","Number of products","number")+"</div>"+
      "<div class='cz-row2'>"+czField(comp,"titleSize","Title size (px)","number")+czField(comp,"columns","Columns","number")+"</div>"+
      "<div class='cz-row2'>"+czField(comp,"priceSize","Price size (px)","number")+"<div></div></div>"+
      "<div class='cz-row2'>"+czField(comp,"headingColor","Heading color","color")+czField(comp,"titleColor","Title color","color")+"</div>"+
      "<div class='cz-row2'>"+czField(comp,"priceColor","Price color","color")+czField(comp,"saleColor","Sale color","color")+"</div>"+
      "<div class='cz-row2'>"+czField(comp,"addBg","Add-to-cart background","color")+czField(comp,"addText","Add-to-cart text","color")+"</div>"+
      "</div>";
  });
  document.getElementById("czGrid").innerHTML=html;
}
function fillCzForm(settings){
  CZ_COMPONENTS.forEach(function(pair){
    var comp=pair[0]; var s=(settings&&settings[comp])||{};
    Object.keys(s).forEach(function(key){
      var el=document.getElementById("cz-"+comp+"-"+key);
      if(el) el.value=s[key];
    });
  });
}
function renderCzCollections(collections,excluded){
  var ex=new Set(excluded||[]);
  document.getElementById("czCollections").innerHTML=(collections&&collections.length)?collections.map(function(c){
    return "<span class='cz-chip"+(ex.has(c.id)?" on":"")+"' data-gid='"+c.id+"'>"+c.title+"</span>";
  }).join(""):"<span class='sub' style='margin:0'>No collections found.</span>";
  Array.prototype.forEach.call(document.querySelectorAll(".cz-chip"),function(chip){
    chip.addEventListener("click",function(){ chip.classList.toggle("on"); });
  });
}
function collectCzForm(){
  var out={global:{excludedCollections:[]}};
  CZ_COMPONENTS.forEach(function(pair){
    var comp=pair[0]; out[comp]={};
    Array.prototype.forEach.call(document.querySelectorAll("[data-comp='"+comp+"']"),function(el){
      var key=el.getAttribute("data-key");
      var v=el.type==="number"?parseFloat(el.value)||0:el.value;
      out[comp][key]=v;
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".cz-chip.on"),function(chip){
    out.global.excludedCollections.push(chip.getAttribute("data-gid"));
  });
  return out;
}
function loadCustomizer(){
  if(czLoaded) return;
  renderCzGrid();
  authedFetch("/settings").then(function(d){
    if(d.error){ document.getElementById("czErr").innerHTML="<div class='err'>Couldn't load settings: "+d.error+"</div>"; return; }
    czState=d.settings; czCollections=d.collections||[];
    fillCzForm(czState);
    renderCzCollections(czCollections,czState.global&&czState.global.excludedCollections);
    czLoaded=true;
  }).catch(function(){ document.getElementById("czErr").innerHTML="<div class='err'>Couldn't load settings.</div>"; });
}
document.getElementById("czSaveBtn").addEventListener("click",function(){
  var status=document.getElementById("czStatus");
  status.textContent="Saving…";
  var body=collectCzForm();
  var headers={Accept:"application/json","Content-Type":"application/json"};
  (async function(){
    try{ if(window.shopify&&shopify.idToken){ var t=await shopify.idToken(); headers.Authorization="Bearer "+t; } }catch(e){}
    fetch("/settings",{method:"POST",headers:headers,body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(d){
      if(d.error){ status.textContent="Error: "+d.error; return; }
      czState=d.settings; status.textContent="Saved.";
      setTimeout(function(){ status.textContent=""; },2500);
    }).catch(function(){ status.textContent="Couldn't save changes."; });
  })();
});
var sfLoaded=false;
function sfSetStatus(el,on,onText,offText){
  el.textContent=on?onText:offText;
  el.classList.toggle("on",!!on);
}
function loadStorefront(){
  if(sfLoaded) return;
  sfLoaded=true;
  authedFetch("/storefront-status").then(function(d){
    if(d.error){
      document.getElementById("sfThemeMsg").innerHTML="<span class='err'>Couldn't load status: "+d.error+"</span>";
      return;
    }
    document.getElementById("sfThemeName").textContent=d.themeName||"–";
    sfSetStatus(document.getElementById("sfThemeStatus"),d.themeInstalled,"Installed","Not installed");
    sfSetStatus(document.getElementById("sfWidgetStatus"),d.widgetsEnabled,"Enabled","Disabled");
    var toggle=document.getElementById("sfWidgetToggle");
    toggle.checked=!!d.widgetsEnabled;
    toggle.disabled=false;
  }).catch(function(){
    document.getElementById("sfThemeMsg").innerHTML="<span class='err'>Couldn't load status.</span>";
  });
}
document.getElementById("sfInstallBtn").addEventListener("click",function(){
  var btn=document.getElementById("sfInstallBtn");
  var msg=document.getElementById("sfThemeMsg");
  btn.disabled=true; msg.className="sf-msg"; msg.textContent="Installing…";
  authedPost("/setup-theme").then(function(d){
    btn.disabled=false;
    if(!d.ok){ msg.className="sf-msg err"; msg.textContent=d.error||"Something went wrong."; return; }
    sfSetStatus(document.getElementById("sfThemeStatus"),true,"Installed","Not installed");
    document.getElementById("sfThemeName").textContent=d.themeName||"–";
    msg.className="sf-msg"; msg.textContent=d.instructions||"Installed.";
  }).catch(function(){
    btn.disabled=false; msg.className="sf-msg err"; msg.textContent="Couldn't reach the server.";
  });
});
document.getElementById("sfWidgetToggle").addEventListener("change",function(){
  var toggle=this; var msg=document.getElementById("sfWidgetMsg");
  var enabling=toggle.checked;
  toggle.disabled=true; msg.className="sf-msg"; msg.textContent=enabling?"Enabling…":"Disabling…";
  authedPost(enabling?"/enable-widgets":"/disable-widgets").then(function(d){
    toggle.disabled=false;
    if(!d.ok){ msg.className="sf-msg err"; msg.textContent=d.error||"Something went wrong."; toggle.checked=!enabling; return; }
    sfSetStatus(document.getElementById("sfWidgetStatus"),enabling,"Enabled","Disabled");
    msg.textContent="";
  }).catch(function(){
    toggle.disabled=false; msg.className="sf-msg err"; msg.textContent="Couldn't reach the server."; toggle.checked=!enabling;
  });
});
function showTab(name){
  document.getElementById("tab-performance").style.display=(name==="perf")?"":"none";
  document.getElementById("tab-customizer").style.display=(name==="cz")?"":"none";
  document.getElementById("tab-storefront").style.display=(name==="sf")?"":"none";
  document.getElementById("tabBtnPerf").classList.toggle("active",name==="perf");
  document.getElementById("tabBtnCz").classList.toggle("active",name==="cz");
  document.getElementById("tabBtnSf").classList.toggle("active",name==="sf");
  if(name==="cz") loadCustomizer();
  if(name==="sf") loadStorefront();
}
document.getElementById("tabBtnPerf").addEventListener("click",function(){showTab("perf");});
document.getElementById("tabBtnCz").addEventListener("click",function(){showTab("cz");});
document.getElementById("tabBtnSf").addEventListener("click",function(){showTab("sf");});

/* Boko dashboard enhancer — Customizer redesign + Widgets tab. Purely additive. */
(function(){
  "use strict";
  try{
  if(window.__bokoEnh) return; window.__bokoEnh=1;
  function byId(id){return document.getElementById(id);}
  var COMPS=[
    ["rail","Product page rail","The “You may also like” row on product pages."],
    ["cart","Cart drawer carousel","Suggestions shown inside the cart drawer."],
    ["sfy","Selected For You collection","The full recommendations page grid."]
  ];

  var css=""
   +".bkz-wrap{max-width:900px}"
   +".bkz-card{border:1px solid #e4e4ec;border-radius:14px;margin:14px 0;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(20,20,50,.05)}"
   +".bkz-head{display:flex;align-items:center;gap:12px;padding:15px 18px;cursor:pointer;user-select:none}"
   +".bkz-head:hover{background:#faf9ff}"
   +".bkz-dot{width:10px;height:10px;border-radius:50%;background:#6b4dff;flex:0 0 auto}"
   +".bkz-htxt{flex:1;min-width:0}"
   +".bkz-htxt b{display:block;font-size:15px;color:#191932;line-height:1.3}"
   +".bkz-htxt span{font-size:12.5px;color:#70708a}"
   +".bkz-chev{transition:transform .2s;color:#a2a2b8;font-size:20px;line-height:1}"
   +".bkz-card.open .bkz-chev{transform:rotate(90deg)}"
   +".bkz-body{display:none;padding:2px 18px 18px}"
   +".bkz-card.open .bkz-body{display:block}"
   +".bkz-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}"
   +".bkz-field label{display:block;font-size:12px;font-weight:600;color:#565672;margin:0 0 4px}"
   +".bkz-field input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #dadae4;border-radius:9px;font-size:13px;background:#fff}"
   +".bkz-field input:focus{outline:none;border-color:#6b4dff;box-shadow:0 0 0 3px rgba(107,77,255,.12)}"
   +".bkz-field input[type=color]{padding:3px;height:38px;cursor:pointer}"
   +".bkz-adv{margin-top:14px;border-top:1px dashed #e4e4ec;padding-top:12px}"
   +".bkz-adv>summary{cursor:pointer;font-size:12.5px;font-weight:700;color:#6b4dff;list-style:none;display:inline-flex;align-items:center;gap:6px}"
   +".bkz-adv>summary::-webkit-details-marker{display:none}"
   +".bkz-adv>summary:before{content:'\\002B';font-weight:700}"
   +".bkz-adv[open]>summary:before{content:'\\2212'}"
   +".bkz-adv[open]>summary{margin-bottom:12px}"
   +".bkz-prev{border:1px solid #ececf3;border-radius:12px;padding:16px;margin:4px 0 16px;background:#fbfbfe}"
   +".bkz-prev .pv-h{font-weight:700;margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8a8aa2}"
   +".bkz-prev .pv-card{border:1px solid #ededf2;border-radius:10px;overflow:hidden;max-width:180px;background:#fff}"
   +".bkz-prev .pv-img{height:110px;background:linear-gradient(135deg,#efeafe,#e7f0ff)}"
   +".bkz-prev .pv-b{padding:10px}"
   +".bkz-prev .pv-t{margin:0 0 6px;font-size:14px;color:#191932}"
   +".bkz-prev .pv-p b{color:#111}"
   +".bkz-prev .pv-p s{color:#b6b6c4;margin-left:6px;font-weight:400}"
   +".bkz-prev .pv-btn{margin-top:10px;display:inline-block;padding:8px 14px;border-radius:8px;background:#111;color:#fff;font-size:12px}"
   +".bkz-note{font-size:11px;color:#a2a2b8;margin-top:10px;line-height:1.4}"
   +".bkz-wtab .card{max-width:520px}"
   +"@media(max-width:640px){.bkz-grid2{grid-template-columns:1fr}}";
  var st=document.createElement("style"); st.textContent=css; document.head.appendChild(st);

  function labelText(f){ var l=f.querySelector("label"); return l?(l.textContent||"").toLowerCase():""; }
  function isAdvanced(f){ var t=labelText(f); return t.indexOf("color")>-1||t.indexOf("colour")>-1||t.indexOf("size")>-1; }
  function fieldByLabel(scope,txt){ var fs=scope.querySelectorAll(".bkz-field,.cz-field"); for(var i=0;i<fs.length;i++){ if(labelText(fs[i]).indexOf(txt)>-1) return fs[i].querySelector("input"); } return null; }

  function buildPreview(comp){
    var w=document.createElement("div"); w.className="bkz-prev"; w.setAttribute("data-prev",comp);
    w.innerHTML="<div class='pv-h'>Live preview</div>"
      +"<div class='pv-card'><div class='pv-img'></div><div class='pv-b'>"
      +"<div class='pv-t'>Sample product</div>"
      +"<div class='pv-p'><b>$49.00</b><s>$69.00</s></div>"
      +"<div class='pv-btn'>Add to cart</div></div></div>"
      +"<div class='bkz-note'>Colours &amp; sizes update instantly and match your storefront. The font shown is illustrative — the live widget uses your theme's own font.</div>";
    return w;
  }
  function applyPreview(card){
    try{
      var pv=card.querySelector("[data-prev]"); if(!pv) return;
      var t=pv.querySelector(".pv-t"), pb=pv.querySelector(".pv-p b"), ps=pv.querySelector(".pv-p s"), btn=pv.querySelector(".pv-btn");
      var tSize=fieldByLabel(card,"title size"), pSize=fieldByLabel(card,"price size");
      var tCol=fieldByLabel(card,"title color")||fieldByLabel(card,"title colour");
      var pCol=fieldByLabel(card,"price color")||fieldByLabel(card,"price colour");
      var saleCol=fieldByLabel(card,"sale color")||fieldByLabel(card,"sale colour");
      var atcBg=fieldByLabel(card,"cart background"), atcTx=fieldByLabel(card,"cart text");
      if(t&&tSize&&tSize.value) t.style.fontSize=parseFloat(tSize.value)+"px";
      if(t&&tCol&&tCol.value) t.style.color=tCol.value;
      if(pb&&pSize&&pSize.value) pb.style.fontSize=parseFloat(pSize.value)+"px";
      if(pb&&pCol&&pCol.value) pb.style.color=pCol.value;
      if(ps&&saleCol&&saleCol.value) ps.style.color=saleCol.value;
      if(btn&&atcBg&&atcBg.value) btn.style.background=atcBg.value;
      if(btn&&atcTx&&atcTx.value) btn.style.color=atcTx.value;
    }catch(e){}
  }

  function enhanceCz(){
    try{
      var grid=byId("czGrid"); if(!grid) return;
      if(grid.getAttribute("data-bkz")==="1") return;
      var fields=[].slice.call(grid.querySelectorAll(".cz-field"));
      if(!fields.length) return;
      grid.setAttribute("data-bkz","1");
      var coll=byId("czCollections");
      var wrap=document.createElement("div"); wrap.className="bkz-wrap";
      COMPS.forEach(function(c,idx){
        var comp=c[0];
        var mine=fields.filter(function(f){ var i=f.querySelector("[data-comp]"); return i&&i.getAttribute("data-comp")===comp; });
        if(!mine.length) return;
        var card=document.createElement("div"); card.className="bkz-card"+(idx===0?" open":"");
        var head=document.createElement("div"); head.className="bkz-head";
        head.innerHTML="<span class='bkz-dot'></span><span class='bkz-htxt'><b>"+c[1]+"</b><span>"+c[2]+"</span></span><span class='bkz-chev'>›</span>";
        head.addEventListener("click",function(){ card.classList.toggle("open"); });
        var body=document.createElement("div"); body.className="bkz-body";
        body.appendChild(buildPreview(comp));
        var basic=document.createElement("div"); basic.className="bkz-grid2";
        var adv=document.createElement("details"); adv.className="bkz-adv";
        var sum=document.createElement("summary"); sum.textContent="Advanced — sizes & colours"; adv.appendChild(sum);
        var advGrid=document.createElement("div"); advGrid.className="bkz-grid2"; adv.appendChild(advGrid);
        mine.forEach(function(f){ f.classList.add("bkz-field"); (isAdvanced(f)?advGrid:basic).appendChild(f); });
        body.appendChild(basic); body.appendChild(adv);
        if(comp==="sfy"&&coll){
          var cc=document.createElement("div"); cc.style.marginTop="14px";
          var h=document.createElement("div"); h.className="bkz-field"; h.innerHTML="<label>Exclude collections from recommendations</label>";
          cc.appendChild(h); cc.appendChild(coll); body.appendChild(cc);
        }
        card.appendChild(head); card.appendChild(body); wrap.appendChild(card);
        body.addEventListener("input",function(){ applyPreview(card); });
        setTimeout(function(){ applyPreview(card); },0);
      });
      grid.innerHTML=""; grid.appendChild(wrap);
      setTimeout(function(){ [].forEach.call(document.querySelectorAll(".bkz-card"),applyPreview); },700);
      setTimeout(function(){ [].forEach.call(document.querySelectorAll(".bkz-card"),applyPreview); },1600);
    }catch(e){}
  }
  try{
    var g0=byId("czGrid");
    if(g0){
      var mo=new MutationObserver(function(){ var g=byId("czGrid"); if(g&&g.getAttribute("data-bkz")!=="1"&&g.querySelector(".cz-field")){ enhanceCz(); } });
      mo.observe(g0,{childList:true,subtree:true});
    }
    setTimeout(function(){ var g=byId("czGrid"); if(g&&g.querySelector(".cz-field")) enhanceCz(); },350);
  }catch(e){}

  /* ---------- Widgets tab ---------- */
  try{
    var czBtn=byId("tabBtnCz");
    var bar=czBtn?czBtn.parentNode:null;
    if(bar&&!byId("tabBtnWi")){
      var b=document.createElement("button"); b.className="tab-btn"; b.id="tabBtnWi"; b.type="button"; b.textContent="Widgets";
      if(czBtn.nextSibling) bar.insertBefore(b,czBtn.nextSibling); else bar.appendChild(b);
      var panel=document.createElement("div"); panel.id="tab-widgets"; panel.className="bkz-wtab"; panel.style.display="none";
      panel.innerHTML="<h2 style='margin:0 0 6px'>Storefront widgets</h2>"
        +"<p class='sub' style='margin:0 0 16px;color:#70708a'>Turn the product-page rail and cart-drawer carousel on or off across your storefront.</p>";
      var host=byId("tab-customizer")?byId("tab-customizer").parentNode:document.body;
      host.appendChild(panel);
      var row=document.querySelector(".sf-row");
      var stat=byId("sfWidgetStatus"), msg=byId("sfWidgetMsg");
      var box=document.createElement("div"); box.className="card"; box.style.padding="18px";
      var hd=document.createElement("div"); hd.style.cssText="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap";
      hd.innerHTML="<b style='font-size:15px'>Rail &amp; cart widgets</b>";
      if(stat) hd.appendChild(stat);
      box.appendChild(hd);
      if(row) box.appendChild(row);
      if(msg) box.appendChild(msg); else { var m=document.createElement("div"); m.id="sfWidgetMsg"; m.className="sf-msg"; box.appendChild(m); }
      panel.appendChild(box);

      function hideWi(){ var w=byId("tab-widgets"); if(w) w.style.display="none"; var bt=byId("tabBtnWi"); if(bt) bt.classList.remove("active"); }
      var pB=byId("tabBtnPerf"); if(pB) pB.addEventListener("click",hideWi);
      if(czBtn) czBtn.addEventListener("click",hideWi);
      b.addEventListener("click",function(){
        ["tab-performance","tab-customizer","tab-storefront"].forEach(function(id){ var e=byId(id); if(e) e.style.display="none"; });
        ["tabBtnPerf","tabBtnCz","tabBtnSf"].forEach(function(id){ var e=byId(id); if(e) e.classList.remove("active"); });
        var w=byId("tab-widgets"); if(w) w.style.display="";
        b.classList.add("active");
        if(typeof window.loadStorefront==="function"){ try{ window.loadStorefront(); }catch(e){} }
      });
    }
  }catch(e){}
  }catch(err){}
})();
</script></body></html>`;

app.get("/dashboard", (req, res) => {
  const shop = req.query.shop || "";
  const frameShop = validShop(shop) ? shop : "*.myshopify.com";
  res.set("Content-Security-Policy", "frame-ancestors https://" + frameShop + " https://admin.shopify.com");
  const ab = '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="' + API_KEY + '"></script>';
  res.set("Content-Type", "text/html").status(200).send(DASHBOARD.replace("__APP_BRIDGE__", ab));
});

// ---------- Webhook HMAC verification ----------
function verifyWebhook(req) {
  const hmac = req.get("X-Shopify-Hmac-Sha256") || "";
  const digest = crypto.createHmac("sha256", API_SECRET).update(req.body).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac)); } catch (e) { return false; }
}

// ---------- Uninstall webhook (HMAC verified) — removes only this shop's token ----------
app.post("/webhooks/app_uninstalled", (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send("bad hmac");
  const shop = req.get("X-Shopify-Shop-Domain");
  if (validShop(shop)) { delToken(shop); setBilled(shop, false); }
  res.status(200).send("ok");
});

// ---------- GDPR / compliance webhooks ----------
app.post("/webhooks/customers/data_request", (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send("bad hmac");
  res.status(200).send("ok");
});

app.post("/webhooks/customers/redact", (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send("bad hmac");
  res.status(200).send("ok");
});

app.post("/webhooks/shop/redact", async (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send("bad hmac");
  const shop = req.get("X-Shopify-Shop-Domain");
  if (validShop(shop)) { await delToken(shop); await setBilled(shop, false); }
  res.status(200).send("ok");
});

app.post("/webhooks/compliance", async (req, res) => {
  if (!verifyWebhook(req)) return res.status(401).send("bad hmac");
  const topic = req.get("X-Shopify-Topic") || "";
  if (topic === "shop/redact") {
    const shop = req.get("X-Shopify-Shop-Domain");
    if (validShop(shop)) { await delToken(shop); await setBilled(shop, false); }
  }
  res.status(200).send("ok");
});

// ---------- Entry / health ----------
app.get("/", async (req, res) => {
  res.set("Cache-Control","no-store, max-age=0");
  const shop = req.query.shop;
  if (validShop(shop)) {
    const token = await getToken(shop);
    return res.redirect(token ? ("/dashboard?shop=" + shop) : ("/auth?shop=" + shop));
  }
  res.send("Boko AI Recommendations (multi-tenant) is running.");
});

app.listen(PORT, () => console.log("Boko Reco MULTI-TENANT listening on " + PORT));
