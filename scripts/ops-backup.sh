#!/bin/sh
# Nightly Supabase backup for voiceboard + memories tables -> NAS.
# Install: webtop crontab -> 37 2 * * * /config/projects/voiceboard-ops/ops-backup.sh
DEST=/mnt/asik_home_8/apps/backups/supabase
KEEP=30
TRUENAS="ssh -o BatchMode=yes -o ConnectTimeout=15 truenas"
STAMP=$(date +%Y%m%d-%H%M)

$TRUENAS "sudo mkdir -p $DEST" 2>/dev/null

$TRUENAS "sudo docker exec supabase-db pg_dump -U postgres -d postgres \
  --table=public.voice_notes --table=public.board_items \
  --table=public.memories --table=public.sync_state \
  --table=public.automations" 2>/dev/null | gzip > /tmp/supabase-$STAMP.sql.gz

SIZE=$(wc -c < /tmp/supabase-$STAMP.sql.gz 2>/dev/null || echo 0)
if [ "$SIZE" -gt 1000 ]; then
  cat /tmp/supabase-$STAMP.sql.gz | $TRUENAS "sudo tee $DEST/supabase-$STAMP.sql.gz >/dev/null" 2>/dev/null \
    && echo "backup ok: $STAMP ($SIZE bytes)"
  rm -f /tmp/supabase-$STAMP.sql.gz
  # rotate: keep newest $KEEP
  $TRUENAS "sudo ls -t $DEST/supabase-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r sudo rm -f" 2>/dev/null
else
  echo "backup FAILED ($SIZE bytes) $STAMP"
  curl -s -m 15 -H "Title: voiceboard backup FAILED" -H "Priority: high" -H "Tags: warning" \
    -d "Supabase pg_dump produced ${SIZE} bytes — check supabase-db container" \
    https://ntfy.sh/asik-mcp >/dev/null 2>&1
fi
