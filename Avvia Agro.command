#!/bin/bash
# Avvia Agro: doppio clic su questo file.
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$HOME/.bun/bin:$HOME/.local/bin"
for d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$d" ] && PATH="$PATH:$d"; done
if command -v node >/dev/null 2>&1; then exec node server.js
elif command -v bun >/dev/null 2>&1; then exec bun server.js
elif command -v python3 >/dev/null 2>&1; then
  echo "Node non trovato: avvio in modalità ridotta (consulente base, dati salvati nel browser)."
  (sleep 1; open "http://localhost:4747") &
  exec python3 -m http.server 4747 --bind 127.0.0.1
else
  echo "Serve Node.js oppure Python 3 per avviare Agro."; read -r -p "Premi Invio per chiudere."
fi
