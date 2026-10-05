// POST /api/online/verify  { email, website? }  →  emails a 6-digit code, returns a signed token.
"use strict";
const crypto = require("crypto");
const L = require("./_lib");

module.exports = async function handler(req, res) {
  const body = L.guard(req, res);
  if (!body) return;
  const email = L.oneLine(body.email, 200).toLowerCase();
  if (!L.EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "Enter a valid email address" });

  const ip = L.clientIp(req);
  if (L.limited(`v-ip:${ip}`, 6, 10 * 60 * 1000) || L.limited(`v-em:${email}`, 3, 10 * 60 * 1000))
    return res.status(429).json({ ok: false, error: "Too many codes requested. Try again in 10 minutes." });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const token = L.issueToken(email, code);
  if (body.website) return res.status(200).json({ ok: true, token }); // honeypot: pretend, send nothing

  try {
    await L.transport().sendMail({
      from: L.fromAddr(), to: email,
      subject: `${code} is your XMQA Online code`,
      text: `Your XMQA Online verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.\n\n— XMQA Online · ${L.mailUser()}`,
      html: `<div style="font:15px/1.6 Arial,sans-serif;color:#222"><p>Your XMQA Online verification code is</p>
        <p style="font:600 30px/1 'Courier New',monospace;letter-spacing:6px;margin:14px 0">${code}</p>
        <p>It expires in 10 minutes. If you didn't request it, ignore this email.</p>
        <p style="color:#888;font-size:13px">XMQA Online · ${L.esc(L.mailUser())}</p></div>`
    });
  } catch (e) {
    console.error("verify mail failed", e && e.message);
    return res.status(502).json({ ok: false, error: "Couldn't send the code. Try again shortly." });
  }
  return res.status(200).json({ ok: true, token });
};
