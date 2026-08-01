#!/usr/bin/env bash
# Qual shim está REALMENTE rodando na VPS — e de que época ele é.
#
# Só leitura: nada é alterado, nenhum serviço reinicia.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-diag-shim-versao.sh?ref=cursor/consolidar-publicavel-4759&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-diag")
#
# Existem várias cópias do shim no disco (os hotfixes gravavam em mais de um
# caminho). Grepar a cópia errada dá resposta errada — daí este script listar
# todas, dizer qual o systemd executa e qual o processo vivo carregou.
set -uo pipefail

SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

line() { printf '%s\n' "------------------------------------------------------------"; }
hash_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }

echo "== diagnostico do shim  ($(date -Is)) =="
line

echo "1) o que o systemd executa"
for unit in arbishield-serverfn-shim arbishield-prelive-events arbishield-prelive; do
  if systemctl list-unit-files "${unit}.service" >/dev/null 2>&1; then
    state="$(systemctl is-active "${unit}.service" 2>/dev/null || true)"
    exec_start="$(systemctl show -p ExecStart --value "${unit}.service" 2>/dev/null | sed -n 's/.*argv\[\]=\([^;]*\).*/\1/p')"
    [[ -z "$exec_start" ]] && exec_start="$(systemctl show -p ExecStart --value "${unit}.service" 2>/dev/null)"
    printf '   %-34s %-10s %s\n' "$unit" "${state:-?}" "${exec_start:-<sem ExecStart>}"
  fi
done
line

echo "2) processos vivos e o arquivo que cada um carregou"
found_proc=0
while read -r pid rest; do
  [[ -z "${pid:-}" ]] && continue
  found_proc=1
  script="$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -m1 '\.mjs$' || true)"
  printf '   pid %-8s %s\n' "$pid" "${script:-<nao identificado>}"
  if [[ -n "${script:-}" && -f "$script" ]]; then
    printf '     sha256 %s\n' "$(hash_of "$script")"
    printf '     mtime  %s   bytes %s\n' "$(date -r "$script" -Is 2>/dev/null)" "$(wc -c <"$script")"
  fi
done < <(pgrep -af 'arbishield-serverfn-shim\.mjs|arbishield-prelive-events\.mjs' 2>/dev/null || true)
[[ "$found_proc" == "1" ]] || echo "   (nenhum processo do shim encontrado)"
line

echo "3) todas as copias no disco"
mapfile -t copies < <(find "$SHIM_DIR" /usr/local/lib/arbishield -maxdepth 3 \
  -name 'arbishield-serverfn-shim.mjs' -type f 2>/dev/null | sort -u)
if [[ "${#copies[@]}" -eq 0 ]]; then
  echo "   (nenhuma cópia encontrada em $SHIM_DIR)"
else
  for f in "${copies[@]}"; do
    printf '   %s\n     sha256 %s\n     mtime  %s   bytes %s\n' \
      "$f" "$(hash_of "$f")" "$(date -r "$f" -Is 2>/dev/null)" "$(wc -c <"$f")"
  done
fi
line

echo "4) capacidades por copia (0 = ausente)"
printf '   %-42s' "marker"
for f in "${copies[@]}"; do printf ' %-12s' "$(basename "$(dirname "$f")")"; done
echo
for m in \
  'desafio-empate-anula-v1' \
  'empate_anula' \
  'settlementCreditParts' \
  'stake_lock_v1' \
  'protectionFlowContract' \
  'PROTECTION_RUNTIME_HEALTH_MARKER' \
  'settle-exchange-so-deducao-v9' \
  'settle-exchange-heal-incompleto-v10' \
  'block-cancel-delete-andamento-v1'
do
  printf '   %-42s' "$m"
  for f in "${copies[@]}"; do
    # grep -c imprime 0 e sai 1 quando não acha; sem "|| echo" para não duplicar
    n="$(grep -c "$m" "$f" 2>/dev/null)"
    printf ' %-12s' "${n:-0}"
  done
  echo
done
line

echo "5) health das portas"
for port in 3098 3101; do
  body="$(curl -fsS --max-time 8 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    printf '   :%s  <sem resposta>\n' "$port"
    continue
  fi
  printf '   :%s  %s\n' "$port" "$(printf '%s' "$body" | head -c 600)"
done
line

echo "6) lib do contrato de protecao (o shim carrega em runtime)"
for p in "$SHIM_DIR/lib/protection-flow-contract.mjs" \
         "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  if [[ -f "$p" ]]; then
    printf '   %s\n     sha256 %s   mtime %s\n' "$p" "$(hash_of "$p")" "$(date -r "$p" -Is 2>/dev/null)"
  else
    printf '   %s  <ausente>\n' "$p"
  fi
done
line

echo "Cole esta saida na conversa: o sha256 identifica o commit exato de cada copia."
