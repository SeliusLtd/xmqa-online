// Shared helpers for the /api/online/* functions. Underscore prefix = not a route on Vercel.
"use strict";
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const EMAIL_RE = /^[^\s@<>"'`]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const oneLine = (s, max) => String(s == null ? "" : s).replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64u = buf => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64u = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function secret() {
  const s = process.env.VERIFY_SECRET || "";
  if (s.length < 32) throw Object.assign(new Error("VERIFY_SECRET missing or shorter than 32 characters"), { status: 503 });
  return s;
}
const hmac = data => crypto.createHmac("sha256", secret()).update(data).digest();

/* Stateless verification token: payload is public (email, expiry, nonce); the signature
   binds it to the 6-digit code, so the code never leaves the server except by email. */
function issueToken(email, code, now = Date.now()) {
  const payload = b64u(JSON.stringify({ e: email.toLowerCase(), x: now + CODE_TTL_MS, n: b64u(crypto.randomBytes(12)) }));
  return `${payload}.${b64u(hmac(`${payload}|${code}`))}`;
}
function checkToken(token, email, code, now = Date.now()) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig || !/^\d{6}$/.test(String(code || ""))) return { ok: false, why: "bad-input" };
  let data;
  try { data = JSON.parse(unb64u(payload).toString("utf8")); } catch { return { ok: false, why: "bad-token" }; }
  if (!data || data.e !== String(email).toLowerCase()) return { ok: false, why: "email-mismatch" };
  if (typeof data.x !== "number" || now > data.x) return { ok: false, why: "expired" };
  const expect = hmac(`${payload}|${code}`), got = unb64u(sig);
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return { ok: false, why: "wrong-code", nonce: data.n };
  return { ok: true, nonce: data.n };
}

// Best-effort in-memory limits (per warm instance). Tokens also expire in 10 minutes.
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
  return arr.length > max;
}
const attempts = new Map(), usedNonces = new Map();
function noteAttempt(nonce) { const n = (attempts.get(nonce) || 0) + 1; attempts.set(nonce, n); return n; }
function tooManyAttempts(nonce) { return (attempts.get(nonce) || 0) >= MAX_CODE_ATTEMPTS; }
function markUsed(nonce) { usedNonces.set(nonce, Date.now()); for (const [k, t] of usedNonces) if (Date.now() - t > CODE_TTL_MS) usedNonces.delete(k); }
const isUsed = nonce => usedNonces.has(nonce);

function clientIp(req) {
  return String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

// Common request guard: POST only, same-origin, JSON, size cap, config present.
function guard(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ ok: false, error: "Method not allowed" }); return null; }
  const allowed = (process.env.ALLOWED_ORIGINS || "https://xmqa.pro,https://www.xmqa.pro,https://xmqa.online,https://www.xmqa.online")  // ship-allow: xmqa.online kept as an accepted origin
    .split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) { res.status(403).json({ ok: false, error: "Origin not allowed" }); return null; }
  if (!String(req.headers["content-type"] || "").includes("application/json")) { res.status(415).json({ ok: false, error: "JSON required" }); return null; }
  if (Number(req.headers["content-length"] || 0) > 32 * 1024) { res.status(413).json({ ok: false, error: "Request too large" }); return null; }
  if (!mail().user || !mail().pass) { res.status(503).json({ ok: false, error: "Email is not configured" }); return null; }
  try { secret(); } catch (e) { res.status(503).json({ ok: false, error: "Verification is not configured" }); return null; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== "object" || Array.isArray(body)) { res.status(400).json({ ok: false, error: "Invalid request" }); return null; }
  return body;
}

/* Mail settings. The store reads its own ONLINE_SMTP_* variables first so it never changes the mailbox
   the rest of xmqa.pro sends from (that site already uses SMTP_*). Settings are taken as one set:
   if ONLINE_SMTP_USER is present, every value comes from ONLINE_SMTP_*, otherwise from SMTP_*. */
function mail() {
  const env = process.env, pre = env.ONLINE_SMTP_USER ? "ONLINE_SMTP_" : "SMTP_";
  const port = Number(env[pre + "PORT"] || 465);
  return {
    user: env[pre + "USER"], pass: env[pre + "PASS"], host: env[pre + "HOST"] || "smtp.hostinger.com", port,
    secure: env[pre + "SECURE"] ? env[pre + "SECURE"] === "true" : port === 465
  };
}
let _t;
function transport() {
  if (_t) return _t;
  const m = mail();
  _t = nodemailer.createTransport({ host: m.host, port: m.port, secure: m.secure, auth: { user: m.user, pass: m.pass } });
  return _t;
}
const mailUser = () => mail().user;
const fromAddr = () => ({ name: "Wicroz", address: mailUser() });
const teamAddr = () => process.env.ORDER_TO || mailUser();

function makeRef() {
  return `XQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

module.exports = { EMAIL_RE, oneLine, esc, issueToken, checkToken, limited, noteAttempt, tooManyAttempts, markUsed, isUsed,
  clientIp, guard, transport, mailUser, fromAddr, teamAddr, makeRef, MAX_CODE_ATTEMPTS };
