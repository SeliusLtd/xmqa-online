/* XMQA Online — shared pricing. Loaded by the page (window.XQPricing) and required by the API,
   so the server always recomputes totals from the same rules the customer sees. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XQPricing = factory();
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
  const worth = e => (e.value || e.price || 0);

  // What the same products cost when bought one by one. Fixed-price packs compare
  // against appraised value; the others compare against the live edition prices.
  // Free items (Nora, when her three ownership products are in the pack) are never
  // counted in either total.
  function bundleWas(cat, b) {
    const ix = index(cat), rule = cat.noraRule;
    const appraised = typeof b.price === "number" && typeof b.value === "number";
    const editionOf = id => {
      const it = ix.items[id];
      if (!it) return null;
      return (b.editions && it.editions.find(x => x.id === b.editions[id])) || baseEd(it);
    };
    const noraFree = b.items.includes(rule.target) && rule.requires.every(r =>
      b.items.includes(r) && editionOf(r) && editionOf(r).id === rule.edition);
    let was = 0;
    for (const id of b.items) {
      if (id === rule.target && noraFree) continue;
      const ed = editionOf(id);
      if (!ed) continue;
      was += appraised ? (ed.value || ed.price || 0) : (typeof ed.price === "number" ? ed.price : 0);
    }
    return round2(was);
  }

  // Five-pack price: fixed if the pack sets one, otherwise the bundle discount off the five base editions.
  function bundlePrice(cat, b) {
    const was = bundleWas(cat, b);
    const basis = typeof b.price === "number" && typeof b.value === "number" ? "appraised" : "sum";
    if (typeof b.price === "number") return { price: b.price, was, basis };
    return { price: Math.round(was * (1 - cat.bundleDiscount)), was, basis };
  }

  // MT5 keys: m:<index> (one item) | mc:<categoryIndex> (the whole category)
  function mt5Lookup(mt5, key) {
    const p = String(key).split(":");
    if (!mt5 || p.length !== 2 || !/^\d+$/.test(p[1])) return null;
    const n = Number(p[1]);
    if (p[0] === "m") {
      const it = mt5.items[n];
      if (!it) return null;
      return { name: it[0], price: it[3], was: it[4], cat: it[2], type: it[1] };
    }
    if (p[0] === "mc") {
      if (!mt5.cats[n]) return null;
      const all = mt5.items.filter(it => it[2] === n);
      const was = all.reduce((s, it) => s + it[4], 0);
      return { name: `MT5 category: ${mt5.cats[n]} (${all.length} tools)`, price: Math.round(was * (1 - mt5.categoryDiscount)), was, count: all.length };
    }
    return null;
  }

  /* keys:
       i:<itemId>:<editionId>   one product in a chosen edition
       b:<bundleId>             five-pack
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
          if (e.id === be.id || price <= be.price) { price = 0; note = "Already in your five-pack"; }
          else { price = round2(price - be.price); note = "Upgrade from your five-pack edition"; }
        }
        if (it.id === rule.target && noraFree) { price = 0; note = "Free with AAM, DEVI-CRONS and Aura Suite in full ownership"; }
        if (it.sub && !note) note = `per ${it.sub}`;
        out.lines.push({ key: k, name: it.name, edition: e.label, price, was: price ? worth(e) : undefined, note });
        if (price) out.total += price;
        if (price) out.was += worth(e);
      } else if (p[0] === "b") {
        const b = ix.bundles[p[1]];
        if (!b || p.length !== 2) { out.errors.push(k); continue; }
        const bp = bundlePrice(cat, b);
        out.lines.push({ key: k, name: `Five-pack: ${b.name}`, edition: b.items.map(id => ix.items[id].name.split(" — ")[0]).join(", "), price: bp.price, was: bp.was, note: `save ${Math.round(100 - bp.price / bp.was * 100)}%` });
        out.total += bp.price; out.was += bp.was;
      } else if (p[0] === "m" || p[0] === "mc") {
        const m = mt5Lookup(mt5, k);
        if (!m) { out.errors.push(k); continue; }
        const covered = p[0] === "m" && wholeCats.has(m.cat);
        const price = covered ? 0 : m.price;
        out.lines.push({ key: k, name: m.name, edition: p[0] === "mc" ? "Every tool in this category" : (m.type === "e" ? "MT5 Expert Advisor" : "MT5 Indicator"),
          price, was: m.was, note: covered ? "Included in the category you're buying" : "" });
        if (price) { out.total += price; out.was += m.was; }
      } else out.errors.push(k);
    }
    out.total = round2(out.total); out.was = round2(out.was);
    return out;
  }

  const money = n => n === null || n === undefined ? "Quote" :
    "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

  return { bundlePrice, priceCart, mt5Lookup, money, MAX_LINES };
});
