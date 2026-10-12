# Zero-downtime deployment

This project uses a single Nginx endpoint, two alternating localhost ports, and
one active PM2 process. New releases are built in `/opt/hulim-deploy/releases`
while the previous release continues serving traffic.

The deployment preserves the existing files without printing their contents:

- `/opt/hulim/.env`
- `/opt/hulim/prisma/prisma/prod.db`
- `/opt/hulim/public/uploads`
- `/opt/hulim/storage/alley-detail`
- `/opt/hulim/storage/partner-import`

The shared `.env` must keep `DATABASE_URL="file:./prisma/prod.db"`. Prisma
resolves that SQLite path relative to `prisma/schema.prisma`, so every release
provides `prisma/prisma/prod.db` as a symbolic link to the production database
at `/opt/hulim/prisma/prisma/prod.db`.

Private alley detail images and partner-import draft photos are recovered from retained releases into the
shared storage directory before each deployment. Every new release links to
that directory, so later blue-green switches do not lose uploaded images.

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

Use the installed `hulim-deploy` command for incremental releases. The legacy
root-level `deploy.sh` bootstrap and local `.codex-recover.bat` helper are not
part of the release; do not use them to update an existing installation.

Releases are exported from a Git commit, so uncommitted and untracked changes
must be reviewed and committed before selecting the release revision. Local
`output/`, `.playwright-cli/`, and `.partner-import-check/` artifacts are excluded
from version control. The `entry-page/` source is a separate static project;
publishing the main application does not build or deploy that entry page.

```bash
hulim-deploy
```

The script fetches `origin/main`, builds a separate release, starts it on the
inactive port, checks the database-backed home page, switches Nginx atomically,
verifies the public HTTPS home page, then drains and removes the old PM2 process.

To deploy a reviewed commit other than `origin/main`:

```bash
hulim-deploy <commit-sha>
```

## Safety boundaries

- Existing `.env`, SQLite data, and uploads are shared, never recreated.
- Concurrent deployments are rejected with a file lock.
- The new release must pass the database-backed home-page health check before
  Nginx is changed. Any HTTP error, including 500, leaves Nginx on the previous
  release.
- Nginx validation or post-switch verification failure triggers rollback.
- Any Prisma migration change aborts blue-green deployment. Schema changes need
  a separately reviewed maintenance deployment because the old and new code
  briefly overlap.
- A reviewed, backward-compatible migration can be deployed with
  `ALLOW_DATABASE_MIGRATIONS=1 hulim-deploy <commit-sha>`. This explicit mode
  first runs `hulim-backup.service`, applies pending Prisma migrations against
  the shared database, and only switches Nginx after the new release passes its
  health checks. Never use it for a migration that breaks the currently active
  code.
- Old release directories are retained for manual recovery and are not deleted
  automatically.

Migration comparison uses the immutable Git commit recorded as `ACTIVE_REVISION`,
not files in the live checkout. Updating that checkout cannot hide newly added
migrations. If the recorded commit is unknown or missing, deployment stops;
verify the commit that produced the running application before correcting the
state. Do not replace the baseline with the latest checkout merely to proceed.

The migration-enabled sequence is dependency installation, Prisma Client
generation, migration of the shared database, then production build and health
checks. A failed build or application rollback does not undo database changes.
Once migration execution begins, failures print an explicit warning. Review the
migration status and pre-migration backup before any retry or restore; database
restoration remains a separate reviewed operation.

For the fixed team quota rollout, pause team-account creation, quota changes,
and team post submissions from before the quota snapshot migration until the
new application is serving and the old process has drained. The old code can
still change monthly allowances without writing `TeamPostQuotaEvent` records;
allowing those writes after the snapshot would leave gaps in quota history.
Keep this write pause in place if deployment fails after migrations. The deploy
script does not enforce this maintenance window or stop the live application;
arrange it explicitly for this release, and resume only after confirming the
version that will serve these operations.

Current state is stored at `/opt/hulim-deploy/active.env`. It contains only the
active port, PM2 process name, release path, and Git revision.
