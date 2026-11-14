#!/usr/bin/env bash
# Deploys Schematica to Azure Container Apps (architecture-atlas, in orch-env).
# The Linux version of infra/deploy.ps1, step for step and flag for flag (both are kept), in the shape of plainsight's.
#
# Usage: infra/deploy.sh [-Live] [flags]. With no flags it is a dry run: it prints every command and changes nothing.
# Nothing live happens without -Live.
#
# Run from the architecture-atlas folder, with Docker running and your az login.
#   1. Rebuilds the site (tools/build.mjs) and refuses if the working tree has changes the image would carry.
#   2. Builds the nginx image with Docker and pushes it to the shared registry, tagged with the commit.
#   3. Deploys atlas.bicep, with the custom domain from infra/site.json (schematica.ca, and www sent to it).
#   4. Checks the home page, one plate and the manifest answer.
#
# Flags (PowerShell spelling or --long):
#   (no flags) | -DryRun             the default: prints every command it would run and runs nothing (no Azure, no Docker)
#   -Live | --live                   deploys for real
#   -WhatIf | --what-if              read-only: checks Azure and shows what step 3 would change, then stops
#   -CertificateReady | --certificate-ready
#                                    the second deploy, after a first that added the hosts: issues the managed
#                                    certificates for schematica.ca and www.schematica.ca and binds them (AB#4984)
#   -Warm | --warm                   keeps one replica running (no cold start)
#   -ResourceGroup, -AppName <value> as in deploy.ps1
# Rollback: the script prints the previous image; az containerapp update -n architecture-atlas -g rg-orchestrata --image <it>
set -euo pipefail

WHATIF=0; DRY=0; LIVE=0; WARM=0; CERT=0
RG=rg-orchestrata; APP=architecture-atlas
while [ $# -gt 0 ]; do
  case "${1,,}" in
    -whatif|--what-if) WHATIF=1 ;;
    -dryrun|--dry-run) DRY=1 ;;
    -live|--live) LIVE=1 ;;
    -warm|--warm) WARM=1 ;;
    -certificateready|--certificate-ready) CERT=1 ;;
    -resourcegroup|--resource-group) RG="$2"; shift ;;
    -appname|--app-name) APP="$2"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
# A dry run unless -Live says otherwise; -WhatIf only reads, so it may query Azure without -Live.
[ $LIVE = 1 ] || [ $WHATIF = 1 ] || DRY=1
if [ $LIVE = 1 ] && [ $DRY = 1 ]; then echo '-Live and -DryRun together: pick one.' >&2; exit 2; fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$HERE")"
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }; green() { printf '\033[32m%s\033[0m\n' "$*"; }; cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
# run: does it, or in a dry run says it.
run() { if [ $DRY = 1 ]; then printf '  would run: %s\n' "$*" >&2; else "$@"; fi; }
# ask: a read-only query whose answer the script needs; a dry run prints it and answers with a placeholder.
ask() { local placeholder="$1"; shift; if [ $DRY = 1 ]; then printf '  would ask: %s\n' "$*" >&2; printf '%s' "$placeholder"; else "$@"; fi; }

# Docker builds the image in step 2. Check it before anything else, and say what is actually wrong (plainsight AB#5059).
docker_problem() {
  local err; err="$(docker info 2>&1 >/dev/null)" && return 1
  if ! command -v docker >/dev/null; then echo 'Docker is not installed (no docker command).'
  elif grep -qi 'permission denied' <<<"$err"; then
    echo "Docker is running, but $USER may not use it (permission denied on /var/run/docker.sock). Add yourself to the docker group: sudo usermod -aG docker \$USER, then log out and in (or run: newgrp docker), and run this script again."
  elif grep -qiE 'cannot connect|is the docker daemon running|no such file' <<<"$err"; then echo 'Docker is not running. Start it (sudo systemctl start docker), then run this script again.'
  else echo "docker info failed: $err"; fi
}
if [ $WHATIF = 0 ] && [ $DRY = 0 ] && msg="$(docker_problem)"; then
  # This subscription does not permit ACR Tasks (TasksOperationsNotAllowed, 2026-10-04), so there is no cloud build.
  echo "$msg (Docker is needed to build the image; cloud builds are not permitted on this subscription. Nothing was deployed.)" >&2; exit 1
fi

yellow '== 1. site'
if [ $WHATIF = 0 ]; then
  run node "$REPO/tools/build.mjs"
  dirty="$(git -C "$REPO" status --porcelain -- index.html assets atlas sitemap.xml robots.txt | grep -v 'kiln\.html$' || true)"
  if [ -n "$dirty" ]; then echo "uncommitted changes in the site; commit them first:" >&2; echo "$dirty" >&2; [ $DRY = 1 ] || exit 1; fi
fi

yellow '== 2. image'
acr="$(ask 'orchacr' az acr list -g "$RG" --query '[0].name' -o tsv)"
login="$(ask 'orchacr.azurecr.io' az acr show -n "$acr" --query loginServer -o tsv)"
tag="$(git -C "$REPO" rev-parse --short HEAD)"
image="$login/architecture-atlas:$tag"
previous="$(ask '' az containerapp list -g "$RG" --query "[?name=='$APP'].properties.template.containers[0].image | [0]" -o tsv)"
if [ $WHATIF = 0 ]; then
  # Docker was checked before step 1 (docker_problem).
  run az acr login -n "$acr" >/dev/null
  run docker build -t "$image" "$REPO"
  run docker push "$image"
fi
echo "  $image${previous:+ (was $previous)}"

yellow '== 3. Container App'
bicep="$HERE/atlas.bicep"
params=("image=$image" "appName=$APP" "minReplicas=$WARM")
# the custom domain comes from infra/site.json, where tools/build.mjs reads it too: an apex is validated over HTTP and
# its www host only redirects to it (nginx); a subdomain is validated by its CNAME and has no www of its own
domain="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).domain ?? ""))' "$HERE/site.json")"
if [ -n "$domain" ]; then
  cert=false; [ $CERT = 1 ] && cert=true
  if [ "$(tr -cd '.' <<<"$domain" | wc -c)" -le 1 ]; then validation=HTTP; else validation=CNAME; fi
  params+=("customDomain=$domain" "certificateReady=$cert" "domainValidation=$validation")
  [ $validation = HTTP ] && params+=("redirectDomain=www.$domain")
fi
if [ $WHATIF = 1 ]; then
  run az deployment group what-if -g "$RG" -f "$bicep" -p "${params[@]}"
  cyan $'\nNothing was changed (-WhatIf).'
  exit 0
fi
out="$(ask '{"siteUrl":{"value":"https://architecture-atlas.example.azurecontainerapps.io"},"latestRevision":{"value":"architecture-atlas--dry"}}' \
  az deployment group create -g "$RG" -f "$bicep" -p "${params[@]}" --query properties.outputs -o json)"
site="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.siteUrl.value)' "$out")"
echo "  $site (revision $(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.latestRevision.value)' "$out"))"

yellow '== 4. answers'
for p in / /atlas/health-records/ /assets/manifest.js; do
  if [ $DRY = 1 ]; then printf '  would check: %s%s answers 200\n' "$site" "$p" >&2; continue; fi
  ok=0
  for _ in $(seq 1 24); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$site$p")" = 200 ]; then ok=1; break; fi
    sleep 5
  done
  [ $ok = 1 ] || { echo "no answer from $site$p. Logs: az containerapp logs show -n $APP -g $RG --tail 50" >&2; exit 1; }
  echo "  $site$p 200"
done
if [ $DRY = 1 ]; then cyan $'\nDry run: nothing was run. To deploy for real, add -Live.'; exit 0; fi
green "  $site"
[ -n "$previous" ] && echo "  Rollback: az containerapp update -n $APP -g $RG --image $previous"
if [ -n "$domain" ] && [ $CERT = 0 ]; then
  cyan "  Next: $domain and www.$domain are on the app, unbound. Run: infra/deploy.sh -Live -CertificateReady (it issues their certificates and binds them)"
fi
