#!/usr/bin/env bash
set -Eeuo pipefail

# Atomic relay release installer. This is the only command the CI deployment
# account may run through sudo; validate every path before touching it.

readonly ROOT=/opt/voltmarch-relay
readonly RELEASES="$ROOT/releases"
readonly CURRENT="$ROOT/current"
readonly ENV_FILE=/etc/voltmarch-relay.env
readonly SERVICE=voltmarch-relay.service
readonly NPM_CACHE=/var/cache/voltmarch-npm

die() { printf '[relay-deploy] %s\n' "$*" >&2; return 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die 'must run as root (through the restricted sudo rule)'
[[ $# -eq 3 ]] || die 'usage: deploy-release.sh <git-sha> <build-version> <archive>'

sha=$1
version=$2
archive=$3

[[ $sha =~ ^[0-9a-f]{7,40}$ ]] || die 'invalid git SHA'
[[ $version =~ ^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$ ]] || die 'invalid build version'
readonly expected_archive="/tmp/voltmarch-relay-${sha}.tgz"
[[ $archive == "$expected_archive" ]] || die 'archive is outside the allowed deployment path'
[[ -f $archive && ! -L $archive ]] || die 'release archive is missing or is a symlink'
[[ -f $ENV_FILE && ! -L $ENV_FILE ]] || die 'relay environment file is missing or unsafe'

mkdir -p "$RELEASES" "$NPM_CACHE"
chown voltmarch:voltmarch "$RELEASES" "$NPM_CACHE"

release="$RELEASES/$sha"
staging="$RELEASES/.${sha}.new"
[[ $release == "$RELEASES/"* && $staging == "$RELEASES/"* ]] || die 'release path escaped its root'
if [[ -e $release ]]; then
  active=''
  if [[ -L $CURRENT ]]; then active=$(readlink -f "$CURRENT" || true); fi
  [[ $active != "$release" ]] || die "release $sha is already active"
  [[ -d $release && ! -L $release ]] || die 'existing inactive release path is unsafe'
  rm -rf -- "$release"
fi
rm -rf -- "$staging"
mkdir -p "$staging"

# Reject absolute paths, traversal and unexpected payloads before extraction.
while IFS= read -r entry; do
  [[ -n $entry ]] || continue
  [[ $entry != /* && $entry != *'../'* && $entry != '..' ]] || die "unsafe archive entry: $entry"
  case "$entry" in
    dist|dist/*|package.json|package-lock.json|smoke.mjs) ;;
    *) die "unexpected archive entry: $entry" ;;
  esac
done < <(tar -tzf "$archive")

tar -xzf "$archive" -C "$staging" --no-same-owner --no-same-permissions
[[ -f $staging/package.json && -f $staging/package-lock.json ]] || die 'release metadata is incomplete'
[[ -f $staging/dist/server/src/index.js && -f $staging/smoke.mjs ]] || die 'compiled relay is incomplete'

chown -R voltmarch:voltmarch "$staging"
sudo -u voltmarch env HOME=/tmp npm --prefix "$staging" ci \
  --omit=dev --ignore-scripts --no-audit --no-fund --cache "$NPM_CACHE"
mv -- "$staging" "$release"

previous=''
if [[ -L $CURRENT ]]; then previous=$(readlink -f "$CURRENT" || true); fi
env_backup=$(mktemp /tmp/voltmarch-relay-env.XXXXXX)
cp -- "$ENV_FILE" "$env_backup"
chmod 600 "$env_backup"

rollback() {
  status=$?
  trap - ERR
  printf '[relay-deploy] activation failed; rolling back\n' >&2
  cp -- "$env_backup" "$ENV_FILE"
  if [[ -n $previous && $previous == "$RELEASES/"* && -d $previous ]]; then
    ln -sfn -- "$previous" "$CURRENT"
    systemctl restart "$SERVICE" || true
  else
    systemctl stop "$SERVICE" || true
    rm -f -- "$CURRENT"
  fi
  [[ $release == "$RELEASES/"* ]] && rm -rf -- "$release"
  rm -f -- "$env_backup" "$archive"
  exit "$status"
}
trap rollback ERR

env_tmp=$(mktemp /tmp/voltmarch-relay-env-next.XXXXXX)
awk -v version="$version" '
  BEGIN { replaced = 0 }
  /^VM_REQUIRE_BUILD=/ { print "VM_REQUIRE_BUILD=" version; replaced = 1; next }
  { print }
  END { if (!replaced) print "VM_REQUIRE_BUILD=" version }
' "$ENV_FILE" > "$env_tmp"
install -o root -g voltmarch -m 0640 "$env_tmp" "$ENV_FILE"
rm -f -- "$env_tmp"

ln -sfn -- "$release" "$CURRENT"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

for _ in {1..20}; do
  systemctl is-active --quiet "$SERVICE" && break
  sleep 0.25
done
systemctl is-active --quiet "$SERVICE" || die 'relay service did not become active'

origin=$(sed -n 's/^VM_ORIGINS=//p' "$ENV_FILE" | cut -d, -f1)
[[ $origin == https://* ]] || die 'no HTTPS game origin is configured'
sudo -u voltmarch env HOME=/tmp node "$release/smoke.mjs" \
  ws://127.0.0.1:8787/ws "$origin" "$version"

trap - ERR
rm -f -- "$env_backup" "$archive"

# Keep the five newest immutable releases. Never delete the active target.
active=$(readlink -f "$CURRENT")
kept=0
while IFS= read -r old; do
  [[ $old == "$RELEASES/"* ]] || continue
  if [[ $old == "$active" || $kept -lt 5 ]]; then
    ((kept += 1))
    continue
  fi
  rm -rf -- "$old"
done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %p\n' \
  | sort -rn | cut -d' ' -f2-)

printf '[relay-deploy] activated %s (build %s)\n' "$sha" "$version"
