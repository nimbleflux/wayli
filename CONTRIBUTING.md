# Contributing to Wayli

Thank you for your interest in contributing! Please follow these guidelines to help us maintain a high-quality project.

## How to Contribute

- **File an Issue:** Use GitHub Issues for bugs, feature requests, or questions.
- **Fork the Repo:** Create your own fork and branch from `main`.
- **Write Code:** Follow our code style and add tests where possible.
- **Submit a Pull Request:** Open a PR with a clear description. Reference related issues.
- **Code Review:** All PRs are reviewed by maintainers. Please respond to feedback promptly.

## Code Style

- Use Prettier and ESLint (see `.prettierrc` and `web/eslint.config.js`; oxlint also runs via `web/.oxlintrc.json`).
- Use TypeScript for all new code.
- Use `bun` (not npm/yarn/pnpm) for installs and scripts.
- Write clear, descriptive commit messages.

## Branching

- Use feature branches: `feature/your-feature`, `fix/your-bug`, etc.
- Keep PRs focused and small for easier review.

## Tests

- Add or update tests for your changes.
- Run `bun run test` (from `web/`) before submitting your PR.

## Community

- Be respectful and inclusive. See our [Code of Conduct](CODE_OF_CONDUCT.md).
