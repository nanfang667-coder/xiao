# Zero-downtime deployment

This project uses a single Nginx endpoint, two alternating localhost ports, and
one active PM2 process. New releases are built in `/opt/hulim-deploy/releases`
while the previous release continues serving traffic.

The deployment preserves the existing files without printing their contents:

- `/opt/hulim/.env`
- `/opt/hulim/prisma/prod.db`
- `/opt/hulim/public/uploads`

## One-time setup

After pulling the commit that adds these scripts, run on the server:

```bash
cd /opt/hulim
bash scripts/setup-blue-green.sh
```

The setup script:

1. backs up `/etc/nginx/sites-enabled/hulim` under `/var/backups/hulim-nginx`;
2. replaces the fixed `proxy_pass` with a small include file;
3. validates and reloads Nginx;
4. adds a persistent Server Actions encryption key only when missing;
5. installs `/usr/local/sbin/hulim-deploy`.

The currently running `hulim` process remains on port 3000 during setup.

## Future deployments

```bash
hulim-deploy
```

The script fetches `origin/main`, builds a separate release, starts it on the
inactive port, checks `/robots.txt`, switches Nginx atomically, verifies HTTPS,
then drains and removes the old PM2 process.

To deploy a reviewed commit other than `origin/main`:

```bash
hulim-deploy <commit-sha>
```

## Safety boundaries

- Existing `.env`, SQLite data, and uploads are shared, never recreated.
- Concurrent deployments are rejected with a file lock.
- A failed health check leaves Nginx on the previous release.
- Nginx validation or post-switch verification failure triggers rollback.
- Any Prisma migration change aborts blue-green deployment. Schema changes need
  a separately reviewed maintenance deployment because the old and new code
  briefly overlap.
- Old release directories are retained for manual recovery and are not deleted
  automatically.

Current state is stored at `/opt/hulim-deploy/active.env`. It contains only the
active port, PM2 process name, release path, and Git revision.
