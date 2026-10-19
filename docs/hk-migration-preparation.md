# Hong Kong migration preparation

The existing server is `202.182.120.184`; the new server is
`140.235.96.155`. Keep the old server serving traffic and leave DNS unchanged
until the new installation and final data synchronization have been verified.

## Dependency repair

- Pin Next.js and its ESLint configuration to `16.4.2`.
- Pin sharp to `0.35.5`, including its updated native image libraries.
- Keep Prisma and its client on the existing 6.x release line. Scope a
  `deepmerge-ts: 8.0.0` override to `@prisma/config` to address
  [CVE-2026-40345](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
  Version 8 changes Map merging; the Prisma configuration loader was exercised
  separately with synthetic schema and migration paths.
- Refresh compatible transitive patches in the lockfile.
- Use sharp's named `SharpOptions` type. Upload normalization, size limits,
  filenames and validation behavior remain unchanged.
- Exclude upload-cleanup filesystem paths from Turbopack's build-time tracing;
  uploaded images are runtime data in shared storage, not bundled source assets.

The revised lockfile's production dependency audit reports zero vulnerabilities.
The full audit still reports five high-severity entries in the development-only
ESLint dependency chain (`braces`, `micromatch`, `fast-glob`,
`@next/eslint-plugin-next`, `eslint-config-next`). Do not accept the audit tool's
suggested downgrade to ESLint configuration 14 or use `audit fix --force`.
Recheck advisories when preparing the final release.

## Verification boundaries

Use a separate source checkout without `.env`, databases, uploads or private
storage. Set `DATABASE_URL` to a newly created, empty verification SQLite file.
Prisma schema validation, client generation, schema creation, configuration
loading, image/bcrypt smoke checks, targeted lint, TypeScript checking, the
existing offline tests and the production build are checked there. A fresh
verification checkout needs an empty `.partner-import-check` directory for an
existing SQLite URI test fixture.

## Migration work still required

The dependency repair does not transfer production data, remove orders, change
membership behavior, publish DNS or switch traffic. Transfer the old server's
configuration and persistent storage securely without printing secrets. Confirm
its active release and schema before applying any database changes: the recorded
historical migration chain cannot safely be replayed from scratch.

Exclude historical orders only in the destination data copy, after reviewing
foreign keys and dependent records. Preserve user accounts, content, pictures,
necessary configuration and the existing behavior of `fenglou1.com`,
`fenglou2.com`, `gp77.top`, `sjeeqw.fit` and `zollot.world`, including any redirects
and channel assignments. Membership entitlement preservation is not required;
this does not authorize redesigning the membership features.

Before switching DNS, verify the new site against the migrated copy, configure
the required HTTPS certificates, and arrange a short write pause for final
synchronization. Keep the old server available during DNS propagation, with
writes controlled so that old and new databases cannot diverge.

## Prepared installation and final cutover

The new installation has been built and started under `hulim-hk.service`.
The first media transfer, order-free database copy and Nginx/TLS installation
have completed. Local HTTPS and the old server's requests to the new IP passed
for all five domains; root and `www` redirects matched the existing behavior.
These checks do not establish that the final data sync or DNS change has run.

`scripts/migrate-hk-cutover.sh` is a one-use operational helper for these exact
hosts, paths, old release and service names. It does not read application `.env`
files, print business records, change DNS or contact payment/certificate APIs.
Run it from the existing root SSH session on `hulim-hk`, after pulling this
branch into `/opt/hulim`:

```bash
bash /opt/hulim/scripts/migrate-hk-cutover.sh --start
bash /opt/hulim/scripts/migrate-hk-cutover.sh --status
```

The launcher validates all four Nginx upstream templates without reloading the
live configuration. It starts an immutable script copy as a background systemd
unit, so an SSH disconnect does not interrupt the migration. Its start timeout
is explicitly `infinity`: a D-Bus timeout of zero terminates the unit immediately.
An existing unit or primary marker prevents replay. The script pauses non-read HTTP methods,
switches the old server to verified HTTPS forwarding and stops its application
before taking a final SQLite backup. It clears only `Order` in the destination
copy, checks its integrity, synchronizes the three media directories without
deleting destination files, and restarts the new application on the final copy.
Public read requests may still update analytics during the temporary pause;
the pause is not a guarantee that all analytics events are preserved.

Before reopening writes, a failure attempts to restore the original routing
and database. If the old application cannot restart, writes remain paused.
After the new primary marker is committed, a failure never restores the old
primary: inspect the technical status and repair forwarding before proceeding.
Do not remove the marker or rerun `--apply` to bypass this protection.
Private recovery copies remain in `/root/hulim-migration/cutover.*` on both
servers; they include source data and must not be published or inspected as
part of routine verification.

Completion is reported as `CUTOVER_OK`. DNS remains unchanged, and the old
server must remain available as a forwarding bridge until DNS propagation has
been checked. Certificate renewal scheduling and final DNS records still need
verification after the backend cutover. Do not cancel the old VPS yet.

Offline verification for the helper: Bash syntax and template self-checks,
launcher refusal on invalid Nginx configuration or an existing primary marker,
and recovery behavior before/after commit. All fixtures use synthetic temporary
files and mocked services; no live application data is queried by these tests.
