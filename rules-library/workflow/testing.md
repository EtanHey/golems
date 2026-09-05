# Testing Context

> Use this context for projects that require testing standards.

---

## Testing Requirements

**All new helpers/utilities MUST have tests.**

### Test Location Convention
```
src/components/ComponentName.test.tsx    # Component tests
src/hooks/hookName.test.ts               # Hook tests
src/lib/utilName.test.ts                 # Utility tests
src/utils/utilName.test.ts               # Utility tests
src/__tests__/featureName.test.ts        # Integration tests
```

---

## When Creating New Code

| Code Type | Test Requirement |
|-----------|------------------|
| New helper/utility | Create `*.test.ts` file with unit tests |
| New component with logic | Create `*.test.tsx` file |
| Bug fix | Add regression test if possible |
| Refactoring | Ensure existing tests still pass |

---

## Test Commands

```bash
# Run all tests once
bun run test
# or
npm run test

# Watch mode for development
bun run test:watch

# E2E tests (Playwright)
bun run test:e2e

# Mobile E2E only
bun run test:e2e:mobile

# Desktop E2E only
bun run test:e2e:desktop

# Visual debugging
bun run test:e2e:ui

# Update visual baselines
bun run test:e2e:update-snapshots
```

---

## Required Test IDs

For data-fetching components, use these standard test IDs:

| State | Test ID |
|-------|---------|
| Loading | `data-testid="[component]-skeleton"` |
| Content | `data-testid="[component]-card"` |
| Empty | `data-testid="empty-state"` |
| Error | `data-testid="error-state"` |

Example:
```tsx
<div data-testid="property-grid-skeleton">Loading...</div>
<div data-testid="property-card">Property content</div>
<div data-testid="empty-state">No results found</div>
<div data-testid="error-state">An error occurred</div>
```

---

## State Testing Checklist

**EVERY data-fetching page MUST test:**

- [ ] **Loading state** - Skeletons visible
- [ ] **Content state** - Real data visible
- [ ] **Empty state** - No results message
- [ ] **Error state** - API failure message
- [ ] **Offline state** - Network disconnected
- [ ] **Slow network state** - 3G simulation

---

## Unit Test Example (Vitest)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { formatCurrency, validateEmail } from './utils';

describe('formatCurrency', () => {
  it('formats positive numbers with currency symbol', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('handles negative numbers', () => {
    expect(formatCurrency(-100)).toBe('-$100.00');
  });
});

describe('validateEmail', () => {
  it('returns true for valid emails', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('user.name@domain.co.uk')).toBe(true);
  });

  it('returns false for invalid emails', () => {
    expect(validateEmail('invalid')).toBe(false);
    expect(validateEmail('missing@')).toBe(false);
    expect(validateEmail('@nodomain.com')).toBe(false);
  });
});
```

---

## Component Test Example (React Testing Library)

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchInput } from './SearchInput';

describe('SearchInput', () => {
  it('renders with placeholder', () => {
    render(<SearchInput placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    const handleChange = vi.fn();
    render(<SearchInput onChange={handleChange} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'test query' }
    });

    expect(handleChange).toHaveBeenCalledWith('test query');
  });

  it('shows clear button when value is present', () => {
    render(<SearchInput value="test" />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });
});
```

---

## E2E Test Example (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Property Search', () => {
  test('shows loading state then results', async ({ page }) => {
    await page.goto('/properties');

    // Should show loading skeleton
    await expect(page.getByTestId('property-grid-skeleton')).toBeVisible();

    // Should show results after loading
    await expect(page.getByTestId('property-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows empty state when no results', async ({ page }) => {
    await page.goto('/properties?search=xyznonexistent');
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('filters work correctly', async ({ page }) => {
    await page.goto('/properties');

    // Apply filter
    await page.getByRole('button', { name: '2 bedrooms' }).click();

    // Verify URL updated
    await expect(page).toHaveURL(/bedrooms=2/);

    // Verify results filtered
    await expect(page.getByTestId('property-card')).toHaveCount(5);
  });
});
```

---

## Mocking

### Mock API Calls
```typescript
import { vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  fetchItems: vi.fn().mockResolvedValue([
    { id: 1, name: 'Item 1' },
    { id: 2, name: 'Item 2' }
  ])
}));
```

### Mock Timers
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('debounced search', async () => {
  // ... test code
  vi.advanceTimersByTime(300); // Advance debounce timer
  // ... assertions
});
```

---

## Test Cleanup

**Multiple component instances in DOM cause "Found multiple elements" errors.**

```typescript
import { afterEach } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
});
```

---

## Pre-commit Hooks

Tests run automatically on every commit via Husky:

```bash
bun run test        # Unit tests (Vitest)
bun run typecheck   # TypeScript check
```

If tests fail, the commit is blocked. Fix tests before committing.

**Bypass for emergencies:** `git commit --no-verify`
