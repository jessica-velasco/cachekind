# Releasing

The repository is prepared as `0.1.0-alpha.0`. Publishing and production
validation are intentionally separate from implementation work.

## Alpha checklist

- Confirm the `cachekind` npm name is still available.
- Confirm the GitHub `npm` environment has the desired reviewers.
- Bootstrap the unpublished package with a short-lived granular npm token from
  the tagged GitHub Actions workflow. npm cannot configure a trusted publisher
  until the package exists.
- Run the full CI matrix on the exact commit.
- Review `npm pack --dry-run`; cached values, credentials, fixtures, and build
  secrets must not appear in the tarball.
- Review the public API, README, changelog, license, security policy, and
  package metadata.
- Create and push the signed `v0.1.0-alpha.0` tag.
- Manually dispatch the `Publish alpha` workflow from that tag.
- Confirm `npm view cachekind@alpha` reports the expected version, dependencies,
  provenance, and files.
- Configure npm trusted publishing for repository
  `jessica-velasco/cachekind`, workflow `release.yml`, environment `npm`, with
  publish permission. Then remove and revoke the bootstrap token, remove the
  `NODE_AUTH_TOKEN` environment variable from the workflow, and keep
  `id-token: write` for trusted publishing and provenance.

The workflow runs only when manually dispatched from a `v*` tag and publishes
with the `alpha` distribution tag. It must not publish an alpha as `latest`. The
first run needs `NPM_TOKEN` configured for the `npm` GitHub environment and
exposed to the publish step as `NODE_AUTH_TOKEN`. The workflow also needs
`id-token: write` to generate npm provenance. After trusted publishing is
configured, remove token use and keep the OIDC permission.

## Real deployment validation

Use one non-critical, representative Next.js service with at least two runtime
instances and a managed Redis 7.2-or-newer endpoint. Keep pages and routes
disabled initially.

Validate:

- shared FETCH hits across instances;
- tag and path invalidation across instances;
- one rolling deployment with old and new build IDs alive together;
- Redis latency and connection count under representative load;
- Redis restart or failover without unbounded request delay;
- warnings and error reporting reach the production observability system;
- rollback to the previous handler is understood and tested.

Record the Cachekind version, Next.js version, Redis product/version, topology,
TLS mode, instance count, traffic window, observed latency, failures, and any
configuration changes. Do not promote the API based only on the contract-probe
application.

## Moving toward 1.0.0

Version `0.x` communicates that the public API may still change. Use additional
alpha versions while basic behavior or architecture is still changing, then
beta versions once the intended feature set is substantially present and needs
broader deployment feedback. A `1.0.0` release should come only after the
public API and operational behavior have survived representative deployments.

When the project is ready for `1.0.0`:

1. Change the version to `1.0.0` and move the changelog entry.
2. Run the complete CI and deployment smoke test again.
3. Tag `v1.0.0`.
4. Publish with the `latest` distribution tag using a reviewed release workflow.
5. Update the security policy's supported-version table.

Never reuse or overwrite a published npm version.
