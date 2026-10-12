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
- Review the public API, README, changelog, license, and package metadata.
- Create and push the signed `v0.1.0-alpha.0` tag.
- Manually dispatch the `Publish alpha` workflow from `main`, entering that tag
  as the `release_tag` input and leaving `operation` set to `publish-alpha`.
  The workflow verifies that the checked-out commit and package version match
  the requested tag before publishing.
- On the first package publish, check whether npm also created `latest`. If it
  did, immediately rerun the workflow with `operation` set to `remove-latest`.
  This removes only the distribution tag; it does not delete the alpha version.
- Confirm `npm view cachekind@alpha` reports the expected version, dependencies,
  and files.
- Configure npm trusted publishing for repository
  `jessica-velasco/cachekind`, workflow `release.yml`, environment `npm`, with
  the **Allow npm publish** and **Allow npm dist-tag** permissions. Then remove
  and revoke the bootstrap token. The workflow uses `id-token: write` for
  short-lived OIDC authentication and does not expose `NODE_AUTH_TOKEN`. Keep
  the workflow on npm 12.2.0 or newer because older clients cannot use trusted
  publishing for dist-tag operations.

The workflow accepts only a `v*` release tag, verifies that its commit and
package version match, and publishes with the `alpha` distribution tag. It must
not publish an alpha as `latest`. The package's `prepublishOnly` gate also
refuses publication unless npm receives an explicit `--tag alpha`; do not
bypass lifecycle scripts when publishing. Bootstrap publication may need a
short-lived `NPM_TOKEN` before the package exists. Once the package exists,
configure trusted publishing and remove the bootstrap token.

This repository is private, so npm cannot verify GitHub Actions provenance for
it. The bootstrap publish therefore passes `--provenance=false` to override the
tagged package's `publishConfig.provenance` setting. If the repository is made
public later, provenance can be restored alongside trusted publishing.

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

Never reuse or overwrite a published npm version.
