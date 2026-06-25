(function () {
  if (window.__bokoRecoInjected) return;
  window.__bokoRecoInjected = true;

  var m = window.location.pathname.match(/^\/products\/([^/?#]+)/);
  if (!m) return;
  var handle = m[1];

  var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';

  function fmt(dollars) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(dollars || 0);
    } catch (e) {
      return '$' + Number(dollars || 0).toFixed(2);
    }
  }

  function addToCart(variantId, btn) {
    btn.disabled = true;
    btn.textContent = 'Adding\u2026';
    var body = JSON.stringify({
      items: [{ id: Number(variantId), quantity: 1, properties: { '_boko_reco': 'pdp' } }]
    });
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body
    })
      .then(function (r) { return r.json(); })
      .then(function () {
        btn.textContent = 'Added!';
        btn.className = btn.className + ' bk-added';
        var drawer = document.querySelector('cart-drawer');
        if (drawer) {
          fetch('/?sections=cart-drawer')
            .then(function (r) { return r.json(); })
            .then(function (sections) {
              if (sections && sections['cart-drawer']) {
                var tmp = document.createElement('div');
                tmp.innerHTML = sections['cart-drawer'];
                var fresh = tmp.querySelector('cart-drawer');
                if (fresh) { drawer.innerHTML = fresh.innerHTML; }
              }
              document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
            })
            .catch(function () {});
        }
        setTimeout(function () {
          btn.textContent = 'Add to Cart';
          btn.disabled = false;
          btn.className = btn.className.replace(/\s*bk-added/g, '');
        }, 2500);
      })
      .catch(function () {
        btn.textContent = 'Add to Cart';
        btn.disabled = false;
      });
  }

  function render(items) {
    var styles = '<style>' +
      '.bk-reco{max-width:1200px;margin:40px auto;padding:0 16px;' +
        'font-family:"Poppins",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
        'color:#0A0A0A;box-sizing:border-box}' +
      '.bk-reco *{box-sizing:border-box}' +
      '.bk-reco__head{text-align:center;margin-bottom:20px}' +
      '.bk-reco__pill{display:inline-block;background:#BFFC00;color:#0A0A0A;padding:5px 13px;' +
        'border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;margin-bottom:8px}' +
      '.bk-reco__title{margin:0;font-size:22px;font-weight:900;letter-spacing:-.3px;line-height:1.2}' +
      '.bk-reco__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}' +
      '.bk-reco__card{border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;background:#fff;' +
        'display:flex;flex-direction:column;transition:box-shadow .12s,transform .12s}' +
      '.bk-reco__card:hover{box-shadow:0 2px 20px rgba(0,0,0,.07);transform:translateY(-2px)}' +
      '.bk-reco__img-link{display:block;aspect-ratio:1/1;background:#F8F9FC;overflow:hidden}' +
      '.bk-reco__img-link img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.bk-reco__body{padding:12px 13px 14px;display:flex;flex-direction:column;gap:5px;flex:1}' +
      '.bk-reco__vendor{font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:.4px;font-weight:600}' +
      '.bk-reco__name{font-size:14px;font-weight:600;line-height:1.3;color:#0A0A0A;' +
        'text-decoration:none;display:block}' +
      '.bk-reco__name:hover{text-decoration:underline}' +
      '.bk-reco__price{font-size:16px;font-weight:800;letter-spacing:-.2px}' +
      '.bk-reco__atc{margin-top:auto;border:none;background:#BFFC00;color:#0A0A0A;font:inherit;' +
        'font-weight:800;text-transform:uppercase;letter-spacing:.5px;font-size:12px;padding:10px;' +
        'border-radius:10px;cursor:pointer;width:100%}' +
      '.bk-reco__atc:hover{filter:brightness(1.05)}' +
      '.bk-reco__atc.bk-added{background:#0A0A0A;color:#fff}' +
      '@media(max-width:720px){.bk-reco__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '</style>';

    var grid = '<div class="bk-reco__grid">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var imgTag = item.img
        ? '<img src="' + item.img + '" alt="' + (item.title || '').replace(/"/g, '&quot;') + '" loading="lazy">'
        : '';
      var vendorHtml = item.vendor
        ? '<div class="bk-reco__vendor">' + item.vendor + '</div>'
        : '';
      grid +=
        '<div class="bk-reco__card">' +
          '<a href="/products/' + (item.handle || '') + '" class="bk-reco__img-link">' + imgTag + '</a>' +
          '<div class="bk-reco__body">' +
            vendorHtml +
            '<a href="/products/' + (item.handle || '') + '" class="bk-reco__name">' + (item.title || '') + '</a>' +
            '<div class="bk-reco__price">' + fmt(item.price || 0) + '</div>' +
            '<button class="bk-reco__atc" data-vid="' + item.variantId + '">Add to Cart</button>' +
          '</div>' +
        '</div>';
    }
    grid += '</div>';

    var section = document.createElement('section');
    section.className = 'bk-reco';
    section.innerHTML =
      styles +
      '<div class="bk-reco__head">' +
        '<div class="bk-reco__pill">Boko AI</div>' +
        '<h2 class="bk-reco__title">You may also like</h2>' +
      '</div>' +
      grid;

    var btns = section.querySelectorAll('.bk-reco__atc');
    for (var j = 0; j < btns.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          addToCart(btn.getAttribute('data-vid'), btn);
        });
      })(btns[j]);
    }

    var selectors = [
      'product-info',
      '#MainContent .product',
      'main .product',
      '[id^="MainProduct-"]',
      '.product__info-wrapper'
    ];
    var anchor = null;
    for (var s = 0; s < selectors.length; s++) {
      anchor = document.querySelector(selectors[s]);
      if (anchor) break;
    }
    if (!anchor) anchor = document.querySelector('main');
    if (!anchor) anchor = document.body;

    if (anchor.parentNode && anchor !== document.body) {
      anchor.parentNode.insertBefore(section, anchor.nextSibling);
    } else {
      anchor.appendChild(section);
    }
  }

  fetch('/products/' + handle + '.js')
    .then(function (r) { return r.json(); })
    .then(function (product) {
      var firstVariant = (product.variants && product.variants[0]) || {};
      var priceInCents = firstVariant.price || 0;
      var tags = product.tags || [];
      if (typeof tags === 'string') {
        tags = tags.split(',').map(function (t) { return t.trim(); });
      }

      var params =
        'type=recommended' +
        '&limit=8' +
        '&anchor=' + encodeURIComponent(product.id) +
        '&atype=' + encodeURIComponent(product.product_type || '') +
        '&atitle=' + encodeURIComponent(product.title || '') +
        '&atags=' + encodeURIComponent(tags.join(',')) +
        '&aprice=' + encodeURIComponent(priceInCents / 100);

      fetch('/apps/reco/recommend?' + params, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var items = data && data.items;
          if (!items || !items.length) return;
          render(items);
        })
        .catch(function () {});
    })
    .catch(function () {});
})();
