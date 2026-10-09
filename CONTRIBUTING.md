# Contributing to Cachekind

Cachekind is in early development. Bug reports, contract observations from real self-hosted Next.js deployments, and focused pull requests are welcome.

## Development setup

Requirements:

- Node.js 20.9 or newer
- npm 11 or newer

```sh
npm install
npm run check
npm run verify:probe
```

`npm run check` builds the root package, type-checks the public configuration examples, and runs unit tests. `npm run verify:probe` builds Next.js and briefly starts its standalone output to verify the runtime cache contract.

## Pull requests

- Keep Redis optional: importing or configuring disabled Cachekind must not open a connection.
- Treat Redis failures as cache misses on the request path.
- Do not introduce Redis `CONFIG` commands or keyspace-notification requirements.
- Add regression coverage for every behavior change.
- Update `docs/NEXTJS-CONTRACT.md` when an observed Next.js shape changes.
- Avoid adding a runtime dependency when a small, testable implementation is practical.

## Commit and release expectations

Use focused commits and describe observable behavior rather than implementation
mechanics. Commit subjects follow
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>[optional scope]: <description>
```

Use `feat` for new behavior and `fix` for bug fixes. Types such as `docs`,
`test`, `refactor`, `build`, `ci`, and `chore` may be used when they describe
the change more accurately. Mark breaking changes with `!` or a
`BREAKING CHANGE:` footer.

Releases will follow semantic versioning once the first public API is ready.
