#!/usr/bin/env bash
# Hotfix: desafios (e jogos) mostram "Lançado por: <admin>".
# - desafios: ADD created_by + metadata; create/publish grava admin via service role
# - UI admin-desafios resolve nome (_createdByName)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-lancado-por-admin.sh?ref=cursor/desafio-lancado-por-admin-e029&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-lancado-por-admin-e029}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE:-/opt/arbishield/deploy/vps-supabase}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

# Carrega SERVICE_ROLE_KEY dos .env comuns na VPS
if [[ -z "$SERVICE_KEY" ]]; then
  for envf in \
    "$SHIM_DIR/.env" \
    "$COMPOSE_DIR/.env" \
    /opt/arbishield/deploy/vps-supabase/.env \
    /var/www/arbishield/.env; do
    if [[ -f "$envf" ]]; then
      # shellcheck disable=SC1090
      set +u
      # extrai sem source completo (evita side-effects)
      k="$(grep -E '^(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)=' "$envf" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
      set -u
      if [[ -n "$k" ]]; then SERVICE_KEY="$k"; break; fi
    fi
  done
fi

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR" "$SHIM_DIR"

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

run_sql() {
  local sql="$1"
  if command -v docker >/dev/null 2>&1; then
    for ctr in supabase-db db postgres; do
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$ctr"; then
        docker exec -i "$ctr" psql -U postgres -d postgres -c "$sql" && return 0
        docker exec -i "$ctr" psql -U supabase_admin -d postgres -c "$sql" && return 0
      fi
    done
    if [[ -f "$COMPOSE_DIR/docker-compose.yml" ]] || [[ -f "$COMPOSE_DIR/compose.yml" ]]; then
      local db_ctr
      db_ctr="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
      if [[ -n "$db_ctr" ]]; then
        docker exec -i "$db_ctr" psql -U postgres -d postgres -c "$sql" && return 0
        docker exec -i "$db_ctr" psql -U supabase_admin -d postgres -c "$sql" && return 0
      fi
    fi
  fi
  if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -c "$sql" && return 0
  fi
  return 1
}

echo "==> vps-hotfix-lancado-por-admin.sh ($(date -Is)) ref=$REF"

log "1/6 schema desafios (created_by + metadata) + reload PostgREST"
SQL_DESAFIOS="$(cat <<'SQL'
ALTER TABLE public.desafios ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.desafios ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
SQL
)"
if run_sql "$SQL_DESAFIOS"; then
  echo "  OK ALTER desafios + reload schema"
else
  echo "  AVISO: não foi possível ALTER desafios (UI ainda resolve via profiles se created_by existir)"
fi

log "2/6 prelive (created_by_name + ensureDesafioCreator)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'created_by_name' "$tmp_pre" || die "prelive sem created_by_name"
grep -q 'ensureDesafioCreator' "$tmp_pre" || die "prelive sem ensureDesafioCreator"
grep -q 'resolveAdminDisplayName' "$tmp_pre" || die "prelive sem resolveAdminDisplayName"
grep -q 'resolveAdminNamesMap' "$tmp_pre" || die "prelive sem resolveAdminNamesMap"
grep -q 'admin_names' "$tmp_pre" || die "prelive sem mode admin_names"
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

log "3/6 shim (desafios created_by + publish stamp)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'created_by_name' "$tmp_shim" || die "shim sem created_by_name"
grep -q 'ensureDesafioCreator' "$tmp_shim" || die "shim sem ensureDesafioCreator"
grep -q 'enrichDesafiosWithCreatorNames' "$tmp_shim" || die "shim sem enrichDesafiosWithCreatorNames"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/6 admin UIs"
for pair in \
  "deploy/vps-supabase/static/v2/admin-desafios.html:admin-desafios.html:desafio-lancado-por-admin-v5" \
  "deploy/vps-supabase/static/v2/admin-jogos.html:admin-jogos.html:Lançado por:"; do
  IFS=: read -r rel name marker <<<"$pair"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -qF "$marker" "$tmp" || die "$name sem '$marker'"
  n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-lancado-por-$(date +%s)" 2>/dev/null || true
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

log "5/6 SQL backfill created_by_name (matches + desafios)"
SQL_BF="$(cat <<'SQL'
UPDATE public.matches m
SET metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
  'created_by', m.created_by::text,
  'created_by_name', coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), left(m.created_by::text, 8))
)
FROM public.profiles p
WHERE m.deleted_at IS NULL
  AND m.created_by IS NOT NULL
  AND m.created_by = p.id
  AND (
    coalesce(m.metadata->>'created_by_name', '') = ''
    OR m.metadata->>'created_by_name' ~* '^[0-9a-f]{8}$'
    OR m.metadata->>'created_by_name' ~* '^[0-9a-f-]{36}$'
  );

UPDATE public.desafios d
SET
  created_by = coalesce(d.created_by, NULLIF(d.metadata->>'created_by', '')::uuid),
  metadata = coalesce(d.metadata, '{}'::jsonb) || jsonb_build_object(
    'created_by', coalesce(d.created_by, NULLIF(d.metadata->>'created_by', '')::uuid)::text,
    'created_by_name', coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(split_part(btrim(p.email), '@', 1), ''),
      nullif(btrim(p.email), ''),
      left(coalesce(d.created_by, NULLIF(d.metadata->>'created_by', '')::uuid)::text, 8)
    )
  )
FROM public.profiles p
WHERE coalesce(d.created_by, NULLIF(d.metadata->>'created_by', '')::uuid) IS NOT NULL
  AND coalesce(d.created_by, NULLIF(d.metadata->>'created_by', '')::uuid) = p.id
  AND (
    coalesce(d.metadata->>'created_by_name', '') = ''
    OR d.metadata->>'created_by_name' ~* '^[0-9a-f]{8}$'
    OR d.metadata->>'created_by_name' ~* '^[0-9a-f-]{36}$'
  );
SQL
)"
if run_sql "$SQL_BF"; then
  echo "  OK backfill SQL"
else
  echo "  AVISO: backfill SQL falhou — seguindo com REST se possível"
fi

log "6/6 restart shim + REST backfill nomes"
# Reinicia processos que servem o shim/prelive
if command -v systemctl >/dev/null 2>&1; then
  for svc in arbishield-shim arbishield-serverfn arbishield-prelive; do
    systemctl try-restart "$svc" 2>/dev/null || true
  done
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all --update-env 2>/dev/null || true
fi
# docker compose restart do shim se existir
if [[ -f "$COMPOSE_DIR/docker-compose.yml" ]] || [[ -f "$COMPOSE_DIR/compose.yml" ]]; then
  (
    cd "$COMPOSE_DIR"
    docker compose restart shim 2>/dev/null || docker compose restart arbishield-shim 2>/dev/null || true
  ) || true
fi

if [[ -n "$SERVICE_KEY" ]]; then
  export SERVICE_KEY
  export SUPABASE_URL
  python3 - <<'PY' || true
import json, os, urllib.request

base = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
key = os.environ.get("SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
if not key:
    raise SystemExit(0)

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(r, timeout=60) as res:
        raw = res.read().decode() or "[]"
        return json.loads(raw)

profs = req("GET", "/rest/v1/profiles?select=id,full_name,email&limit=5000")
name_map = {}
for p in profs if isinstance(profs, list) else []:
    cid = str(p.get("id") or "")
    label = (p.get("full_name") or "").strip() or (p.get("email") or "").strip()
    if cid and label:
        name_map[cid] = label

rows = req("GET", "/rest/v1/desafios?select=id,created_by,metadata&limit=2000")
patched = 0
for d in rows if isinstance(rows, list) else []:
    meta = d.get("metadata") if isinstance(d.get("metadata"), dict) else {}
    cid = str(d.get("created_by") or meta.get("created_by") or "")
    if not cid:
        continue
    cur = str(meta.get("created_by_name") or "").strip()
    weak = (not cur) or (len(cur) == 8 and all(c in "0123456789abcdefABCDEF" for c in cur))
    if not weak:
        continue
    name = name_map.get(cid) or cid[:8]
    meta = dict(meta)
    meta["created_by"] = cid
    meta["created_by_name"] = name
    body = {"metadata": meta, "created_by": cid}
    try:
        req("PATCH", f"/rest/v1/desafios?id=eq.{d['id']}", body)
        patched += 1
    except Exception:
        try:
            req("PATCH", f"/rest/v1/desafios?id=eq.{d['id']}", {"created_by": cid})
            patched += 1
        except Exception:
            pass
print(f"  REST backfill desafios: {patched}")
PY
else
  echo "  AVISO: SERVICE_KEY ausente — pulando REST backfill"
fi

echo "OK. Confira Gestão de Desafios: 'Lançado por: <admin>'."
echo "Hotfix ref=$REF"
