#!/data/data/com.termux/files/usr/bin/sh
# voiceboard Append — tap 1: pick a card + start recording. tap 2: stop + merge into that card.
TB=/data/data/com.termux/files/usr/bin
V=$HOME/.voiceboard
DIR=/storage/emulated/0/VoiceLoop
HUB=https://board.asikmydeen.com
mkdir -p "$DIR" "$V/queue" 2>/dev/null
TOKEN="$(cat "$V/token" 2>/dev/null)"
[ -n "$TOKEN" ] || { $TB/termux-toast "no voiceboard token"; exit 1; }

upload_append() { # $1=file $2=item_id
  F="$1"; ID="$2"
  DEDUP="$(sha256sum "$F" | cut -c1-16)$(stat -c %s "$F")"
  if $TB/curl -s -m 120 -X POST "$HUB/ingest/voice" \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@$F;type=audio/opus" -F "dedup_key=$DEDUP" -F "mode=append" -F "source=phone" -F "append_to=$ID" \
      | grep -q '"id"'; then
    rm -f "$F"
    $TB/termux-toast "appended to card"
  else
    mv "$F" "$V/queue/"
    $TB/termux-toast "queued offline (append)"
  fi
  rm -f "$V/append.target"
}

# tap 2: already recording -> stop and append to the remembered card
if $TB/termux-microphone-record -i 2>/dev/null | grep -q '"isRecording":true'; then
  ID="$(cat "$V/append.target" 2>/dev/null)"
  if [ -z "$ID" ]; then
    $TB/termux-microphone-record -q
    $TB/termux-toast "no append target remembered"
    exit 1
  fi
  $TB/termux-microphone-record -q
  sleep 1
  F=$(ls -t "$DIR"/append-*.opus 2>/dev/null | head -n1)
  [ -n "$F" ] || { $TB/termux-toast "no clip found"; exit 1; }
  upload_append "$F" "$ID"
  exit 0
fi

# tap 1: pick a card, remember it, start recording
ITEMS=$($TB/curl -s -m 20 "$HUB/api/items?status=in.(inbox,review_pr,queued,building)&select=id,title&order=created_at.desc&limit=12" -H "Authorization: Bearer $TOKEN")
[ -n "$ITEMS" ] || { $TB/termux-toast "no cards / no network"; exit 1; }
IDS=$(printf '%s' "$ITEMS" | grep -oE '"id":"[0-9a-f-]{36}"' | cut -d'"' -f4)
TITLES=$(printf '%s' "$ITEMS" | grep -oE '"title":"[^"]*"' | cut -d'"' -f4)
[ -n "$IDS" ] || { $TB/termux-toast "could not parse cards"; exit 1; }

PICK=$($TB/termux-dialog spinner -v "$(printf '%s' "$TITLES" | tr '\n' ',' | sed 's/,$//;s/,/, /g')" 2>/dev/null \
       | grep -oE '"text" *: *"[^"]*"' | cut -d'"' -f4)
[ -n "$PICK" ] || exit 0
IDX=$(printf '%s' "$TITLES" | grep -nxF "$PICK" | cut -d: -f1)
ID=$(printf '%s' "$IDS" | sed -n "${IDX}p")
[ -n "$ID" ] || { $TB/termux-toast "pick failed"; exit 1; }

printf '%s' "$ID" > "$V/append.target"
F="$DIR/append-$(date +%Y%m%d-%H%M%S).opus"
$TB/termux-microphone-record -e opus -r 16000 -b 32 -c 1 -f "$F" -l 300
$TB/termux-toast -g top "recording append — tap again to stop"
