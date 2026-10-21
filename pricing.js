/* Wicroz — shared pricing. Loaded by the page (window.WXPricing) and required by the API,
   so the server always recomputes totals from the same rules the customer sees.

   Sale model: every price in catalog.json is the price you charge now. The crossed-out
   price is the previous list price, derived as sale.multiplier x the sale price. With
   multiplier 4 that is exactly 75% off, which is what every badge on the page says.
   Change the one number in catalog.json -> sale.multiplier (3 = 66.7% off) and the whole
   site, the cart and the API follow. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WXPricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MAX_LINES = 200;
  const round2 = n => Math.round(n * 100) / 100;
  const cache = new WeakMap();
  function index(cat) {
    let ix = cache.get(cat);
    if (!ix) {
      ix = { items: {}, bundles: {} };
      cat.items.forEach(i => { ix.items[i.id] = i; });
      cat.bundles.forEach(b => { ix.bundles[b.id] = b; });
      cache.set(cat, ix);
    }
    return ix;
  }
  const baseEd = it => it.editions[0];

  // ---------- sale ----------
  const DEFAULTS = { active: true, multiplier: 4, label: "75% OFF", badge: "SALE" };
  function saleOf(cat) { return Object.assign({}, DEFAULTS, (cat && cat.sale) || {}); }
  function wasOf(cat, price) {
    if (price === null || price === undefined) return null;
    const s = saleOf(cat);
    return s.active ? round2(price * s.multiplier) : null;
  }
  function offPct(cat, price, was) {
    if (was === null || was === undefined || !price) return 0;
    return Math.round((1 - price / was) * 100);
  }
  // The short sticker text, e.g. "75% OFF".
  function saleLabel(cat) { return saleOf(cat).label; }

  // ---------- bundles ----------
  // What the same products cost one by one at today's sale prices, and whether the pack
  // hides a quote-priced product (then the pack itself is quote-only).
  function bundleSum(cat, b) {
    const ix = index(cat), rule = cat.noraRule;
    const editionOf = id => {
      const it = ix.items[id];
      if (!it) return null;
      return (b.editions && it.editions.find(x => x.id === b.editions[id])) || baseEd(it);
    };
    const noraFree = b.items.includes(rule.target) && rule.requires.every(r =>
      b.items.includes(r) && editionOf(r) && editionOf(r).id === rule.edition);
    let sum = 0, quote = false;
    for (const id of b.items) {
      if (id === rule.target && noraFree) continue;
      const ed = editionOf(id);
      if (!ed) continue;
      if (typeof ed.price !== "number") { quote = true; continue; }
      sum += ed.price;
    }
    return { sum: round2(sum), quote, noraFree };
  }

  // Fixed pack price when the pack sets one, otherwise the bundle discount off the members.
  function bundlePrice(cat, b) {
    const { sum, quote } = bundleSum(cat, b);
    let price;
    if (typeof b.price === "number") price = b.price;
    else if (quote) price = null;
    else price = Math.round(sum * (1 - cat.bundleDiscount));
    return { price, was: wasOf(cat, price), sum, off: offPct(cat, price, wasOf(cat, price)), quote };
  }

  // MT5 keys: m:<index> (one item) | mc:<categoryIndex> (the whole category)
  function mt5Lookup(mt5, key, cat) {
    const p = String(key).split(":");
    if (!mt5 || p.length !== 2 || !/^\d+$/.test(p[1])) return null;
    const n = Number(p[1]);
    if (p[0] === "m") {
      const it = mt5.items[n];
      if (!it) return null;
      const price = it[3];
      return { name: it[0], price, was: cat ? wasOf(cat, price) : it[4], cat: it[2], type: it[1] };
    }
    if (p[0] === "mc") {
      if (!mt5.cats[n]) return null;
      const all = mt5.items.filter(it => it[2] === n);
      const was = all.reduce((s, it) => s + it[4], 0);
      const price = Math.round(was * (1 - mt5.categoryDiscount));
      return { name: `MT5 category: ${mt5.cats[n]} (${all.length} tools)`, price,
        was: cat ? wasOf(cat, price) : was, list: was, count: all.length };
    }
    return null;
  }

  /* keys:
       i:<itemId>:<editionId>   one product in a chosen edition
       b:<bundleId>             a job bundle
       m:<index>                one MT5 EA or indicator
       mc:<categoryIndex>       every MT5 tool in a category */
  function priceCart(cat, mt5, keys) {
    const ix = index(cat), rule = cat.noraRule;
    const out = { lines: [], total: 0, was: 0, hasQuote: false, errors: [] };
    const uniq = [...new Set((Array.isArray(keys) ? keys : []).map(String))].slice(0, MAX_LINES);
    const owned = new Set(), inBundle = new Map(), wholeCats = new Set();
    uniq.forEach(k => {
      const p = k.split(":");
      if (p[0] === "i" && ix.items[p[1]] && p[2] === rule.edition) owned.add(p[1]);
      if (p[0] === "b" && ix.bundles[p[1]]) {
        const b = ix.bundles[p[1]];
        b.items.forEach(x => { inBundle.set(x, b); if (b.editions && b.editions[x] === rule.edition) owned.add(x); });
      }
      if (p[0] === "mc") wholeCats.add(Number(p[1]));
    });
    const noraFree = rule.requires.every(r => owned.has(r));

    for (const k of uniq) {
      const p = k.split(":");
      if (p[0] === "i") {
        const it = ix.items[p[1]];
        const e = it && p.length === 3 && it.editions.find(x => x.id === p[2]);
        if (!e) { out.errors.push(k); continue; }
        let price = e.price, note = "";
        if (price === null) { out.hasQuote = true; note = "Quote"; }
        const b = inBundle.get(it.id);
        if (b && price !== null) {
          const be = (b.editions && it.editions.find(x => x.id === b.editions[it.id])) || baseEd(it);
          if (be && typeof be.price === "number" && e.id === be.id) { price = 0; note = `Already in ${b.name}`; }
        }
        if (it.id === rule.target && noraFree) { price = 0; note = "Free with A.A.M, DEVI-CRONS and Aura Suite in full ownership"; }
        if (it.sub && !note) note = `per ${it.sub}`;
        const was = price ? wasOf(cat, price) : null;
        out.lines.push({ key: k, name: it.name, edition: e.label, price, was, note });
        if (price) { out.total += price; out.was += was; }
      } else if (p[0] === "b") {
        const b = ix.bundles[p[1]];
        if (!b || p.length !== 2) { out.errors.push(k); continue; }
        const bp = bundlePrice(cat, b);
        if (bp.price === null) out.hasQuote = true;
        out.lines.push({ key: k, name: `Bundle: ${b.name}`, edition: b.items.map(id => ix.items[id].name.split(" — ")[0]).join(", "),
          price: bp.price, was: bp.was, note: bp.price === null ? "Quote" : `${bp.off}% off the previous price` });
        if (bp.price) { out.total += bp.price; out.was += bp.was; }
      } else if (p[0] === "m" || p[0] === "mc") {
        const m = mt5Lookup(mt5, k, cat);
        if (!m) { out.errors.push(k); continue; }
        const covered = p[0] === "m" && wholeCats.has(m.cat);
        const price = covered ? 0 : m.price;
        out.lines.push({ key: k, name: m.name, edition: p[0] === "mc" ? "Every tool in this category" : (m.type === "e" ? "MT5 Expert Advisor" : "MT5 Indicator"),
          price, was: price ? m.was : null, note: covered ? "Included in the category you're buying" : "" });
        if (price) { out.total += price; out.was += m.was; }
      } else out.errors.push(k);
    }
    out.total = round2(out.total); out.was = round2(out.was);
    return out;
  }

  const money = n => n === null || n === undefined ? "Quote" :
    "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

  return { bundlePrice, bundleSum, priceCart, mt5Lookup, money, wasOf, offPct, saleOf, saleLabel, MAX_LINES };
});
