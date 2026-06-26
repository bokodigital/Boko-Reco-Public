/* Boko AI Recommendations — server-injected storefront (product rail + cart carousel).
   Loaded via the Shopify Script Tag the app registers on install. No theme edits required.
   Product rail mirrors the "AI Recommendations" section; cart carousel mirrors the Boko Cart Carousel. */

/* ===================== PRODUCT RAIL (product pages, injected once) ===================== */
(function(){
  if(window.__bokoRecoPDP) return; window.__bokoRecoPDP=1;
  if(!/\/products\/[^/?#]+/.test(location.pathname)) return;


  function el(h){var d=document.createElement("div");d.innerHTML=h.trim();return d.firstChild;}
  function vnum(g){var m=String(g).match(/(\d+)$/);return m?m[1]:g;}
  function init(root){
    var proxy=root.getAttribute("data-proxy")||"/apps/reco/recommend";
    var perRow=parseInt(root.getAttribute("data-per-row")||"4",10);
    var limit=parseInt(root.getAttribute("data-limit")||"8",10);
    var discount=parseFloat(root.getAttribute("data-bundle-discount")||"0");
    var anchor=root.getAttribute("data-anchor")||"";
    var aType=root.getAttribute("data-anchor-type")||"";
    var aTitle=root.getAttribute("data-anchor-title")||"";
    var aTags=root.getAttribute("data-anchor-tags")||"";
    var aPrice=root.getAttribute("data-anchor-price")||"";
    var grid=root.querySelector("[data-reco-grid]");
    var bundle=[],ITEMS={},bar;
    function money(n){return "$"+Number(n).toFixed(2);}
    function toast(count){var t=document.getElementById("boko-toast");if(!t){t=el("<div id='boko-toast' style=\"position:fixed;right:18px;bottom:18px;z-index:100000;background:#1f1f1f;color:#fff;padding:14px 18px;border-radius:10px;font:500 14px/1.2 'Jost',-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:14px;align-items:center;transform:translateY(160%);transition:transform .25s\"></div>");document.body.appendChild(t);}t.innerHTML="<span>✓ Added to cart"+(count?" ("+count+")":"")+"</span><a href='/cart' style='color:#fff;text-decoration:none;font-weight:700'>View cart →</a>";requestAnimationFrame(function(){t.style.transform="translateY(0)";});clearTimeout(t._h);t._h=setTimeout(function(){t.style.transform="translateY(160%)";},4000);}
    function cartNotify(count){try{document.querySelectorAll(".cart-link__count,.cart-count-bubble,.cart-count,[data-cart-count],#CartCount,.cart-link__bubble,.cart-count-number,[data-cart-item-count],.cart-counter,.cart__count").forEach(function(e){var n=e.querySelector("span")||e;if(/^\s*\d+\s*$/.test(n.textContent||""))n.textContent=count;});}catch(e){}["cart:refresh","cart:updated","cart:change","ajaxCart:afterCartLoad"].forEach(function(ev){document.dispatchEvent(new CustomEvent(ev,{bubbles:true}));});document.dispatchEvent(new CustomEvent("boko:cart:added"));toast(count);}
    function refreshCart(){return fetch("/cart.js",{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(c){cartNotify(c.item_count);}).catch(function(){cartNotify(0);});}
    function getSections(){var cd=document.querySelector("cart-drawer");return (cd&&cd.getSectionsToRender)?cd.getSectionsToRender().map(function(s){return s.id;}):null;}
    function showCart(json){var cd=document.querySelector("cart-drawer");if(cd&&typeof cd.renderContents==="function"&&json&&json.sections&&json.sections["cart-drawer"]){try{cd.renderContents(json);cd.classList.remove("is-empty");var inner=document.querySelector("#CartDrawer");if(inner)inner.classList.remove("is-empty");return;}catch(e){}}refreshCart();}
    function getItems(){
      var url=proxy+"?type=recommended&limit="+limit+(anchor?"&anchor="+encodeURIComponent(anchor):"")+(aType?"&atype="+encodeURIComponent(aType):"")+(aTitle?"&atitle="+encodeURIComponent(aTitle):"")+(aTags?"&atags="+encodeURIComponent(aTags):"")+(aPrice?"&aprice="+encodeURIComponent(aPrice):"");
      return fetch(url,{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(d){return d.items||[];}).catch(function(){return [];});
    }
    function card(p){
      var inB=bundle.indexOf(p.variantId)>=0;
      var url=p.handle?("/products/"+p.handle):null;
      var imgInner=(p.img?"<img loading='lazy' src='"+p.img+"' alt=''>":"");
      var imgHtml=url?("<a class='boko-reco__imglink' href='"+url+"' style='position:absolute;inset:0;display:block'>"+imgInner+"</a>"):imgInner;
      var titleHtml=url?("<a href='"+url+"' style='color:inherit;text-decoration:none'>"+p.title+"</a>"):p.title;
      var c=el("<div class='boko-reco__card'><div class='boko-reco__imgwrap'><label class='boko-reco__bsel'><input type='checkbox' "+(inB?"checked":"")+"> Bundle</label>"+imgHtml+"<button class='boko-reco__atc'>Add to cart</button></div><div class='boko-reco__cbody'><div class='boko-reco__vendor'>"+(p.vendor||"")+"</div><div class='boko-reco__ctitle'>"+titleHtml+"</div><div class='boko-reco__price'>"+money(p.price)+"</div></div></div>");
      c.querySelector(".boko-reco__atc").addEventListener("click",function(){addToCart(p.variantId,this);});
      c.querySelector("input").addEventListener("change",function(){toggleBundle(p);});
      return c;
    }
    function load(){
      grid.style.gridTemplateColumns="repeat("+perRow+",minmax(0,1fr))";
      grid.innerHTML="<div class='boko-reco__loading'>Loading…</div>";
      getItems().then(function(items){grid.innerHTML="";if(!items.length){grid.innerHTML="<div class='boko-reco__loading'>No recommendations yet.</div>";return;}items.forEach(function(p){if(p.variantId)grid.appendChild(card(p));});});
    }
    function addToCart(variantId,btn){if(btn)btn.disabled=true;var body={items:[{id:Number(vnum(variantId)),quantity:1,properties:{"_boko_reco":"pdp"}}]};var sec=getSections();if(sec){body.sections=sec;body.sections_url=location.pathname;}fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){if(!r.ok)return r.json().then(function(e){throw e;});return r.json();}).then(function(json){if(btn){btn.textContent="Added ✓";btn.classList.add("is-added");setTimeout(function(){btn.textContent="Add to cart";btn.classList.remove("is-added");btn.disabled=false;},1600);}showCart(json);}).catch(function(e){if(btn){btn.textContent="Unavailable";setTimeout(function(){btn.textContent="Add to cart";btn.disabled=false;},1600);}console.warn("[boko] add-to-cart failed",e);});}
    function ensureBar(){if(bar)return bar;bar=el("<div class='boko-reco__bar'><div class='boko-reco__bthumbs' data-bt></div><div class='boko-reco__btext'><b data-bc>0 items</b><span data-bs></span></div><div class='boko-reco__bspacer'></div><div class='boko-reco__btotal'><small data-bcomp></small><span data-btt>$0.00</span></div><button class='boko-reco__bclear' data-bclear>Clear</button><button class='boko-reco__badd' data-badd>Add bundle to cart</button></div>");root.appendChild(bar);bar.querySelector("[data-bclear]").addEventListener("click",function(){bundle=[];ITEMS={};renderBundle();load();});bar.querySelector("[data-badd]").addEventListener("click",addBundle);return bar;}
    function toggleBundle(p){var i=bundle.indexOf(p.variantId);if(i>=0){bundle.splice(i,1);delete ITEMS[p.variantId];}else{bundle.push(p.variantId);ITEMS[p.variantId]=p;}renderBundle();}
    function renderBundle(){ensureBar();if(!bundle.length){bar.classList.remove("is-show");return;}var items=bundle.map(function(v){return ITEMS[v];});var sub=items.reduce(function(s,p){return s+Number(p.price);},0);var disc=sub*discount/100;bar.querySelector("[data-bt]").innerHTML=items.slice(0,6).map(function(p){return p.img?"<img src='"+p.img+"' alt=''>":"";}).join("");bar.querySelector("[data-bc]").textContent=items.length+(items.length===1?" item":" items")+" in bundle";bar.querySelector("[data-bs]").innerHTML=discount?"<span class='boko-reco__save'>Save "+money(disc)+" ("+discount+"%)</span>":"";bar.querySelector("[data-bcomp]").textContent=discount?money(sub):"";bar.querySelector("[data-btt]").textContent=money(sub-disc);bar.classList.add("is-show");}
    function addBundle(){if(!bundle.length)return;var items=bundle.map(function(v){return {id:Number(vnum(v)),quantity:1,properties:{"_boko_reco":"pdp"}};});var add=bar&&bar.querySelector("[data-badd]");if(add){add.disabled=true;add.textContent="Adding…";}function done(){if(add){add.disabled=false;add.textContent="Add bundle to cart";}bundle=[];ITEMS={};renderBundle();load();}var body={items:items};var sec=getSections();if(sec){body.sections=sec;body.sections_url=location.pathname;}fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){if(!r.ok)throw r;return r.json();}).then(function(json){showCart(json);done();}).catch(function(){var seq=Promise.resolve();items.forEach(function(it){seq=seq.then(function(){return fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:[it]})}).then(function(){}).catch(function(){});});});seq.then(function(){return refreshCart();}).then(done);});}
    load();
  }


  function railHost(){
    var sels=["product-info","#MainContent .product","main .product","[id^='MainProduct-']",".product__info-wrapper",".product-single","main","#MainContent"];
    for(var i=0;i<sels.length;i++){ var e=document.querySelector(sels[i]); if(e){ return (e.closest && e.closest("section")) || e; } }
    return document.body;
  }
  function mountRail(prod){
    if(document.getElementById("boko-reco-main")) return;
    if(!document.getElementById("boko-reco-css")){
      var st=document.createElement("style"); st.id="boko-reco-css";
      st.textContent="#boko-reco-main{\n  --reco-font: inherit;\n  --reco-title: 30px;\n  --reco-body: 13px;\n  --reco-ls: 7px;\n  --ink:#2b2b2b;--muted:#8a8a8a;--line:#e6e6e6;--badge:#3f8f5f;\n  font-family:var(--reco-font);color:var(--ink);width:100vw;max-width:100vw;margin:40px 0;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding:0}\n#boko-reco-main *{box-sizing:border-box}\n#boko-reco-main .boko-reco__title{text-align:center;font-weight:300;font-size:var(--reco-title);letter-spacing:var(--reco-ls);text-transform:uppercase;margin:0 0 30px}\n#boko-reco-main .boko-reco__grid{display:grid;gap:4px}\n#boko-reco-main .boko-reco__loading{grid-column:1/-1;text-align:center;color:var(--muted);padding:24px}\n#boko-reco-main .boko-reco__card{position:relative;display:flex;flex-direction:column;background:#fff}\n#boko-reco-main .boko-reco__imgwrap{position:relative;aspect-ratio:3/4.1;overflow:hidden;background:#f3f1ee}\n#boko-reco-main .boko-reco__imgwrap img{width:100%;height:100%;object-fit:cover;display:block}\n#boko-reco-main .boko-reco__bsel{position:absolute;top:10px;right:10px;z-index:3;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:99px;padding:3px 9px;font-size:11px;cursor:pointer;opacity:1;transition:opacity .2s}\n#boko-reco-main .boko-reco__bsel input{accent-color:var(--badge);margin:0}\n#boko-reco-main .boko-reco__atc{position:absolute;left:12px;right:12px;bottom:12px;z-index:2;border:none;background:#1f1f1f;color:#fff;font:inherit;font-size:calc(var(--reco-body) - 2px);letter-spacing:1.5px;text-transform:uppercase;padding:12px;cursor:pointer;opacity:0;transform:translateY(6px);transition:.2s}\n#boko-reco-main .boko-reco__card:hover .boko-reco__atc{opacity:1;transform:translateY(0)}\n#boko-reco-main .boko-reco__atc.is-added{background:var(--badge)}\n#boko-reco-main .boko-reco__cbody{padding:14px 6px 0;text-align:center;display:flex;flex-direction:column;align-items:center;gap:7px}\n#boko-reco-main .boko-reco__vendor{font-size:calc(var(--reco-body) - 3px);color:var(--muted);text-transform:uppercase;letter-spacing:.4px}\n#boko-reco-main .boko-reco__ctitle{font-size:var(--reco-body);letter-spacing:1.2px;text-transform:uppercase;font-weight:400}\n#boko-reco-main .boko-reco__price{font-size:calc(var(--reco-body) + 2px)}\n#boko-reco-main .boko-reco__bar{position:fixed;left:0;right:0;bottom:0;background:#1f1f1f;color:#fff;padding:13px 22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;transform:translateY(120%);transition:transform .25s;z-index:9999;font-family:var(--reco-font)}\n#boko-reco-main .boko-reco__bar.is-show{transform:translateY(0)}\n#boko-reco-main .boko-reco__bthumbs{display:flex}\n#boko-reco-main .boko-reco__bthumbs img{width:40px;height:40px;border-radius:4px;object-fit:cover;border:2px solid #1f1f1f;margin-left:-10px}\n#boko-reco-main .boko-reco__bthumbs img:first-child{margin-left:0}\n#boko-reco-main .boko-reco__btext b{font-size:14px}#boko-reco-main .boko-reco__btext span{display:block;font-size:12px;color:#bdbdbd}\n#boko-reco-main .boko-reco__save{color:#7fd0a1}\n#boko-reco-main .boko-reco__bspacer{flex:1}\n#boko-reco-main .boko-reco__btotal{font-size:20px}#boko-reco-main .boko-reco__btotal small{font-size:12px;color:#9a9a9a;text-decoration:line-through;margin-right:8px}\n#boko-reco-main .boko-reco__badd{border:none;background:#fff;color:#1f1f1f;font:inherit;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;padding:12px 22px;cursor:pointer}\n#boko-reco-main .boko-reco__bclear{background:transparent;border:1px solid #444;color:#ddd;padding:11px 14px;font:inherit;font-size:12px;letter-spacing:1px;text-transform:uppercase;cursor:pointer}\n@media(max-width:600px){#boko-reco-main .boko-reco__grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}";
      document.head.appendChild(st);
    }
    var tags=(prod&&prod.tags?prod.tags.join(","):"");
    var price=(prod&&prod.price!=null)?(Number(prod.price)/100):"";
    var root=el("<div id='boko-reco-main' class='boko-reco' data-boko-reco data-proxy='/apps/reco/recommend' data-per-row='4' data-limit='8' data-bundle-discount='10'><h2 class='boko-reco__title'>You may also like</h2><div class='boko-reco__grid' data-reco-grid></div></div>");
    if(prod&&prod.id){
      root.setAttribute("data-anchor",prod.id);
      root.setAttribute("data-anchor-type",prod.type||"");
      root.setAttribute("data-anchor-title",prod.title||"");
      root.setAttribute("data-anchor-tags",tags);
      root.setAttribute("data-anchor-price",price);
    }
    var host=railHost();
    if(host&&host.parentNode){ host.parentNode.insertBefore(root, host.nextSibling); } else { document.body.appendChild(root); }
    init(root);
  }
  var h=location.pathname.match(/\/products\/([^/?#]+)/)[1];
  fetch("/products/"+h+".js",{headers:{Accept:"application/json"}})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(p){ mountRail(p||{}); })
    .catch(function(){ mountRail({}); });
})();

/* ===================== CART DRAWER CAROUSEL (injected once into the cart drawer) ===================== */
(function(){
  if(window.__bokoRecoCart) return; window.__bokoRecoCart=1;
  function el(h){var d=document.createElement("div");d.innerHTML=h.trim();return d.firstChild;}
  var CC_CSS="#boko-cc-main{--ink:#2b2b2b;--muted:#8a8a8a;--line:#e6e6e6;font-family:inherit;color:var(--ink);margin:16px 0;border-top:1px solid var(--line);padding-top:14px}\n#boko-cc-main .bcc-h{font-size:15px;letter-spacing:1.5px;text-transform:uppercase;text-align:center;margin:0 0 10px;font-weight:500}\n#boko-cc-main .bcc-stage{position:relative;display:flex;align-items:center;gap:8px}\n#boko-cc-main .bcc-nav{flex:0 0 36px;width:36px!important;height:36px!important;min-width:36px!important;max-width:36px!important;min-height:36px!important;padding:0!important;margin:0;border:1px solid var(--line);background:#fff;border-radius:50%!important;cursor:pointer;font-size:16px;line-height:1;color:var(--ink);display:flex;align-items:center;justify-content:center;box-sizing:border-box;aspect-ratio:1/1;flex-shrink:0}\n#boko-cc-main .bcc-nav:hover{border-color:var(--ink)}\n#boko-cc-main .bcc-track{flex:1;overflow:hidden}\n#boko-cc-main .bcc-slides{display:flex;transition:transform .3s ease}\n#boko-cc-main .bcc-slide{flex:0 0 100%;display:flex;gap:12px;align-items:center;padding:4px}\n#boko-cc-main .bcc-img{flex:0 0 76px;width:76px;height:90px;object-fit:cover;background:#f3f1ee;border-radius:6px}\n#boko-cc-main .bcc-info{flex:1;min-width:0}\n#boko-cc-main .bcc-title{font-size:13px;line-height:1.3;margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n#boko-cc-main .bcc-price{font-size:13px;font-weight:600;margin-bottom:8px}\n#boko-cc-main .bcc-add{border:none;background:#1f1f1f;color:#fff;font:inherit;font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:8px 12px;border-radius:6px;cursor:pointer}\n#boko-cc-main .bcc-add.added{background:#3f8f5f}\n#boko-cc-main .bcc-dots{display:flex;gap:5px;justify-content:center;margin-top:10px}\n#boko-cc-main .bcc-dot{width:6px;height:6px;border-radius:50%;background:var(--line);border:none;padding:0;cursor:pointer}\n#boko-cc-main .bcc-dot.on{background:var(--ink)}\n#boko-cc-main .bcc-empty{color:var(--muted);font-size:12px;text-align:center;padding:10px}";
  function makeCC(){
    return el("<div id='boko-cc-main' class='boko-cc' data-boko-cc data-proxy='/apps/reco/recommend' data-count='6' data-autoplay='0'><p class='bcc-h'>You may also like</p><div class='bcc-stage'><button class='bcc-nav' data-prev aria-label='Previous'>&#8249;</button><div class='bcc-track'><div class='bcc-slides' data-slides><div class='bcc-empty'>Loading\u2026</div></div></div><button class='bcc-nav' data-next aria-label='Next'>&#8250;</button></div><div class='bcc-dots' data-dots></div></div>");
  }
  function wireCC(root){
    if(root.dataset.init) return; root.dataset.init="1";
var proxy=root.getAttribute("data-proxy");
  var count=Math.max(1,parseInt(root.getAttribute("data-count")||"6",10));
  var autoplay=parseInt(root.getAttribute("data-autoplay")||"0",10);
  var anchor=root.getAttribute("data-anchor")||"";
  var aType=root.getAttribute("data-anchor-type")||"";
  var aTitle=root.getAttribute("data-anchor-title")||"";
  var aTags=root.getAttribute("data-anchor-tags")||"";
  var aPrice=root.getAttribute("data-anchor-price")||"";
  var slides=root.querySelector("[data-slides]"), dots=root.querySelector("[data-dots]");
  var items=[], idx=0, timer=null, cartIds={}, busy=false;
  function money(n){return "$"+Number(n).toFixed(2);}
  function vnum(g){var m=String(g).match(/(\d+)$/);return m?m[1]:g;}
  function setCount(n){try{document.querySelectorAll(".cart-link__count,.cart-count-bubble,.cart-count,[data-cart-count],#CartCount,.cart-link__bubble,.cart-count-number,[data-cart-item-count],.cart-counter,.cart__count").forEach(function(e){var t=e.querySelector("span")||e;if(/^\s*\d+\s*$/.test(t.textContent||""))t.textContent=n;});}catch(e){}["cart:refresh","cart:updated","cart:change"].forEach(function(ev){try{document.dispatchEvent(new CustomEvent(ev,{bubbles:true}));}catch(e){}});}
  function go(i){ if(!items.length)return; idx=(i+items.length)%items.length; slides.style.transform="translateX("+(-idx*100)+"%)"; dots.querySelectorAll(".bcc-dot").forEach(function(d,k){d.classList.toggle("on",k===idx);}); }
  function stop(){ if(timer){clearInterval(timer);timer=null;} }
  function start(){ stop(); if(autoplay>0 && items.length>1){ timer=setInterval(function(){go(idx+1);}, autoplay*1000); } }
  function addToCart(v,btn){
    fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:[{id:vnum(v),quantity:1,properties:{"_boko_reco":"cart_drawer"}}]})})
      .then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(){ if(btn){btn.textContent="Added";btn.classList.add("added");} document.dispatchEvent(new CustomEvent("boko:cart:added")); refresh(); })
      .catch(function(){ if(btn)btn.textContent="Try again"; });
  }
  function render(){
    stop();
    if(!items.length){ slides.innerHTML="<div class='bcc-empty'>No recommendations right now.</div>"; dots.innerHTML=""; return; }
    slides.innerHTML="";
    items.forEach(function(p){
      var s=document.createElement("div"); s.className="bcc-slide";
      s.innerHTML=(p.img?"<img class='bcc-img' src='"+p.img+"' alt=''>":"<div class='bcc-img'></div>")+
        "<div class='bcc-info'><div class='bcc-title'>"+p.title+"</div><div class='bcc-price'>"+money(p.price)+"</div><button class='bcc-add'>Add to cart</button></div>";
      s.querySelector(".bcc-add").addEventListener("click",function(){addToCart(p.variantId,this);});
      slides.appendChild(s);
    });
    dots.innerHTML=items.map(function(_,k){return "<button class='bcc-dot"+(k===0?" on":"")+"' data-d='"+k+"'></button>";}).join("");
    dots.querySelectorAll(".bcc-dot").forEach(function(d){d.addEventListener("click",function(){go(+d.dataset.d);start();});});
    idx=0; go(0); start();
  }
  function loadRecos(){
    var url=proxy+"?type=recommended&limit="+(count+5)+(anchor?"&anchor="+encodeURIComponent(anchor):"")+(aType?"&atype="+encodeURIComponent(aType):"")+(aTitle?"&atitle="+encodeURIComponent(aTitle):"")+(aTags?"&atags="+encodeURIComponent(aTags):"")+(aPrice?"&aprice="+encodeURIComponent(aPrice):"");
    return fetch(url,{headers:{Accept:"application/json"}}).then(function(r){return r.json();})
      .then(function(d){ items=(d.items||[]).filter(function(p){return p.variantId && !cartIds[vnum(p.variantId)];}).slice(0,count); render(); })
      .catch(function(){ slides.innerHTML="<div class='bcc-empty'>Couldn’t load.</div>"; });
  }
  function refresh(){
    if(busy)return; busy=true;
    fetch("/cart.js",{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(c){
      cartIds={}; (c.items||[]).forEach(function(it){ cartIds[String(it.variant_id)]=1; });
      setCount(c.item_count||0);
      if((c.item_count||0)===0){ root.style.display="none"; busy=false; return; }
      root.style.display=""; loadRecos().then(function(){busy=false;});
    }).catch(function(){ root.style.display=""; loadRecos().then(function(){busy=false;}); });
  }
  root.querySelector("[data-prev]").addEventListener("click",function(){go(idx-1);start();});
  root.querySelector("[data-next]").addEventListener("click",function(){go(idx+1);start();});
  refresh();
  ["boko:cart:added","cart:updated","cart:refresh","cart:change","ajaxCart:afterCartLoad"].forEach(function(ev){
    document.addEventListener(ev,function(){ setTimeout(refresh,300); });
  });
  }
  var HOSTS=["cart-drawer .drawer__footer","cart-drawer .cart-drawer__footer","#CartDrawer .drawer__footer",".cart-drawer .drawer__footer",".drawer__footer",".cart-drawer__footer","#cart-notification .cart-notification__links","cart-items + *",".cart__footer","#main-cart-footer .cart__footer"];
  function findHost(){ for(var i=0;i<HOSTS.length;i++){ var e=document.querySelector(HOSTS[i]); if(e) return e; } return null; }
  function inject(){
    var host=findHost(); if(!host) return;
    if(host.parentNode && host.parentNode.querySelector("[data-boko-cc]")) return;
    if(!document.getElementById("boko-cc-css")){ var s=document.createElement("style"); s.id="boko-cc-css"; s.textContent=CC_CSS; document.head.appendChild(s); }
    var node=makeCC();
    host.parentNode.insertBefore(node, host);
    wireCC(node);
  }
  inject();
  document.addEventListener("DOMContentLoaded", inject);
  var mo=new MutationObserver(function(){ inject(); });
  mo.observe(document.documentElement,{childList:true,subtree:true});
})();
