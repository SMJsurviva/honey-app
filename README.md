# 🍯 Honey App — 꿀 주문

Monastery honey-room ordering PWA. Static frontend (GitHub Pages) + Supabase backend.
Design log and decision history: `honey_app.md` in project-juno memory.

## Views

- `index.html` — monk ordering view (anonymous, device-UUID identity, 3-tap order)
- `operator.html` — operator queue (Supabase Auth login, realtime + 30 s polling, stockout toggles, verbal-order entry)

## Setup

1. Create Supabase project, run `schema.sql` in the SQL editor
2. Create the operator user in Supabase Auth (email + password)
3. Fill `js/config.js` with the project URL and anon key
4. Deploy to GitHub Pages (static — no build step)
5. Notifications: `npx web-push generate-vapid-keys`, set secrets, deploy
   `supabase/functions/notify-operator`, add a database webhook on `orders` INSERT,
   put the public key in `js/config.js`
6. Keepalive: deploy `mack/honey_keepalive.sh` + plist to Mack (fills in URL/key)

## Hard rules

- The service role key never appears in this repo or any client code
- The anon key is public by design; all protection is Row Level Security
- ORDER button shows success only after Supabase confirms the insert
