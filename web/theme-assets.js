// theme-assets.js — theme file contents installed onto a merchant's live theme
// via the Admin REST Asset API (POST /setup-theme in server.js). This is the
// "no theme-app-extension" path: instead of shipping a Liquid file inside the
// app's extension bundle (which needs `shopify app deploy`), we PUT these
// contents directly onto the merchant's MAIN theme at install time.
//
// Adapted from extensions/reco-widget/blocks/selected-for-you.liquid:
//  - block.settings -> section.settings
//  - block.shopify_attributes removed (sections don't have it)
//  - styling (fonts/sizes/colours) now comes from GET /apps/reco/config at
//    runtime instead of theme-editor settings, so it stays in sync with the
//    merchant's Customizer choices on the app dashboard.
//  - adds an `exclude_collections` setting (comma-separated handles) that is
//    passed through to /apps/reco/recommend as `&exclude=...`.

const SFY_SECTION_LIQUID = `{% comment %}
  Boko AI — Selected For You page section.
  Installed automatically by the Boko AI Recommendations app (POST /setup-theme).
  Do not rename this file — it is referenced by templates/page.selected-for-you.json.
{% endcomment %}
{%- liquid
  assign img_ratio = "4 / 5"
  case section.settings.image_shape
    when 'portrait_23'
      assign img_ratio = "2 / 3"
    when 'square'
      assign img_ratio = "1 / 1"
    when 'landscape_32'
      assign img_ratio = "3 / 2"
    when 'landscape_54'
      assign img_ratio = "5 / 4"
  endcase
  assign tab_handles = ""
  assign tab_titles  = ""
  for coll in section.settings.collections
    unless forloop.first
      assign tab_handles = tab_handles | append: "||"
      assign tab_titles  = tab_titles  | append: "||"
    endunless
    assign tab_handles = tab_handles | append: coll.handle
    assign tab_titles  = tab_titles  | append: coll.title
  endfor
  assign extra_raw = section.settings.collection_handles | strip
  if extra_raw != blank
    assign extra_list = extra_raw | split: ","
    for h in extra_list
      assign hc = h | strip
      if hc != blank
        if tab_handles != blank
          assign tab_handles = tab_handles | append: "||"
          assign tab_titles  = tab_titles  | append: "||"
        endif
        assign tab_handles = tab_handles | append: hc
        assign tab_titles  = tab_titles  | append: hc
      endif
    endfor
  endif
-%}
<style>
#boko-sfy-{{ section.id }}{
  --sfy-hfont: inherit;
  --sfy-bfont: inherit;
  --sfy-hsize: 36px;
  --sfy-tsize: 13px;
  --sfy-psize: 13px;
  --sfy-hcolor: #1f1f1f;
  --sfy-tcolor: #1f1f1f;
  --sfy-pcolor: #1f1f1f;
  --sfy-wacolor: #8a8a8a;
  --sfy-tab-c: #2b2b2b;
  --sfy-tab-b: #e6e6e6;
  --sfy-atab-bg: #1f1f1f;
  --sfy-atab-c: #ffffff;
  --sfy-atc-bg: #1f1f1f;
  --sfy-atc-c: #ffffff;
  --sfy-atc-hbg: #3f3f3f;
  --sfy-atc-hc: #ffffff;
  --sfy-ratio: {{ img_ratio }};
  --sfy-cols: {{ section.settings.columns }};
  font-family: var(--sfy-bfont);
  padding: 40px 20px;
}
#boko-sfy-{{ section.id }} *{box-sizing:border-box}
#boko-sfy-{{ section.id }} .sfy-heading{
  font-family:var(--sfy-hfont);font-size:var(--sfy-hsize);color:var(--sfy-hcolor);
  text-align:center;text-transform:uppercase;margin:0 0 24px;line-height:1.15;
}
#boko-sfy-{{ section.id }} .sfy-bar{display:flex;align-items:center;gap:8px;margin-bottom:28px;flex-wrap:wrap;}
#boko-sfy-{{ section.id }} .sfy-tab{
  border:1px solid var(--sfy-tab-b);color:var(--sfy-tab-c);background:transparent;
  font-family:var(--sfy-bfont);font-weight:500;font-size:13px;letter-spacing:.5px;
  text-transform:uppercase;padding:8px 18px;border-radius:99px;cursor:pointer;
  transition:background .18s,color .18s,border-color .18s;white-space:nowrap;
}
#boko-sfy-{{ section.id }} .sfy-tab.is-on{background:var(--sfy-atab-bg);color:var(--sfy-atab-c);border-color:var(--sfy-atab-bg);}
#boko-sfy-{{ section.id }} .sfy-tab:hover:not(.is-on){border-color:var(--sfy-hcolor);}
#boko-sfy-{{ section.id }} .sfy-grid{display:grid;grid-template-columns:repeat(var(--sfy-cols),minmax(0,1fr));gap:20px 14px;}
#boko-sfy-{{ section.id }} .sfy-loading{grid-column:1/-1;text-align:center;padding:32px;font-size:14px;color:#8a8a8a;}
#boko-sfy-{{ section.id }} .sfy-card{display:flex;flex-direction:column;position:relative;}
#boko-sfy-{{ section.id }} .sfy-imgwrap{position:relative;overflow:hidden;background:#f3f1ee;aspect-ratio:var(--sfy-ratio);}
#boko-sfy-{{ section.id }} .sfy-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;transition:opacity .35s;}
#boko-sfy-{{ section.id }} .sfy-img2{opacity:0;}
#boko-sfy-{{ section.id }} .sfy-card:hover .sfy-img1{opacity:0;}
#boko-sfy-{{ section.id }} .sfy-card:hover .sfy-img2{opacity:1;}
#boko-sfy-{{ section.id }} .sfy-imglink{position:absolute;inset:0;display:block;z-index:1;}
#boko-sfy-{{ section.id }} .sfy-atc{
  position:absolute;left:10px;right:10px;bottom:10px;z-index:2;border:none;background:var(--sfy-atc-bg);color:var(--sfy-atc-c);
  font-family:var(--sfy-bfont);font-size:12px;letter-spacing:1.2px;text-transform:uppercase;padding:11px;cursor:pointer;
  opacity:0;transform:translateY(4px);transition:.2s;
}
#boko-sfy-{{ section.id }} .sfy-card:hover .sfy-atc{opacity:1;transform:translateY(0);}
#boko-sfy-{{ section.id }} .sfy-atc:hover{background:var(--sfy-atc-hbg);color:var(--sfy-atc-hc);}
#boko-sfy-{{ section.id }} .sfy-atc.is-added{background:#3f8f5f;color:#fff;}
#boko-sfy-{{ section.id }} .sfy-atc:disabled{opacity:.5;cursor:not-allowed;}
#boko-sfy-{{ section.id }} .sfy-body{padding:12px 4px 0;display:flex;flex-direction:column;gap:5px;}
#boko-sfy-{{ section.id }} .sfy-title{font-family:var(--sfy-bfont);font-size:var(--sfy-tsize);color:var(--sfy-tcolor);letter-spacing:.8px;text-transform:uppercase;font-weight:400;line-height:1.3;text-decoration:none;display:block;}
#boko-sfy-{{ section.id }} .sfy-title:hover{text-decoration:underline;}
#boko-sfy-{{ section.id }} .sfy-prices{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
#boko-sfy-{{ section.id }} .sfy-price{font-size:var(--sfy-psize);color:var(--sfy-pcolor);font-weight:600;}
#boko-sfy-{{ section.id }} .sfy-was{font-size:calc(var(--sfy-psize) - 1px);color:var(--sfy-wacolor);text-decoration:line-through;}
#boko-sfy-{{ section.id }} .sfy-opts{display:flex;flex-direction:column;gap:5px;margin-top:4px;}
#boko-sfy-{{ section.id }} .sfy-opt{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
#boko-sfy-{{ section.id }} .sfy-optlabel{font-size:10px;color:#8a8a8a;text-transform:uppercase;letter-spacing:.4px;width:100%;}
#boko-sfy-{{ section.id }} .sfy-sw{border:1px solid #e6e6e6;background:#fff;color:#2b2b2b;font:inherit;font-size:11px;padding:3px 8px;border-radius:3px;cursor:pointer;line-height:1;transition:background .15s,border-color .15s;}
#boko-sfy-{{ section.id }} .sfy-sw:hover{border-color:#2b2b2b;}
#boko-sfy-{{ section.id }} .sfy-sw.is-sel{background:#1f1f1f;color:#fff;border-color:#1f1f1f;}
#boko-sfy-{{ section.id }} .sfy-sw.is-oos{opacity:.4;text-decoration:line-through;cursor:not-allowed;}
@media(max-width:640px){
  #boko-sfy-{{ section.id }} .sfy-bar{flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
  #boko-sfy-{{ section.id }} .sfy-bar::-webkit-scrollbar{display:none;}
  #boko-sfy-{{ section.id }} .sfy-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;}
}
</style>

<div id="boko-sfy-{{ section.id }}"
  data-proxy="/apps/reco/recommend"
  data-config="/apps/reco/config"
  data-count="{{ section.settings.count }}"
  data-cols="{{ section.settings.columns }}"
  data-show-atc="{{ section.settings.show_atc }}"
  data-atc-text="{{ section.settings.atc_text | escape }}"
  data-tab-handles="{{ tab_handles | escape }}"
  data-tab-titles="{{ tab_titles | escape }}"
  data-show-bar="{{ section.settings.show_browse_bar }}"
  data-browse-label="{{ section.settings.browse_label | escape }}"
  data-exclude="{{ section.settings.exclude_collections | escape }}">
  {%- if section.settings.heading != blank -%}
  <h2 class="sfy-heading">{{ section.settings.heading | escape }}</h2>
  {%- endif -%}
  <div class="sfy-bar" data-sfy-bar style="{% unless section.settings.show_browse_bar %}display:none{% endunless %}"></div>
  <div class="sfy-grid" data-sfy-grid></div>
</div>

<script>
(function(){
  function vnum(g){var m=String(g).match(/(\\d+)$/);return m?m[1]:g;}
  function money(n){return "$"+Number(n).toFixed(2);}
  function isGift(p){var re=/gift/i;if(re.test(p.productType||""))return true;if(re.test(p.handle||""))return true;var t=p.tags||[];for(var i=0;i<t.length;i++){if(re.test(t[i]))return true;}return false;}
  function applyConfig(root,cfg){
    if(!cfg||!cfg.sfy)return;
    var s=cfg.sfy;
    if(s.headingFont)root.style.setProperty("--sfy-hfont",s.headingFont);
    if(s.bodyFont)root.style.setProperty("--sfy-bfont",s.bodyFont);
    if(s.headingSize)root.style.setProperty("--sfy-hsize",s.headingSize+"px");
    if(s.titleSize)root.style.setProperty("--sfy-tsize",s.titleSize+"px");
    if(s.priceSize)root.style.setProperty("--sfy-psize",s.priceSize+"px");
    if(s.headingColor)root.style.setProperty("--sfy-hcolor",s.headingColor);
    if(s.titleColor)root.style.setProperty("--sfy-tcolor",s.titleColor);
    if(s.priceColor)root.style.setProperty("--sfy-pcolor",s.priceColor);
    if(s.saleColor)root.style.setProperty("--sfy-wacolor",s.saleColor);
    if(s.addBg){root.style.setProperty("--sfy-atc-bg",s.addBg);root.style.setProperty("--sfy-atab-bg",s.addBg);}
    if(s.addText){root.style.setProperty("--sfy-atc-c",s.addText);root.style.setProperty("--sfy-atab-c",s.addText);}
  }
  function cartNotify(count){
    try{document.querySelectorAll(".cart-link__count,.cart-count-bubble,.cart-count,[data-cart-count],#CartCount,.cart-link__bubble,.cart-count-number,[data-cart-item-count],.cart-counter,.cart__count").forEach(function(e){var n=e.querySelector("span")||e;if(/^\\s*\\d+\\s*$/.test(n.textContent||""))n.textContent=count;});}catch(e){}
    ["cart:refresh","cart:updated","cart:change","ajaxCart:afterCartLoad"].forEach(function(ev){document.dispatchEvent(new CustomEvent(ev,{bubbles:true}));});
    document.dispatchEvent(new CustomEvent("boko:cart:added"));
  }
  function refreshCart(){fetch("/cart.js",{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(c){cartNotify(c.item_count||0);}).catch(function(){cartNotify(0);});}
  function getSections(){var cd=document.querySelector("cart-drawer");return(cd&&cd.getSectionsToRender)?cd.getSectionsToRender().map(function(s){return s.id;}):null;}
  function updateDrawer(){
    var cd=document.querySelector("cart-drawer");
    var sec=getSections();
    if(cd&&typeof cd.renderContents==="function"&&sec&&sec.length){
      fetch(location.pathname+"?sections="+sec.join(","),{headers:{Accept:"application/json"}})
        .then(function(r){return r.json();})
        .then(function(json){try{cd.renderContents({sections:json});}catch(e){refreshCart();}})
        .catch(function(){refreshCart();});
    } else {refreshCart();}
  }
  function variantFor(p,sel){for(var i=0;i<p.variants.length;i++){var v=p.variants[i],ok=true;for(var k=0;k<sel.length;k++){if(sel[k]!=null&&v.options[k]!==sel[k]){ok=false;break;}}if(ok)return v;}return null;}
  function firstAvail(p){for(var i=0;i<p.variants.length;i++){if(p.variants[i].available)return p.variants[i];}return p.variants[0];}
  function valAvail(p,oi,val,sel){for(var i=0;i<p.variants.length;i++){var v=p.variants[i];if(!v.available)continue;if(v.options[oi]!==val)continue;var ok=true;for(var k=0;k<sel.length;k++){if(k!==oi&&sel[k]!=null&&v.options[k]!==sel[k]){ok=false;break;}}if(ok)return true;}return false;}
  function cssColorValid(val){var s=(new Option).style;s.color=val.toLowerCase().replace(/\\s+/g,"");return!!s.color;}
  function normalizeProxy(items){
    return items.map(function(p){
      return {handle:p.handle,title:p.title,vendor:p.vendor||"",img:p.img||"",img2:"",
        price:p.price,compareAtPrice:null,variantId:p.variantId,
        productType:p.category||"",tags:p.tags||[],
        options:p.options||[],variants:p.variants||[]};
    });
  }
  function normalizeColl(products){
    return products.map(function(p){
      var imgs=p.images||[];
      var first=imgs[0]&&imgs[0].src?imgs[0].src:"";
      var second=imgs[1]&&imgs[1].src?imgs[1].src:"";
      var opts=(p.options||[]).filter(function(o){return!(o.name==="Title"&&o.position===1);}).map(function(o){return{name:o.name,values:o.values||[]};});
      var variants=(p.variants||[]).map(function(v){
        var vals=opts.map(function(_,i){return v["option"+(i+1)]||null;});
        var cap=v.compare_at_price?parseFloat(v.compare_at_price):null;
        var vim=v.featured_image&&v.featured_image.src?v.featured_image.src:"";
        return{id:v.id,title:v.title,price:parseFloat(v.price)||0,compareAtPrice:cap,available:!!v.available,options:vals,img:vim};
      });
      var defV=variants.find(function(v){return v.available;})||variants[0];
      return{handle:p.handle,title:p.title,vendor:p.vendor||"",img:first,img2:second,
        price:defV?defV.price:0,compareAtPrice:defV?defV.compareAtPrice:null,
        variantId:defV?defV.id:null,productType:p.product_type||"",tags:p.tags||[],
        options:opts,variants:variants};
    }).filter(function(p){return p.variantId;});
  }
  function card(p,atcText,showAtc){
    var c=document.createElement("div");c.className="sfy-card";
    var imgwrap=document.createElement("div");imgwrap.className="sfy-imgwrap";
    if(p.img){var i1=document.createElement("img");i1.className="sfy-img sfy-img1";i1.loading="lazy";i1.src=p.img;i1.alt=p.title||"";imgwrap.appendChild(i1);}
    if(p.img2){var i2=document.createElement("img");i2.className="sfy-img sfy-img2";i2.loading="lazy";i2.src=p.img2;i2.alt=p.title||"";imgwrap.appendChild(i2);}
    if(p.handle){var al=document.createElement("a");al.className="sfy-imglink";al.href="/products/"+p.handle;al.setAttribute("tabindex","-1");imgwrap.appendChild(al);}
    var atcBtn=document.createElement("button");atcBtn.className="sfy-atc";atcBtn.type="button";atcBtn.textContent=atcText||"Add to cart";
    if(showAtc!==false)imgwrap.appendChild(atcBtn);
    c.appendChild(imgwrap);
    var body=document.createElement("div");body.className="sfy-body";
    var tl;
    if(p.handle){tl=document.createElement("a");tl.className="sfy-title";tl.href="/products/"+p.handle;tl.textContent=p.title||"";}
    else{tl=document.createElement("span");tl.className="sfy-title";tl.textContent=p.title||"";}
    body.appendChild(tl);
    var prices=document.createElement("div");prices.className="sfy-prices";
    var priceEl=document.createElement("span");priceEl.className="sfy-price";priceEl.textContent=money(p.price);prices.appendChild(priceEl);
    var wasEl=document.createElement("span");wasEl.className="sfy-was";if(p.compareAtPrice&&p.compareAtPrice>p.price){wasEl.textContent=money(p.compareAtPrice);}prices.appendChild(wasEl);
    body.appendChild(prices);
    var optsEl=document.createElement("div");optsEl.className="sfy-opts";body.appendChild(optsEl);
    c.appendChild(body);
    var vid=p.variantId;
    var hasV=p.options&&p.options.length&&p.variants&&p.variants.length>1;
    if(hasV){
      var sel=p.options.map(function(){return null;});
      var dv=firstAvail(p);if(dv){sel=dv.options.slice();vid=dv.id;priceEl.textContent=money(dv.price);if(dv.compareAtPrice&&dv.compareAtPrice>dv.price){wasEl.textContent=money(dv.compareAtPrice);}else{wasEl.textContent="";}}
      var draw=function(){
        optsEl.innerHTML="";
        p.options.forEach(function(opt,oi){
          var isColor=/^colou?r$/i.test(opt.name);
          var row=document.createElement("div");row.className="sfy-opt";
          var lab=document.createElement("span");lab.className="sfy-optlabel";lab.textContent=opt.name;row.appendChild(lab);
          opt.values.forEach(function(val){
            var b=document.createElement("button");b.type="button";
            var on=sel[oi]===val,av=valAvail(p,oi,val,sel);
            if(isColor){
              b.className="sfy-sw sfy-sw--color"+(on?" is-sel":"")+(av?"":" is-oos");
              b.title=val;
              var varImg=null;
              for(var vi=0;vi<p.variants.length;vi++){if(p.variants[vi].options[oi]===val&&p.variants[vi].img){varImg=p.variants[vi].img;break;}}
              if(varImg){b.style.backgroundImage="url('"+varImg+"')";}
              else if(cssColorValid(val)){b.style.setProperty("--sw-bg",val);}
              else{b.style.setProperty("--sw-bg","#ccc");}
            } else {
              b.className="sfy-sw"+(on?" is-sel":"")+(av?"":" is-oos");b.textContent=val;
            }
            b.addEventListener("click",function(){
              if(!av&&!on)return;sel[oi]=val;
              var v=variantFor(p,sel);
              if(v){vid=v.id;priceEl.textContent=money(v.price);atcBtn.disabled=!v.available;atcBtn.textContent=v.available?(atcText||"Add to cart"):"Sold out";if(v.compareAtPrice&&v.compareAtPrice>v.price){wasEl.textContent=money(v.compareAtPrice);}else{wasEl.textContent="";}}
              draw();
            });
            row.appendChild(b);
          });
          optsEl.appendChild(row);
        });
        var cur=variantFor(p,sel);if(cur){atcBtn.disabled=!cur.available;atcBtn.textContent=cur.available?(atcText||"Add to cart"):"Sold out";}
      };
      draw();
    }
    atcBtn.addEventListener("click",function(){
      if(this.disabled)return;
      var self=this;self.disabled=true;
      var body={items:[{id:Number(vnum(vid)),quantity:1,properties:{"_boko_source":"selected-for-you-page"}}]};
      var sec=getSections();if(sec){body.sections=sec;body.sections_url=location.pathname;}
      fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
        .then(function(r){if(!r.ok)return r.json().then(function(e){throw e;});return r.json();})
        .then(function(json){
          self.textContent="Added \u2713";self.classList.add("is-added");
          setTimeout(function(){self.textContent=atcText||"Add to cart";self.classList.remove("is-added");self.disabled=false;},1600);
          var cd=document.querySelector("cart-drawer");
          if(cd&&typeof cd.renderContents==="function"&&json&&json.sections&&json.sections["cart-drawer"]){try{cd.renderContents(json);}catch(e){}}
          updateDrawer();
        })
        .catch(function(){self.textContent="Unavailable";setTimeout(function(){self.textContent=atcText||"Add to cart";self.disabled=false;},1600);});
    });
    return c;
  }
  function init(root){
    if(root.dataset.sfyInit)return;root.dataset.sfyInit="1";
    var proxy=root.getAttribute("data-proxy")||"/apps/reco/recommend";
    var configUrl=root.getAttribute("data-config")||"/apps/reco/config";
    var count=parseInt(root.getAttribute("data-count")||"12",10);
    var cols=parseInt(root.getAttribute("data-cols")||"4",10);
    var showAtc=root.getAttribute("data-show-atc")!=="false";
    var atcText=root.getAttribute("data-atc-text")||"Add to cart";
    var rawHandles=(root.getAttribute("data-tab-handles")||"").split("||").map(function(s){return s.trim();}).filter(Boolean);
    var rawTitles=(root.getAttribute("data-tab-titles")||"").split("||").map(function(s){return s.trim();}).filter(Boolean);
    var showBar=root.getAttribute("data-show-bar")!=="false";
    var browseLabel=root.getAttribute("data-browse-label")||"For You";
    var exclude=root.getAttribute("data-exclude")||"";
    var bar=root.querySelector("[data-sfy-bar]");
    var grid=root.querySelector("[data-sfy-grid]");
    grid.style.setProperty("--sfy-cols",cols);
    var activeTab=null;
    fetch(configUrl,{headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(cfg){applyConfig(root,cfg);}).catch(function(){});
    function setLoading(){grid.innerHTML="<div class='sfy-loading'>Loading\u2026</div>";}
    function showEmpty(){grid.innerHTML="<div class='sfy-loading'>No products found.</div>";}
    function renderProducts(products){
      grid.innerHTML="";
      if(!products.length){showEmpty();return;}
      products.slice(0,count).forEach(function(p){
        if(!p.variantId||isGift(p))return;
        grid.appendChild(card(p,atcText,showAtc));
      });
      if(!grid.children.length)showEmpty();
    }
    function activateTab(btn,loader){
      if(activeTab)activeTab.classList.remove("is-on");
      btn.classList.add("is-on");activeTab=btn;
      setLoading();
      loader().then(renderProducts).catch(function(){grid.innerHTML="<div class='sfy-loading'>Couldn't load products.</div>";});
    }
    function buildBar(){
      bar.innerHTML="";
      var fyBtn=document.createElement("button");fyBtn.type="button";fyBtn.className="sfy-tab";fyBtn.textContent=browseLabel;
      fyBtn.addEventListener("click",function(){activateTab(fyBtn,loadForYou);});
      bar.appendChild(fyBtn);
      rawHandles.forEach(function(h,i){
        var label=rawTitles[i]&&rawTitles[i]!==h?rawTitles[i]:h.replace(/-/g," ").replace(/\\b\\w/g,function(c){return c.toUpperCase();});
        var btn=document.createElement("button");btn.type="button";btn.className="sfy-tab";btn.textContent=label;
        btn.addEventListener("click",function(){activateTab(btn,function(){return loadCollection(h);});});
        bar.appendChild(btn);
      });
      activateTab(fyBtn,loadForYou);
    }
    function loadForYou(){
      var url=proxy+"?type=recommended&limit="+(count+20)+(exclude?"&exclude="+encodeURIComponent(exclude):"");
      return fetch(url,{headers:{Accept:"application/json"}})
        .then(function(r){return r.json();})
        .then(function(d){return normalizeProxy(d.items||[]);})
        .catch(function(){return[];});
    }
    function loadCollection(handle){
      return fetch("/collections/"+handle+"/products.json?limit=250",{headers:{Accept:"application/json"}})
        .then(function(r){return r.json();})
        .then(function(d){return normalizeColl(d.products||[]);})
        .catch(function(){return[];});
    }
    if(showBar){buildBar();}
    else{setLoading();loadForYou().then(renderProducts).catch(function(){grid.innerHTML="<div class='sfy-loading'>Couldn't load products.</div>";});}
  }
  document.querySelectorAll("[id^='boko-sfy-']").forEach(init);
})();
</script>

{% schema %}
{
  "name": "Selected For You",
  "settings": [
    { "type": "header", "content": "Content" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Selected For You" },
    { "type": "checkbox", "id": "show_browse_bar", "label": "Show Browse bar", "default": true },
    { "type": "text", "id": "browse_label", "label": "\\"For You\\" tab label", "default": "For You" },
    { "type": "collection_list", "id": "collections", "label": "Collection tabs", "limit": 8 },
    { "type": "text", "id": "collection_handles", "label": "Extra collection handles (comma-separated, fallback)", "info": "Used if the collection picker above is empty, or to add more. Example: new-arrivals,sale" },
    { "type": "text", "id": "exclude_collections", "label": "Exclude collections from \\"For You\\" (comma-separated handles)" },
    { "type": "range", "id": "count", "label": "Products to show", "min": 8, "max": 40, "step": 4, "default": 12 },
    { "type": "range", "id": "columns", "label": "Desktop columns", "min": 2, "max": 5, "step": 1, "default": 4 },
    {
      "type": "select",
      "id": "image_shape",
      "label": "Image shape",
      "options": [
        { "value": "portrait_23",  "label": "Portrait 2:3" },
        { "value": "portrait_45",  "label": "Portrait 4:5" },
        { "value": "square",       "label": "Square 1:1" },
        { "value": "landscape_32", "label": "Landscape 3:2" },
        { "value": "landscape_54", "label": "Landscape 5:4" }
      ],
      "default": "portrait_45"
    },
    { "type": "checkbox", "id": "show_atc", "label": "Show Add to cart button", "default": true },
    { "type": "text", "id": "atc_text", "label": "Add to cart button text", "default": "Add to cart" }
  ],
  "presets": [ { "name": "Selected For You" } ]
}
{% endschema %}
`;

const SFY_PAGE_TEMPLATE = {
  sections: { main: { type: "boko-selected-for-you", settings: {} } },
  order: ["main"],
};

export { SFY_SECTION_LIQUID, SFY_PAGE_TEMPLATE };
