#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${SOURCE_DIR:-/opt/hulim}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/hulim-deploy}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/hulim}"
UPSTREAM_INCLUDE="${UPSTREAM_INCLUDE:-/etc/nginx/conf.d/hulim-upstream.inc}"
CURRENT_PORT="${CURRENT_PORT:-3000}"
CURRENT_PROCESS="${CURRENT_PROCESS:-hulim}"
STATE_FILE="$DEPLOY_ROOT/active.env"
BACKUP_DIR="/var/backups/hulim-nginx"

log() {
  printf '[setup] %s\n' "$*"
}

die() {
  printf '[setup] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

write_initial_state() {
  local revision state_tmp
  revision="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"
  state_tmp="$(mktemp "$DEPLOY_ROOT/.active.XXXXXX")"
  {
    printf 'ACTIVE_PORT=%q\n' "$CURRENT_PORT"
    printf 'ACTIVE_PROCESS=%q\n' "$CURRENT_PROCESS"
    printf 'ACTIVE_RELEASE=%q\n' "$SOURCE_DIR"
    printf 'ACTIVE_REVISION=%q\n' "$revision"
  } > "$state_tmp"
  chmod 600 "$state_tmp"
  mv -f "$state_tmp" "$STATE_FILE"
}

[[ "$EUID" -eq 0 ]] || die "Run as root"
for command_name in nginx systemctl pm2 git openssl grep sed mktemp install; do
  require_command "$command_name"
done

[[ "$SOURCE_DIR" == /* && "$DEPLOY_ROOT" == /* ]] || die "Deployment paths must be absolute"
[[ "$UPSTREAM_INCLUDE" == /* && "$NGINX_SITE" == /* ]] || die "Nginx paths must be absolute"
[[ -d "$SOURCE_DIR/.git" ]] || die "Git repository not found at $SOURCE_DIR"
[[ -f "$SOURCE_DIR/.env" ]] || die "Existing .env not found at $SOURCE_DIR/.env"
[[ -f "$SOURCE_DIR/prisma/prod.db" ]] || die "Production database not found"
[[ -d "$SOURCE_DIR/public/uploads" ]] || die "Upload directory not found"
[[ -f "$NGINX_SITE" ]] || die "Nginx site not found at $NGINX_SITE"
[[ "$(pm2 pid "$CURRENT_PROCESS" | tr -d '[:space:]')" =~ ^[1-9][0-9]*$ ]] || die "PM2 process $CURRENT_PROCESS is not online"

install -d -m 700 "$DEPLOY_ROOT"
install -d -m 700 "$DEPLOY_ROOT/releases"
install -d -m 700 "$BACKUP_DIR"

if ! grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' "$SOURCE_DIR/.env"; then
  log "Adding one persistent Server Actions encryption key to the existing .env"
  umask 077
  printf '\nNEXT_SERVER_ACTIONS_ENCRYPTION_KEY="%s"\n' "$(openssl rand -base64 32)" >> "$SOURCE_DIR/.env"
fi

include_directive="include $UPSTREAM_INCLUDE;"
if grep -Fq "$include_directive" "$NGINX_SITE"; then
  [[ -f "$UPSTREAM_INCLUDE" ]] || die "Nginx include is configured but missing"
  log "Nginx blue-green include is already configured"
else
  proxy_count="$(grep -Ec '^[[:space:]]*proxy_pass[[:space:]]+http://(localhost|127\.0\.0\.1):3000;[[:space:]]*$' "$NGINX_SITE" || true)"
  [[ "$proxy_count" == "1" ]] || die "Expected exactly one localhost:3000 proxy_pass; found $proxy_count"

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="$BACKUP_DIR/hulim.$timestamp.conf"
  cp -a "$NGINX_SITE" "$backup"

  include_tmp="$(mktemp "$(dirname "$UPSTREAM_INCLUDE")/.hulim-upstream.XXXXXX")"
  printf 'proxy_pass http://127.0.0.1:%s;\n' "$CURRENT_PORT" > "$include_tmp"
  chmod 644 "$include_tmp"
  mv -f "$include_tmp" "$UPSTREAM_INCLUDE"

  site_tmp="$(mktemp "$(dirname "$NGINX_SITE")/.hulim-site.XXXXXX")"
  sed -E "s#^[[:space:]]*proxy_pass[[:space:]]+http://(localhost|127\\.0\\.0\\.1):3000;[[:space:]]*$#        include $UPSTREAM_INCLUDE;#" "$NGINX_SITE" > "$site_tmp"
  chmod --reference="$NGINX_SITE" "$site_tmp"
  chown --reference="$NGINX_SITE" "$site_tmp"
  mv -f "$site_tmp" "$NGINX_SITE"

  if ! nginx -t; then
    cp -a "$backup" "$NGINX_SITE"
    nginx -t || true
    die "Nginx validation failed; original site configuration restored"
  fi
  systemctl reload nginx
  log "Nginx now reads its application port from $UPSTREAM_INCLUDE"
fi

nginx -t
[[ -f "$STATE_FILE" ]] || write_initial_state

install -m 0755 "$SOURCE_DIR/scripts/blue-green-deploy.sh" /usr/local/sbin/hulim-deploy

log "Blue-green deployment is ready"
log "Future code-only deployments: hulim-deploy"
