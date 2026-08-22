#!/data/data/com.termux/files/usr/bin/sh
# voiceboard Walk — continuous dictation: 60s segments, auto-upload, silent chunks
# discarded server-side. Tap once to start, tap again to stop (or auto-stops after 30 min).
TB=/data/data/com.termux/files/usr/bin
V=$HOME/.voiceboard
DIR=/storage/emulated/0/VoiceLoop
HUB=https://board.asikmydeen.com/ingest/voice
MAXMIN=30
mkdir -p "$DIR" "$V/queue" 2>/dev/null
TOKEN="$(cat "$V/token" 2>/dev/null)"
[ -n "$TOKEN" ] || { $TB/termux-toast "no voiceboard token"; exit 1; }

# tap 2: stop an active walk
if [ -f "$V/walk.state" ]; then
  rm -f "$V/walk.state"
  $TB/termux-microphone-record -q 2>/dev/null
  $TB/termux-toast "walk ended"
  exit 0
fi

# tap 1: start the walk loop in the background
printf '%s' "$(date +%s)" > "$V/walk.state"
nohup sh -c '
TB=/data/data/com.termux/files/usr/bin
V=$HOME/.voiceboard
DIR=/storage/emulated/0/VoiceLoop
HUB=https://board.asikmydeen.com/ingest/voice
TOKEN="$(cat "$V/token" 2>/dev/null)"
N=0
while [ -f "$V/walk.state" ]; do
  N=$((N+1))
  [ $N -gt 30 ] && break
  F="$DIR/walk-$(date +%Y%m%d-%H%M%S).opus"
  $TB/termux-microphone-record -e opus -r 16000 -b 24 -c 1 -f "$F" -l 60 >/dev/null 2>&1
  sleep 62
  [ -f "$F" ] || continue
  SZ=$(stat -c %s "$F" 2>/dev/null || echo 0)
  DEDUP="$(sha256sum "$F" | cut -c1-16)$SZ"
  if $TB/curl -s -m 90 -X POST "$HUB" \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@$F;type=audio/opus" -F "dedup_key=$DEDUP" -F "mode=walk" -F "source=phone" \
      | grep -q "\"id\""; then
    rm -f "$F"
  else
    mv "$F" "$V/queue/" 2>/dev/null
  fi
done
rm -f "$V/walk.state"
' >/dev/null 2>&1 &

$TB/termux-wake-lock 2>/dev/null
$TB/termux-toast -g top "walk mode ON — tap to stop (30 min max)"
