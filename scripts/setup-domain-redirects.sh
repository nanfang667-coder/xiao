#!/usr/bin/env bash
set -Eeuo pipefail

NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/hulim}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hulim-nginx}"
UPSTREAM_INCLUDE="${UPSTREAM_INCLUDE:-/etc/nginx/conf.d/hulim-upstream.inc}"
CERTIFICATE="${CERTIFICATE:-/etc/letsencrypt/live/fenglou1.com/fullchain.pem}"
CERTIFICATE_KEY="${CERTIFICATE_KEY:-/etc/letsencrypt/live/fenglou1.com/privkey.pem}"
SSL_OPTIONS="${SSL_OPTIONS:-/etc/letsencrypt/options-ssl-nginx.conf}"
SSL_DHPARAM="${SSL_DHPARAM:-/etc/letsencrypt/ssl-dhparams.pem}"

SITE_TMP=""
BACKUP=""
CONFIG_CHANGED=0
SUCCEEDED=0

log() {
  printf '[redirects] %s\n' "$*"
}

die() {
  printf '[redirects] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

cleanup() {
  local exit_code=$?

  if [[ "$SUCCEEDED" -ne 1 && "$CONFIG_CHANGED" -eq 1 && -f "$BACKUP" ]]; then
    log "Restoring the previous Nginx configuration"
    cp -a "$BACKUP" "$NGINX_SITE"
    if nginx -t; then
      systemctl reload nginx || true
    fi
  fi

  [[ -z "$SITE_TMP" || ! -f "$SITE_TMP" ]] || rm -f -- "$SITE_TMP"
  exit "$exit_code"
}

check_redirect() {
  local host="$1" path="$2" result=""
  for _ in $(seq 1 10); do
    result="$(
      curl --noproxy '*' --silent --show-error --max-time 15 \
        --resolve "$host:443:127.0.0.1" \
        --output /dev/null \
        --write-out '%{http_code} %{redirect_url}' \
        "https://$host$path"
    )"
    [[ "$result" == "301 https://fenglou1.com$path" ]] && return
    sleep 1
  done
  die "Unexpected redirect for $host$path: $result"
}

trap cleanup EXIT

[[ "$EUID" -eq 0 ]] || die "Run as root"
for command_name in nginx systemctl curl readlink mktemp install cp rm date cat chmod chown mv dirname seq sleep; do
  require_command "$command_name"
done

[[ "$NGINX_SITE" == /* && "$BACKUP_DIR" == /* ]] || die "Nginx paths must be absolute"
[[ -f "$NGINX_SITE" ]] || die "Nginx site not found at $NGINX_SITE"
NGINX_SITE="$(readlink -f -- "$NGINX_SITE")"
[[ -n "$NGINX_SITE" && -f "$NGINX_SITE" ]] || die "Could not resolve the Nginx site file"

for required_file in "$UPSTREAM_INCLUDE" "$CERTIFICATE" "$CERTIFICATE_KEY" "$SSL_OPTIONS" "$SSL_DHPARAM"; do
  [[ -f "$required_file" ]] || die "Required file not found: $required_file"
done

install -d -m 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/domain-redirect-before-$(date -u +%Y%m%dT%H%M%SZ).conf"
cp -a "$NGINX_SITE" "$BACKUP"
log "Backup created at $BACKUP"

SITE_TMP="$(mktemp "$(dirname "$NGINX_SITE")/.hulim-domain-redirect.XXXXXX")"
cat > "$SITE_TMP" <<'NGINX'
server {
    server_name fenglou1.com;
    client_max_body_size 20m;

    location /uploads/ {
        alias /opt/hulim/public/uploads/;
    }

    location / {
        include /etc/nginx/conf.d/hulim-upstream.inc;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/fenglou1.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fenglou1.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    listen 443 ssl;
    server_name www.fenglou1.com gp77.top www.gp77.top;

    ssl_certificate /etc/letsencrypt/live/fenglou1.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fenglou1.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    return 301 https://fenglou1.com$request_uri;
}

server {
    listen 80;
    server_name fenglou1.com www.fenglou1.com gp77.top www.gp77.top;
    return 301 https://fenglou1.com$request_uri;
}
NGINX

chmod --reference="$NGINX_SITE" "$SITE_TMP"
chown --reference="$NGINX_SITE" "$SITE_TMP"
mv -f "$SITE_TMP" "$NGINX_SITE"
SITE_TMP=""
CONFIG_CHANGED=1

nginx -t
systemctl reload nginx

main_status="$(
  curl --noproxy '*' --silent --show-error --max-time 15 \
    --resolve 'fenglou1.com:443:127.0.0.1' \
    --output /dev/null \
    --write-out '%{http_code}' \
    'https://fenglou1.com/robots.txt'
)"
[[ "$main_status" == "200" ]] || die "Main domain health check returned $main_status"

check_redirect 'gp77.top' '/'
check_redirect 'gp77.top' '/fenglou'
check_redirect 'www.gp77.top' '/'
check_redirect 'www.fenglou1.com' '/'

SUCCEEDED=1
log "Canonical domain redirects are active"
log "Only https://fenglou1.com serves application content"
