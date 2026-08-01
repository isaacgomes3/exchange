# Publicação versionada do frontend

**Contrato:** `release-artifact-v1`
**Fonte da verdade:** `scripts/lib/release-manifest.mjs`
**Testes CI:** `npm test` → `scripts/release-manifest.test.mjs`

Substitui os `vps-hotfix-*.sh` por arquivo. O problema que isso resolve: cada hotfix
baixava um arquivo de uma branch fixa, então rodar um script antigo trazia arquivos
antigos de volta — e não havia como saber qual versão estava publicada.

## Como fica no servidor

```
/var/www/arbishield/
  releases/
    <commit>/          # UI + __manifest.json + __version.json
    .history           # ordem de publicação (base do rollback)
  v2 -> releases/<commit>   # symlink; é o root do nginx
```

A troca é `ln -sfn` + `mv -Tf`, atômica: nenhum request vê meio caminho.

## Publicar

```bash
bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-publish-release.sh?ref=main&t=$(date +%s%N)" \
  -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-publish") -- --ref main
```

Etapas do script: resolve o ref → lê o commit no ar → **guarda de regressão** →
baixa o tarball do commit → monta a release → confere o manifesto → **checa
referências** → instala → troca o symlink → retenção → reload do nginx → confirma
pelo `/__version.json`.

| Opção | Para quê |
|---|---|
| `--ref <branch\|tag\|sha>` | o que publicar (default `main`) |
| `--dry-run` | baixa, monta e valida sem instalar nem trocar |
| `--adopt-webroot` | **primeira vez:** guarda o `v2` atual e o troca por symlink |
| `--rollback` | volta para a release anterior do `.history` |
| `--list` | lista as releases instaladas e marca a que está no ar |
| `--force` | publica mesmo sendo anterior/divergente (última instância) |

Variáveis: `ARBISHIELD_WEB` (default `/var/www/arbishield`), `ARBISHIELD_ORIGIN`,
`ARBISHIELD_KEEP_RELEASES` (default 5), `GITHUB_TOKEN` (opcional, sobe o rate limit).

### Primeira publicação

`v2` hoje é diretório comum. Sem `--adopt-webroot` o script instala a release e
**para**, avisando — não troca nada por conta própria. Antes de adotar:

1. `npm run audit:prod` e trazer para o repo tudo que estiver em `DESVIO` — esses
   arquivos só existem no servidor e a adoção os substitui pela release.
2. `--dry-run` para validar o artefato.
3. `--adopt-webroot` (o diretório antigo fica em `v2.pre-release-<timestamp>`).

## Guarda de regressão

O script compara, pela API do GitHub, o commit no ar com o commit alvo:

| compare | Decisão |
|---|---|
| `ahead` / `identical` | publica |
| `behind` | **bloqueia** — alvo é anterior ao que está no ar |
| `diverged` | **bloqueia** — não há linha reta entre os dois |
| indisponível | **bloqueia** — sem comparação não publica |

Sem versão anterior (primeira vez) ou mesmo commit (republicação) libera. A decisão
vive em `decidePublish()` e é coberta por teste; sai com código 3 quando bloqueia.

## Checagem de referências (não trocar arquivo por 404)

`missingRefs()` varre os `src`/`href` locais dos HTML da release e exige que cada
arquivo citado esteja **dentro** da release. Publicar sem isso troca um arquivo que
o servidor serve hoje por 404 — regressão com outro nome. Sai com código 5.

Foi o que pegou, na primeira adoção, que `finance-admins.js` (ACL de financeiro em 8
páginas admin), `blocked-emails.js` (bloqueio de e-mail no cadastro) e
`market-catalog.js` (catálogo em Lançar jogos) estavam servidos em produção e fora
da release. Os dois primeiros moram um nível acima no repo e entram por
`RELEASE_EXTRA_FILES`; o terceiro havia se perdido da linhagem principal.

Falta intencional vai em `RELEASE_OPTIONAL_REFS`, com o motivo no comentário
(`market-catalog.js` é carregado de três caminhos de propósito; `/termos.html` hoje
cai no fallback do nginx e não existe em branch nenhuma).

Conferir uma release já instalada:

```bash
node scripts/release-cli.mjs refs --dir /var/www/arbishield/releases/<sha>
```

## Cache-bust

Gerado no build: `applyCacheBust()` reescreve os `?v=` de js/css para o commit curto.
**Nunca** rodar `sed` no HTML publicado — era o que fazia o arquivo no ar não
corresponder a commit nenhum e o desvio ficar invisível.

## Backend (shim :3101) — `shim-release-v1`

Publicador: `scripts/vps-publish-shim.sh` · teste: `scripts/shim-release.test.mjs`

O shim era publicado por dezenas de hotfixes que gravavam em caminhos diferentes.
O systemd executa `/opt/arbishield/scripts/arbishield-serverfn-shim.mjs`, mas havia
cópia **mais nova e diferente** na raiz `/opt/arbishield/` — então "atualizar o
backend" às vezes não mudava nada do que rodava, e `grep` na cópia errada dava
resposta errada.

```bash
bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-publish-shim.sh?ref=main&t=$(date +%s%N)" \
  -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-publish") -- --ref main
```

Etapas: resolve o ref → lê o commit no ar (`.shim-release.json`) → **guarda de
regressão** (código 3) → `node --check` no shim e em cada lib → **backup** de
shim+lib → instala em `scripts/` e sincroniza as cópias paralelas → grava o
sidecar → restart → **valida `/health`** e, se não ficar saudável, **volta sozinho
para o backup** (código 7).

`/health` só é aceito com `ok=true`, `createProtectionModel=stake_lock_v1` e
`protectionFlowContract` presente — e passa a expor `release.commit`, então dá
para responder por HTTP qual backend está no ar.

| Opção | Para quê |
|---|---|
| `--ref <branch\|tag\|sha>` | o que publicar (default `main`) |
| `--dry-run` | baixa e checa sintaxe sem instalar nem reiniciar |
| `--rollback` | volta para o backup mais recente e revalida o health |
| `--list` | commit no ar, sha256 do arquivo em execução e backups |
| `--force` | publica commit anterior/divergente (última instância) |

### Expor o /health para a auditoria

O `/health` responde em `127.0.0.1:3101` mas não sai pelo nginx, então a auditoria
não alcança. Para expor apenas leitura:

```nginx
location = /__shim-health {
    proxy_pass http://127.0.0.1:3101/health;
    proxy_set_header Host $host;
}
```

### Diagnóstico

`scripts/vps-diag-shim-versao.sh` (só leitura) mostra o `ExecStart` do systemd, o
arquivo que cada processo vivo carregou, todas as cópias no disco com sha256 e
data, a matriz de capacidades por cópia e o health das portas. O sha256 identifica
o commit exato comparando contra as branches.

## Conferir e reverter

```bash
curl -s https://arbishield.app/__version.json     # commit publicado
npm run audit:prod                                # produção × git
bash scripts/vps-publish-release.sh --rollback    # volta uma release
```
