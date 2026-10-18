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
