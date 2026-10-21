(() => {
  "use strict";
  const SUPPORT = "support@selius.co.za";
  const API = { verify: "/api/online/verify", order: "/api/online/order" };
  const P = window.WXPricing;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = P.money;
  const STATUS = { available: ["Available", "b-available"], early: ["Early access", "b-early"], order: ["Built to order", "b-order"] };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let CAT = null, MT5 = null, LIB = [];
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem("xq_cart") || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, P.MAX_LINES) : []; } catch { return []; } },
    set(v) { try { localStorage.setItem("xq_cart", JSON.stringify(v)); } catch {} }
  };
  let cart = store.get();

  // ---------- helpers ----------
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2200); }
  const byId = id => CAT.items.find(i => i.id === id);
  const itemKeyInCart = id => cart.find(k => k.startsWith(`i:${id}:`));
  function saveCart() { store.set(cart); renderCartCount(); refreshButtons(); if ($("#cart").open) renderCart(); }
  function addKey(k, label) {
    if (cart.includes(k)) return;
    if (k.startsWith("i:")) { const id = k.split(":")[1]; cart = cart.filter(x => !x.startsWith(`i:${id}:`)); }
    if (cart.length >= P.MAX_LINES) { toast("Your cart is full. Check out first."); return; }
    cart.push(k); saveCart(); toast(`Added: ${label}`);
  }
  function removeKey(k) { cart = cart.filter(x => x !== k); saveCart(); }
  function renderCartCount() { $("#cartCount").textContent = cart.length; }
  function refreshButtons() {
    document.querySelectorAll("[data-add]").forEach(b => {
      const k = b.dataset.add, inCart = cart.includes(k);
      b.classList.toggle("btn-added", inCart); b.classList.toggle("btn-brass", !inCart);
      b.textContent = inCart ? "In cart ✓" : b.dataset.label;
      b.setAttribute("aria-pressed", String(inCart));
    });
  }

  // ---------- five-packs ----------
  function renderPacks() {
    $("#packGrid").innerHTML = CAT.bundles.map(b => {
      const bp = P.bundlePrice(CAT, b);
      const quoted = bp.price === null;
      const list = b.items.map(id => { const it = byId(id); if (!it) return "";
        const free = id === CAT.noraRule.target && CAT.noraRule.requires.every(r => b.items.includes(r));
        const ed = (b.editions && it.editions.find(e => e.id === b.editions[id])) || it.editions[0];
        return `<li><a href="#" data-detail="${id}">${esc(it.name.split(" — ")[0])}</a> <span class="mono" style="font-size:12px;color:var(--dim)">${free ? "free" : money(ed.price)}</span></li>`; }).join("");
      const save = (!quoted && bp.sum) ? Math.round((1 - bp.price / bp.sum) * 100) : 0;
      const label = quoted ? "Ask for a quote" : "Add bundle";
      return `<article class="pack${b.ownership ? " crown" : ""}${b.special ? " special" : ""}">
        ${quoted ? "" : `<span class="sticker">${esc(P.saleLabel(CAT))}</span>`}
        <span class="eyebrow">${b.special ? "Bundle · on special" : b.ownership ? "Complete set" : "Job bundle"}</span><h3 style="margin-top:6px">${esc(b.name)}</h3>
        <p class="muted" style="font-size:14px;margin-top:6px">${esc(b.blurb)}</p>
        <ol>${list}</ol>
        <div class="pricing"><b>${money(bp.price)}</b>${quoted ? "" : `<s class="was">${money(bp.was)}</s><span class="off">${bp.off}% OFF</span>`}
          <span class="saving">${quoted ? "Priced with your seat count" : `${money(bp.sum)} bought separately · save ${save}% again`}</span></div>
        <button class="btn btn-brass" type="button" data-add="b:${b.id}" data-label="${label}" data-name="${esc(b.name)}">${label}</button>
      </article>`;
    }).join("");
  }

  // ---------- catalogue ----------
  let filter = "all", query = "";
  function editionControl(it, idPrefix) {
    if (it.link) return `<div class="row"><span class="price">${money(it.editions[0].price)}${it.sub ? ` <span class="muted" style="font-weight:400">/ ${it.sub}</span>` : ""}</span></div>`;
    const cur = itemKeyInCart(it.id); const curEd = cur ? cur.split(":")[2] : it.editions[0].id;
    const e = it.editions.find(x => x.id === curEd) || it.editions[0];
    const sel = it.editions.length > 1
      ? `<select class="edition" data-ed="${it.id}" id="${idPrefix}-${it.id}" aria-label="Edition for ${esc(it.name)}">${it.editions.map(x => `<option value="${x.id}"${x.id === e.id ? " selected" : ""}>${esc(x.label)} — ${money(x.price)}</option>`).join("")}</select>`
      : `<span class="muted" style="font-size:13px">${esc(e.label)}</span>`;
    return `<div class="row" data-price="${it.id}">${priceHtml(it, e)}</div>${sel}`;
  }
  function priceHtml(it, e) {
    if (e.price === null) return `<span class="price">Quote</span>`;
    const was = P.wasOf(CAT, e.price);
    return `<span class="price">${money(e.price)}${it.sub ? ` <span class="muted" style="font-weight:400;font-size:12px">/ ${it.sub}</span>` : ""}</span>` +
      (was ? `<s class="was">${money(was)}</s><span class="off">${esc(P.saleLabel(CAT))}</span>` : "");
  }
  function buyButton(it) {
    if (it.link) return `<a class="btn btn-brass btn-sm" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.linkLabel)}</a>`;
    const cur = itemKeyInCart(it.id) || `i:${it.id}:${it.editions[0].id}`;
    const label = it.editions[0].price === null ? "Add for a quote" : "Add to cart";
    return `<button class="btn btn-brass btn-sm" type="button" data-add="${cur}" data-item="${it.id}" data-label="${label}" data-name="${esc(it.name)}">${label}</button>`;
  }
  function renderChips() {
    const counts = CAT.items.reduce((a, i) => (a[i.cat] = (a[i.cat] || 0) + 1, a), {});
    $("#chips").innerHTML = [["all", "All", CAT.items.length], ...Object.entries(CAT.categories).map(([k, v]) => [k, v, counts[k] || 0])]
      .map(([k, v, n]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === filter}">${esc(v)}<span class="n">${n}</span></button>`).join("");
  }
  function renderGrid() {
    const list = CAT.items.filter(i => (filter === "all" || i.cat === filter) &&
      (!query || `${i.name} ${i.blurb} ${i.features.join(" ")}`.toLowerCase().includes(query)));
    $("#grid").innerHTML = list.length ? list.map(it => {
      const st = STATUS[it.status] || STATUS.available;
      const priced = it.editions[0].price !== null;
      return `<article class="card${priced ? " on-sale" : ""}">
        ${priced ? `<span class="sticker">${esc(P.saleLabel(CAT))}</span>` : ""}
        <div class="meta"><span class="cat">${esc(CAT.categories[it.cat])}</span><span class="badge ${st[1]}">${st[0]}</span></div>
        <h3>${esc(it.name)}</h3>
        <p class="blurb">${esc(it.blurb)}</p>
        <div class="buy">${editionControl(it, "ed")}<div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-detail="${it.id}">Details</button>${buyButton(it)}</div></div>
      </article>`;
    }).join("") : `<div class="empty">Nothing matches that search. <a href="#contact">Ask us instead.</a></div>`;
    refreshButtons();
  }
  function onEditionChange(sel) {
    const it = byId(sel.dataset.ed), e = it.editions.find(x => x.id === sel.value);
    const scope = sel.closest(".buy");
    scope.querySelector(`[data-price="${it.id}"]`).innerHTML = priceHtml(it, e);
    const btn = scope.querySelector(`[data-item="${it.id}"]`);
    const newKey = `i:${it.id}:${e.id}`;
    const had = itemKeyInCart(it.id);
    btn.dataset.add = newKey;
    if (had && had !== newKey) { cart = cart.map(k => k === had ? newKey : k); saveCart(); toast(`Switched to ${e.label}`); }
    refreshButtons();
  }

  // ---------- detail dialog ----------
  const dlg = $("#dlg");
  function openDetail(id) {
    const it = byId(id); if (!it) return;
    $("#dlgCat").textContent = CAT.categories[it.cat] + " · " + (STATUS[it.status] || STATUS.available)[0];
    $("#dlgTitle").textContent = it.name;
    $("#dlgBlurb").textContent = it.blurb;
    $("#dlgFeatures").innerHTML = it.features.map(f => `<li>${esc(f)}</li>`).join("");
    $("#dlgBuy").innerHTML = editionControl(it, "dlged") + `<div class="actions">${buyButton(it)}</div>`;
    refreshButtons();
    dlg.showModal();
  }

  // ---------- MT5 library ----------
  const PAGE = 40; let libPage = 0;
  function buildLib() {
    LIB = MT5.items.map((it, i) => ({ k: `m:${i}`, n: it[0], t: it[1], c: it[2], p: it[3], v: it[4], d: it[5], l: (it[0] + " " + it[5]).toLowerCase().replace(/-/g, " ") }));
    const counts = MT5.cats.map((_, i) => LIB.filter(x => x.c === i).length);
    $("#libCol").insertAdjacentHTML("beforeend", MT5.cats.map((c, i) => counts[i] ? `<option value="${i}">${esc(c)} (${counts[i]})</option>` : "").join(""));
    const ea = LIB.filter(x => x.t === "e").length;
    $("#fEa").textContent = ea.toLocaleString("en-US"); $("#fInd").textContent = (LIB.length - ea).toLocaleString("en-US");
  }
  function renderLib() {
    const q = $("#libQ").value.trim().toLowerCase().replace(/-/g, " "), col = $("#libCol").value, type = $("#libType").value;
    const terms = q.split(/\s+/).filter(Boolean);
    const rows = LIB.filter(x => (col === "" || x.c === Number(col)) && (!type || x.t === type) && terms.every(t => x.l.includes(t)));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE)); libPage = Math.min(libPage, pages - 1);
    const slice = rows.slice(libPage * PAGE, libPage * PAGE + PAGE);
    $("#libCount").textContent = `${rows.length.toLocaleString("en-US")} of ${LIB.length.toLocaleString("en-US")} tools`;
    $("#libList").innerHTML = slice.length ? slice.map(x => `<div class="li"><div class="nm"><span>${esc(MT5.cats[x.c])} · ${x.t === "e" ? "Expert Advisor" : "Indicator"}</span><b>${esc(x.n)}</b><p>${esc(x.d)}</p></div>
      <div class="pr"><span class="price">${money(x.p)}</span><s class="was">${money(P.wasOf(CAT, x.p))}</s></div><button class="btn btn-brass btn-sm" type="button" data-add="${x.k}" data-label="Add" data-name="${esc(x.n)}">Add</button></div>`).join("")
      : `<div class="empty" style="border:0">No matches. Try a shorter search.</div>`;
    $("#libPager").innerHTML = pages > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-pg="-1"${libPage === 0 ? " disabled" : ""}>← Prev</button><span>Page ${libPage + 1} of ${pages}</span><button class="btn btn-ghost btn-sm" type="button" data-pg="1"${libPage >= pages - 1 ? " disabled" : ""}>Next →</button>` : "";
    if (col !== "") {
      const m = P.mt5Lookup(MT5, `mc:${col}`, CAT);
      $("#libColBuy").innerHTML = `<button class="btn btn-brass btn-sm" type="button" data-add="mc:${col}" data-label="Take all ${m.count} · ${money(m.price)}" data-name="${esc(MT5.cats[col])}">Take all ${m.count} · ${money(m.price)}</button> <s class="was">${money(m.was)}</s> <span class="off">${P.offPct(CAT, m.price, m.was)}% OFF</span>`;
    } else $("#libColBuy").innerHTML = `<span class="muted">Pick a category to take every tool in it at one price.</span>`;
    refreshButtons();
  }

  // ---------- Arkbase ----------
  function renderArkbase() {
    const fb = CAT.arkbase;
    $("#fbPerks").innerHTML = fb.perks.map(p => `<li>${esc(p)}</li>`).join("");
    $("#fbSite").href = fb.page;
    $("#fbPlans").innerHTML = fb.plans.map(p => `<article class="plan${p.interval === "year" ? " best" : ""}">
      <div class="meta" style="margin:0"><span class="eyebrow">${esc(p.name)}</span>${p.interval === "year" ? '<span class="save">best value</span>' : ""}</div>
      <div class="amt">${money(p.price)} <small>/ ${esc(p.interval)}</small></div>
      <p class="muted" style="font-size:14px;flex:1">${esc(p.desc)}</p>
      <a class="paypal" href="${esc(p.paypal)}" target="_blank" rel="noopener" aria-label="Pay for ${esc(p.name)} with PayPal"><span class="pw">Pay with</span> <span class="pp1">Pay</span><span class="pp2">Pal</span></a>
      ${p.checkout ? `<a class="card-alt" href="${esc(p.checkout)}" target="_blank" rel="noopener">Pay by card</a>` : ""}
      <p class="fine">Secure PayPal checkout on xmqa.pro. Pay with a PayPal balance or any debit or credit card. <a href="${esc(fb.page)}">Explore Arkbase first →</a></p>
    </article>`).join("");
  }

  // ---------- cart + checkout ----------
  const cartDlg = $("#cart");
  let token = "", startedAt = Date.now();
  function stage(n) {
    $("#stage1").hidden = n !== 1; $("#stage2").hidden = n !== 2; $("#stage3").hidden = n !== 3;
    document.querySelectorAll("#steps [data-s]").forEach(s => { if (Number(s.dataset.s) === n) s.setAttribute("aria-current", "step"); else s.removeAttribute("aria-current"); });
  }
  function status(kind, html) { const s = $("#cartStatus"); s.className = "status" + (kind ? " " + kind : ""); s.innerHTML = html || ""; }
  function renderCart() {
    const q = P.priceCart(CAT, MT5, cart);
    if (q.errors.length) { cart = cart.filter(k => !q.errors.includes(k)); store.set(cart); renderCartCount(); }
    const empty = !q.lines.length;
    $("#cartTitle").textContent = empty ? "Ask a question" : "Your cart";
    $("#lines").innerHTML = empty ? `<p class="muted">Your cart is empty. Send us a question below, or <a href="#catalogue" data-close>browse the catalogue</a>.</p>`
      : q.lines.map(l => `<div class="line"><span class="n">${esc(l.name)}</span><span class="p">${l.price === null ? "Quote" : money(l.price)}${l.was ? `<br><s class="was">${money(l.was)}</s>` : ""}</span>
        <span class="e">${esc(l.edition)}${l.note ? " · " + esc(l.note) : ""}</span><button class="rm" type="button" data-rm="${esc(l.key)}">Remove</button></div>`).join("");
    $("#totalRow").hidden = empty;
    $("#total").innerHTML = money(q.total) + "";
    $("#quoteNote").textContent = q.hasQuote ? "+ quoted items" : "";
    $("#noraNote").hidden = !q.lines.some(l => l.key.startsWith("i:nora:") && l.price === 0);
    $("#msgOpt").textContent = empty ? "(required)" : "(optional)";
    $("#sendCode").textContent = "Email me a verification code";
  }
  function openCart() { renderCart(); stage(1); status(""); if (!cartDlg.open) cartDlg.showModal(); }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) { const e = new Error(data.error || `Request failed (${r.status})`); e.data = data; throw e; }
    return data;
  }
  const details = () => ({ name: $("#fName").value.trim(), email: $("#fEmail").value.trim(), company: $("#fCompany").value.trim(),
    message: $("#fMsg").value.trim(), nda: $("#fNda").checked, website: $("#fWebsite").value });

  async function requestCode() {
    const d = details(), errs = [];
    if (d.name.length < 2) errs.push("your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) errs.push("a valid email");
    if (!cart.length && d.message.length < 10) errs.push("a message of at least 10 characters");
    if (errs.length) { status("err", "Please add " + errs.map(esc).join(", ") + "."); return; }
    const btn = $("#sendCode"); btn.disabled = true; btn.textContent = "Sending code…"; status("");
    try {
      const r = await post(API.verify, { email: d.email, website: d.website });
      token = r.token; $("#sentTo").textContent = d.email; $("#fCode").value = "";
      stage(2); status("info", `Check your inbox for a code from ${esc(SUPPORT)}. If it isn't there, check your spam folder.`);
      setTimeout(() => $("#fCode").focus(), 50);
    } catch (e) { status("err", `${esc(e.message)} You can also email <a href="mailto:${SUPPORT}">${SUPPORT}</a>.`); }
    finally { btn.disabled = false; btn.textContent = "Email me a verification code"; }
  }
  async function confirmOrder() {
    const code = $("#fCode").value.replace(/\D/g, "");
    if (code.length !== 6) { status("err", "Enter the 6-digit code from the email."); return; }
    const btn = $("#confirm"); btn.disabled = true; btn.textContent = "Confirming…"; status("");
    try {
      const d = details();
      const r = await post(API.order, { ...d, code, token, cart, elapsedMs: Date.now() - startedAt });
      const hadItems = cart.length > 0;
      cart = []; saveCart(); stage(3); status("");
      $("#doneMsg").innerHTML = hadItems
        ? `<b>Order confirmed.</b> Your reference is <b class="mono">${esc(r.ref)}</b>. We've emailed you a copy. Your secure payment link (PayPal or card) will follow within 24 hours.`
        : `<b>Message sent.</b> Your reference is <b class="mono">${esc(r.ref)}</b>. We've emailed you a copy and will reply from ${esc(SUPPORT)}.`;
      $("#cartTitle").textContent = hadItems ? "Thank you" : "Sent";
    } catch (e) { status("err", esc(e.message)); }
    finally { btn.disabled = false; btn.textContent = "Confirm order"; }
  }

  // ---------- events ----------
  document.addEventListener("click", e => {
    const t = e.target;
    const add = t.closest("[data-add]");
    if (add) { const k = add.dataset.add; if (cart.includes(k)) { removeKey(k); toast("Removed from cart"); } else addKey(k, add.dataset.name || "item"); return; }
    const det = t.closest("[data-detail]"); if (det) { e.preventDefault(); openDetail(det.dataset.detail); return; }
    const rm = t.closest("[data-rm]"); if (rm) { removeKey(rm.dataset.rm); return; }
    const chip = t.closest(".chip"); if (chip) { filter = chip.dataset.f; renderChips(); renderGrid(); return; }
    const pg = t.closest("[data-pg]"); if (pg) { libPage += Number(pg.dataset.pg); renderLib(); $("#library").scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); return; }
    const close = t.closest("[data-close]"); if (close) { const d = close.closest("dialog"); if (d) d.close(); return; }
    if (t === dlg || t === cartDlg) t.close();
  });
  document.addEventListener("change", e => { if (e.target.matches("select[data-ed]")) onEditionChange(e.target); });
  $("#q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); renderGrid(); });
  let libT; $("#libQ").addEventListener("input", () => { clearTimeout(libT); libT = setTimeout(() => { libPage = 0; renderLib(); }, 120); });
  $("#libCol").addEventListener("change", () => { libPage = 0; renderLib(); });
  $("#libType").addEventListener("change", () => { libPage = 0; renderLib(); });
  $("#openCart").addEventListener("click", openCart);
  $("#askBtn").addEventListener("click", openCart);
  $("#details").addEventListener("submit", e => { e.preventDefault(); requestCode(); });
  $("#stage2").addEventListener("submit", e => { e.preventDefault(); confirmOrder(); });
  $("#back").addEventListener("click", () => { stage(1); status(""); });
  $("#resend").addEventListener("click", () => { stage(1); requestCode(); });
  $("#fCode").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  window.addEventListener("storage", e => { if (e.key === "xq_cart") { cart = store.get(); renderCartCount(); refreshButtons(); } });

  // ---------- boot ----------
  document.querySelectorAll("#supportLink,#supportFoot").forEach(a => { a.href = "mailto:" + SUPPORT; a.textContent = SUPPORT; });
  renderCartCount();
  Promise.all([fetch("/catalog.json").then(r => r.json()), fetch("/mt5.json").then(r => r.json())])
    .then(([cat, mt5]) => {
      CAT = cat; MT5 = mt5;
      $("#fItems").textContent = CAT.items.length;
      renderPacks(); renderChips(); renderGrid(); buildLib(); renderLib(); renderArkbase(); refreshButtons();
      if (location.hash === "#cart") openCart();
    })
    .catch(() => { $("#grid").innerHTML = `<div class="empty">The catalogue didn't load. Refresh the page, or email <a href="mailto:${SUPPORT}">${SUPPORT}</a>.</div>`; });

  // ---------- cilia field ----------
  const cv = $("#cilia"), ctx = cv.getContext("2d");
  let W = 0, H = 0, pts = [], mx = -1e4, my = -1e4, raf = 0, vis = true;
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect(); W = r.width; H = r.height;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gap = W < 700 ? 34 : 28; pts = [];
    for (let y = gap / 2; y < H; y += gap) for (let x = gap / 2; x < W; x += gap) pts.push({ x, y, p: Math.random() * 6.28 });
  }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (const q of pts) {
      const dx = q.x - mx, dy = q.y - my, pull = Math.max(0, 1 - Math.hypot(dx, dy) / 180);
      const a = Math.sin(t * 0.0008 + q.x * 0.012 + q.y * 0.008 + q.p) * 0.55 + (pull ? Math.atan2(dy, dx) * pull * 0.6 : 0), len = 7 + pull * 9;
      ctx.strokeStyle = pull > 0.05 ? `rgba(255,0,255,${0.3 + pull * 0.6})` : "rgba(0,229,255,0.30)"; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + Math.sin(a) * len, q.y - Math.cos(a) * len); ctx.stroke();
    }
  }
  const loop = t => { draw(t); if (vis && !reduce) raf = requestAnimationFrame(loop); };
  size(); draw(0);
  if (!reduce) {
    raf = requestAnimationFrame(loop);
    addEventListener("pointermove", e => { const r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });
    new IntersectionObserver(([en]) => { vis = en.isIntersecting; cancelAnimationFrame(raf); if (vis) raf = requestAnimationFrame(loop); }).observe(cv);
  }
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { size(); draw(performance.now()); }, 150); });
})();
