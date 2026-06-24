# Free setup — no app, no hosting, no API key (~5 minutes)

This uses Shopify's built-in (free) product recommendations + one of your collections.
Nothing to host, nothing to pay for. You just paste one file into your theme.

## Steps

1. **Online Store → Themes → ⋯ → Edit code.**
2. Under **Sections**, click **Add a new section**, name it `boko-recommendations-free`.
   Delete the starter code.
3. Open `theme-section/boko-recommendations-free.liquid`, copy **everything**, paste it in,
   **Save**.
4. **Customize** → open a **product** page → **Add section** → **AI Recommendations (Free)**.
5. In the section settings:
   - Pick your **Bestsellers collection** (create one if needed: Products → Collections →
     Create collection → set **Sort: Best selling**).
   - Choose products-per-row, number of products, default tab, bundle discount.
   **Save.**

That's it. The widget is live and free.

## What each tab uses (all free)

| Tab | Source |
|-----|--------|
| Bestsellers | The collection you picked (Shopify's best-selling sort) |
| Recommended | Shopify's related-products engine (`/recommendations/products.json`) |
| Up-sells | Recommended items priced **above** the current product |
| Down-sells | Recommended items priced **below** the current product |

Per-product **Add to cart** and **Add bundle to cart** use Shopify's free AJAX Cart API.

## Good to know
- **Product pages** give the best results (Up/Down-sell need the current product's price).
  On the home/cart page those tabs fall back to your Bestsellers collection.
- **"Most viewed"** isn't included here — Shopify doesn't expose view counts without paid
  analytics. The paid app version (with your own backend) can add it.
- **Bundle discount** is shown to shoppers but, like all Shopify bundles, isn't *enforced*
  at checkout without a discount — create an automatic discount in Shopify, or move to the
  app version + a discount function, if you need the price locked in at checkout.
- This is currency-formatted as `$` for simplicity; tell me your store currency if you want
  it localised.

## When to upgrade to the paid app version
Choose the full app (`DEPLOY.md` / `NO-CLI-DEPLOY.md`) when you want your **own** AI/LLM
ranking, "most viewed", or logic that differs from Shopify's native engine. That one needs
a host (small monthly cost) because it runs a server.
