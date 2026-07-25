#!/usr/bin/env bash
# Hotfix: LAY odd do mercado em todos os campos (sem gravar back-equivalente).
# Ex.: lançar LAY @ 30 → proteção e monitor mostram LAY 30.
# Conversão L/(L−1) continua só no cálculo de fee (effective_back_odd).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-lay-odd-sem-converter.sh?ref=cursor/lay-odd-sem-converter-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/lay-odd-sem-converter-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$SCRIPTS_DIR" "$SHIM_DIR" "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

echo "==> vps-hotfix-lay-odd-sem-converter.sh ($(date -Is)) ref=$REF"

log "1/4 protection-flow-contract (odd LAY = mercado)"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q 'Persistência/UI: odd LAY do mercado' "$tmp_c" || die "contrato sem fix odd LAY"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/4 prelive createProtection (persistOdd = market)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'persistOdd' "$tmp_pre" || die "prelive sem persistOdd"
grep -q 'effective_back_odd' "$tmp_pre" || die "prelive sem effective_back_odd"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/4 UIs (monitor + proteções cliente)"
for pair in \
  "deploy/vps-supabase/static/v2/admin-monitoring-protections.html:admin-monitoring-protections.html:displayOddOf" \
  "deploy/vps-supabase/static/v2/app-protecoes.html:app-protecoes.html:displayOddOf"; do
  IFS=: read -r rel name marker <<<"$pair"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem $marker"
  n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-lay-odd-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  if [[ "$n" -eq 0 ]]; then
    mkdir -p "$WEB"
    cp -f "$tmp" "$WEB/$name"
    chmod 0644 "$WEB/$name"
    echo "  OK $WEB/$name (fallback)"
  fi
  rm -f "$tmp"
done

log "4/4 restart + backfill odd = metadata.market_odd"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

if [[ -n "$SERVICE_KEY" ]]; then
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" python3 - <<'PY' || echo "AVISO: backfill falhou"
import json, os, urllib.request

url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

def get(path):
    req = urllib.request.Request(url + path, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def patch(path, body):
    data = json.dumps(body).encode()
    h = dict(headers)
    req = urllib.request.Request(url + path, data=data, headers=h, method="PATCH")
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()

updated = 0
for table in ("protections", "back_protections"):
    try:
        rows = get(f"/rest/v1/{table}?select=id,odd,metadata&order=created_at.desc&limit=2000")
    except Exception as e:
        print(f"  skip {table}: {e}")
        continue
    if not isinstance(rows, list):
        continue
    for row in rows:
        meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        mt = str(meta.get("market_type") or ("BACK" if table.startswith("back") else "LAY")).upper()
        market_odd = meta.get("market_odd")
        try:
            market_odd_n = float(market_odd)
        except (TypeError, ValueError):
            continue
        if not (market_odd_n > 1.01):
            continue
        try:
            cur = float(row.get("odd") or 0)
        except (TypeError, ValueError):
            cur = 0
        # Só corrige quando a coluna odd parece a back-equivalente (≠ mercado)
        if abs(cur - market_odd_n) < 1e-6:
            continue
        # LAY: se odd ≈ L/(L-1), era conversão errada
        if mt == "LAY":
            equiv = market_odd_n / (market_odd_n - 1) if market_odd_n > 1.01 else 0
            if abs(cur - equiv) > 0.05 and cur > 2:
                # odd já alta e diferente — não mexe
                continue
        body = {"odd": market_odd_n}
        # guarda a convertida só como info
        meta2 = dict(meta)
        if mt == "LAY" and cur > 1.01 and abs(cur - market_odd_n) > 1e-6:
            meta2["effective_back_odd"] = cur
            meta2["odd_was_converted_bug"] = True
            body["metadata"] = meta2
        try:
            patch(f"/rest/v1/{table}?id=eq.{row['id']}", body)
            updated += 1
        except Exception as e:
            print("  skip", row.get("id"), e)
print(f"  backfill odd mercado: {updated} linhas")
PY
else
  echo "AVISO: SERVICE_ROLE_KEY ausente — pulando backfill"
fi

echo ""
echo "OK. LAY lançado @ 30 deve aparecer LAY 30 no monitor e nas proteções."
echo "Hard refresh (Ctrl+Shift+R)."
