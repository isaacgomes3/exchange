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

## Conferir e reverter

```bash
curl -s https://arbishield.app/__version.json     # commit publicado
npm run audit:prod                                # produção × git
bash scripts/vps-publish-release.sh --rollback    # volta uma release
```
