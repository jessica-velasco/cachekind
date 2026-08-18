# Changelog

All notable changes to Cachekind are documented here. The project follows
[Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) structure.

## [0.1.0-alpha.0] - 2026-08-18

### Added

- Next.js 16.2 incremental cache support for `FETCH`, `APP_PAGE`, and
  `APP_ROUTE`.
- Safe FETCH-only defaults with explicit page and route opt-in.
- Binary-safe, TTL-bound Redis entries and timestamp-based tag invalidation.
- Build-scoped keys, bounded value sizes, operation timeouts, a circuit breaker,
  and automatic Redis recovery.
- Cachekind-owned URL mode and an application-owned transport interface.
- Production standalone, two-instance, Redis 7.2/7.4, TLS, and failure-mode
  verification.

[0.1.0-alpha.0]: https://github.com/jessica-velasco/cachekind/releases/tag/v0.1.0-alpha.0
