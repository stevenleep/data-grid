# Security Policy

## Supported versions

Security fixes are applied to the latest published minor line. Before the first npm release, the
current `main` branch is the only maintained code line. Older GitHub release artifacts should not
be treated as supported once a newer release is available.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository:

https://github.com/stevenleep/data-grid/security/advisories/new

Do not open a public issue for an undisclosed vulnerability. Include the affected version or
commit, reproduction steps, expected impact, and any suggested mitigation. Maintainers will use
the private advisory to coordinate validation, remediation, and disclosure.

For ordinary correctness bugs that do not create a security or privacy impact, use the public
issue tracker instead.

## Data and integration boundaries

This package runs in the consuming application and does not provide authorization by itself.
Applications must enforce row, field, action, export, and shared-view permissions on the server.
Do not persist secrets or sensitive filter values in browser storage.
