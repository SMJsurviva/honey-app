// Edge Function: fired by a database webhook on orders INSERT.
// Sends a Telegram message (primary — always works) and Web Push (secondary — nicer UX).
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//      TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//      HONEY_WEBHOOK_SECRET (guard),
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injected).

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:mecjackson@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sendTelegram(text: string): Promise<void> {
  const token  = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (_) { /* Telegram down — web push still fires */ }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("HONEY_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-honey-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const payload = await req.json();
  const order = payload.record;
  if (!order || payload.type !== "INSERT") {
    return new Response("ignored", { status: 200 });
  }
  if (order.verbal) return new Response("verbal — skipped", { status: 200 });

  const { data: product } = await sb
    .from("products")
    .select("display_label")
    .eq("id", order.product_id)
    .single();

  const title  = order.urgent ? "🔴 새 주문 (급함)" : "🍯 새 주문";
  const qty    = (order.quantity ?? 1) > 1 ? ` × ${order.quantity}개` : "";
  const name   = order.requester_name ?? "이름 없음";
  const label  = product?.display_label ?? "?";
  const body   = `${name} — ${label}${qty}`;

  // ── Telegram (primary — no client state required) ─────────────────────────
  const urgentTag = order.urgent ? "\n<b>⚠️ 급함</b>" : "";
  await sendTelegram(
    `${title}\n${body}${urgentTag}\n\n<a href="https://smjsurviva.github.io/honey-app/operator.html">주문 확인 →</a>`
  );

  // ── Web Push (secondary — better UX when subscription is live) ────────────
  const { data: subs } = await sb.from("operator_subscriptions").select("id, subscription");
  let sent = 0;
  for (const row of subs ?? []) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body }));
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sb.from("operator_subscriptions").delete().eq("id", row.id);
      }
    }
  }

  return new Response(`telegram sent, push sent ${sent}`, { status: 200 });
});
