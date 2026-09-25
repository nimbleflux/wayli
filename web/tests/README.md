# Test Suite Documentation

## Overview

This document outlines the testing strategy, patterns, and guidelines for the Wayli application test suite. The test suite uses Vitest as the testing framework and follows best practices for comprehensive coverage.

## Test Structure

```
tests/
├── components/            # Component tests
├── e2e/                   # End-to-end tests (Playwright)
├── helpers/               # Test helpers
├── integration/           # Integration tests
├── mocks/                 # Test mocks
├── unit/                  # Unit tests (incl. accessibility-aria-button.test.ts)
├── utils/                 # Test utilities
├── setup.ts              # Test setup and configuration
└── README.md             # This file
```

## Test Categories

### 1. Unit Tests (`tests/unit/`)

Unit tests focus on testing individual functions, classes, and utilities in isolation.

**Coverage Goals:**

- **Business Logic**: 90%+ coverage
- **Utilities**: 95%+ coverage
- **Services**: 85%+ coverage

**Key Areas:**

- API response utilities
- Validation schemas
- Error handling
- Security utilities
- Data transformation functions

**Example:**

```typescript
// tests/unit/api-response.test.ts
describe('API Response Utilities', () => {
	it('should create successful response', async () => {
		const response = successResponse({ data: 'test' });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
	});
});
```

### 2. Component Tests (`tests/components/`)

Component tests verify that Svelte components render correctly and handle user interactions.

**Coverage Goals:**

- **UI Components**: 80%+ coverage
- **User Interactions**: 90%+ coverage
- **Accessibility**: 100% coverage for a11y features

**Key Areas:**

- Component rendering
- User interactions (click, input, keyboard)
- Event handling
- Props validation
- Accessibility compliance

**Example:**

```typescript
// tests/components/AddressSearch.test.ts
describe('AddressSearch Component', () => {
	it('should render with default props', () => {
		const { getByRole, getByText } = render(AddressSearch, {
			props: { label: 'Address' }
		});
		expect(getByText('Address')).toBeInTheDocument();
		expect(getByRole('textbox')).toBeInTheDocument();
	});
});
```

### 3. Accessibility Tests

Accessibility tests live under `tests/unit/` — today as
`tests/unit/accessibility-aria-button.test.ts`, which exercises the
`useAriaButton` action. Run them with `bun run test:accessibility`.

```typescript
// tests/unit/accessibility-aria-button.test.ts
describe('Accessibility Tests', () => {
	it('should have proper ARIA attributes', () => {
		render(AccessibleButton, { props: { label: 'Test Button' } });
		const button = screen.getByRole('button', { name: 'Test Button' });
		expect(button).toHaveAttribute('role', 'button');
	});
});
```

### 4. Integration Tests (`tests/integration/`)

Integration tests verify that different parts of the application work together correctly.

**Coverage Goals:**

- **API Endpoints**: 85%+ coverage
- **Service Integration**: 80%+ coverage
- **Database Operations**: 75%+ coverage

**Key Areas:**

- API endpoint behavior
- Service layer integration
- Database operations
- Authentication flows
- Error handling across layers

## Testing Patterns

### 1. Arrange-Act-Assert (AAA)

All tests should follow the AAA pattern:

```typescript
describe('UserService', () => {
	it('should create user successfully', async () => {
		// Arrange
		const userData = { name: 'John', email: 'john@example.com' };
		const mockDb = createMockDatabase();

		// Act
		const result = await userService.createUser(userData);

		// Assert
		expect(result).toHaveProperty('id');
		expect(result.name).toBe(userData.name);
	});
});
```

### 2. Descriptive Test Names

Test names should clearly describe what is being tested:

```typescript
// Good
it('should return 404 when user is not found');

// Bad
it('should handle missing user');
```

### 3. Test Isolation

Each test should be independent and not rely on other tests:

```typescript
describe('UserService', () => {
	beforeEach(() => {
		// Reset database state
		resetTestDatabase();
	});

	afterEach(() => {
		// Clean up after each test
		cleanupTestData();
	});
});
```

### 4. Mocking Strategy

Use mocks sparingly and prefer real implementations when possible:

```typescript
// Mock external dependencies
vi.mock('$lib/services/external/api');

// Use real implementations for internal logic
const userService = new UserService(realDatabase);
```

## Coverage Goals

### Overall Coverage Targets

| Category           | Target | Current |
| ------------------ | ------ | ------- |
| **Total Coverage** | 85%    | TBD     |
| **Business Logic** | 90%    | TBD     |
| **API Layer**      | 85%    | TBD     |
| **Components**     | 80%    | TBD     |
| **Accessibility**  | 100%   | TBD     |

### Critical Paths (100% Coverage Required)

- Authentication flows
- Error handling
- Data validation
- Security utilities
- Accessibility features

## Running Tests

### Development

```bash
# Run all tests
bun run test

# Run unit tests in watch mode
bun run test:unit

# Run tests with coverage
bun run test:coverage

# Run a specific test category
bun run test:accessibility
bun run test:integration
bun run test:e2e
```

### CI/CD

CI runs unit tests with coverage report-only
(`vitest --run --config vitest.ci.config.ts --coverage`) and uploads the
coverage report; thresholds are advisory and do not fail the build.

## Test Configuration

### Vitest Configuration

```typescript
// vitest.config.ts
export default defineConfig({
	test: {
		include: ['tests/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		setupFiles: ['./tests/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'tests/']
		}
	}
});
```

### Test Setup

```typescript
// tests/setup.ts
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock environment variables
vi.stubEnv('NODE_ENV', 'test');

// Global test utilities
global.ResizeObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn()
}));
```

## Best Practices

### 1. Test Organization

- Group related tests using `describe` blocks
- Use nested `describe` blocks for complex scenarios
- Keep test files focused on a single module or feature

### 2. Test Data

- Use factories for creating test data
- Keep test data realistic but minimal
- Use constants for repeated test data

```typescript
// test-data/factories.ts
export const createUser = (overrides = {}) => ({
	id: 'user-123',
	name: 'Test User',
	email: 'test@example.com',
	...overrides
});
```

### 3. Assertions

- Use specific assertions
- Test one thing per test
- Use descriptive assertion messages

```typescript
// Good
expect(user.name).toBe('John Doe');
expect(user.email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);

// Bad
expect(user).toBeDefined();
```

### 4. Error Testing

- Test both success and error scenarios
- Verify error messages and types
- Test edge cases and boundary conditions

```typescript
it('should throw error for invalid input', () => {
	expect(() => {
		validateUser({ name: '', email: 'invalid' });
	}).toThrow('Name is required');
});
```

## Accessibility Testing

### Required Tests

Every component must include:

1. **ARIA Attributes Test**

   ```typescript
   it('should have proper ARIA attributes', () => {
   	const button = screen.getByRole('button');
   	expect(button).toHaveAttribute('aria-label');
   });
   ```

2. **Keyboard Navigation Test**

   ```typescript
   it('should support keyboard navigation', async () => {
   	const button = screen.getByRole('button');
   	await fireEvent.keyDown(button, { key: 'Enter' });
   	expect(mockClickHandler).toHaveBeenCalled();
   });
   ```

3. **Focus Management Test**
   ```typescript
   it('should manage focus correctly', () => {
   	const input = screen.getByRole('textbox');
   	input.focus();
   	expect(input).toHaveFocus();
   });
   ```

### Accessibility Checklist

- [ ] All interactive elements are keyboard accessible
- [ ] All form inputs have associated labels
- [ ] All images have alt text
- [ ] Color is not the only way to convey information
- [ ] Focus indicators are visible
- [ ] Heading hierarchy is logical
- [ ] ARIA attributes are used correctly

## Performance Testing

### Component Performance

```typescript
it('should render within performance budget', () => {
	const startTime = performance.now();
	render(ComplexComponent);
	const endTime = performance.now();

	expect(endTime - startTime).toBeLessThan(100); // 100ms budget
});
```

### Memory Leaks

```typescript
it('should not leak memory', () => {
	const initialMemory = performance.memory?.usedJSHeapSize || 0;

	for (let i = 0; i < 100; i++) {
		render(Component);
		cleanup();
	}

	const finalMemory = performance.memory?.usedJSHeapSize || 0;
	expect(finalMemory - initialMemory).toBeLessThan(1024 * 1024); // 1MB
});
```

## Continuous Integration

### GitHub Actions

CI runs unit tests with coverage (report-only) and uploads the coverage
report as an artifact.

### Coverage Thresholds

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
}
```

## Contributing Guidelines

### Adding New Tests

1. **Identify the test category** (unit, component, integration, accessibility)
2. **Follow the naming convention**: `[module-name].test.ts`
3. **Use descriptive test names** that explain the expected behavior
4. **Include both positive and negative test cases**
5. **Add accessibility tests** for all UI components
6. **Update coverage goals** if adding new modules

### Test Review Checklist

- [ ] Tests are focused and test one thing
- [ ] Test names are descriptive
- [ ] Tests are independent and don't rely on other tests
- [ ] Mocks are used appropriately
- [ ] Error scenarios are tested
- [ ] Accessibility requirements are met
- [ ] Performance considerations are addressed

### Code Coverage

- **New features**: Must have 90%+ coverage
- **Bug fixes**: Must include regression tests
- **Refactoring**: Must maintain or improve coverage
- **Critical paths**: Must have 100% coverage

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Jest DOM Matchers](https://github.com/testing-library/jest-dom)
- [Svelte Testing Best Practices](https://testing-library.com/docs/svelte-testing-library/intro/)
