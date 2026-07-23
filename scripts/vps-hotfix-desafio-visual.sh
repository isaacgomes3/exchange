#!/usr/bin/env bash
# Hotfix: visual Desafios + lançamento 1 evento (etapa = falha do cliente)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-visual.sh?v=16")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "app-desafio.html (visual mockup + etapa pessoal)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-desafio.html" -o "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
grep -q 'dz-v2-compare' "$WEB/app-desafio.html" || die "HTML sem dz-v2-compare"
grep -q 'dz-wallet-bar' "$WEB/app-desafio.html" || die "HTML sem dz-wallet-bar"
grep -q 'Depositar Desafio' "$WEB/app-desafio.html" || die "HTML sem Depositar Desafio"
grep -q 'Maior retorno' "$WEB/app-desafio.html" || die "HTML sem Maior retorno"
grep -q 'resolveTeamLogo' "$WEB/app-desafio.html" || die "HTML sem resolveTeamLogo"
grep -q 'searchFootballTeams' "$WEB/app-desafio.html" || die "HTML sem searchFootballTeams"
grep -q 'personalProgress' "$WEB/app-desafio.html" || die "HTML sem personalProgress (etapa = falha do cliente)"
# enrichLogos deve sobrescrever URL quebrada com TheSportsDB
grep -q 'Sempre tenta TheSportsDB' "$WEB/app-desafio.html" || die "app-desafio sem enrichLogos reforçado"
grep -q 'data-stake-input' "$WEB/app-desafio.html" || die "HTML sem campo editável Entrar com"
grep -q 'data-stake-max' "$WEB/app-desafio.html" || die "HTML sem botão MAX do stake"
grep -q 'calcSideStakes' "$WEB/app-desafio.html" || die "HTML sem cálculo automático da casa"
grep -q 'em andamento' "$WEB/app-desafio.html" || die "HTML sem progresso em andamento"

log "v2.js (busca de times + fallback TheSportsDB)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.js" -o "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'thesportsdb.com' "$WEB/v2.js" || die "v2.js sem fallback TheSportsDB"

log "v2.css (barra preta + borda limão)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.css" -o "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
# Espelha também na raiz caso o nginx sirva /v2.css de outro path
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'dz-v2-panel' "$WEB/v2.css" || die "CSS sem dz-v2-panel"
grep -q 'dz-wallet-bar' "$WEB/v2.css" || die "CSS sem dz-wallet-bar"
grep -q 'background: #000' "$WEB/v2.css" || die "CSS sem background preto da barra"
grep -q 'border: 1.5px solid #c9f223' "$WEB/v2.css" || die "CSS sem borda limão da barra"

grep -q 'dz-wallet-black' "$WEB/app-desafio.html" || die "HTML sem cache-bust da barra"
grep -q 'background: #000 !important' "$WEB/app-desafio.html" || die "HTML sem estilo inline preto"

log "admin-desafios.html (1 evento no lançamento; sem Adicionar Etapa)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-desafios.html" -o "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
grep -q 'Sugestão de Desafio' "$WEB/admin-desafios.html" && die "botão Sugestão de Desafio ainda presente"
grep -q 'Adicionar Etapa' "$WEB/admin-desafios.html" && die "botão Adicionar Etapa ainda presente"
grep -q 'admin-desafio-lancar.html' "$WEB/admin-desafios.html" || die "admin sem link para página de lançamento"
grep -q 'Saldo inicial' "$WEB/admin-desafios.html" && die "admin ainda mostra Saldo inicial (saldo é da carteira Desafio)"
grep -q 'desafio-delete' "$WEB/admin-desafios.html" || die "admin sem Excluir (desafio-delete)"
grep -q 'desafio-cancel' "$WEB/admin-desafios.html" || die "admin sem Cancelar (desafio-cancel)"
grep -q 'data-delete' "$WEB/admin-desafios.html" || die "admin sem botão Excluir"
grep -q 'data-cancel' "$WEB/admin-desafios.html" || die "admin sem botão Cancelar"

log "admin-desafio-lancar.html (página dedicada — sem número/título/saldo/etapas manuais)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-desafio-lancar.html" -o "$WEB/admin-desafio-lancar.html"
chmod 0644 "$WEB/admin-desafio-lancar.html"
if grep -Eq 'fCircuitMax|id="fNumber"|id="fTitle"|id="fSubtitle"|id="fBalance"|Saldo inicial ArbiShield|Máx\. etapas' "$WEB/admin-desafio-lancar.html"; then
  die "página de lançamento ainda tem campos manuais removidos"
fi
grep -q 'Adicionar Etapa' "$WEB/admin-desafio-lancar.html" && die "página de lançamento ainda tem Adicionar Etapa"
grep -q 'defaultEventTitle' "$WEB/admin-desafio-lancar.html" || die "página sem título automático do evento"
grep -q 'DEFAULT_CIRCUIT_STEPS' "$WEB/admin-desafio-lancar.html" || die "página sem etapas padrão do circuito"
grep -q 'casaSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca na Entrada Casa Externa"
grep -q 'arbiSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca na Entrada ArbiShield"
grep -q 'casaMarketSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca de mercado (casa)"
grep -q 'arbiMarketSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca de mercado (arbi)"
grep -q 'bindMarketPickers' "$WEB/admin-desafio-lancar.html" || die "página sem bindMarketPickers"
grep -q 'filterLocalMarkets' "$WEB/admin-desafio-lancar.html" || die "página sem filterLocalMarkets (catálogo local)"
grep -q 'DESAFIO_MARKET_FLAT' "$WEB/admin-desafio-lancar.html" || die "página sem DESAFIO_MARKET_FLAT"
grep -q 'Catálogo de mercados indisponível' "$WEB/admin-desafio-lancar.html" && die "página ainda mostra catálogo indisponível"
grep -q 'Menos 2.5 gols na partida' "$WEB/admin-desafio-lancar.html" || die "página sem opções Menos 2.5 no catálogo"
grep -q 'fProfitPct' "$WEB/admin-desafio-lancar.html" || die "página sem lucro líquido do evento"
grep -q 'calcArbiOddFromCasa' "$WEB/admin-desafio-lancar.html" || die "página sem cálculo automático da odd ArbiShield"
grep -q 'max-width: none !important' "$WEB/admin-desafio-lancar.html" || die "página ainda centralizada (sem full-bleed)"
grep -q '720px' "$WEB/admin-desafio-lancar.html" && die "página ainda tem max-width 720px"

log "market-catalog.js (autocomplete de mercados)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/market-catalog.js" -o "$WEB/market-catalog.js"
chmod 0644 "$WEB/market-catalog.js"
cp -f "$WEB/market-catalog.js" "$WEB_ROOT/market-catalog.js" 2>/dev/null || true
grep -q 'ArbiMarketCatalog' "$WEB/market-catalog.js" || die "market-catalog sem ArbiMarketCatalog"
grep -q 'Menos 2.5 gols na partida' "$WEB/market-catalog.js" || die "market-catalog sem Menos 2.5"

log "v2-shell.js (menu ativo em Lançar Desafio)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2-shell.js" -o "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
grep -q 'admin-desafio-lancar' "$WEB/v2-shell.js" || die "shell sem rota admin-desafio-lancar"

# Sempre atualiza prelive (createDesafio = 1 step + appendDesafioGame)
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
if [[ -f /opt/arbishield/arbishield-prelive-events.mjs ]] || [[ -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" ]]; then
  log "Atualizando prelive (1 evento no create + append próximo jogo)"
  curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
  chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
  grep -q 'appendDesafioGame' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem appendDesafioGame"
fi

# Shim :3101 — excluir / cancelar desafio (devolver saldo)
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
mkdir -p "$SCRIPTS_DIR"
SHIM_PATH=""
# Descobre o arquivo real usado pelo systemd (se existir)
if command -v systemctl >/dev/null 2>&1; then
  EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
  if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
    SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
  fi
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for cand in \
    "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
    /opt/arbishield/arbishield-serverfn-shim.mjs \
    /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
  do
    if [[ -f "$cand" ]]; then SHIM_PATH="$cand"; break; fi
  done
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
fi
log "Atualizando shim em $SHIM_PATH"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_PATH"
chmod 0755 "$SHIM_PATH"
# Espelho em /opt/arbishield caso o serviço use outro path
cp -f "$SHIM_PATH" /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'cancelDesafio' "$SHIM_PATH" || die "shim sem cancelDesafio"
grep -q 'desafio-delete' "$SHIM_PATH" || die "shim sem rota desafio-delete"
grep -q 'desafio_cancel_refund' "$SHIM_PATH" || die "shim sem reembolso carteira Desafio"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

# Nginx — location = explícitas (não depende só do regex)
inject_nginx_locations() {
  local conf="$1"
  python3 - "$conf" <<'PY'
import sys
path = sys.argv[1]
block = '''
    location = /api/arbishield/desafio-delete {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }

    location = /api/arbishield/desafio-cancel {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }

    location = /api/arbishield/desafio-pending-counts {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
'''
text = open(path, encoding="utf-8", errors="ignore").read()
if "location = /api/arbishield/desafio-delete" in text:
    # ainda assim atualiza o regex se existir
    pass
else:
    # inserir após desafios ou match-settle
    for needle in (
        "location = /api/arbishield/match-settle",
        "location = /api/arbishield/desafios",
        "desafio-settle",
    ):
        i = text.find(needle)
        if i < 0:
            continue
        # achar fim do bloco location atual
        k = i
        depth = 0
        end = None
        started = False
        while k < len(text):
            ch = text[k]
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
                if started and depth == 0:
                    end = k + 1
                    break
            k += 1
        if end is None:
            continue
        text = text[:end] + "\n" + block + text[end:]
        break
    else:
        raise SystemExit("não achou ponto de inserção nginx")

# Atualiza regex antiga se ainda não tiver desafio-delete
if "desafio-settle" in text and "desafio-delete" not in text.split("desafio-settle")[0] + text.split("desafio-settle")[1][:200]:
    text2 = text.replace(
        "desafio-participations|",
        "desafio-participations|desafio-delete|desafio-cancel|desafio-pending-counts|",
        1,
    )
    if text2 == text:
        text2 = text.replace(
            "desafio-register|desafio-settle|desafio-participations",
            "desafio-register|desafio-settle|desafio-participations|desafio-delete|desafio-cancel|desafio-pending-counts",
            1,
        )
    text = text2

open(path, "w", encoding="utf-8").write(text)
if "location = /api/arbishield/desafio-delete" not in open(path, encoding="utf-8").read():
    raise SystemExit("falha ao gravar location desafio-delete")
print("ok", path)
PY
}

NGINX_UPDATED=0
for conf in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* /etc/nginx/sites-available/*; do
  [[ -f "$conf" ]] || continue
  if grep -qE 'arbishield|desafio-settle|location = /api/arbishield/desafios' "$conf" 2>/dev/null; then
    log "Nginx: garantindo rotas delete/cancel em $conf"
    cp -a "$conf" "$conf.bak.desafio-cancel-$(date +%s)" || true
    inject_nginx_locations "$conf" || die "falha nginx inject em $conf"
    NGINX_UPDATED=1
  fi
done
if [[ "$NGINX_UPDATED" -eq 1 ]]; then
  nginx -t
  systemctl reload nginx
fi

# Smoke: shim deve conhecer a rota (sem auth → Acesso negado, NÃO not_found)
log "Smoke test :3101 desafio-delete"
SMOKE="$(curl -sS -X POST http://127.0.0.1:3101/api/arbishield/desafio-delete \
  -H 'Content-Type: application/json' -d '{}' || true)"
echo "  resposta: $SMOKE"
echo "$SMOKE" | grep -q 'not_found' && die "shim ainda responde not_found — serviço não reiniciou com o arquivo novo"
echo "$SMOKE" | grep -Eqi 'Acesso negado|id obrigatório|ok' || die "resposta inesperada do shim: $SMOKE"

log "OK — hotfix desafio visual aplicado (v15: logos no card via TheSportsDB)"
echo "Faça Ctrl+F5 no app Desafio. Se o teste ainda tiver URL 404, rode o seed v2."
