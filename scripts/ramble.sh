#!/data/data/com.termux/files/usr/bin/sh
# voiceboard Ramble — long-form capture, max 15 min. Same toggle as rec.sh.
TB=/data/data/com.termux/files/usr/bin
V=$HOME/.voiceboard
DIR=/storage/emulated/0/VoiceLoop
HUB=https://board.asikmydeen.com/ingest/voice
mkdir -p "$DIR" "$V/queue" 2>/dev/null
TOKEN="$(cat "$V/token" 2>/dev/null)"
[ -n "$TOKEN" ] || { $TB/termux-toast "no voiceboard token"; exit 1; }

upload() {
  F="$1"; M="${2:-ramble}"
  DEDUP="$(sha256sum "$F" | cut -c1-16)$(stat -c %s "$F")"
  if $TB/curl -s -m 180 -X POST "$HUB" \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@$F;type=audio/opus" -F "dedup_key=$DEDUP" -F "mode=$M" -F "source=phone" \
      | grep -q '"id"'; then
    rm -f "$F"
    $TB/termux-toast "voiceboard: ramble captured"
  else
    mv "$F" "$V/queue/"
    $TB/termux-toast "voiceboard: queued offline"
  fi
}

if $TB/termux-microphone-record -i 2>/dev/null | grep -q '"isRecording":true'; then
  $TB/termux-microphone-record -q
  sleep 1
  F=$(ls -t "$DIR"/ramble-*.opus 2>/dev/null | head -n1)
  [ -n "$F" ] || { $TB/termux-toast "no clip found"; exit 1; }
  $TB/termux-notification -t voiceboard --content "uploading ramble $(basename "$F")…"
  upload "$F" ramble
  exit 0
fi

F="$DIR/ramble-$(date +%Y%m%d-%H%M%S).opus"
$TB/termux-microphone-record -e opus -r 16000 -b 32 -c 1 -f "$F" -l 900
$TB/termux-toast -g top "rambling — tap again to stop"
