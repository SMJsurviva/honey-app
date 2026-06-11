// Edge Function: fired by a database webhook on orders INSERT.
// Sends a Web Push notification to every stored operator subscription.
// Env (set via `supabase secrets set`): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

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

Deno.serve(async (req) => {
  const payload = await req.json();
  const order = payload.record;
  if (!order || payload.type !== "INSERT") {
    return new Response("ignored", { status: 200 });
  }
  // Operator's own verbal entries don't need a push
  if (order.verbal) return new Response("verbal — skipped", { status: 200 });

  const { data: product } = await sb
    .from("products")
    .select("display_label")
    .eq("id", order.product_id)
    .single();

  const title = order.urgent ? "🔴 새 주문 (급함)" : "🍯 새 주문";
  const body = `${order.requester_name ?? "이름 없음"} — ${product?.display_label ?? "?"}`;

  const { data: subs } = await sb.from("operator_subscriptions").select("id, subscription");
  let sent = 0;
  for (const row of subs ?? []) {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body }));
      sent++;
    } catch (err) {
      // 404/410 = subscription expired — remove it
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sb.from("operator_subscriptions").delete().eq("id", row.id);
      }
    }
  }
  return new Response(`sent ${sent}`, { status: 200 });
});
