# Contributing to Wayli

Thank you for your interest in contributing to Wayli! This guide will help you get started with development and ensure your contributions meet our standards.

## 🚀 Quick Start

### Prerequisites

- **Bun** - [Install here](https://bun.sh/) (the package manager Wayli standardizes on)
- **Git** - [Download here](https://git-scm.com/)
- **Fluxbase** - [Get started here](https://fluxbase.eu/)
- **Code Editor** - We recommend VS Code with the Svelte extension

### Development Setup

1. **Fork and Clone**

   ```bash
   git clone https://github.com/nimbleflux/wayli.git
   cd wayli/web
   ```

2. **Install Dependencies**

   ```bash
   bun install
   ```

3. **Environment Setup**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your Fluxbase credentials:

   ```env
   FLUXBASE_PUBLIC_BASE_URL=your_FLUXBASE_BASE_URL
   PUBLIC_FLUXBASE_ANON_KEY=your_fluxbase_anon_key
   FLUXBASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

4. **Database Setup**

   The schema is declarative — it lives in `fluxbase/schema/public.sql` and is
   reconciled by `fluxbase schema sync`. There is no `fluxbase db reset`.
   Start a Fluxbase + Postgres stack (see the
   [Docker Compose quick start](../README.md#quick-start)), then sync all
   resources:

   ```bash
   bun run sync:all
   ```

5. **Start Development Server**

   ```bash
   bun run dev
   ```

6. **Run Tests**
   ```bash
   bun run test
   ```

## 📋 Development Workflow

### 1. Issue Creation

Before starting work, create or find an issue that describes the problem or feature:

- **Bug Reports**: Include steps to reproduce, expected vs actual behavior
- **Feature Requests**: Describe the use case and expected functionality
- **Enhancements**: Explain the improvement and its benefits

### 2. Branch Strategy

Create a feature branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

**Branch Naming Conventions:**

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test improvements
- `chore/` - Maintenance tasks

### 3. Development Guidelines

#### Code Style

- **TypeScript**: Use strict mode, avoid `any` types
- **Formatting**: Use Prettier (configured in project)
- **Linting**: Follow the flat ESLint config (`web/eslint.config.js`) plus oxlint (`.oxlintrc.json`)
- **Naming**: Use descriptive names, follow established conventions

#### File Organization

```
src/
├── lib/
│   ├── accessibility/       # Accessibility utilities
│   ├── components/          # Reusable UI components
│   ├── core/
│   │   └── config/          # Environment configuration docs (README.md)
│   ├── rules/               # Trip/transport detection rules
│   ├── schemas/             # Zod validation schemas
│   ├── services/            # Business logic services
│   ├── stores/              # Svelte stores
│   ├── types/               # TypeScript types
│   └── utils/
│       └── api/             # API utilities and patterns
├── shared/                  # Shared config, environment, and types
├── routes/
│   ├── (user)/              # Protected user routes
│   ├── api/                 # API endpoints (link-preview only; not served in production)
│   └── auth/                # Auth routes
└── static/                  # Static assets
```

#### API Development

Wayli is client-side first — data access goes through the Fluxbase client SDK
with RLS. New server logic belongs in Fluxbase RPCs, jobs, or edge functions,
not SvelteKit API routes. For the routes that do exist, use the shared
utilities:

```typescript
// Response utilities ($lib/utils/api/response)
import { successResponse, errorResponse } from '$lib/utils/api/response';
return successResponse(data, 200);

// Validation schemas ($lib/utils/api/schemas)
import { paginationSchema } from '$lib/utils/api/schemas';
```

#### Component Development

Follow accessibility-first development (Svelte 5 runes):

```svelte
<script lang="ts">
	// Svelte action: makes any element behave like an accessible button
	let menuOpen = $state(false);
</script>

<div use:useAriaButton={{ label: 'Open menu' }} onclick={() => (menuOpen = !menuOpen)}>Menu</div>
```

### 4. Testing Requirements

#### Test Coverage Goals

Thresholds are advisory goals — CI runs coverage report-only.

- **Total Coverage**: 85%+
- **Business Logic**: 90%+
- **API Layer**: 85%+
- **Components**: 80%+
- **Accessibility**: 100%

#### Writing Tests

```typescript
// Unit test example
import { describe, it, expect, beforeEach } from 'vitest';
import { UserProfileService } from '$lib/services/user-profile.service';

describe('UserProfileService', () => {
	let service: UserProfileService;

	beforeEach(() => {
		service = new UserProfileService(mockFluxbaseClient);
	});

	it('should create user profile successfully', async () => {
		// Arrange
		const userData = { name: 'Test User', email: 'test@example.com' };

		// Act
		const result = await service.createProfile(userData);

		// Assert
		expect(result.success).toBe(true);
		expect(result.data.name).toBe('Test User');
	});
});
```

#### Running Tests

```bash
# Run all tests
bun run test

# Run with coverage
bun run test:coverage

# Run specific test categories
bun run test:unit                            # Unit tests
bun run test:accessibility                   # Accessibility tests (ARIA button)
bun run test:integration                     # Integration tests
bun run test:e2e                             # E2E tests (Playwright)
```

### 5. Accessibility Requirements

All contributions must meet WCAG 2.1 AA standards:

- **Keyboard Navigation**: All interactive elements must be keyboard accessible
- **Screen Reader Support**: Proper ARIA attributes and semantic HTML
- **Color Contrast**: Minimum 4.5:1 ratio for normal text
- **Focus Management**: Visible focus indicators and logical tab order

Use the accessibility utilities:

```typescript
import { useAriaButton } from '$lib/accessibility/aria-button';
import { ariaHelpers } from '$lib/accessibility/accessibility-utils';
```

### 6. Environment Configuration

Wayli is a client-side SvelteKit app — all server-side work is handled by
Fluxbase. Configuration entry points:

```typescript
// Client runtime configuration
import { config } from '$lib/config';

// Environment configuration
// src/lib/environment.ts, src/shared/environment.ts,
// src/shared/config/environment.ts
```

**⚠️ Security Rule**: Never import `$env/static/private` in client-side code!
Role assignment is decided server-side (the `user_roles` INSERT clamp plus the
`ensure_user_profile` RPC bootstrap the first user as admin) — never trust
client-sent roles.

## 🔄 Pull Request Process

### 1. Pre-PR Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass (`bun run test`)
- [ ] Coverage checked (`bun run test:coverage`)
- [ ] Accessibility tests pass (`bun run test:accessibility`)
- [ ] No TypeScript errors (`bun run check`)
- [ ] No linting errors (`bun run lint`)
- [ ] Documentation updated if needed

### 2. PR Description Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Accessibility tests pass
- [ ] Manual testing completed

## Screenshots (if applicable)

Add screenshots for UI changes

## Checklist

- [ ] Code follows project style
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No console errors
- [ ] Accessibility requirements met
```

### 3. Review Process

1. **Automated Checks**: CI/CD pipeline runs tests and linting
2. **Code Review**: Maintainers review for:
   - Code quality and style
   - Security considerations
   - Performance impact
   - Accessibility compliance
   - Test coverage
3. **Approval**: At least one maintainer approval required
4. **Merge**: PR merged to `main` branch

## 🐛 Bug Reports

When reporting bugs, include:

1. **Environment**: OS, browser, Bun version
2. **Steps to Reproduce**: Clear, numbered steps
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Screenshots/Logs**: Visual evidence if applicable
6. **Additional Context**: Any relevant information

## 💡 Feature Requests

When requesting features, include:

1. **Use Case**: Why this feature is needed
2. **Proposed Solution**: How it should work
3. **Alternatives Considered**: Other approaches
4. **Mockups/Wireframes**: Visual examples if applicable
5. **Impact**: Who benefits and how

## 🏷️ Issue Labels

We use the following labels to organize issues:

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Improvements or additions to documentation
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention is needed
- `priority: high` - High priority issues
- `priority: low` - Low priority issues
- `accessibility` - Accessibility-related issues
- `security` - Security-related issues

## 🤝 Community Guidelines

### Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please:

- Be respectful and considerate
- Use inclusive language
- Be open to constructive feedback
- Help others learn and grow
- Report inappropriate behavior

### Communication

- **Issues**: Use GitHub Issues for bugs and feature requests
- **Discussions**: Use GitHub Discussions for questions and ideas
- **Discord**: Join our community server for real-time chat

## 📚 Resources

### Documentation

- **[AI.MD](AI.MD)**: Comprehensive development guidelines
- **[API Documentation](src/lib/utils/api/README.md)**: API patterns and usage
- **[Testing Guide](tests/README.md)**: Testing strategy and patterns
- **[Environment Guide](src/lib/core/config/README.md)**: Environment configuration

### External Resources

- [SvelteKit Documentation](https://kit.svelte.dev/)
- [Fluxbase Documentation](https://fluxbase.eu/docs)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Vitest Testing Framework](https://vitest.dev/)
- [Zod Validation](https://zod.dev/)

## 🎉 Recognition

Contributors are recognized in several ways:

- **Contributors List**: GitHub automatically shows contributors
- **Release Notes**: Significant contributions mentioned in releases
- **Community Spotlight**: Featured in community updates

## 📞 Getting Help

If you need help:

1. **Check Documentation**: Start with the guides above
2. **Search Issues**: Look for similar problems
3. **Ask Questions**: Use GitHub Discussions
4. **Join Community**: Connect with other contributors

---

Thank you for contributing to Wayli! Your efforts help make location tracking more private and accessible for everyone. 🌍✨
