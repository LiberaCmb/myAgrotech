#!/bin/zsh
# Rende Agro raggiungibile da altri computer con un link pubblico (Cloudflare Tunnel).
# Doppio clic su questo file. Ctrl+C in questa finestra per smettere di condividere.
cd "$(dirname "$0")"
export PATH="$HOME/.agro/bin:$HOME/.nock/bin:$HOME/.homebrew/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG="condivisione.log"; : > "$LOG"

if ! curl -s -o /dev/null http://127.0.0.1:4747/api/stato; then
  echo "Agro non è acceso: lo avvio io."
  AGRO_NO_OPEN=1 open "Avvia Agro.command"; sleep 4
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installo cloudflared (Cloudflare, ufficiale)…"
  if command -v brew >/dev/null 2>&1; then
    brew install cloudflared
  else
    mkdir -p "$HOME/.agro/bin"
    ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=amd64
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" | tar -xz -C "$HOME/.agro/bin"
    chmod +x "$HOME/.agro/bin/cloudflared"
  fi
fi

echo "Apro il tunnel… il link compare qui sotto (e in $LOG)."
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4747 2>&1 | tee -a "$LOG" | while read -r line; do
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    URL="${match[1]}"
    echo "\n  ✓ Link pubblico: $URL\n"
    echo "LINK: $URL" >> "$LOG"
    echo -n "$URL" | pbcopy
    echo "  (copiato negli appunti — Ctrl+C per smettere di condividere)\n"
  fi
done
