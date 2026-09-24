# Security Policy

## Supported Versions

Security fixes target the **latest minor release only** (currently `2.6.x`).
Older releases do not receive security updates.

Self-hosters should always run the latest release to pick up security fixes.

| Version        | Supported |
| -------------- | --------- |
| 2.6.x (latest) | Yes       |
| older releases | No        |

## Reporting a Vulnerability

We appreciate responsible disclosure.

**Please DO NOT create a public GitHub issue for security vulnerabilities.**

Report privately via GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab
2. Click **Report a vulnerability** (or "New draft security advisory")
3. Include:
   - **Description**: clear description of the vulnerability
   - **Steps to Reproduce**: detailed steps
   - **Impact**: potential impact on users and data
   - **Environment**: browser, OS, and version information
   - **Proof of Concept**: code or screenshots, if applicable
   - **Suggested Fix**: your recommendations, if any

## Response Timeline

We aim to:

- **Initial response**: within 2 weeks of receiving the report
- **Status updates**: as significant progress is made
- **Resolution**: as quickly as possible, coordinated with the reporter

## Disclosure Policy

- **Private disclosure**: initial report stays private
- **Coordinated disclosure**: we work with the reporter on a timeline
- **Public disclosure**: a security advisory is published once a fix ships
- **CVE assignment**: requested where appropriate

## Security Measures

- **Authentication**: Fluxbase Auth with 2FA support; device tokens are stored
  only as SHA-256 hashes
- **Authorization**: Row-level security policies; role assignment is decided
  server-side (server-side bootstrap RPC + insert clamps), never by client input
- **Input validation**: Zod schemas and per-item validation on ingest endpoints
- **Data minimization**: location data is processed client-side where possible

## Security Checklist for Contributors

- [ ] Follow secure coding practices
- [ ] Validate all user input
- [ ] Use parameterized queries
- [ ] Implement proper authentication
- [ ] Add security tests
- [ ] Review for common vulnerabilities
- [ ] Update dependencies regularly
