#!/usr/bin/env bash
# Fonte única: admin-jogos.html com manualLaunchPanel (formulário full-page).
# Uso: source este arquivo e chamar arbishield_deploy_admin_jogos_html
ARBISHIELD_JOGOS_REPO="${ARBISHIELD_JOGOS_REPO:-isaacgomes3/exchange}"
ARBISHIELD_JOGOS_BRANCH="${ARBISHIELD_JOGOS_BRANCH:-cursor/manual-evento-escudo-times-bb44}"

arbishield_deploy_admin_jogos_html() {
  local web_root="${1:-${ARBISHIELD_WEB:-/var/www/arbishield}}"
  local web="${web_root}/v2"
  local repo="$ARBISHIELD_JOGOS_REPO"
  local branch="$ARBISHIELD_JOGOS_BRANCH"
  local sha="${ARBISHIELD_JOGOS_COMMIT:-}"

  mkdir -p "$web"

  if [[ -z "$sha" ]]; then
    sha=$(curl -fsSL "https://api.github.com/repos/${repo}/commits/${branch}" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])" 2>/dev/null || true)
  fi

  local raw="https://raw.githubusercontent.com/${repo}/${sha:-$branch}"
  curl -fsSL "${raw}/deploy/vps-supabase/static/v2/admin-jogos.html" -o "${web}/admin-jogos.html"
  chmod 0644 "${web}/admin-jogos.html"

  grep -q 'manualLaunchPanel' "${web}/admin-jogos.html" || {
    echo "ERRO: ${web}/admin-jogos.html sem manualLaunchPanel" >&2
    return 1
  }
  grep -q 'drawer-backdrop' "${web}/admin-jogos.html" && {
    echo "ERRO: ${web}/admin-jogos.html ainda usa drawer lateral (versão antiga)" >&2
    return 1
  }

  cp -f "${web}/admin-jogos.html" "${web_root}/admin-jogos.html" 2>/dev/null || true
  echo "  ok ${web}/admin-jogos.html ($(wc -c < "${web}/admin-jogos.html") bytes, branch ${branch})"
}
