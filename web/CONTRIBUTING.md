# Contributing to Wayli

Thank you for your interest in contributing to Wayli! This guide will help you get started with development and ensure your contributions meet our standards.

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Git** - [Download here](https://git-scm.com/)
- **Fluxbase** - [Get started here](https://fluxbase.eu/)
- **Code Editor** - We recommend VS Code with the Svelte extension

### Development Setup

1. **Fork and Clone**

   ```bash
   git clone https://github.com/wayli-app/wayli.git
   cd wayli/web
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Environment Setup**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your Fluxbase credentials:

   ```env
   PUBLIC_FLUXBASE_BASE_URL=your_FLUXBASE_BASE_URL
   PUBLIC_FLUXBASE_ANON_KEY=your_fluxbase_anon_key
   FLUXBASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

4. **Database Setup**

   ```bash
   npx fluxbase db reset
   ```

5. **Start Development Server**

   ```bash
   npm run dev
   ```

6. **Run Tests**
   ```bash
   npm test
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
- **Linting**: Follow ESLint rules
- **Naming**: Use descriptive names, follow established conventions

#### File Organization

```
src/
├── lib/
│   ├── accessibility/       # Accessibility utilities
│   ├── components/          # Reusable UI components
│   ├── core/
│   │   ├── config/          # Environment configuration
│   │   └── fluxbase/        # Fluxbase clients
│   ├── services/           # Business logic services
│   ├── stores/             # Svelte stores
│   ├── types/              # TypeScript types
│   ├── utils/
│   │   ├── api/            # API utilities and patterns
│   │   └── ...             # Other utilities
│   ├── validation/         # Zod validation schemas
│   └── middleware/         # Request middleware
├── routes/
│   ├── (user)/             # Protected user routes
│   ├── api/                # API endpoints
│   └── setup/              # Initial setup flow
└── static/                 # Static assets
```

#### API Development

Use the established API patterns:

```typescript
// Use base handlers for consistent API endpoints
export const GET: RequestHandler = createGetHandler(
	async (context) => {
		const { user, query } = context;
		// Business logic here
		return { data: result };
	},
	{
		requireAuthentication: true,
		validateQuery: paginationSchema
	}
);

// Use validation schemas
export const POST: RequestHandler = createPostHandler(
	async (context) => {
		const { body } = context;
		// body is already validated
		return { result };
	},
	{
		validateBody: createTripSchema
	}
);
```

#### Component Development

Follow accessibility-first development:

```svelte
<script lang="ts">
	import { useAriaButton } from '$lib/accessibility/aria-button';

	export let label: string;
	export let disabled = false;

	let buttonElement: HTMLButtonElement;
	const { buttonProps } = useAriaButton({ disabled });
</script>

<button bind:this={buttonElement} use:buttonProps {disabled} class="btn btn-primary">
	{label}
</button>
```

### 4. Testing Requirements

#### Test Coverage Goals

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
npm test

# Run with coverage
npm run test:coverage

# Run specific test categories
npm test -- tests/unit/          # Unit tests
npm test -- tests/components/    # Component tests
npm test -- tests/accessibility/ # Accessibility tests
npm test -- tests/integration/   # Integration tests
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
import { useAriaModal } from '$lib/accessibility/aria-modal';
```

### 6. Environment Configuration

Follow the environment separation pattern:

```typescript
// Note: Nominatim configuration is now handled directly in the service
// No client-side config needed at this time

// Server-only (private variables)
import { validateServerEnvironment } from '$lib/core/config/server-environment';

// Worker environment
import { validateWorkerEnvironment } from '$lib/core/config/worker-environment';
```

**⚠️ Security Rule**: Never import `$env/static/private` in client-side code!

## 🔄 Pull Request Process

### 1. Pre-PR Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass (`npm test`)
- [ ] Coverage meets requirements (`npm run test:coverage`)
- [ ] Accessibility tests pass (`npm test -- tests/accessibility/`)
- [ ] No TypeScript errors (`npm run check`)
- [ ] No linting errors (`npm run lint`)
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

1. **Environment**: OS, browser, Node.js version
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
