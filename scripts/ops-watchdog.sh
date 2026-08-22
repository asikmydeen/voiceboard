#!/bin/sh
# voiceboard watchdog — health, stuck pipeline, ASR credit exhaustion.
# Install: webtop crontab -> */15 * * * * /config/projects/voiceboard-ops/ops-watchdog.sh
NTFY=https://ntfy.sh/asik-mcp
STATE=/tmp/vb-watchdog-state
TRUENAS="ssh -o BatchMode=yes -o ConnectTimeout=10 truenas"

send() { curl -s -m 15 -H "Title: $1" -H "Tags: $2" -H "Priority: $3" -d "$4" "$NTFY" >/dev/null 2>&1; }

sql() { $TRUENAS "sudo docker exec supabase-db psql -U postgres -d postgres -t -A -c \"$1\"" 2>/dev/null; }

# 1. service health
h=$(curl -s -m 15 https://board.asikmydeen.com/health 2>/dev/null)
echo "$h" | grep -q '"ok":true' || send "voiceboard DOWN" "rotating_light" "urgent" "health check failed: ${h:-no response}"

# 2. notes stuck unprocessed > 45 min
stuck=$(sql "select count(*) from public.voice_notes where status in ('uploaded','processing') and captured_at < now() - interval '45 minutes'")
[ "${stuck:-0}" -gt 0 ] 2>/dev/null && send "voiceboard: ${stuck} stuck clip(s)" "warning" "high" "Voice notes unprocessed for >45min — check the pipeline"

# 3. ASR/LLM credit exhaustion in last 24h (notify at most once per 20h)
now=$(date +%s)
last=$(cat "$STATE" 2>/dev/null || echo 0)
if [ $((now - last)) -gt 72000 ]; then
  credit=$(sql "select count(*) from public.voice_notes where (error ilike '%1113%' or error ilike '%insufficient balance%' or error ilike '%no credits%') and captured_at > now() - interval '1 day'")
  if [ "${credit:-0}" -gt 0 ] 2>/dev/null; then
    send "voiceboard: STT credit exhausted" "money_with_wings" "urgent" "${credit} clip(s) failed in 24h on billing (1113/insufficient balance). Recharge the Z.AI key (GLM_ASR_KEY) or STT stops working."
    echo "$now" > "$STATE"
  fi
fi
