#!/data/data/com.termux/files/usr/bin/sh
# voiceboard Rec — tap to start, tap again to stop+upload. Max 5 min.
# Install: Termux:Widget app + place in ~/.shortcuts/ (real Termux home)
TB=/data/data/com.termux/files/usr/bin
V=$HOME/.voiceboard
DIR=/storage/emulated/0/VoiceLoop
HUB=https://board.asikmydeen.com/ingest/voice
mkdir -p "$DIR" "$V/queue" 2>/dev/null
TOKEN="$(cat "$V/token" 2>/dev/null)"
[ -n "$TOKEN" ] || { $TB/termux-toast "no voiceboard token"; exit 1; }

upload() { # $1=file $2=mode
  F="$1"; M="${2:-rec}"
  DEDUP="$(sha256sum "$F" | cut -c1-16)$(stat -c %s "$F")"
  if $TB/curl -s -m 120 -X POST "$HUB" \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@$F;type=audio/opus" -F "dedup_key=$DEDUP" -F "mode=$M" -F "source=phone" \
      | grep -q '"id"'; then
    rm -f "$F"
    $TB/termux-toast "voiceboard: captured"
  else
    mv "$F" "$V/queue/"
    $TB/termux-toast "voiceboard: queued offline"
  fi
}

# already recording? -> stop and upload
if $TB/termux-microphone-record -i 2>/dev/null | grep -q '"isRecording":true'; then
  $TB/termux-microphone-record -q
  sleep 1
  F=$(ls -t "$DIR"/rec-*.opus 2>/dev/null | head -n1)
  [ -n "$F" ] || { $TB/termux-toast "no clip found"; exit 1; }
  $TB/termux-notification -t voiceboard --content "uploading $(basename "$F")…"
  upload "$F" rec
  exit 0
fi

# not recording -> start
F="$DIR/rec-$(date +%Y%m%d-%H%M%S).opus"
$TB/termux-microphone-record -e opus -r 16000 -b 32 -c 1 -f "$F" -l 300
$TB/termux-toast -g top "recording — tap again to stop"
