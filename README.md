# XMQA Online — xmqa.online

The software, apps and MT5 tools store, as its own website (moved out of xmqa.pro/online on 2026-10-05).

- Static site + two Vercel functions: `api/online/verify` (6-digit email code) and `api/online/order` (order email).
- Arkbase lives at `/arkbase/`. Old `/online/...` and `/freebase/...` links redirect here.
- Payment links for Arkbase still go through xmqa.pro's PayPal flow (`?action=freebase-pay`).

## Go live
1. New Vercel project from this folder (or its own GitHub repo).
2. Add the variables from `.env.example`.
3. Domains: add `xmqa.online` (+ `www`) to this project, and remove the old "xmqa.online → xmqa.pro" redirect at the DNS/registrar.
4. Run locally: `npx serve .` (the order/verify functions need `vercel dev`).
