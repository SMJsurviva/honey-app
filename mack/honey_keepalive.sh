#!/bin/bash
# Honey App keepalive — real DB query every 5 days so the Supabase free-tier
# project is never paused for 7-day inactivity. Telegram alert on failure.
# Deployed on Mack as com.klp.honey-keepalive.

SUPABASE_URL="__SUPABASE_URL__"
SUPABASE_ANON_KEY="__SUPABASE_ANON_KEY__"

# Telegram credentials — same pattern as other KLP alert scripts
source "$HOME/.klp/telegram.env" 2>/dev/null  # provides TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

alert() {
  [ -n "$TELEGRAM_BOT_TOKEN" ] && curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="🍯⚠️ Honey App keepalive FAILED: $1" > /dev/null
}

HTTP=$(curl -s -o /tmp/honey_keepalive_body -w "%{http_code}" --max-time 30 \
  "${SUPABASE_URL}/rest/v1/products?select=id&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

if [ "$HTTP" != "200" ]; then
  alert "HTTP ${HTTP} — $(head -c 200 /tmp/honey_keepalive_body)"
  exit 1
fi

echo "$(date -Iseconds) keepalive ok" >> "$HOME/.klp/honey_keepalive.log"
