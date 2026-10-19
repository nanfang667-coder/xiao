#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BASE=/root/hulim-migration
UNIT=hulim-hk-cutover.service

require_destination() {
  [[ "$EUID" -eq 0 && "$(hostname)" == hulim-hk ]]
  [[ -d "$BASE" ]]
}

migration_status() {
  require_destination
  systemctl show "$UNIT" -p LoadState -p ActiveState -p SubState -p Result || true
  systemctl is-active hulim-hk nginx || true
  if [[ -f "$BASE/NEW_PRIMARY" ]]; then
    printf 'NEW_PRIMARY_PRESENT\n'
    local run
    run=$(cat "$BASE/NEW_PRIMARY")
    case "$run" in "$BASE"/cutover.*) [[ ! -f "$run/status" ]] || cat "$run/status";; esac
  else
    printf 'NEW_PRIMARY_ABSENT\n'
  fi
  cat /etc/nginx/conf.d/hulim-upstream.inc
  # This file contains only this script's technical progress, never application logs.
  [[ ! -f "$BASE/cutover-run.log" ]] || tail -n 25 "$BASE/cutover-run.log"
}

render_upstream() {
  local mode=$1 readonly=$2
  [[ "$readonly" == yes || "$readonly" == no ]] || return 2
  if [[ "$readonly" == yes ]]; then
    printf '%s\n' 'if ($request_method !~ "^(GET|HEAD|OPTIONS)$") { return 503; }'
  fi
  if [[ "$mode" == local ]]; then
    printf '%s\n' 'proxy_pass http://127.0.0.1:3000;'
  elif [[ "$mode" == bridge ]]; then
    printf '%s\n' 'proxy_ssl_server_name on;' 'proxy_ssl_name $host;' \
      'proxy_ssl_verify on;' 'proxy_ssl_verify_depth 3;' \
      'proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;' \
      'proxy_pass https://140.235.96.155;'
  else
    return 2
  fi
}

validate_templates() {
  require_destination
  local directory mode readonly file
  directory=$(mktemp -d "$BASE/nginx-template-check.XXXXXXXX")
  for mode in local bridge; do
    for readonly in yes no; do
      file="$directory/$mode-$readonly.inc"
      render_upstream "$mode" "$readonly" > "$file"
      printf 'pid %s/test.pid;\nerror_log /dev/stderr;\nevents {}\nhttp { server { listen 127.0.0.1:19483; location / { include %s; proxy_set_header Host $host; } } }\n' "$directory" "$file" > "$directory/test.conf"
      nginx -t -q -c "$directory/test.conf" -p "$directory/"
    done
  done
  printf 'NGINX_TEMPLATE_VALIDATION_OK\n'
}

if [[ "${1:-}" == --status ]]; then
  migration_status
  exit 0
fi

if [[ "${1:-}" == --validate ]]; then
  validate_templates
  exit 0
fi

if [[ "${1:-}" == --start ]]; then
  require_destination
  exec 8> "$BASE/launcher.lock"
  flock -n 8
  if [[ -e "$BASE/NEW_PRIMARY" || "$(systemctl show "$UNIT" -p LoadState --value 2>/dev/null)" != not-found ]]; then
    migration_status
    printf 'Existing migration detected; refusing to repeat it.\n' >&2
    exit 1
  fi
  # Run the reviewed copy independently of this SSH session and future git pulls.
  staged=$(mktemp "$BASE/cutover-script.XXXXXXXX")
  install -m 700 -- "${BASH_SOURCE[0]}" "$staged"
  bash -n "$staged"
  bash "$staged" --self-test
  bash "$staged" --validate
  systemd-run --no-block --unit=hulim-hk-cutover \
    --property=Type=oneshot --property=RemainAfterExit=yes \
    --property=TimeoutStartSec=infinity \
    --property="StandardOutput=append:$BASE/cutover-run.log" \
    --property="StandardError=append:$BASE/cutover-run.log" \
    /bin/bash "$staged" --apply
  printf 'CUTOVER_STARTED: use --status to inspect progress. DNS is unchanged.\n'
  exit 0
fi

if [[ "${1:-}" == --render ]]; then
  [[ "$#" -eq 3 ]]
  render_upstream "$2" "$3"
  exit 0
fi

if [[ "${1:-}" == --self-test ]]; then
  [[ "$(render_upstream local no)" == 'proxy_pass http://127.0.0.1:3000;' ]]
  [[ "$(render_upstream local yes | wc -l)" -eq 2 ]]
  render_upstream bridge yes | grep -Fq 'proxy_ssl_verify on;'
  render_upstream bridge yes | grep -Fq 'proxy_ssl_name $host;'
  render_upstream bridge no | grep -Fq 'proxy_pass https://140.235.96.155;'
  ! render_upstream bridge no | grep -Fq 'return 503'
  if render_upstream invalid no; then exit 1; fi
  printf 'UPSTREAM_TEMPLATE_TESTS_OK\n'
  exit 0
fi

[[ "${1:-}" == --apply ]] || { printf 'Use --start, --status, --validate or --self-test\n'; exit 2; }
require_destination
UPSTREAM=/etc/nginx/conf.d/hulim-upstream.inc
DB=/opt/hulim/prisma/prisma/prod.db
SSH=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -i /root/.ssh/hulim-migration)
old() { ssh "${SSH[@]}" root@202.182.120.184 "$@"; }
log() { printf '[migration] %s\n' "$*"; }
local_upstream() {
  local readonly=$1 temporary
  temporary=$(mktemp /etc/nginx/conf.d/.hulim-upstream.XXXXXXXX) || return
  render_upstream local "$readonly" > "$temporary" || return
  chmod 644 "$temporary" || return
  mv -f -- "$temporary" "$UPSTREAM" || return
  nginx -t || return
  systemctl reload nginx || return
}
old_upstream() {
  local mode=$1 readonly=$2
  render_upstream "$mode" "$readonly" | old 'set -e; f=$(mktemp /etc/nginx/conf.d/.hulim-migration.XXXXXXXX); cat > "$f"; chmod 644 "$f"; mv -f -- "$f" /etc/nginx/conf.d/hulim-upstream.inc; nginx -t; systemctl reload nginx'
}
healthy_new() {
  local attempt code
  for attempt in $(seq 1 30); do
    code=$(curl --noproxy '*' --max-time 5 --silent --output /dev/null --write-out '%{http_code}' -H 'Host: fenglou1.com' http://127.0.0.1:3000/ || true)
    [[ "$code" == 200 ]] && return 0
    sleep 1
  done
  return 1
}
healthy_bridge() {
  old 'test "$(curl --noproxy "*" --resolve fenglou1.com:443:127.0.0.1 --max-time 15 --silent --output /dev/null --write-out "%{http_code}" https://fenglou1.com/)" = 200'
}
new_writes_paused() {
  [[ "$(curl --noproxy '*' --resolve fenglou1.com:443:127.0.0.1 --max-time 10 -sS -o /dev/null -w '%{http_code}' -X POST https://fenglou1.com/__hulim_migration_write_probe__)" == 503 ]]
}

[[ -d "$BASE" && -f "$DB" && ! -L "$DB" && -f "$UPSTREAM" ]]
[[ ! -e "$DB.next" ]]
exec 9> "$BASE/cutover.lock"
flock -n 9 || { log 'Another cutover is running'; exit 1; }
[[ ! -e "$BASE/NEW_PRIMARY" ]] || { log 'New server is already primary; refusing to replay'; exit 1; }
for command_name in ssh rsync scp sqlite3 python3 nginx systemctl curl flock install; do command -v "$command_name" >/dev/null; done
cmp -s "$UPSTREAM" <(render_upstream local no)
systemctl is-active --quiet hulim-hk
healthy_new
STATE=$(old 'set -e; test "$(hostname)" = forum; command -v pm2 >/dev/null; grep -E "^ACTIVE_(PORT|PROCESS|REVISION)=" /opt/hulim-deploy/active.env; cmp -s /etc/nginx/conf.d/hulim-upstream.inc <(printf "proxy_pass http://127.0.0.1:3000;\n")')
grep -Fxq 'ACTIVE_PORT=3000' <<< "$STATE"
grep -Fxq 'ACTIVE_PROCESS=hulim-298746e6388b' <<< "$STATE"
grep -Fxq 'ACTIVE_REVISION=298746e6388b4798489969e73351eeb2a63dc94c' <<< "$STATE"
cd /opt/hulim
git diff --quiet 298746e6388b4798489969e73351eeb2a63dc94c HEAD -- prisma/schema.prisma prisma/migrations
RUN=$(mktemp -d "$BASE/cutover.XXXXXXXX")
OLD_RUN="$RUN"
install -m 600 "$UPSTREAM" "$RUN/upstream.before"
COMMITTED=no
MUTATED=no
NEW_DB_REPLACED=no
OLD_STOPPED=no
rollback() {
  local status=$?
  trap - ERR
  log "Failure at script line ${1:-unknown}; exit status $status"
  if [[ "$COMMITTED" == yes ]]; then
    log "New server is primary. Do NOT restore the old database. Resume forwarding using $RUN."
    printf 'COMMITTED_NEEDS_ATTENTION\n' > "$RUN/status"
    exit "$status"
  fi
  if [[ "$MUTATED" == yes ]]; then
    log 'Failure before enabling writes; restoring original routing'
    if [[ "$NEW_DB_REPLACED" == yes ]]; then
      systemctl stop hulim-hk || true
      # Preserve all candidate files for recovery. Never remove a nonempty SQLite sidecar.
      if [[ ! -s "$DB-wal" && ! -s "$DB-journal" ]]; then
        mv -- "$DB" "$RUN/failed-candidate.db"
        install -m 600 "$RUN/new-before-final.db" "$DB"
      fi
    fi
    systemctl start hulim-hk || true
    if [[ "$OLD_STOPPED" == no ]] || old 'pm2 restart hulim-298746e6388b >/dev/null'; then
      sleep 3
      if old_upstream local no; then
        local_upstream no || log 'NEW_ROUTING_RESTORE_FAILED'
      else
        log 'OLD_ROUTING_RESTORE_FAILED: keep writes paused and use the saved old upstream file'
      fi
    else
      log 'OLD_PROCESS_RESTART_FAILED: keep writes paused and use the old console'
    fi
  fi
  printf 'FAILED_BEFORE_COMMIT\n' > "$RUN/status"
  exit "$status"
}
trap 'rollback "$LINENO"' ERR
trap 'false' TERM INT
old "install -d -m 700 '$OLD_RUN'; test ! -e '$OLD_RUN/upstream.before'; install -m 600 /etc/nginx/conf.d/hulim-upstream.inc '$OLD_RUN/upstream.before'"
log "Recovery directory: $RUN"
MUTATED=yes
local_upstream yes
old_upstream local yes
new_writes_paused
old 'test "$(curl --noproxy "*" --resolve fenglou1.com:443:127.0.0.1 --max-time 10 --silent --output /dev/null --write-out "%{http_code}" -X POST https://fenglou1.com/__hulim_migration_write_probe__)" = 503'
log 'Write pause enabled; browsing remains available'
old_upstream bridge yes
healthy_bridge
OLD_STOPPED=yes
old 'pm2 stop hulim-298746e6388b >/dev/null'
healthy_bridge
log 'Old application stopped after verified forwarding; creating final consistent snapshot'
old "python3 - '$OLD_RUN/source-final.db'" <<'PY'
import os, sqlite3, sys
p = sys.argv[1]
fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
os.close(fd)
source = sqlite3.connect('file:/opt/hulim/prisma/prisma/prod.db?mode=ro', uri=True, timeout=30)
target = sqlite3.connect(p)
source.backup(target, pages=256, sleep=0.1)
target.close()
source.close()
PY
scp -q -p "${SSH[@]}" "root@202.182.120.184:$OLD_RUN/source-final.db" "$RUN/source-final.db"
[[ "$(sqlite3 -readonly "$RUN/source-final.db" "SELECT name FROM sqlite_schema WHERE type='table' AND name='Order';")" == Order ]]
[[ "$(sqlite3 -readonly "$RUN/source-final.db" "SELECT count(*) FROM sqlite_schema m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table' AND lower(f.[table])='order';")" == 0 ]]
[[ "$(sqlite3 -readonly "$RUN/source-final.db" "SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND lower(tbl_name)='order';")" == 0 ]]
install -m 600 "$RUN/source-final.db" "$RUN/prepared-final.db"
sqlite3 -bail "$RUN/prepared-final.db" 'PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; BEGIN IMMEDIATE; DELETE FROM "Order"; COMMIT; VACUUM;' >/dev/null
[[ "$(sqlite3 -readonly "$RUN/prepared-final.db" 'PRAGMA quick_check;')" == ok ]]
for folder in public/uploads storage/alley-detail storage/partner-import; do
  rsync -a --timeout=120 --stats -e 'ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -i /root/.ssh/hulim-migration' "root@202.182.120.184:/opt/hulim/$folder/" "/opt/hulim/$folder/" | tail -n 4
done
log 'Final media sync complete; installing the final order-free database'
systemctl stop hulim-hk
sqlite3 "$DB" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
[[ ! -e "$DB-wal" && ! -e "$DB-journal" ]]
install -m 600 "$DB" "$RUN/new-before-final.db"
install -m 600 "$RUN/prepared-final.db" "$DB.next"
NEW_DB_REPLACED=yes
mv -f -- "$DB.next" "$DB"
systemctl start hulim-hk
healthy_new
healthy_bridge
log 'Final snapshot is serving successfully; enabling writes on the new primary'
# From this point, never restore old routing: new writes may have been accepted.
COMMITTED=yes
printf '%s\n' "$RUN" > "$BASE/NEW_PRIMARY"
printf 'NEW_PRIMARY\n' > "$RUN/status"
local_upstream no
old_upstream bridge no
healthy_new
healthy_bridge
old 'pm2 save --force >/dev/null'
printf 'CUTOVER_OK\n' > "$RUN/status"
log 'CUTOVER_OK: new server is primary; old server forwards using verified HTTPS; DNS is unchanged'
