import crypto from "node:crypto";
const S=process.env.SHOP, T=process.env.ADMIN_TOKEN, SEC=process.env.SHOPIFY_API_SECRET;
const BASE="https://boko-reco-staging.replit.app";
async function adminGql(q){const r=await fetch(`https://${S}/admin/api/2024-10/graphql.json`,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":T},body:JSON.stringify({query:q})});return (await r.json());}
const d=await adminGql(`{products(first:5,query:"title:Smartphone X15"){edges{node{id title}}}}`);
const node=d.data.products.edges.map(e=>e.node).find(n=>n.title==="Smartphone X15")||d.data.products.edges[0]&&d.data.products.edges[0].node;
if(!node){console.log("LC|no anchor product found");process.exit(0);}
const anum=String(node.id).match(/(\d+)$/)[1];
console.log("LC|anchor="+node.title+" id="+anum+" secret="+(SEC?"set":"MISSING"));
const params={shop:S, anchor:anum, limit:"6"};
const msg=Object.keys(params).sort().map(k=>`${k}=${params[k]}`).join("");
const sig=crypto.createHmac("sha256",SEC).update(msg).digest("hex");
const url=`${BASE}/proxy/recommend?shop=${encodeURIComponent(S)}&anchor=${anum}&limit=6&signature=${sig}`;
const r=await fetch(url);
const txt=await r.text();
let j; try{j=JSON.parse(txt);}catch(e){console.log("LC|status="+r.status+" nonjson="+txt.slice(0,120));process.exit(0);}
if(j.error){console.log("LC|status="+r.status+" error="+j.error);process.exit(0);}
console.log("LC|status="+r.status+" count="+(j.items||[]).length);
for(const it of (j.items||[])) console.log("LC| - "+it.title+" $"+it.price);
