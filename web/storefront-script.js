// storefront-script.js — the JS body served at GET /storefront.js.
// Loaded on every storefront page via a Shopify ScriptTag (registered by
// POST /enable-widgets) instead of a theme-app-extension block/embed. It
// renders two widgets purely in JS, using data already available on the
// page (Shopify's own `ShopifyAnalytics` meta object) instead of Liquid:
//   - a "You may also like" rail on product pages (tag: _boko_reco:"pdp")
//   - a cart-drawer / cart-page carousel (tag: _boko_reco:"cart_drawer")
// Both read GET /apps/reco/config for fonts/sizes/colours set in the
// dashboard Customizer, and GET /apps/reco/recommend for products.

const STOREFRONT_JS = `(function(){
  if (window.__bokoStorefrontLoaded) return; window.__bokoStorefrontLoaded = 1;
  var PROXY = "/apps/reco/recommend";
  var CONFIG_URL = "/apps/reco/config";
  var TRACK_URL = "/apps/reco/track";

  function sendTrack(event,source,handle){
    try{
      var payload=JSON.stringify({event:event,source:source,handle:handle||null});
      if(navigator.sendBeacon){
        var blob=new Blob([payload],{type:"application/json"});
        navigator.sendBeacon(TRACK_URL,blob);
      } else {
        fetch(TRACK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:payload,keepalive:true}).catch(function(){});
      }
    }catch(e){}
  }

  function vnum(g){var m=String(g).match(/(\\d+)$/);return m?m[1]:g;}
  function money(n){return "$"+Number(n).toFixed(2);}
  function el(h){var d=document.createElement("div");d.innerHTML=h.trim();return d.firstChild;}

  function getConfig(){
    if(window.__bokoConfigPromise) return window.__bokoConfigPromise;
    window.__bokoConfigPromise = fetch(CONFIG_URL,{headers:{Accept:"application/json"}})
      .then(function(r){return r.json();}).catch(function(){return {};});
    return window.__bokoConfigPromise;
  }

  function cartNotify(count){
    try{document.querySelectorAll(".cart-link__count,.cart-count-bubble,.cart-count,[data-cart-count],#CartCount,.cart-link__bubble,.cart-count-number,[data-cart-item-count],.cart-counter,.cart__count").forEach(function(e){var n=e.querySelector("span")||e;if(/^\\s*\\d+\\s*$/.test(n.textContent||""))n.textContent=count;});}catch(e){}
    ["cart:refresh","cart:updated","cart:change","ajaxCart:afterCartLoad"].forEach(function(ev){document.dispatchEvent(new CustomEvent(ev,{bubbles:true}));});
    document.dispatchEvent(new CustomEvent("boko:cart:added"));
  }
  function getSections(){var cd=document.querySelector("cart-drawer");return(cd&&cd.getSectionsToRender)?cd.getSectionsToRender().map(function(s){return s.id;}):null;}
  function bokoUnempty(cd){try{if(!document.querySelector("cart-drawer .cart-item"))return;var L=["#CartDrawer",".drawer__inner","cart-drawer-items",".cart-drawer"];for(var i=0;i<L.length;i++){var n=document.querySelector(L[i]);if(n)n.classList.remove("is-empty");}cd.classList.remove("is-empty");if(typeof cd.open==="function"){cd.open();}else{cd.classList.add("active");}}catch(e){}}
function showCart(json){
    var cd=document.querySelector("cart-drawer");
    if(cd&&typeof cd.renderContents==="function"&&json&&json.sections&&json.sections["cart-drawer"]){
      try{cd.renderContents(json);bokoUnempty(cd);return;}catch(e){}
    }
    fetch("/cart.js",{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(c){cartNotify(c.item_count||0);}).catch(function(){cartNotify(0);});
  }
  function addToCart(variantId,tag,btn,handle){
    if(btn)btn.disabled=true;
    sendTrack("add",tag.value,handle);
    var props={};props[tag.key]=tag.value;
    var body={items:[{id:Number(vnum(variantId)),quantity:1,properties:props}]};
    var sec=getSections();if(sec){body.sections=sec;body.sections_url=location.pathname;}
    return fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
      .then(function(r){if(!r.ok)return r.json().then(function(e){throw e;});return r.json();})
      .then(function(json){
        if(btn){btn.textContent="Added \\u2713";btn.classList.add("is-added");setTimeout(function(){btn.textContent=btn.dataset.label||"Add to cart";btn.classList.remove("is-added");btn.disabled=false;},1600);}
        showCart(json);
      })
      .catch(function(e){if(btn){btn.textContent="Unavailable";setTimeout(function(){btn.textContent=btn.dataset.label||"Add to cart";btn.disabled=false;},1600);}console.warn("[boko]",e);});
  }
  function variantFor(p,sel){for(var i=0;i<p.variants.length;i++){var v=p.variants[i],ok=true;for(var k=0;k<sel.length;k++){if(sel[k]!=null&&v.options[k]!==sel[k]){ok=false;break;}}if(ok)return v;}return null;}
  function firstAvail(p){for(var i=0;i<p.variants.length;i++){if(p.variants[i].available)return p.variants[i];}return p.variants[0];}
  function valAvail(p,oi,val,sel){for(var i=0;i<p.variants.length;i++){var v=p.variants[i];if(!v.available)continue;if(v.options[oi]!==val)continue;var ok=true;for(var k=0;k<sel.length;k++){if(k!==oi&&sel[k]!=null&&v.options[k]!==sel[k]){ok=false;break;}}if(ok)return true;}return false;}

  // ---------------- PDP rail ----------------
  var RAIL_HOSTS = ["main#MainContent",".product__info-wrapper","main .product","product-info","main"];
  function findRailHost(){for(var i=0;i<RAIL_HOSTS.length;i++){var e=document.querySelector(RAIL_HOSTS[i]);if(e)return e;}return document.body;}
  function productMeta(){
    try{
      var m=window.ShopifyAnalytics&&window.ShopifyAnalytics.meta;
      if(m&&m.page&&m.page.pageType==="product"&&m.product){return m.product;}
    }catch(e){}
    return null;
  }
  function railCard(p,cfg){
    var c=el("<div class='boko-rail__card'><div class='boko-rail__imgwrap'>"+(p.img?"<img loading='lazy' src='"+p.img+"' alt=''>":"")+"<button class='boko-rail__atc' data-label='"+ (cfg.addText?"Add to cart":"Add to cart") +"'>Add to cart</button></div><div class='boko-rail__body'><div class='boko-rail__title'></div><div class='boko-rail__price'></div><div class='boko-rail__opts'></div></div></div>");
    var titleEl=c.querySelector(".boko-rail__title");
    if(p.handle){var a=document.createElement("a");a.href="/products/"+p.handle;a.style.color="inherit";a.style.textDecoration="none";a.textContent=p.title||"";a.addEventListener("click",function(){sendTrack("click","pdp",p.handle);});titleEl.appendChild(a);}
    else{titleEl.textContent=p.title||"";}
    var priceEl=c.querySelector(".boko-rail__price"); priceEl.textContent=money(p.price);
    var atc=c.querySelector(".boko-rail__atc"), optsEl=c.querySelector(".boko-rail__opts");
    var vid=p.variantId;
    var hasV=p.options&&p.options.length&&p.variants&&p.variants.length>1;
    if(hasV){
      var sel=p.options.map(function(){return null;});
      var dv=firstAvail(p);if(dv){sel=dv.options.slice();vid=dv.id;priceEl.textContent=money(dv.price);}
      var draw=function(){
        optsEl.innerHTML="";
        p.options.forEach(function(opt,oi){
          var row=document.createElement("div");row.className="boko-rail__opt";
          opt.values.forEach(function(val){
            var b=document.createElement("button");b.type="button";
            var on=sel[oi]===val,av=valAvail(p,oi,val,sel);
            b.className="boko-rail__sw"+(on?" is-sel":"")+(av?"":" is-oos");b.textContent=val;
            b.addEventListener("click",function(){if(!av&&!on)return;sel[oi]=val;var v=variantFor(p,sel);if(v){vid=v.id;priceEl.textContent=money(v.price);atc.disabled=!v.available;atc.textContent=v.available?"Add to cart":"Sold out";}draw();});
            row.appendChild(b);
          });
          optsEl.appendChild(row);
        });
        var cur=variantFor(p,sel);if(cur){atc.disabled=!cur.available;atc.textContent=cur.available?"Add to cart":"Sold out";}
      };
      draw();
    }
    atc.addEventListener("click",function(){if(this.disabled)return;addToCart(vid,{key:"_boko_reco",value:"pdp"},this,p.handle);});
    return c;
  }
  function fontStack(name){if(!name||name==="Default")return "inherit";return "'"+name+"', sans-serif";}
  function loadGFont(name){if(!name||name==="Default")return;var id="boko-gf-"+name.replace(/[^a-z0-9]+/gi,"-");if(document.getElementById(id))return;var l=document.createElement("link");l.id=id;l.rel="stylesheet";l.href="https://fonts.googleapis.com/css2?family="+encodeURIComponent(name).replace(/%20/g,"+")+":wght@400;500;600;700&display=swap";document.head.appendChild(l);}
  function styleRail(root,cfg){
    var s=(cfg&&cfg.rail)||{};
    var d=(cfg&&cfg.global&&cfg.global.design)||{};
    loadGFont(d.fontFamily);var f=fontStack(d.fontFamily);
    root.style.setProperty("--boko-rail-hfont",f!=="inherit"?f:(s.headingFont||"inherit"));
    root.style.setProperty("--boko-rail-bfont",f!=="inherit"?f:(s.bodyFont||"inherit"));
    root.style.setProperty("--boko-rail-hsize",(d.headingSize||s.headingSize||24)+"px");
    root.style.setProperty("--boko-rail-tsize",(d.titleSize||s.titleSize||13)+"px");
    root.style.setProperty("--boko-rail-psize",(d.subtitleSize||s.priceSize||13)+"px");
    root.style.setProperty("--boko-rail-hcolor",s.headingColor||"#1f1f1f");
    root.style.setProperty("--boko-rail-tcolor",s.titleColor||"#1f1f1f");
    root.style.setProperty("--boko-rail-pcolor",s.priceColor||"#1f1f1f");
    root.style.setProperty("--boko-rail-atc-bg",d.buttonColor||s.addBg||"#1f1f1f");
    root.style.setProperty("--boko-rail-atc-c",d.buttonTextColor||s.addText||"#ffffff");
    root.style.setProperty("--boko-rail-cols",s.columns||4);
    return s;
  }
  function injectRailStyles(){
    if(document.getElementById("boko-rail-style"))return;
    var css=".boko-rail{font-family:var(--boko-rail-bfont);margin:40px auto;max-width:1240px;padding:0 16px;box-sizing:border-box;width:100%}"+
      ".boko-rail__title{text-align:center;font-family:var(--boko-rail-hfont);font-size:var(--boko-rail-hsize);color:var(--boko-rail-hcolor);text-transform:uppercase;margin:0 0 24px}"+
      ".boko-rail__grid{display:grid;grid-template-columns:repeat(var(--boko-rail-cols),minmax(0,1fr));gap:16px}"+
      "@media(max-width:640px){.boko-rail__grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}"+
      ".boko-rail__card{position:relative;display:flex;flex-direction:column;background:#fff}"+
      ".boko-rail__imgwrap{position:relative;aspect-ratio:3/4;overflow:hidden;background:#f3f1ee}"+
      ".boko-rail__imgwrap img{width:100%;height:100%;object-fit:cover;display:block}"+
      ".boko-rail__atc{position:absolute;left:10px;right:10px;bottom:10px;border:none;background:var(--boko-rail-atc-bg);color:var(--boko-rail-atc-c);font:inherit;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:11px;cursor:pointer;opacity:0;transform:translateY(6px);transition:.2s}"+
      ".boko-rail__card:hover .boko-rail__atc{opacity:1;transform:translateY(0)}"+
      ".boko-rail__atc.is-added{background:#3f8f5f}"+
      ".boko-rail__body{padding:10px 4px 0;text-align:center}"+
      ".boko-rail__title{font-family:var(--boko-rail-bfont);font-size:var(--boko-rail-tsize);color:var(--boko-rail-tcolor);text-transform:uppercase;font-weight:400}"+
      ".boko-rail .boko-rail__price{font-size:var(--boko-rail-psize);color:var(--boko-rail-pcolor);margin-top:4px}"+
      ".boko-rail__opts{display:flex;flex-direction:column;gap:4px;margin-top:6px}"+
      ".boko-rail__opt{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}"+
      ".boko-rail__sw{border:1px solid #e6e6e6;background:#fff;font:inherit;font-size:11px;padding:3px 8px;border-radius:3px;cursor:pointer}"+
      ".boko-rail__sw.is-sel{background:#1f1f1f;color:#fff;border-color:#1f1f1f}"+
      ".boko-rail__sw.is-oos{opacity:.4;text-decoration:line-through;cursor:not-allowed}"+
      ".boko-rail__loading{grid-column:1/-1;text-align:center;color:#8a8a8a;padding:20px}";
    var s=document.createElement("style");s.id="boko-rail-style";s.textContent=css;document.head.appendChild(s);
  }
  function initRail(){
    var product=productMeta();
    if(!product||!product.id)return;
    if(document.getElementById("boko-rail"))return;
    injectRailStyles();
    var host=findRailHost();
    var root=el("<div id='boko-rail' class='boko-rail'><h2 class='boko-rail__title'>You may also like</h2><div class='boko-rail__grid'><div class='boko-rail__loading'>Loading\\u2026</div></div></div>");
    host.appendChild(root);
    getConfig().then(function(cfg){
      var s=styleRail(root,cfg);
      var url=PROXY+"?type=recommended&limit="+(s.count||8)+"&anchor="+encodeURIComponent(product.id);
      return fetch(url,{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(d){return d.items||[];});
    }).catch(function(){return [];}).then(function(items){
      var grid=root.querySelector(".boko-rail__grid");
      grid.innerHTML="";
      if(!items||!items.length){root.remove();return;}
      items.forEach(function(p){if(p.variantId)grid.appendChild(railCard(p,{}));});
    });
  }

  // ---------------- Cart drawer carousel ----------------
  var CART_HOSTS = [
    "cart-drawer .drawer__footer","cart-drawer .cart-drawer__footer",
    "#CartDrawer .drawer__footer",".cart-drawer .drawer__footer",
    ".drawer__footer",".cart-drawer__footer",
    "#cart-notification .cart-notification__links",
    "cart-items + *",".cart__footer","#main-cart-footer .cart__footer"
  ];
  function injectCartStyles(){
    if(document.getElementById("boko-cart-style"))return;
    var css=".boko-cart{font-family:var(--boko-cart-bfont,inherit);margin:14px 0;border-top:1px solid #e6e6e6;padding-top:14px}"+
    ".boko-cart__h{text-align:center;font-family:var(--boko-cart-hfont,inherit);font-size:var(--boko-cart-hsize,13px);letter-spacing:1.5px;text-transform:uppercase;color:var(--boko-cart-hcolor,#1f1f1f);margin:0 0 12px}"+
    ".boko-cart__vp{position:relative;overflow:hidden}"+
    ".boko-cart__track{display:flex;transition:transform .25s ease}"+
    ".boko-cart__slide{flex:0 0 100%;box-sizing:border-box;padding:0 30px;display:flex;gap:12px;align-items:flex-start}"+
    ".boko-cart__img{flex:0 0 84px;display:block}"+
    ".boko-cart__img img{width:84px;height:112px;object-fit:cover;border-radius:4px;background:#f3f1ee;display:block}"+
    ".boko-cart__info{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}"+
    ".boko-cart__row1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}"+
    ".boko-cart__title{font-size:var(--boko-cart-tsize,12px);color:var(--boko-cart-tcolor,#1f1f1f);text-transform:uppercase;letter-spacing:.3px;line-height:1.3}"+
    ".boko-cart__title a{color:inherit;text-decoration:none}"+
    ".boko-cart__price{font-size:var(--boko-cart-psize,12px);color:var(--boko-cart-pcolor,#1f1f1f);white-space:nowrap}"+
    ".boko-cart__opts{display:flex;flex-direction:column;gap:6px}"+
    ".boko-cart__optrow{display:flex;flex-wrap:wrap;gap:6px}"+
    ".boko-cart__sw{min-width:28px;height:28px;padding:0 6px;border:1px solid #d9d9d9;background:#fff;font:inherit;font-size:11px;color:#1f1f1f;cursor:pointer;border-radius:2px}"+
    ".boko-cart__sw.is-sel{border-color:var(--boko-cart-btn,#1f1f1f)}"+
    ".boko-cart__sw.is-oos{opacity:.4;text-decoration:line-through;cursor:not-allowed}"+
    ".boko-cart__add{width:100%;border:1px solid var(--boko-cart-btn,#1f1f1f);background:#fff;color:var(--boko-cart-btn,#1f1f1f);font:inherit;font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:10px 8px;cursor:pointer;transition:.15s}"+
    ".boko-cart__add:hover{background:var(--boko-cart-btn,#1f1f1f);color:var(--boko-cart-btntext,#fff)}"+
    ".boko-cart__add.is-added{background:var(--boko-cart-btn,#1f1f1f);color:var(--boko-cart-btntext,#fff)}"+
    ".boko-cart__add:disabled{opacity:.45;cursor:not-allowed}"+
    ".boko-cart__nav{position:absolute;top:56px;transform:translateY(-50%);width:24px;height:24px;border:1px solid #d9d9d9;background:#fff;border-radius:50%;cursor:pointer;color:#1f1f1f;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}"+
    ".boko-cart__nav:disabled{opacity:.3;cursor:not-allowed}"+
    ".boko-cart__prev{left:0}"+
    ".boko-cart__next{right:0}"+
    ".boko-cart__dots{display:flex;justify-content:center;gap:6px;margin-top:12px}"+
    ".boko-cart__dot{width:6px;height:6px;border-radius:50%;background:#d9d9d9;border:none;padding:0;cursor:pointer}"+
    ".boko-cart__dot.is-on{background:#1f1f1f}"+
    ".boko-cart__empty{color:#8a8a8a;font-size:12px;text-align:center;padding:10px}";
    var s=document.createElement("style");s.id="boko-cart-style";s.textContent=css;document.head.appendChild(s);
  }
  function cartCard(p){
    var c=el("<div class='boko-cart__slide'><a class='boko-cart__img'></a><div class='boko-cart__info'><div class='boko-cart__row1'><span class='boko-cart__title'></span><span class='boko-cart__price'></span></div><div class='boko-cart__opts'></div><button class='boko-cart__add' data-label='Add to cart'>Add to cart</button></div></div>");
    var imgA=c.querySelector(".boko-cart__img");
    if(p.img){imgA.innerHTML="<img loading='lazy' src='"+p.img+"' alt=''>";}
    else{imgA.innerHTML="<div style='width:84px;height:112px;background:#f3f1ee;border-radius:4px'></div>";}
    if(p.handle){imgA.href="/products/"+p.handle;}
    var titleEl=c.querySelector(".boko-cart__title");
    if(p.handle){var a=document.createElement("a");a.href="/products/"+p.handle;a.textContent=p.title||"";a.addEventListener("click",function(){sendTrack("click","cart_drawer",p.handle);});titleEl.appendChild(a);}
    else{titleEl.textContent=p.title||"";}
    var priceEl=c.querySelector(".boko-cart__price");priceEl.textContent=money(p.price);
    var atc=c.querySelector(".boko-cart__add"),optsEl=c.querySelector(".boko-cart__opts");
    var vid=p.variantId;
    var hasV=p.options&&p.options.length&&p.variants&&p.variants.length>1;
    if(hasV){
      var sel=p.options.map(function(){return null;});
      var dv=firstAvail(p);if(dv){sel=dv.options.slice();vid=dv.id;priceEl.textContent=money(dv.price);}
      var draw=function(){
        optsEl.innerHTML="";
        p.options.forEach(function(opt,oi){
          var row=document.createElement("div");row.className="boko-cart__optrow";
          opt.values.forEach(function(val){
            var b=document.createElement("button");b.type="button";
            var on=sel[oi]===val,av=valAvail(p,oi,val,sel);
            b.className="boko-cart__sw"+(on?" is-sel":"")+(av?"":" is-oos");b.textContent=val;
            b.addEventListener("click",function(){if(!av&&!on)return;sel[oi]=val;var v=variantFor(p,sel);if(v){vid=v.id;priceEl.textContent=money(v.price);atc.disabled=!v.available;atc.textContent=v.available?"Add to cart":"Sold out";}draw();});
            row.appendChild(b);
          });
          optsEl.appendChild(row);
        });
        var cur=variantFor(p,sel);if(cur){atc.disabled=!cur.available;atc.textContent=cur.available?"Add to cart":"Sold out";}
      };
      draw();
    }
    atc.addEventListener("click",function(){if(this.disabled)return;addToCart(vid,{key:"_boko_reco",value:"cart_drawer"},this,p.handle);});
    return c;
  }
  function findCartHost(){for(var i=0;i<CART_HOSTS.length;i++){var e=document.querySelector(CART_HOSTS[i]);if(e)return e;}return null;}
  function styleCartRoot(root,cfg){
    var s=(cfg&&cfg.cart)||{};
    var d=(cfg&&cfg.global&&cfg.global.design)||{};
    loadGFont(d.fontFamily);var f=fontStack(d.fontFamily);
    root.style.setProperty("--boko-cart-hfont",f!=="inherit"?f:(s.headingFont||"inherit"));
    root.style.setProperty("--boko-cart-bfont",f!=="inherit"?f:(s.bodyFont||"inherit"));
    root.style.setProperty("--boko-cart-hsize",(d.headingSize||s.headingSize||15)+"px");
    root.style.setProperty("--boko-cart-tsize",(d.titleSize||s.titleSize||12)+"px");
    root.style.setProperty("--boko-cart-psize",(d.subtitleSize||s.priceSize||12)+"px");
    root.style.setProperty("--boko-cart-hcolor",s.headingColor||"#1f1f1f");
    root.style.setProperty("--boko-cart-tcolor",s.titleColor||"#1f1f1f");
    root.style.setProperty("--boko-cart-pcolor",s.priceColor||"#1f1f1f");
    root.style.setProperty("--boko-cart-btn",d.buttonColor||s.addBg||"#1f1f1f");
    root.style.setProperty("--boko-cart-btntext",d.buttonTextColor||s.addText||"#ffffff");
    return s;
  }
  function loadCartWidget(root,cfgCount){
    var track=root.querySelector("[data-row]");
    var dotsEl=root.querySelector("[data-dots]");
    var prev=root.querySelector(".boko-cart__prev");
    var next=root.querySelector(".boko-cart__next");
    track.innerHTML="<div class='boko-cart__empty'>Loading&#8230;</div>";
    var url=PROXY+"?type=recommended&limit="+((cfgCount||6)+6);
    fetch(url,{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(d){
      var items=(d.items||[]).filter(function(p){return p.variantId;}).slice(0,cfgCount||6);
      track.innerHTML="";if(dotsEl)dotsEl.innerHTML="";
      if(!items.length){track.innerHTML="<div class='boko-cart__empty'>No recommendations right now.</div>";if(prev)prev.style.display="none";if(next)next.style.display="none";return;}
      items.forEach(function(p){track.appendChild(cartCard(p));});
      var idx=0,n=items.length;
      function upd(){track.style.transform="translateX(-"+(idx*100)+"%)";if(prev)prev.disabled=idx===0;if(next)next.disabled=idx===n-1;if(dotsEl){var ds=dotsEl.children;for(var k=0;k<ds.length;k++){ds[k].className="boko-cart__dot"+(k===idx?" is-on":"");}}}
      function go(i){idx=Math.max(0,Math.min(n-1,i));upd();}
      var single=n<=1;
      if(prev)prev.style.display=single?"none":"";
      if(next)next.style.display=single?"none":"";
      if(dotsEl&&!single){for(var k2=0;k2<n;k2++){(function(j){var dot=document.createElement("button");dot.type="button";dot.className="boko-cart__dot"+(j===0?" is-on":"");dot.addEventListener("click",function(){go(j);});dotsEl.appendChild(dot);})(k2);}}
      if(prev)prev.onclick=function(){go(idx-1);};
      if(next)next.onclick=function(){go(idx+1);};
      go(0);
    }).catch(function(){track.innerHTML="<div class='boko-cart__empty'>Couldn't load.</div>";});
  }
  function cartRootHTML(){return "<div class='boko-cart' data-boko-cart><p class='boko-cart__h'>You may also like</p><div class='boko-cart__vp'><button class='boko-cart__nav boko-cart__prev' type='button' aria-label='Previous'>&#8249;</button><div class='boko-cart__track' data-row></div><button class='boko-cart__nav boko-cart__next' type='button' aria-label='Next'>&#8250;</button></div><div class='boko-cart__dots' data-dots></div></div>";}
  function injectCart(){
    var dup=document.querySelectorAll("[data-boko-cc]");for(var q=0;q<dup.length;q++){if(dup[q].parentNode)dup[q].parentNode.removeChild(dup[q]);}
    var host=findCartHost();
    if(host){
      if(host.parentNode&&host.parentNode.querySelector("[data-boko-cart]"))return;
      injectCartStyles();
      var root=el(cartRootHTML());
      host.parentNode.insertBefore(root,host);
      getConfig().then(function(cfg){var s=styleCartRoot(root,cfg);loadCartWidget(root,s.count);}).catch(function(){loadCartWidget(root,6);});
      return;
    }
    var box=document.querySelector("cart-drawer .drawer__inner")||document.querySelector(".cart-drawer .drawer__inner")||document.querySelector("#CartDrawer .drawer__inner")||document.querySelector("cart-drawer")||document.querySelector(".cart-drawer");
    if(!box)return;
    if(box.querySelector("[data-boko-cart]"))return;
    injectCartStyles();
    var root2=el(cartRootHTML());
    box.appendChild(root2);
    getConfig().then(function(cfg){var s=styleCartRoot(root2,cfg);loadCartWidget(root2,s.count);}).catch(function(){loadCartWidget(root2,6);});
  }
  function initCart(){
    injectCart();
    document.addEventListener("DOMContentLoaded",injectCart);
    var mo=new MutationObserver(function(){injectCart();});
    mo.observe(document.documentElement,{childList:true,subtree:true});
    ["boko:cart:added","cart:updated","cart:refresh","cart:change","ajaxCart:afterCartLoad"].forEach(function(ev){
      document.addEventListener(ev,function(){setTimeout(injectCart,300);});
    });
  }

  function boot(){initRail();initCart();}
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",boot);}else{boot();}
})();
`;

export { STOREFRONT_JS };
