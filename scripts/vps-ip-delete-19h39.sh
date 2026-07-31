#!/usr/bin/env bash
# Extrai APENAS linhas nginx de desafio-delete/cancel perto de 30/07 19:39 UTC.
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-ip-delete-19h39.sh")
set -euo pipefail

echo "════════════════════════════════════════════════════════════════════════"
echo "IP · desafio-delete/cancel · 30/07/2026 18:30–20:30 UTC"
echo "════════════════════════════════════════════════════════════════════════"

shopt -s nullglob
FILES=(/var/log/nginx/*access* /var/log/nginx/access.log*)

echo
echo "==> Linhas completas (POST preferencial) na janela 18:30–20:30 UTC"
for f in "${FILES[@]}"; do
  [[ -e "$f" ]] || continue
  if [[ "$f" == *.gz ]]; then
    OUT=$(zgrep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
      | grep -E '30/Jul/2026:(18:3|18:4|18:5|19:|20:0|20:1|20:2)' || true)
  else
    OUT=$(grep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
      | grep -E '30/Jul/2026:(18:3|18:4|18:5|19:|20:0|20:1|20:2)' || true)
  fi
  if [[ -n "${OUT// }" ]]; then
    echo "—— $f ——"
    echo "$OUT"
    echo
  fi
done

echo
echo "==> Só POST (método) na mesma janela"
for f in "${FILES[@]}"; do
  [[ -e "$f" ]] || continue
  if [[ "$f" == *.gz ]]; then
    zgrep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
      | grep -E '30/Jul/2026:(18:3|18:4|18:5|19:|20:0|20:1|20:2)' \
      | grep -E '"POST |POST ' || true
  else
    grep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
      | grep -E '30/Jul/2026:(18:3|18:4|18:5|19:|20:0|20:1|20:2)' \
      | grep -E '"POST |POST ' || true
  fi
done | tee /tmp/desafio-delete-1939.txt || true

echo
echo "==> IPs distintos só nessa janela"
if [[ -s /tmp/desafio-delete-1939.txt ]]; then
  awk '{print $1}' /tmp/desafio-delete-1939.txt | sort | uniq -c | sort -rn
else
  echo "(nenhum POST na janela — tentando qualquer método)"
  for f in "${FILES[@]}"; do
    [[ -e "$f" ]] || continue
    if [[ "$f" == *.gz ]]; then
      zgrep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
        | grep -E '30/Jul/2026:(18:3|18:4|18:5|19:|20:0|20:1|20:2)' || true
    else
      grep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
        | grep -E '30/Jul/2026:(18:3|18:4|18:5|19:|20:0|20:1|20:2)' || true
    fi
  done | awk '{print $1}' | sort | uniq -c | sort -rn || echo "(zero hits na janela)"
fi

echo
echo "==> Log local desafio-admin-actions (se existir)"
for f in /var/log/arbishield/desafio-admin-actions.log /opt/arbishield/logs/desafio-admin-actions.log; do
  if [[ -f "$f" ]]; then
    echo "—— $f (tail 100 com delete/cancel/30–31) ——"
    grep -E 'delete|cancel|DELETE|CANCEL|2026-07-30|2026-07-31|3b7e5b99|jawadog' "$f" | tail -n 100 || true
    echo "—— últimas 30 linhas brutas ——"
    tail -n 30 "$f" || true
  fi
done

echo
echo "OK — cole TODA esta saída."
