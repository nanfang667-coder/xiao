#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${SOURCE_DIR:-/opt/hulim}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/hulim-deploy}"
RELEASES_DIR="$DEPLOY_ROOT/releases"
STATE_FILE="$DEPLOY_ROOT/active.env"
UPSTREAM_INCLUDE="${UPSTREAM_INCLUDE:-/etc/nginx/conf.d/hulim-upstream.inc}"
TARGET_REF="${1:-origin/main}"
HEALTH_PATH="${HEALTH_PATH:-/}"
DATABASE_FILE="${DATABASE_FILE:-dev.db}"
HEALTH_HOST="${HEALTH_HOST:-fenglou1.com}"
DRAIN_SECONDS="${DRAIN_SECONDS:-10}"

NEW_PROCESS=""
NEW_RELEASE=""
UPSTREAM_BACKUP=""
NGINX_SWITCHED=0
DEPLOYMENT_SUCCEEDED=0

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

migration_fingerprint() {
  local directory="$1"
  if [[ ! -d "$directory/prisma/migrations" ]]; then
    printf none
    return
  fi
  (
    cd "$directory"
    find prisma/migrations -type f -print0 \
      | sort -z \
      | xargs -0 sha256sum \
      | sha256sum \
      | awk '{print $1}'
  )
}

write_state() {
  local state_tmp
  state_tmp="$(mktemp "$DEPLOY_ROOT/.active.XXXXXX")"
  {
    printf 'ACTIVE_PORT=%q\n' "$NEW_PORT"
    printf 'ACTIVE_PROCESS=%q\n' "$NEW_PROCESS"
    printf 'ACTIVE_RELEASE=%q\n' "$NEW_RELEASE"
    printf 'ACTIVE_REVISION=%q\n' "$TARGET_REVISION"
  } > "$state_tmp"
  chmod 600 "$state_tmp"
  mv -f "$state_tmp" "$STATE_FILE"
}

write_upstream() {
  local port="$1" upstream_tmp
  upstream_tmp="$(mktemp "$(dirname "$UPSTREAM_INCLUDE")/.hulim-upstream.XXXXXX")"
  printf 'proxy_pass http://127.0.0.1:%s;\n' "$port" > "$upstream_tmp"
  chmod --reference="$UPSTREAM_INCLUDE" "$upstream_tmp"
  chown --reference="$UPSTREAM_INCLUDE" "$upstream_tmp"
  mv -f "$upstream_tmp" "$UPSTREAM_INCLUDE"
}

cleanup() {
  local exit_code=$?
  if [[ "$DEPLOYMENT_SUCCEEDED" -ne 1 ]]; then
    if [[ "$NGINX_SWITCHED" -eq 1 && -f "$UPSTREAM_BACKUP" ]]; then
      log "Rolling Nginx back to the previous application"
      cp -a "$UPSTREAM_BACKUP" "$UPSTREAM_INCLUDE"
      if nginx -t; then
        systemctl reload nginx || true
      fi
    fi
    if [[ -n "$NEW_PROCESS" && "$NEW_PROCESS" != "${ACTIVE_PROCESS:-}" ]]; then
      pm2 delete "$NEW_PROCESS" >/dev/null 2>&1 || true
    fi
  elif [[ -n "${ACTIVE_PROCESS:-}" && "$ACTIVE_PROCESS" != "$NEW_PROCESS" ]]; then
    pm2 delete "$ACTIVE_PROCESS" >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
  fi
  [[ -z "$UPSTREAM_BACKUP" || ! -f "$UPSTREAM_BACKUP" ]] || rm -f -- "$UPSTREAM_BACKUP"
  exit "$exit_code"
}

trap cleanup EXIT

[[ "$EUID" -eq 0 ]] || die "Run as root"
for command_name in git npm npx pm2 curl nginx systemctl flock tar sha256sum awk mktemp; do
  require_command "$command_name"
done

[[ -d "$SOURCE_DIR/.git" ]] || die "Git repository not found at $SOURCE_DIR"
[[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || die "Run setup-blue-green.sh first"
[[ -f "$UPSTREAM_INCLUDE" ]] || die "Nginx upstream include is missing"
[[ -f "$SOURCE_DIR/.env" ]] || die "Shared .env is missing"
[[ "$DATABASE_FILE" =~ ^[A-Za-z0-9._-]+\.db$ ]] || die "Invalid shared database filename"
[[ -f "$SOURCE_DIR/prisma/$DATABASE_FILE" ]] || die "Shared production database is missing"
[[ -d "$SOURCE_DIR/public/uploads" ]] || die "Shared upload directory is missing"

exec 9>"$DEPLOY_ROOT/deploy.lock"
flock -n 9 || die "Another deployment is already running"

# The state file is created by the root-only setup script and contains no secrets.
# shellcheck disable=SC1090
source "$STATE_FILE"
[[ "$ACTIVE_PORT" == "3000" || "$ACTIVE_PORT" == "3001" ]] || die "Invalid active port in state"
[[ "$ACTIVE_PROCESS" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid PM2 process name in state"
[[ "$ACTIVE_RELEASE" == "$SOURCE_DIR" || "$ACTIVE_RELEASE" == "$RELEASES_DIR/"* ]] || die "Invalid active release path"
[[ "$(pm2 pid "$ACTIVE_PROCESS" | tr -d '[:space:]')" =~ ^[1-9][0-9]*$ ]] || die "Active PM2 process is not online"

log "Fetching origin/main without modifying the live checkout"
git -C "$SOURCE_DIR" fetch --prune origin main
TARGET_REVISION="$(git -C "$SOURCE_DIR" rev-parse --verify "$TARGET_REF^{commit}")"
SHORT_REVISION="$(git -C "$SOURCE_DIR" rev-parse --short=12 "$TARGET_REVISION")"
if [[ "$TARGET_REVISION" == "$ACTIVE_REVISION" ]]; then
  log "Revision $SHORT_REVISION is already active"
  DEPLOYMENT_SUCCEEDED=1
  exit 0
fi

NEW_PORT=3000
[[ "$ACTIVE_PORT" == "3000" ]] && NEW_PORT=3001
NEW_PROCESS="hulim-$SHORT_REVISION"
NEW_RELEASE="$RELEASES_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$SHORT_REVISION"
[[ "$NEW_RELEASE" == "$RELEASES_DIR/"* ]] || die "Unsafe release path"

log "Preparing release $SHORT_REVISION on port $NEW_PORT"
mkdir -p "$NEW_RELEASE"
git -C "$SOURCE_DIR" archive "$TARGET_REVISION" | tar -x -C "$NEW_RELEASE"

ln -s "$SOURCE_DIR/.env" "$NEW_RELEASE/.env"
rm -f -- "$NEW_RELEASE/prisma/$DATABASE_FILE"
ln -s "$SOURCE_DIR/prisma/$DATABASE_FILE" "$NEW_RELEASE/prisma/$DATABASE_FILE"
if [[ -e "$NEW_RELEASE/public/uploads" ]]; then
  mv "$NEW_RELEASE/public/uploads" "$NEW_RELEASE/uploads.repository"
fi
mkdir -p "$NEW_RELEASE/public/uploads"

ACTIVE_MIGRATIONS="$(migration_fingerprint "$ACTIVE_RELEASE")"
TARGET_MIGRATIONS="$(migration_fingerprint "$NEW_RELEASE")"
if [[ "$ACTIVE_MIGRATIONS" != "$TARGET_MIGRATIONS" ]]; then
  die "Database migrations changed. Use a reviewed maintenance deployment instead of blue-green deployment."
fi

log "Installing dependencies and building away from the live application"
(
  cd "$NEW_RELEASE"
  npm ci --no-audit --no-fund
  npx prisma generate
  NEXT_DEPLOYMENT_ID="$TARGET_REVISION" npm run build
)

rmdir -- "$NEW_RELEASE/public/uploads"
ln -s "$SOURCE_DIR/public/uploads" "$NEW_RELEASE/public/uploads"

pm2 delete "$NEW_PROCESS" >/dev/null 2>&1 || true
NODE_ENV=production NEXT_DEPLOYMENT_ID="$TARGET_REVISION" \
  pm2 start "$NEW_RELEASE/node_modules/next/dist/bin/next" \
    --name "$NEW_PROCESS" \
    --cwd "$NEW_RELEASE" \
    -- start -H 127.0.0.1 -p "$NEW_PORT"

log "Waiting for the new application to become healthy"
healthy=0
for _ in $(seq 1 45); do
  if curl --fail --silent --show-error --max-time 3 \
    --output /dev/null \
    "http://127.0.0.1:$NEW_PORT$HEALTH_PATH"; then
    healthy=1
    break
  fi
  sleep 1
done
[[ "$healthy" -eq 1 ]] || die "New application failed its health check"

UPSTREAM_BACKUP="$(mktemp "$DEPLOY_ROOT/.upstream-backup.XXXXXX")"
cp -a "$UPSTREAM_INCLUDE" "$UPSTREAM_BACKUP"
write_upstream "$NEW_PORT"
NGINX_SWITCHED=1
nginx -t
systemctl reload nginx

log "Verifying the public Nginx route after the atomic switch"
curl --noproxy '*' --fail --silent --show-error --max-time 15 \
  --output /dev/null \
  --resolve "$HEALTH_HOST:443:127.0.0.1" \
  "https://$HEALTH_HOST$HEALTH_PATH"

write_state
DEPLOYMENT_SUCCEEDED=1
log "Deployment complete: $SHORT_REVISION is serving on port $NEW_PORT"

log "Draining the previous process for $DRAIN_SECONDS seconds"
sleep "$DRAIN_SECONDS"
if [[ "$ACTIVE_PROCESS" != "$NEW_PROCESS" ]]; then
  pm2 delete "$ACTIVE_PROCESS" >/dev/null 2>&1 || log "Previous PM2 process requires manual cleanup"
fi
pm2 save >/dev/null || log "PM2 state requires a manual 'pm2 save'"

log "Active state: $STATE_FILE"
