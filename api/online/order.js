// POST /api/online/order
// { token, code, name, email, company?, message?, nda?, cart: [keys], website?, elapsedMs }
// Checks the emailed code, re-prices the cart on the server, emails the team and the customer.
"use strict";
const L = require("./_lib");
const P = require("../../pricing.js");
const CATALOG = require("../../catalog.json");
const MT5 = require("../../mt5.json");
const CODES = require("./_mt5-codes.json"); // private: original file names, for fulfilment only

function internal(key) {
  const p = String(key).split(":");
  if (p[0] === "m") return CODES[Number(p[1])] || "";
  if (p[0] === "mc") return MT5.items.map((it, i) => it[2] === Number(p[1]) ? CODES[i] : null).filter(Boolean).join("; ");
  return "";
}

function rowsHtml(q, team) {
  return q.lines.map(l => `<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #eee"><b>${L.esc(l.name)}</b><br><span style="color:#777;font-size:13px">${L.esc(l.edition)}${l.note ? " · " + L.esc(l.note) : ""}</span>${team && internal(l.key) ? `<br><span style="color:#a06a00;font-size:12px">File: ${L.esc(internal(l.key))}</span>` : ""}</td>
    <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${L.esc(P.money(l.price))}</td></tr>`).join("");
}
const rowsText = (q, team) => q.lines.map(l => `- ${l.name} [${l.edition}${l.note ? ", " + l.note : ""}] — ${P.money(l.price)}${team && internal(l.key) ? `\n    file: ${internal(l.key)}` : ""}`).join("\n");

module.exports = async function handler(req, res) {
  const body = L.guard(req, res);
  if (!body) return;

  const f = {
    name: L.oneLine(body.name, 100), email: L.oneLine(body.email, 200).toLowerCase(),
    company: L.oneLine(body.company, 120), message: String(body.message == null ? "" : body.message).trim().slice(0, 4000),
    nda: body.nda === true, code: L.oneLine(body.code, 6), token: L.oneLine(body.token, 600)
  };
  if (f.name.length < 2) return res.status(400).json({ ok: false, error: "Enter your name" });
  if (!L.EMAIL_RE.test(f.email)) return res.status(400).json({ ok: false, error: "Enter a valid email address" });
  const cart = Array.isArray(body.cart) ? body.cart.slice(0, P.MAX_LINES) : [];
  if (!cart.length && f.message.length < 10) return res.status(400).json({ ok: false, error: "Add a product or write a message" });

  const ip = L.clientIp(req);
  if (L.limited(`o-ip:${ip}`, 10, 10 * 60 * 1000)) return res.status(429).json({ ok: false, error: "Too many attempts. Try again in 10 minutes." });

  const chk = L.checkToken(f.token, f.email, f.code);
  if (chk.nonce && L.tooManyAttempts(chk.nonce)) return res.status(429).json({ ok: false, error: "Too many wrong codes. Request a new one." });
  if (!chk.ok) {
    if (chk.nonce) L.noteAttempt(chk.nonce);
    const msg = { expired: "That code has expired. Request a new one.", "wrong-code": "That code isn't right. Check the email and try again." }[chk.why] || "Verify your email first.";
    return res.status(400).json({ ok: false, error: msg, verify: true });
  }
  if (L.isUsed(chk.nonce)) return res.status(400).json({ ok: false, error: "That code was already used. Request a new one.", verify: true });

  const q = P.priceCart(CATALOG, MT5, cart);
  if (q.errors.length) return res.status(400).json({ ok: false, error: "Some items are no longer available. Refresh and try again." });

  const ref = L.makeRef();
  if (body.website || Number(body.elapsedMs) < 3000) { L.markUsed(chk.nonce); return res.status(200).json({ ok: true, ref, total: q.total }); }

  const kind = q.lines.length ? "Order" : "Enquiry";
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const totalLine = q.lines.length ? `${P.money(q.total)}${q.hasQuote ? " + quoted items" : ""}` : "—";
  const t = L.transport();

  try {
    await t.sendMail({
      from: L.fromAddr(), to: L.teamAddr(), replyTo: { name: f.name, address: f.email },
      subject: `[Online] ${kind} ${ref} — ${f.name} — ${totalLine}`,
      text: `${kind} ${ref}\nVerified email: ${f.email}\nName: ${f.name}\nCompany: ${f.company || "—"}\nNDA requested: ${f.nda ? "yes" : "no"}\nReceived: ${when}\nIP: ${ip}\n\n${rowsText(q, true) || "(no items)"}\n\nTotal: ${totalLine}\n\nMessage:\n${f.message || "—"}\n`,
      html: `<div style="font:14px/1.5 Arial,sans-serif;color:#222"><h2 style="margin:0 0 6px">${kind} ${L.esc(ref)}</h2>
        <p style="margin:0 0 14px;color:#555">Verified email <b>${L.esc(f.email)}</b> · ${L.esc(f.name)}${f.company ? " · " + L.esc(f.company) : ""} · NDA: ${f.nda ? "yes" : "no"} · ${L.esc(when)}</p>
        <table style="border-collapse:collapse;width:100%;max-width:640px">${rowsHtml(q, true)}
        <tr><td style="padding:10px 0"><b>Total</b></td><td style="padding:10px 0;text-align:right"><b>${L.esc(totalLine)}</b></td></tr></table>
        <div style="white-space:pre-wrap;margin-top:14px;padding:12px;border-left:3px solid #c9a45c;background:#faf7f1">${L.esc(f.message || "—")}</div></div>`
    });
  } catch (e) {
    console.error("team mail failed", e && e.message);
    return res.status(502).json({ ok: false, error: "Mail server unavailable. Try again shortly." });
  }
  L.markUsed(chk.nonce);

  try {
    await t.sendMail({
      from: L.fromAddr(), to: f.email, replyTo: L.teamAddr(),
      subject: `We've received your ${kind.toLowerCase()} (${ref})`,
      text: `Hi ${f.name},\n\nThanks — your ${kind.toLowerCase()} ${ref} is in.\n\n${rowsText(q)}\n\nTotal: ${totalLine}\n\n${q.lines.length ? "We'll email your secure payment link (PayPal or card) within 24 hours. Delivery follows payment." : "We'll reply from this address shortly."}\nReply to this email to add anything — keep ${ref} in the subject.\n\n— XMQA Online · ${L.mailUser()}`,
      html: `<div style="font:15px/1.6 Arial,sans-serif;color:#222"><p>Hi ${L.esc(f.name)},</p><p>Thanks — your ${kind.toLowerCase()} <b>${L.esc(ref)}</b> is in.</p>
        ${q.lines.length ? `<table style="border-collapse:collapse;width:100%;max-width:560px">${rowsHtml(q)}<tr><td style="padding:10px 0"><b>Total</b></td><td style="padding:10px 0;text-align:right"><b>${L.esc(totalLine)}</b></td></tr></table>
        <p>We'll email your secure payment link (PayPal or card) within 24 hours. Delivery follows payment.</p>` : `<p>We'll reply from this address shortly.</p>`}
        <p style="color:#777;font-size:13px">Reply to this email to add anything — keep ${L.esc(ref)} in the subject.<br>XMQA Online · ${L.esc(L.mailUser())}</p></div>`
    });
  } catch (e) { console.error("customer mail failed", e && e.message); }

  return res.status(200).json({ ok: true, ref, total: q.total, hasQuote: q.hasQuote });
};
