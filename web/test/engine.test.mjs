import { recommend, rankHeuristic, bundlePricing, parseIds } from "../recommendations.js";
let pass=0,fail=0; const ok=(c,m)=>c?pass++:(fail++,console.log("FAIL:",m));
const P=[
 {id:"gid://shopify/Product/1",price:129,orders:482,views:9100,category:"tops"},
 {id:"gid://shopify/Product/2",price:29,orders:1320,views:21000,category:"tops"},
 {id:"gid://shopify/Product/4",price:149,orders:980,views:18800,category:"tech"},
 {id:"gid://shopify/Product/7",price:34,orders:1450,views:16500,category:"accessories"},
];
const anchor=P[0];
const rec=rankHeuristic("recommended",P,anchor);
ok(rec.every(p=>p.id!==anchor.id),"recommended excludes anchor");
ok(rec[0].id.endsWith("/2"),"recommended top = id2, got "+rec[0].id);
ok(bundlePricing([{price:100},{price:50},{price:30}],10).total===162,"bundle 180->162");
const r=await recommend({products:P,anchor,limit:3,useLLM:false});
ok(r.length===3 && r[0].id!==anchor.id,"recommend returns 3, no anchor");
const ids=parseIds('ok {"ids":["gid://shopify/Product/4","nope","gid://shopify/Product/2"]}',P);
ok(ids && ids.length===2 && ids[0].id.endsWith("/4"),"parseIds reorders+filters");
ok(parseIds("garbage",P)===null,"parseIds bad -> null");
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
