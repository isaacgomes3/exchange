#!/usr/bin/env bash
# Verifica IP / horário de POST desafio-delete e desafio-cancel (nginx + journal).
#
# Foco: exclusões de 30/07/2026 ~19:39 UTC (deleted_at dos #50–#53)
# e qualquer hit em 30–31/07.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-verificar-ip-desafio-delete.sh")
set -euo pipefail

echo "════════════════════════════════════════════════════════════════════════"
echo "VERIFICAÇÃO · IP de desafio-delete / desafio-cancel"
echo "Alvo temporal: 2026-07-30 ~19:39 UTC (±2h) e 30–31/07"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "==> 1) Arquivos de access log nginx"
ls -la /var/log/nginx/*access* 2>/dev/null || echo "(nenhum em /var/log/nginx)"
ls -la /var/log/nginx/*.log 2>/dev/null | head -40 || true

echo
echo "==> 2) Hits desafio-delete / desafio-cancel (todos os access*)"
shopt -s nullglob
FOUND=0
for f in /var/log/nginx/*access* /var/log/nginx/access.log*; do
  [[ -e "$f" ]] || continue
  # zgrep cobre .gz
  if [[ "$f" == *.gz ]]; then
    CMD=(zgrep -E 'desafio-delete|desafio-cancel' "$f")
  else
    CMD=(grep -E 'desafio-delete|desafio-cancel' "$f")
  fi
  OUT="$("${CMD[@]}" 2>/dev/null || true)"
  if [[ -n "${OUT// }" ]]; then
    FOUND=1
    echo "—— arquivo: $f ——"
    # Prioriza 30/Jul e 31/Jul 2026
    echo "$OUT" | grep -E '30/Jul/2026|31/Jul/2026|2026-07-30|2026-07-31' || echo "$OUT" | tail -n 80
    echo
  fi
done
[[ "$FOUND" -eq 1 ]] || echo "(nenhum hit nos access logs atuais — pode ter rotacionado)"

echo
echo "==> 3) Janela 30/07 17:00–22:00 UTC (perto de 19:39Z)"
for f in /var/log/nginx/*access* /var/log/nginx/access.log*; do
  [[ -e "$f" ]] || continue
  if [[ "$f" == *.gz ]]; then
    zgrep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
      | grep -E '30/Jul/2026:(1[7-9]|2[0-1]):' || true
  else
    grep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null \
      | grep -E '30/Jul/2026:(1[7-9]|2[0-1]):' || true
  fi
done | head -n 100 || true

echo
echo "==> 4) journalctl shim (30–31/07) audit/delete/cancel"
if command -v journalctl >/dev/null; then
  journalctl -u arbishield-serverfn-shim.service \
    --since "2026-07-30 00:00:00" --until "2026-07-32 00:00:00" \
    --no-pager 2>/dev/null \
    | grep -E 'desafio-admin-audit|desafio-delete|desafio-cancel|deleted_by|CANCEL|DELETE|jawadog|3b7e5b99' \
    | tail -n 120 || echo "(sem linhas no journal)"
else
  echo "(sem journalctl)"
fi

echo
echo "==> 5) Log local desafio-admin-actions"
for f in /var/log/arbishield/desafio-admin-actions.log /opt/arbishield/logs/desafio-admin-actions.log; do
  if [[ -f "$f" ]]; then
    echo "—— $f ——"
    grep -E '2026-07-30|2026-07-31|DELETE|CANCEL|3b7e5b99|jawadog' "$f" | tail -n 80 || true
  fi
done

echo
echo "==> 6) Resumo IPs distintos (delete/cancel)"
{
  for f in /var/log/nginx/*access* /var/log/nginx/access.log*; do
    [[ -e "$f" ]] || continue
    if [[ "$f" == *.gz ]]; then
      zgrep -Eo '^[0-9a-fA-F\.:]+' "$f" 2>/dev/null | head -0
      zgrep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null || true
    else
      grep -E 'desafio-delete|desafio-cancel' "$f" 2>/dev/null || true
    fi
  done
} | awk '{print $1}' | sort | uniq -c | sort -rn | head -30 || true

echo
echo "OK — cole a saída (principalmente seções 2, 3 e 6)."
