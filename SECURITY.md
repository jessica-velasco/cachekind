# Security policy

## Supported versions

Cachekind has not published its first release. Security fixes currently apply to the latest `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature on the Cachekind repository. Include affected versions or commits, reproduction steps, impact, and any suggested mitigation.

We aim to acknowledge a report within five business days and will coordinate disclosure after a fix is available.

## Security boundaries

Cachekind stores application-generated Next.js cache values. It is not an authorization boundary and must not be used to make personalized output cacheable. Redis credentials remain the application's responsibility and should be supplied at runtime through the hosting platform's secret management.

