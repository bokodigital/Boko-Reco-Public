# Adds the promo banner to extensions/reco-widget/blocks/reco.liquid (idempotent).
import re, json, sys
f = "extensions/reco-widget/blocks/reco.liquid"
s = open(f).read()
if "boko-reco__promo" in s:
    print("already has banner; no change"); sys.exit(0)

css = ("\n#boko-reco-{{ block.id }} .boko-reco__promo{display:flex;align-items:center;"
       "justify-content:center;gap:8px;text-align:center;max-width:760px;margin:-14px auto 28px;"
       "padding:10px 20px;background:#faf6f0;border:1px solid var(--line);border-radius:99px;"
       "font-size:calc(var(--reco-body));letter-spacing:1.5px;text-transform:uppercase;color:var(--ink)}"
       "\n#boko-reco-{{ block.id }} .boko-reco__promo b{color:var(--badge);font-weight:600}")
anchor_css = "text-transform:uppercase;margin:0 0 30px}"
assert anchor_css in s, "title css anchor missing"
s = s.replace(anchor_css, anchor_css + css, 1)

h = '<h2 class="boko-reco__title">{{ block.settings.title }}</h2>'
mk = (h + "\n  {%- if block.settings.promo_enabled and block.settings.promo_text != blank -%}"
      "{%- assign boko_disc = '<b>' | append: block.settings.bundle_discount | append: '%</b>' -%}"
      "{%- assign boko_promo = block.settings.promo_text | replace: '{discount}', boko_disc "
      "| replace: '{min}', block.settings.promo_min -%}"
      '<div class="boko-reco__promo">{{ boko_promo }}</div>{%- endif -%}')
assert h in s, "h2 anchor missing"
s = s.replace(h, mk, 1)

d = '      "content": "Design"'
ins = ('      "content": "Promotion banner"\n    },\n'
       '    {\n      "type": "checkbox",\n      "id": "promo_enabled",\n'
       '      "label": "Show promotion banner",\n      "default": true\n    },\n'
       '    {\n      "type": "text",\n      "id": "promo_text",\n'
       '      "label": "Promotion text",\n'
       '      "default": "Mix & match any {min}+ styles & save {discount}",\n'
       '      "info": "Use {discount} for the discount % and {min} for the minimum items."\n    },\n'
       '    {\n      "type": "header",\n' + d)
assert d in s, "design header anchor missing"
s = s.replace(d, ins, 1)

m = re.search(r"\{% schema %\}(.*?)\{% endschema %\}", s, re.S)
json.loads(m.group(1))  # validate schema JSON
open(f, "w").write(s)
print("OK promo=%d promo_enabled=%d promo_text=%d" % (s.count("boko-reco__promo"), s.count("promo_enabled"), s.count("promo_text")))
