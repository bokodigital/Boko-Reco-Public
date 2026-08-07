import { toEngineProduct } from "./web/sector/loader.js";
import { recommendForShop } from "./web/sector/engine.js";
const S = process.env.SHOP, T = process.env.ADMIN_TOKEN;
const BOKO = `metafields(namespace:"boko",first:30){edges{node{key value type}}}`;
const q = `query($n:Int!){products(first:$n,query:"status:active"){edges{node{id title productType tags publishedAt createdAt variants(first:1){edges{node{price availableForSale}}} ${BOKO}}}}}`;
async function gql(){const r=await fetch(`https://${S}/admin/api/2024-10/graphql.json`,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":T},body:JSON.stringify({query:q,variables:{n:250}})});const j=await r.json();if(j.errors)throw new Error(JSON.stringify(j.errors));return j.data.products.edges.map(e=>e.node);}
function toBase(n){const v=n.variants.edges[0]&&n.variants.edges[0].node;return{id:n.id,title:n.title,productType:n.productType||"",category:(n.productType||"").toLowerCase(),tags:n.tags||[],price:v?parseFloat(v.price):0,available:!!(v&&v.availableForSale),createdAt:n.publishedAt||n.createdAt||null,bokoMf:(n.metafields&&n.metafields.edges)||[]};}
const ANCHORS={Beauty:"Gel Cleanser",Travel:"Cabin Backpack","Home & Living":"Scandi 3-Seat Sofa",Electronics:"Smartphone X15","Food & Beverage":"Single-Origin Coffee Beans",Jewellery:"Gold Chain Necklace",Others:"2-Person Tent"};
const raw=await gql();
const eng=raw.map(n=>toEngineProduct(toBase(n)));
console.log("RES|seeded="+eng.filter(p=>(p.tags||[]).some(t=>String(t).startsWith("boko-sector:"))).length+" active="+eng.length);
for(const [industry,anchorTitle] of Object.entries(ANCHORS)){
  const pool=eng.filter(p=>(p.tags||[]).includes("boko-sector:"+industry));
  const anchor=pool.find(p=>p.title===anchorTitle)||eng.find(p=>p.title===anchorTitle);
  if(!anchor){console.log("RES|"+industry+"|ANCHOR_MISSING");continue;}
  const picks=await recommendForShop({products:pool,anchor,cart:[],industry,limit:6});
  console.log("RES|"+industry+"|anchor="+anchorTitle+"|"+picks.map(p=>p.title+"["+(p.attrs&&p.attrs.role||"?")+"]").join(", "));
}
