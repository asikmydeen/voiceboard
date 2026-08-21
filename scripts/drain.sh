#!/data/data/com.termux/files/usr/bin/sh
# voiceboard drain — uploads queued clips (offline-safe). Run from cron every 2 min:
#   crontab -e  ->  */2 * * * * $HOME/.voiceboard/drain.sh >/dev/null 2>&1
TB=/data/data/com.termux/files/usr/bin
V=$HOME/.voiceboard
HUB=https://board.asikmydeen.com/ingest/voice
TOKEN="$(cat "$V/token" 2>/dev/null)"
[ -n "$TOKEN" ] || exit 0
[ -d "$V/queue" ] || exit 0
ls "$V"/queue/*.opus >/dev/null 2>&1 || exit 0
$TB/termux-wake-lock 2>/dev/null
for F in "$V"/queue/*.opus; do
  [ -e "$F" ] || break
  DEDUP="$(sha256sum "$F" | cut -c1-16)$(stat -c %s "$F")"
  M=rec; case "$(basename "$F")" in ramble-*) M=ramble;; esac
  if $TB/curl -s -m 180 -X POST "$HUB" \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@$F;type=audio/opus" -F "dedup_key=$DEDUP" -F "mode=$M" -F "source=phone" \
      | grep -q '"id"'; then
    rm -f "$F"
  fi
done
$TB/termux-wake-unlock 2>/dev/null
