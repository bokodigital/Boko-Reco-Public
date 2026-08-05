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
import { recommendForShop } from "./sector/engine.js";
import { toEngineProduct, BOKO_METAFIELD_FRAGMENT } from "./sector/loader.js";
import { track, funnelCounts } from "./boko-tracker.js";
import { loadSettings, saveSettings, publicConfig, handlesToCollectionGids } from "./boko-settings.js";
import { SFY_SECTION_LIQUID, SFY_PAGE_TEMPLATE } from "./theme-assets.js";
import { STOREFRONT_JS } from "./storefront-script.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.SHOPIFY_API_KEY || "";
const API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES = process.env.SCOPES || "read_orders,read_products,write_discounts";
const HOST = ((process.env.HOST || "").replace(/^(?!https?:\/\/)/,"https://")).replace(/\/+$/, "");
const API = process.env.SHOPIFY_API_VERSION || "2024-10";
const db = new Database();

// ---- token store (per shop) — handles both @replit/database return styles ----
const k = (shop) => "shop:" + shop;
async function rawTok(shop) { const r = await db.get(k(shop)); if (r && typeof r === "object" && "ok" in r) return r.ok ? r.value : null; return r || null; } async function refreshExpiring(shop, t) { if (!t || !t.refresh_token) return t; try { const r = await fetch("https://" + shop + "/admin/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: new URLSearchParams({ client_id: API_KEY, client_secret: API_SECRET, grant_type: "refresh_token", refresh_token: t.refresh_token }) }).then((x) => x.json()); if (r && r.access_token) { const n = { access_token: r.access_token, refresh_token: r.refresh_token || t.refresh_token, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) }; await db.set(k(shop), n); return n; } } catch (e) {} return t; } async function migrateToken(shop, oldToken) { try { const r = await fetch("https://" + shop + "/admin/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: new URLSearchParams({ client_id: API_KEY, client_secret: API_SECRET, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: oldToken, subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: "1" }) }).then((x) => x.json()); if (r && r.access_token) { const n = { access_token: r.access_token, refresh_token: r.refresh_token || null, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) }; await db.set(k(shop), n); return n; } } catch (e) {} return { access_token: oldToken }; } async function getToken(shop) { let t = await rawTok(shop); if (!t) return null; if (typeof t === "string") { t = await migrateToken(shop, t); } else if (t && t.access_token && !t.expires_at) { t = await migrateToken(shop, t.access_token); } if (t.expires_at && Date.now() > (t.expires_at - 120000)) t = await refreshExpiring(shop, t); return (t && t.access_token) || null; } async function setToken(shop, token) { await db.set(k(shop), token); }
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

// ---- Bundle discount (Shopify Function) ----
const BUNDLE_FN_HANDLE = "boko-bundle-disc";
const BUNDLE_TITLE = "Boko Bundle Discount";
const BUNDLE_META_NS = "$app:boko-bundle-disc";
const BUNDLE_META_KEY = "function-configuration";
async function getBundleFunctionId(shop, token) {
  const r = await gql(shop, token, "query{shopifyFunctions(first:50){nodes{id title apiType}}}");
  const nodes = (r && r.data && r.data.shopifyFunctions && r.data.shopifyFunctions.nodes) || [];
  const fn = nodes.find((n) => n.title === BUNDLE_FN_HANDLE) || nodes.find((n) => n.apiType === "product_discounts");
  return fn ? fn.id : null;
}
async function ensureBundleDiscount(shop, token, cfg) {
  const pct = Math.max(1, Math.min(90, Number(cfg.percentage) || 10));
  const minItems = Math.max(2, Number(cfg.minItems) || 2);
  const enabled = !!cfg.enabled;
  const value = JSON.stringify({ percentage: pct, minItems: minItems });
  const settings = await loadSettings(shop);
  let gid = (settings.global && settings.global.bundle && settings.global.bundle.discountGid) || null;
  if (gid) {
    const chk = await gql(shop, token, "query($id:ID!){discountNode(id:$id){id}}", { id: gid });
    if (!(chk && chk.data && chk.data.discountNode)) gid = null;
  }
  if (!gid) {
    if (!enabled) return { ok: true, gid: null };
    const fnId = await getBundleFunctionId(shop, token);
    if (!fnId) return { ok: false, error: "bundle function not found" };
    const cr = await gql(shop, token, "mutation C($d:DiscountAutomaticAppInput!){discountAutomaticAppCreate(automaticAppDiscount:$d){userErrors{field message}automaticAppDiscount{discountId}}}", { d: { title: BUNDLE_TITLE, functionId: fnId, startsAt: new Date().toISOString(), combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }, metafields: [{ namespace: BUNDLE_META_NS, key: BUNDLE_META_KEY, type: "json", value: value }] } });
    const cErr = cr && cr.data && cr.data.discountAutomaticAppCreate && cr.data.discountAutomaticAppCreate.userErrors;
    if (cErr && cErr.length) return { ok: false, error: cErr.map((e) => e.message).join("; ") };
    gid = cr.data.discountAutomaticAppCreate.automaticAppDiscount.discountId;
    await saveSettings(shop, { global: { bundle: { discountGid: gid } } });
    return { ok: true, gid: gid, created: true };
  }
  await gql(shop, token, "mutation S($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){userErrors{field message}}}", { m: [{ ownerId: gid, namespace: BUNDLE_META_NS, key: BUNDLE_META_KEY, type: "json", value: value }] });
  const mut = enabled ? "discountAutomaticActivate" : "discountAutomaticDeactivate";
  await gql(shop, token, "mutation A($id:ID!){" + mut + "(id:$id){userErrors{field message}}}", { id: gid });
  return { ok: true, gid: gid, updated: true };
}

// (Asset API + ScriptTag helpers removed — widgets ship via theme app extension blocks)

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
  // Persist the state nonce so we can verify it in the callback (CSRF protection).
  db.set("oauth_state:" + shop, { state, ts: Date.now() }).catch(() => {});
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
    // Verify the state nonce we issued at /auth (CSRF protection).
    let savedState = await db.get("oauth_state:" + shop);
    if (savedState && typeof savedState === "object" && "ok" in savedState) savedState = savedState.ok ? savedState.value : null;
    const expectedState = savedState && savedState.state;
    const stateFresh = savedState && savedState.ts && (Date.now() - savedState.ts) < 3600000;
    if (!req.query.state || !expectedState || req.query.state !== expectedState || !stateFresh) {
      return res.status(400).send("State validation failed");
    }
    db.delete("oauth_state:" + shop).catch(() => {});
    // Exchange the code for a permanent access token
    const tok = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
    }).then((r) => r.json());
    if (!tok.access_token) return res.status(500).send("Token exchange failed");
    // Deprecated permanent offline tokens: immediately exchange for a new expiring offline token.
    const session = await migrateToken(shop, tok.access_token);
    const accessToken = (session && session.access_token) || tok.access_token;
    if (!(session && session.expires_at)) await setToken(shop, tok.access_token);
    // Register the uninstall webhook so we clean up this shop's token automatically
    try {
      await gql(shop, accessToken,
        `mutation($u:URL!){ webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription:{ callbackUrl:$u, format: JSON }){ userErrors{ message } } }`,
        { u: HOST + "/webhooks/app_uninstalled" });
    } catch (e) {}
    // Billing gate: redirect to subscription confirmation if not yet billed
    if (BILLING_ON && !(await billingOK(shop, accessToken))) {
      const { confirmationUrl } = await startSubscription(shop, accessToken);
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

async function loadProducts(shop, token, limit = 100, productType = "", includeBoko = false) {
  const safe = productType.replace(/[^a-zA-Z0-9 &-]/g, "");
  const qstr = safe ? `status:active product_type:${safe}` : "status:active";
  const query = `query($n:Int!){ products(first:$n, sortKey: PUBLISHED_AT, reverse: true, query:"${qstr}"){ edges{ node{ id title handle productType vendor tags publishedAt createdAt isGiftCard featuredImage{url} options{ name values } collections(first:20){ edges{ node{ id handle } } } variants(first:100){ edges{ node{ id title price availableForSale selectedOptions{ name value } } } }${includeBoko ? " " + BOKO_METAFIELD_FRAGMENT : ""} } } } }`;
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
      productType: n.productType || "",
      price: parseFloat(v.price), img: (n.featuredImage && n.featuredImage.url) || "",
      orders: 0, views: 0, options, variants,
      collectionGids: collGids,
      bokoMf: (n.metafields && n.metafields.edges) || [],
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
    // Multi-sector: is this shop opted into a sector playbook? If so, fetch boko.*
    // metafields alongside products so the sector engine has attributes to work with.
    let industry = null;
    try { const ri = await db.get("boko_industry:" + shop); industry = (ri && typeof ri === "object" && "ok" in ri) ? (ri.ok ? ri.value : null) : (ri || null); } catch (e) {}
    let products = await loadProducts(shop, token, 250, "", !!industry);
    const settings = await loadSettings(shop);
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
    let items;
    if (industry) {
      // ---- sector-aware path (dormant unless the shop set a business category) ----
      const eng = products.map((p) => toEngineProduct(p, p.bokoMf || []));
      const engAnchor = found ? toEngineProduct(found, found.bokoMf || []) : anchor;
      const cartNums = String(req.query.cart || "").split(",").map((s) => s.trim()).filter(Boolean);
      const cart = cartNums.length ? eng.filter((p) => cartNums.some((c) => String(p.id).endsWith(c))) : [];
      const tod = (req.query.tod || req.query.timeOfDay || "").trim();
      const giftSignal = /^(1|true|yes)$/i.test(String(req.query.gift || ""));
      const picks = await recommendForShop({ products: eng, anchor: engAnchor, cart, industry, limit, timeOfDay: tod, giftSignal });
      items = picks.map(({ bokoMf, attrs, ...rest }) => rest); // drop internal fields from the payload
    } else {
      items = await recommend({ products, anchor, limit });
    }
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
    const settings = await loadSettings(req.query.shop);
    res.status(200).send(JSON.stringify(publicConfig(settings)));
  } catch (e) {
    res.status(200).send(JSON.stringify(publicConfig(await loadSettings(req.query.shop).catch(() => null))));
  }
});

// ---------- Public funnel event tracking (impression / click / add_to_cart) ----------
app.post("/proxy/track", express.json({ type: () => true }), async (req, res) => {
  try {
    if (!verifyProxy(req.query)) return res.status(401).end();
    const shop = req.query.shop;
    const b = req.body || {};
    if (validShop(shop)) await track(shop, b.event, b.source);
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

function bokoNormTag(v) {
  const t = String(v || "").toLowerCase();
  if (!t) return null;
  if (t.indexOf("cart") >= 0) return "cart_drawer";
  if (t.indexOf("sfy") >= 0 || t.indexOf("selected") >= 0) return "sfy_page";
  if (t.indexOf("pdp") >= 0 || t.indexOf("rail") >= 0 || t.indexOf("product") >= 0) return "pdp";
  return null;
}

async function loadStats(shop, token, days) {
  const since = new Date(Date.now() - (days || 90) * 864e5).toISOString().slice(0, 10);
  // Paginate through ALL orders created in the selected timeframe (not just the
  // first page). Shopify caps `first` at 250 for orders; we follow the cursor
  // until hasNextPage is false. MAX_PAGES is a runaway guard, not a business cap.
  const query = `query($n:Int!,$q:String,$cursor:String){ orders(first:$n, after:$cursor, reverse:true, query:$q){ pageInfo{ hasNextPage } edges{ cursor node{ lineItems(first:50){ edges{ node{ title quantity originalTotalSet{ shopMoney{ amount currencyCode } } discountAllocations{ allocatedAmountSet{ shopMoney{ amount } } } customAttributes{ key value } } } } } } } }`;
  const MAX_PAGES = 100; // safety cap: up to 100 x 250 = 25,000 orders per timeframe
  let orders = [];
  let cursor = null, hasNext = true, pages = 0, truncated = false;
  while (hasNext) {
    if (pages >= MAX_PAGES) { truncated = true; break; }
    const j = await gql(shop, token, query, { n: 250, q: "created_at:>=" + since, cursor });
    if (j.errors) {
      const __es = JSON.stringify(j.errors);
      const __locked = __es.indexOf("ACCESS_DENIED") >= 0 || __es.indexOf("protected-customer-data") >= 0 || __es.indexOf("not approved to access the Order") >= 0;
      // Access errors on the FIRST page => orders locked. A mid-pagination error
      // (e.g. GraphQL throttling) => stop and report on what we've already gathered.
      if (pages === 0) return { error: __locked ? "orders_locked" : __es, pdp: { total: 0, revenue: 0, items: [] }, cart_drawer: { total: 0, revenue: 0, items: [] }, sfy_page: { total: 0, revenue: 0, items: [] } };
      truncated = true; break;
    }
    const conn = (j.data && j.data.orders) || {};
    const edges = conn.edges || [];
    orders = orders.concat(edges);
    hasNext = !!(conn.pageInfo && conn.pageInfo.hasNextPage);
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    if (!cursor) break;
    pages++;
  }
  const src = { pdp: { items: {}, rev: 0 }, cart_drawer: { items: {}, rev: 0 }, sfy_page: { items: {}, rev: 0 } };
  let currency = "";
  orders.forEach((o) => (o.node.lineItems.edges || []).forEach((le) => {
    const li = le.node; let bokoReco = null, bokoSource = null;
    (li.customAttributes || []).forEach((a) => { if (a.key === "_boko_reco") bokoReco = a.value; if (a.key === "_boko_source") bokoSource = a.value; });
    const tag = bokoNormTag(bokoReco || bokoSource);
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
  return { ordersLocked: false, ordersScanned: orders.length, truncated, since, currency, totalRevenue: Math.round((pdp.revenue + cd.revenue + sfy.revenue) * 100) / 100, totalItems: pdp.total + cd.total + sfy.total, pdp, cart_drawer: cd, sfy_page: sfy };
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
    res.status(200).send(JSON.stringify(await funnelCounts(shop, days)));
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
      loadSettings(shop),
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
    const merged = await saveSettings(shop, req.body || {});
    // Multi-sector: mirror the chosen business category into the industry flag the
    // sector engine reads. Fashion (and unset) clears it -> the base engine runs.
    try {
      if (req.body && req.body.global && typeof req.body.global.category === "string") {
        const CAT2IND = { "Beauty": "Beauty", "Travel": "Travel", "Home & Living": "Home & Living", "Electronics": "Electronics", "Food & Beverage": "Food & Beverage", "Jewellery & Accessories": "Jewellery", "Other": "Others" };
        const ind = CAT2IND[req.body.global.category] || null;
        if (ind) await db.set("boko_industry:" + shop, ind);
        else await db.delete("boko_industry:" + shop).catch(() => {});
      }
    } catch (e) { console.error("industry flag sync:", e && e.message); }
      try { if (req.body && req.body.global && req.body.global.bundle) { const _st = await shopAndTokenFromRequest(req); if (_st && _st.token) { const _br = await ensureBundleDiscount(shop, _st.token, (merged.global && merged.global.bundle) || {}); if (_br && _br.error) console.error("bundle sync:", _br.error); } } } catch (e) { console.error("bundle sync failed:", e && e.message); }
    res.status(200).send(JSON.stringify({ settings: merged }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ error: e.message }));
  }
});

// ---------- Session-token → admin token helper ----------
// Resolves the shop + admin token from a dashboard session token (Authorization: Bearer <id_token>).
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
.cz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:stretch;gap:16px;margin-bottom:20px}@media(max-width:960px){.cz-grid{grid-template-columns:1fr}}
.cz-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column}
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
  <button class="tab-btn" id="tabBtnCz" type="button">Settings</button>
  <button class="tab-btn" id="tabBtnInstall" type="button">Installation guide</button>
</div>
<div id="tab-performance">
<p class="sub">Items and revenue from products added via your recommendation widgets.</p>

<div class="row"><label class="sub" style="margin:0">Period</label>
<select id="days"><option value="30">Last 30 days</option><option value="90" selected>Last 90 days</option><option value="365">Last 12 months</option></select>
<span id="meta" class="sub" style="margin:0 0 0 auto"></span></div>
<div id="err"></div>
<div class="hero"><div><div class="v lime" id="revTotal">–</div><div class="x">total revenue from recommendations</div></div>
<div style="margin-left:auto"><div class="v" id="itemTotal">–</div><div class="x">items purchased</div></div></div>
<div class="cards">
  <div class="card"><span class="pill">Complete the Look</span><div class="big" id="pdpTotal">–</div><div class="rev" id="pdpRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="pdpRows"></tbody></table></div>
  <div class="card"><span class="pill">Cart drawer carousel</span><div class="big" id="cdTotal">–</div><div class="rev" id="cdRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="cdRows"></tbody></table></div>
  <div class="card"><span class="pill">Selected For You collection</span><div class="big" id="sfyTotal">–</div><div class="rev" id="sfyRev"></div>
    <table><thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead><tbody id="sfyRows"></tbody></table></div>
</div><p class="foot" id="foot"></p>
</div>
<div id="tab-installation" style="display:none">
<details class="how-to" open>
<summary>Installation guide <span class="chev">&#9658;</span></summary>
<div class="how-to__body">
<ol class="how-to__list">
  <li><strong>What this app does</strong><div style="font-weight:400;color:var(--muted);margin-top:4px">It shows shoppers products they are likely to want &mdash; a "You may also like" or "Complete the look row" on product pages, a carousel inside the cart, and a "Selected For You" page. Follow the steps below to switch each one on. You can reopen this guide any time from <strong>Apps &rarr; AI Recommendations</strong>.</div></li>
  <li><strong>Step 1 &mdash; Show recommendations on product pages</strong>
    <ol style="margin:6px 0 0;padding-left:20px;line-height:1.7;font-weight:400">
      <li>In your Shopify admin, open <strong>Online Store &rarr; Themes</strong>.</li>
      <li>On your live theme, click <strong>Customize</strong>.</li>
      <li>At the top of the editor, click the page name and choose a <strong>Product</strong> page.</li>
      <li>In the left sidebar, click <strong>Add block</strong> where you want the recommendations.</li>
      <li>Under <strong>Apps</strong>, choose <strong>AI Recommendations</strong>.</li>
      <li>Click <strong>Save</strong> (top right).</li>
    </ol>
    <div style="font-weight:400;color:var(--muted);margin-top:4px">Shoppers now see a recommendations row on every product page.</div>
  </li>
  <li><strong>Step 2 &mdash; Show recommendations in the cart</strong>
    <ol style="margin:6px 0 0;padding-left:20px;line-height:1.7;font-weight:400">
      <li>In the theme editor, click the <strong>App embeds</strong> icon in the far-left toolbar.</li>
      <li>Turn on <strong>Cart recommendations</strong>.</li>
      <li>Click <strong>Save</strong>.</li>
    </ol>
    <div style="font-weight:400;color:var(--muted);margin-top:4px">A recommendations carousel now appears inside the cart drawer.</div>
  </li>
  <li><strong>Step 3 &mdash; Create the "Selected For You" page</strong>
    <ol style="margin:6px 0 0;padding-left:20px;line-height:1.7;font-weight:400">
      <li>Go to <strong>Online Store &rarr; Pages</strong> and click <strong>Add page</strong>.</li>
      <li>Title it <strong>Selected For You</strong>, leave the content empty, and click <strong>Save</strong>.</li>
      <li>Open <strong>Online Store &rarr; Themes &rarr; Customize</strong>.</li>
      <li>At the top of the editor, click the page name and choose <strong>Pages &rarr; Selected For You</strong>.</li>
      <li>In the left sidebar click <strong>Add section</strong>, and under <strong>Apps</strong> choose <strong>Selected For You</strong>.</li>
      <li>Click <strong>Save</strong>.</li>
    </ol>
  </li>
  <li><strong>Step 4 &mdash; Add the page to your menu</strong>
    <ol style="margin:6px 0 0;padding-left:20px;line-height:1.7;font-weight:400">
      <li>Go to <strong>Online Store &rarr; Navigation</strong>.</li>
      <li>Click the menu you want it in (usually <strong>Main menu</strong>).</li>
      <li>Click <strong>Add menu item</strong>.</li>
      <li>For <strong>Name</strong>, enter <strong>Selected For You</strong>.</li>
      <li>Click the <strong>Link</strong> field, choose <strong>Pages</strong>, and select your <strong>Selected For You</strong> page.</li>
      <li>Click <strong>Add</strong>, then <strong>Save menu</strong>.</li>
    </ol>
    <div style="font-weight:400;color:var(--muted);margin-top:4px">The page is now live in your store navigation for shoppers to browse.</div>
  </li>
  <li><strong>Step 5 &mdash; Style all the recommendations</strong>
    <div style="font-weight:400;color:var(--muted);margin-top:4px">Open the <strong>Settings</strong> tab above to choose your category, exclude collections, and set fonts, sizes and the bundle discount. These apply to all three widgets at once.</div>
  </li>
</ol>
</div>
</details>
</div>
<div id="tab-customizer" style="display:none">
<p class="sub">Choose your business category, exclude any collections you don't want recommended, then style the widgets.</p>
<div id="czErr"></div>

<div class="cz-global" id="czCategoryCard">
  <h3>Choose category <span style="color:#d33">*</span></h3>
  <p class="sub" style="margin:0 0 12px">Select your business category. This is required — recommendations are tailored to your industry, so choose one before setting anything else.</p>
  <div class="cz-field" style="max-width:380px;margin:0">
    <label>Business category</label>
    <select id="cz-category" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:14px;padding:10px 12px;border:1px solid #E6E7EB;border-radius:10px;background:#fff;color:#0B0B0B">
      <option value="">Select a category…</option>
      <option value="Fashion">Fashion</option>
      <option value="Beauty">Beauty</option>
      <option value="Travel">Travel</option>
      <option value="Home & Living">Home &amp; Living</option>
      <option value="Electronics">Electronics</option>
      <option value="Food & Beverage">Food &amp; Beverage</option>
      <option value="Jewellery & Accessories">Jewellery &amp; Accessories</option>
      <option value="Other">Other</option>
    </select>
  </div>
  <div id="czCatNote" class="sub" style="margin:10px 0 0;color:#b45309;font-weight:600"></div>
</div>

<div id="czGated">
  <div class="cz-global">
    <h3>Exclude categories</h3>
    <p class="sub" style="margin:0 0 10px">Products in these collections never appear in any recommendation widget.</p>
    <div class="cz-multiselect" id="czCollections"></div>
  </div>
  <div style="margin-top:20px">
    <h3 style="font-weight:700;font-size:16px;margin:0 0 12px">Design customizer</h3>
    <div class="cz-grid" id="czGrid"></div>
  </div>
</div>

<div class="cz-save"><button id="czSaveBtn" type="button" disabled>Save changes</button><span class="cz-status" id="czStatus"></span></div>
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
    var _m=document.getElementById("meta");if(d.ordersLocked){_m.innerHTML="<span style='color:#b45309;font-weight:600'>&#9888; Orders locked \u2014 approve <b>Protected customer data access</b> in your Partner Dashboard to see purchases &amp; revenue.</span>";}else{_m.textContent=d.ordersScanned!=null?(d.ordersScanned+" recent orders scanned"):"";}
    document.getElementById("foot").textContent="Counts reflect orders since "+(d.since||"")+" whose items were added via a Boko recommendation widget.";
  }).catch(function(){document.getElementById("err").innerHTML="<div class='err'>Couldn't load stats.</div>";});
}
document.getElementById("days").addEventListener("change",load); load();

var CZ_COMPONENTS=[["rail","Complete the Look"],["cart","Cart drawer carousel"],["sfy","Selected For You collection"]];
var czState=null, czCollections=[], czLoaded=false;
function czField(comp,key,label,type,extra){
  extra=extra||"";
  return "<div class='cz-field'><label>"+label+"</label><input "+extra+" type='"+type+"' data-comp='"+comp+"' data-key='"+key+"' id='cz-"+comp+"-"+key+"'></div>";
}
function renderCzGrid(){
  var fonts=["Roboto","Open Sans","Lato","Montserrat","Poppins","Inter","Oswald","Raleway","Nunito","Playfair Display","Merriweather","Rubik","Work Sans","Noto Sans","Mulish"];
  var opts="<option value=''>Default (theme font)</option>"+fonts.map(function(f){return "<option value='"+f+"'>"+f+"</option>";}).join("");
  var html="<div class='cz-design'><h3>Design</h3><p class='sub' style='margin:0 0 16px'>These styles apply to all three recommendation widgets: Complete the Look, Cart Drawer and Selected For You.</p>"
   +"<div class='cz-field'><label>Font family</label><select id='cz-fontFamily'>"+opts+"</select></div>"
   +"<div class='cz-row2'><div class='cz-field'><label>Heading font size (px)</label><input id='cz-headingSize' type='number' min='10' max='60'></div><div class='cz-field'><label>Subtitle font size (px)</label><input id='cz-subtitleSize' type='number' min='8' max='40'></div></div>"
   +"<div class='cz-row2'><div class='cz-field'><label>Product title font size (px)</label><input id='cz-titleSize' type='number' min='8' max='40'></div><div class='cz-field'></div></div>"
   +"<div class='cz-row2'><div class='cz-field'><label>Button color</label><input id='cz-buttonColor' type='color'></div><div class='cz-field'><label>Button text color</label><input id='cz-buttonTextColor' type='color'></div></div>"
   +"</div>";
  html=html+"<div class='cz-design'><h3>Bundle discount</h3><p class='sub' style='margin:0 0 16px'>Give shoppers an automatic discount when they add two or more recommended products together. The discount applies only to those bundle items.</p><div class='cz-field'><label style='display:flex;align-items:center;gap:8px;cursor:pointer'><input id='cz-bundleEnabled' type='checkbox' style='width:auto;margin:0'>Enable bundle discount</label></div><div class='cz-row2'><div class='cz-field'><label>Discount %</label><input id='cz-bundlePct' type='number' min='1' max='90'></div><div class='cz-field'><label>Minimum bundle items</label><input id='cz-bundleMin' type='number' min='2' max='10'></div></div></div>";document.getElementById("czGrid").innerHTML=html;
}
function fillCzForm(settings){
  var d=(settings&&settings.global&&settings.global.design)||{};
  function setv(id,v){var el=document.getElementById(id);if(el&&v!=null&&v!=="")el.value=v;}
  setv("cz-fontFamily",d.fontFamily||"");
  setv("cz-headingSize",d.headingSize||20);
  setv("cz-subtitleSize",d.subtitleSize||14);
  setv("cz-titleSize",d.titleSize||14);
  setv("cz-buttonColor",d.buttonColor||"#0B0B0B");
  setv("cz-buttonTextColor",d.buttonTextColor||"#FFFFFF");var b=(settings&&settings.global&&settings.global.bundle)||{};var be=document.getElementById("cz-bundleEnabled");if(be)be.checked=!!b.enabled;setv("cz-bundlePct",b.percentage||10);setv("cz-bundleMin",b.minItems||2);
  setv("cz-category",(settings&&settings.global&&settings.global.category)||"");
}
var bkNeedsCategory=false;
function bkBanner(on){
  var b=document.getElementById("bkCatBanner");
  if(!b){ b=document.createElement("div"); b.id="bkCatBanner"; b.style.cssText="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;font-size:14px;font-weight:600;margin:0 0 18px"; b.textContent="Choose your business category in Settings to start using the app."; var tabs=document.querySelector(".tabs"); if(tabs&&tabs.parentNode){tabs.parentNode.insertBefore(b,tabs.nextSibling);} }
  b.style.display=on?"":"none";
}
function applyCatGate(){
  var sel=document.getElementById("cz-category");var cat=sel?sel.value:"";
  var gated=document.getElementById("czGated");var save=document.getElementById("czSaveBtn");var note=document.getElementById("czCatNote");
  if(cat){ if(gated){gated.style.opacity="";gated.style.pointerEvents="";} if(save)save.disabled=false; if(note)note.textContent=""; }
  else { if(gated){gated.style.opacity=".45";gated.style.pointerEvents="none";} if(save)save.disabled=true; if(note)note.textContent="Please select a business category to continue."; }
  bkNeedsCategory=!cat; bkBanner(!cat);
}
function bkInitGate(){
  authedFetch("/settings").then(function(d){
    var cat=d&&d.settings&&d.settings.global&&d.settings.global.category;
    bkNeedsCategory=!cat;
    if(bkNeedsCategory){ bkBanner(true); showTab("cz"); }
  }).catch(function(){});
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
  function gv(id,dv){var el=document.getElementById(id);var v=el?(""+el.value).trim():"";return v||dv;}
  var out={global:{excludedCollections:[],design:{fontFamily:gv("cz-fontFamily",""),headingSize:parseInt(gv("cz-headingSize","20"),10)||20,subtitleSize:parseInt(gv("cz-subtitleSize","14"),10)||14,titleSize:parseInt(gv("cz-titleSize","14"),10)||14,buttonColor:gv("cz-buttonColor","#0B0B0B"),buttonTextColor:gv("cz-buttonTextColor","#FFFFFF")}}};
  Array.prototype.forEach.call(document.querySelectorAll(".cz-chip.on"),function(chip){out.global.excludedCollections.push(chip.getAttribute("data-gid"));});var bce=document.getElementById("cz-bundleEnabled");out.global.bundle={enabled:bce?!!bce.checked:false,percentage:parseInt(gv("cz-bundlePct","10"),10)||10,minItems:parseInt(gv("cz-bundleMin","2"),10)||2};
  var _cat=document.getElementById("cz-category");out.global.category=_cat?_cat.value:"";
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
    var _catSel=document.getElementById("cz-category");if(_catSel)_catSel.addEventListener("change",applyCatGate);
    applyCatGate();
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
function showTab(name){
  if(bkNeedsCategory && name!=="cz"){ name="cz"; var _n=document.getElementById("czCatNote"); if(_n)_n.textContent="Please choose a business category first — the app is locked until you do."; bkBanner(true); }
  document.getElementById("tab-performance").style.display=(name==="perf")?"":"none";
  document.getElementById("tab-customizer").style.display=(name==="cz")?"":"none";
  document.getElementById("tab-installation").style.display=(name==="install")?"":"none";
  document.getElementById("tabBtnPerf").classList.toggle("active",name==="perf");
  document.getElementById("tabBtnCz").classList.toggle("active",name==="cz");
  document.getElementById("tabBtnInstall").classList.toggle("active",name==="install");
  if(name==="cz") loadCustomizer();
}
document.getElementById("tabBtnPerf").addEventListener("click",function(){showTab("perf");});
document.getElementById("tabBtnCz").addEventListener("click",function(){showTab("cz");});
 document.getElementById("tabBtnInstall").addEventListener("click",function(){showTab("install");});
bkInitGate();

/* Boko dashboard enhancer v2 — on-brand two-pane customizer. Purely additive. */
(function(){
 var LIME="#BFFC00",INK="#0B0B0B",LILAC="#F8F9FC",LINE="#E6E7EB",MUT="#6B7280";
 if(!document.getElementById('bk-font')){var l=document.createElement('link');l.id='bk-font';l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap';document.head.appendChild(l);}
 var css=""
 +"body{font-family:'Poppins',system-ui,sans-serif;background:"+LILAC+";color:"+INK+";}"
 +".wrap{max-width:1200px;margin:0 auto;padding:28px 24px 90px;}"
 +"h1{font-weight:700;letter-spacing:-.02em;}"
 +".tabs{display:flex;gap:4px;border-bottom:1px solid "+LINE+";margin-bottom:22px;}"
 +".tab-btn{font-family:inherit;font-weight:600;font-size:14px;color:"+MUT+";background:none;border:0;padding:12px 14px;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px;}"
 +".tab-btn:hover{color:"+INK+";}.tab-btn.active{color:"+INK+";border-bottom-color:"+LIME+";}"
 +".sub{color:"+MUT+";font-size:14px;line-height:1.5;}"
 +".cz-design{background:#fff;border:1px solid #E6E7EB;border-radius:16px;padding:22px 22px 10px;box-shadow:0 1px 2px rgba(0,0,0,.04);max-width:660px}"+".cz-design h3{margin:0 0 2px;font-weight:700;font-size:18px}"+".cz-design select,.cz-design input{width:100%;box-sizing:border-box;font-family:inherit;font-size:14px;padding:10px 12px;border:1px solid #E6E7EB;border-radius:10px;background:#fff;color:#0B0B0B}"+".cz-design input[type=color]{height:44px;padding:5px}"
 +".bk-cz{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:24px;align-items:start;}"
 +".bk-left{min-width:0;}"
 +".bk-seg{display:inline-flex;background:#fff;border:1px solid "+LINE+";border-radius:12px;padding:4px;gap:4px;margin-bottom:18px;flex-wrap:wrap;}"
 +".bk-seg button{font-family:inherit;font-weight:600;font-size:13px;border:0;background:none;color:"+MUT+";padding:9px 16px;border-radius:9px;cursor:pointer;}"
 +".bk-seg button.on{background:"+INK+";color:#fff;}"
 +".bk-left .cz-card{background:#fff;border:1px solid "+LINE+";border-radius:16px;padding:22px;box-shadow:0 1px 2px rgba(0,0,0,.04);display:flex;flex-direction:column;height:100%;box-sizing:border-box;}"
 +".bk-left .cz-card h3{display:none;}"
 +".cz-field{margin:0 0 16px;}"
 +".cz-field label{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:"+MUT+";font-weight:600;margin:0 0 6px;}"
 +".cz-field input{width:100%;box-sizing:border-box;font-family:inherit;font-size:14px;padding:10px 12px;border:1px solid "+LINE+";border-radius:10px;background:#fff;color:"+INK+";}"
 +".cz-field input:focus{outline:none;border-color:"+INK+";box-shadow:0 0 0 3px rgba(191,252,0,.4);}"
 +".cz-row2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}"
 +".bk-right{position:sticky;top:16px;}"
 +".bk-pv{background:#fff;border:1px solid "+LINE+";border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);}"
 +".bk-pv .cap{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:"+MUT+";font-weight:700;margin:0 0 12px;display:flex;align-items:center;gap:8px;}"
 +".bk-pv .cap:before{content:'';width:9px;height:9px;border-radius:50%;background:"+LIME+";display:inline-block;}"
 +".bk-stage{background:"+LILAC+";border-radius:12px;padding:16px;border:1px solid "+LINE+";}"
 +".bk-tiles{display:grid;gap:12px;}"
 +".bk-tile .img{aspect-ratio:1/1;background:linear-gradient(135deg,#eef0f4,#e0e4ee);border-radius:10px;}"
 +".bk-tile .t{margin:8px 0 2px;line-height:1.2;}.bk-tile .p{font-weight:600;}.bk-tile .p s{font-weight:400;margin-left:6px;}"
 +".bk-atc{margin-top:8px;width:100%;border:0;border-radius:8px;padding:9px 0;font-family:inherit;font-weight:600;font-size:12px;}"
 +".cz-global{background:#fff;border:1px solid "+LINE+";border-radius:16px;padding:22px;margin-top:20px;}"
 +".cz-global h3{margin:0 0 6px;font-weight:700;font-size:16px;}"
 +".cz-save{position:sticky;bottom:0;display:flex;align-items:center;gap:14px;margin-top:18px;padding:14px 0;background:linear-gradient(180deg,rgba(248,249,252,0),"+LILAC+" 45%);}"
 +"#czSaveBtn,.sf-row button{font-family:inherit;font-weight:700;font-size:14px;background:"+LIME+";color:"+INK+";border:0;border-radius:10px;padding:11px 22px;cursor:pointer;}"
 +"#czSaveBtn:hover,.sf-row button:hover{filter:brightness(.93);}"
 +"#czSaveBtn:disabled{background:#E6E7EB;color:#9AA0AA;cursor:not-allowed;filter:none;}"
 +".sf-card{background:#fff;border:1px solid "+LINE+";border-radius:16px;padding:22px;margin-bottom:16px;}"
 +".hero{border-radius:16px;}.cards .card{border-radius:16px;}";
 var st=document.getElementById('bk-style')||document.createElement('style');st.id='bk-style';st.textContent=css;if(!st.parentNode)document.head.appendChild(st);
(function(){
 var L="#BFFC00",INK="#0B0B0B",LINE="#E6E7EB",MUT="#6B7280";
 var s2=document.createElement('style');s2.textContent=""
  +".bk-flow{margin-top:24px}"
  +".bk-flow-h{font-weight:700;font-size:18px;margin:0}"
  +".bk-flow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:14px}"
  +".bk-fc{background:#fff;border:1px solid "+LINE+";border-radius:16px;padding:18px 18px 14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}"
  +".bk-fc .cap{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin:0 0 16px}"
  +".bk-fc .dot{width:13px;height:13px;border-radius:4px;background:"+L+";display:inline-block}"
  +".bk-row{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:"+MUT+";font-weight:600}"
  +".bk-row b{font-size:19px;color:"+INK+"}"
  +".bk-bar{height:8px;border-radius:6px;background:#EEF0F4;margin:7px 0 5px;overflow:hidden}"
  +".bk-bar>i{display:block;height:100%;border-radius:6px;background:"+L+"}"
  +".bk-bar.blk>i{background:"+INK+"}"
  +".bk-sub{font-size:12px;color:"+MUT+";margin:0 0 14px}.bk-sub b{color:"+INK+"}"
  +".bk-foot{display:flex;justify-content:space-between;border-top:1px dashed "+LINE+";padding-top:11px;margin-top:4px;font-size:12px;color:"+MUT+"}"
  +".bk-foot b{display:block;color:"+INK+";font-size:14px;font-weight:700}";
 document.head.appendChild(s2);
 function money(n,cur){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:cur||'USD',currencyDisplay:'code',maximumFractionDigits:0}).format(n||0);}catch(e){return (cur||'')+' '+Math.round(Number(n||0));}}
 function pct(a,b){if(!b)return '0%';return Math.round((a/b)*100)+'%';}
 function W(v,mx){var p=mx>0?Math.round((v/mx)*100):0;if(v>0&&p<4)p=4;return p;}
 var COMPS=[{name:'Complete the Look',stat:'pdp',fk:['pdp','rail','product_rail','ctl','complete_look','complete-the-look']},{name:'Selected For You',stat:'sfy_page',fk:['sfy','page','sfy_page','selected-for-you','selected-for-you-page']},{name:'Cart Drawer',stat:'cart_drawer',fk:['cart','cart_drawer','cart-drawer']}];
 function fv(funnel,keys,ev){var t=0;for(var i=0;i<keys.length;i++){var b=funnel[keys[i]];if(b&&b[ev])t+=b[ev];}return t;}
 function render(funnel,stats){
  funnel=funnel||{};stats=stats||{};
  var rows=COMPS.map(function(c){var st=stats[c.stat]||{};return {name:c.name,clicks:fv(funnel,c.fk,'click'),atc:fv(funnel,c.fk,'add_to_cart'),pur:st.total||0,rev:st.revenue||0};});
  var mC=Math.max.apply(null,rows.map(function(r){return r.clicks;}).concat([0]));
  var mA=Math.max.apply(null,rows.map(function(r){return r.atc;}).concat([0]));
  var mP=Math.max.apply(null,rows.map(function(r){return r.pur;}).concat([0]));
  var cur=stats.currency||'USD';
  var html=rows.map(function(r){return ""
   +"<div class='bk-fc'><div class='cap'><span class='dot'></span>"+r.name+"</div>"
   +"<div class='bk-row'>Clicks<b>"+r.clicks+"</b></div><div class='bk-bar'><i style='width:"+W(r.clicks,mC)+"%'></i></div><div class='bk-sub'><b>"+pct(r.atc,r.clicks)+"</b> added to cart</div>"
   +"<div class='bk-row'>Add to cart<b>"+r.atc+"</b></div><div class='bk-bar'><i style='width:"+W(r.atc,mA)+"%'></i></div><div class='bk-sub'><b>"+pct(r.pur,r.atc)+"</b> of carts purchased</div>"
   +"<div class='bk-row'>Purchases<b>"+r.pur+"</b></div><div class='bk-bar blk'><i style='width:"+W(r.pur,mP)+"%'></i></div>"
   +"<div class='bk-foot'><div>Revenue<b>"+money(r.rev,cur)+"</b></div><div style='text-align:right'>Click &rarr; buy<b>"+pct(r.pur,r.clicks)+"</b></div></div>"
   +"</div>";}).join('');
  var g=document.getElementById('bk-flow-grid');if(g)g.innerHTML=html;
 }
 function build(){
  var perf=document.getElementById('tab-performance');if(!perf)return;
  if(!document.getElementById('bk-flow')){
   var wrap=document.createElement('div');wrap.id='bk-flow';wrap.className='bk-flow';
   wrap.innerHTML="<h3 class='bk-flow-h'>User Flow by Component</h3><p class='sub' style='margin:2px 0 0'>Clicks &rarr; Add to cart &rarr; Purchases &middot; attributed to the source component</p><div class='bk-flow-grid' id='bk-flow-grid'></div>";
   var cards=perf.querySelector('.cards');
   if(cards&&cards.parentNode){cards.parentNode.insertBefore(wrap,cards.nextSibling);}else{perf.appendChild(wrap);}
  }
  render({},{});try{Promise.all([Promise.resolve(authedFetch('/funnel')).catch(function(){return {};}),Promise.resolve(authedFetch('/stats')).catch(function(){return {};})]).then(function(a){render(a[0]||{},a[1]||{});}).catch(function(){});}catch(e){}
 }
 setTimeout(build,500);
 var dd=document.getElementById('days');if(dd)dd.addEventListener('change',function(){setTimeout(build,60);});
 var pb=document.getElementById('tabBtnPerf');if(pb)pb.addEventListener('click',function(){setTimeout(build,60);});
})();
 function val(id,d){var e=document.getElementById(id);var v=e&&e.value!=null?(''+e.value).trim():'';return v||d;}
 function lum(hex){hex=(''+hex).replace('#','');if(hex.length===3)hex=hex.replace(/./g,'$&$&');var n=parseInt(hex,16);if(isNaN(n))return 0;return (0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))/255;}
 function wkey(card){var i=card.querySelector('input[id^="cz-"]');if(!i)return null;var m=/^cz-([a-z]+)-/.exec(i.id);return m?m[1]:null;}
 function preview(card){
  var k=wkey(card);if(!k)return'';
  var hf=val('cz-'+k+'-headingFont',''),bf=val('cz-'+k+'-bodyFont','');
  var hs=val('cz-'+k+'-headingSize','20'),ts=val('cz-'+k+'-titleSize','14'),ps=val('cz-'+k+'-priceSize','14');
  var hc=val('cz-'+k+'-headingColor','#0B0B0B'),tc=val('cz-'+k+'-titleColor','#0B0B0B'),pc=val('cz-'+k+'-priceColor','#0B0B0B'),sc=val('cz-'+k+'-saleColor','#9AA0AA');
  var ab=val('cz-'+k+'-addBg','#0B0B0B'),at=val('cz-'+k+'-addText','#ffffff');
  if(Math.abs(lum(at)-lum(ab))<0.25)at=(lum(ab)>0.5?'#0B0B0B':'#ffffff');
  var cols=parseInt(val('cz-'+k+'-columns','3'),10);if(!(cols>=1&&cols<=6))cols=3;var shown=Math.min(cols,3);
  var head=(k==='page'?'Selected for you':'You may also like');
  var tiles='';for(var i=0;i<shown;i++){tiles+="<div class='bk-tile'><div class='img'></div>"
   +"<div class='t' style='font-family:"+(bf||'inherit')+";font-size:"+ts+"px;color:"+tc+"'>Sample product</div>"
   +"<div class='p' style='font-size:"+ps+"px;color:"+pc+"'>$49.00<s style='color:"+sc+"'>$69.00</s></div>"
   +"<button class='bk-atc' style='background:"+ab+";color:"+at+"'>Add to cart</button></div>";}
  return "<div class='cap'>Live preview</div><div class='bk-stage'>"
   +"<div style='font-family:"+(hf||'inherit')+";font-weight:700;font-size:"+hs+"px;color:"+hc+";margin:0 0 12px'>"+head+"</div>"
   +"<div class='bk-tiles' style='grid-template-columns:repeat("+shown+",1fr)'>"+tiles+"</div></div>";
 }
 var state={sel:0,cards:[]};
 function refresh(){var pv=document.querySelector('.bk-pv');if(pv&&state.cards[state.sel])pv.innerHTML=preview(state.cards[state.sel]);}
 function select(i){state.sel=i;state.cards.forEach(function(c,j){c.style.display=(j===i?'block':'none');});[].forEach.call(document.querySelectorAll('.bk-seg button'),function(b,j){b.className=(j===i?'on':'');});refresh();}
 function build(){
  var grid=document.getElementById('czGrid');if(!grid)return;
  var cards=[].slice.call(grid.querySelectorAll('.cz-card'));
  if(document.querySelector('.bk-cz')){if(!cards.length){state.cards=[].slice.call(document.querySelectorAll('.bk-left .cz-card'));refresh();return;}var o=document.querySelector('.bk-cz');if(o&&o.parentNode)o.parentNode.removeChild(o);}
  if(!cards.length)return;
  var wrap=document.createElement('div');wrap.className='bk-cz';
  var left=document.createElement('div');left.className='bk-left';
  var right=document.createElement('div');right.className='bk-right';
  var pv=document.createElement('div');pv.className='bk-pv';right.appendChild(pv);
  var seg=document.createElement('div');seg.className='bk-seg';left.appendChild(seg);
  cards.forEach(function(c){left.appendChild(c);});
  wrap.appendChild(left);wrap.appendChild(right);grid.parentNode.insertBefore(wrap,grid);
  cards.forEach(function(c,idx){var b=document.createElement('button');var h=c.querySelector('h3');b.textContent=h?h.textContent:('Widget '+(idx+1));b.onclick=function(){select(idx);};seg.appendChild(b);});
  left.addEventListener('input',refresh);
  state.cards=cards;state.sel=0;select(0);
 }
 build();
 var g=document.getElementById('czGrid');
 if(g&&window.MutationObserver){var mo=new MutationObserver(function(){if(g.querySelector('.cz-card'))build();});mo.observe(g,{childList:true});}
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
    return res.redirect(token ? ("/dashboard?shop=" + shop) : ("/dashboard?shop=" + shop));
  }
  res.send("Boko AI Recommendations (multi-tenant) is running.");
});

app.listen(PORT, () => console.log("Boko Reco MULTI-TENANT listening on " + PORT));

