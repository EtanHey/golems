# Design System Context

> Use this context for projects with a component design system.

---

## Rule #1: Check for Existing Components BEFORE Coding

**BEFORE writing ANY UI code, check these locations IN ORDER:**

| Priority | Location | What's There |
|----------|----------|--------------|
| 1st | Shared UI package exports | Typography, Buttons, Tags, etc. |
| 2nd | App's `src/components/index.ts` | App-specific components |
| 3rd | Design system docs | DESIGN_SYSTEM.md, Figma specs |

**NEVER inline. NEVER duplicate. ALWAYS import.**

```tsx
// FORBIDDEN - Inlining existing components
<button className="bg-white/80 border rounded-md">
  <Heart className="text-red-500" />
</button>
<p className="text-[17px] text-[#111827]">Address</p>

// REQUIRED - Import and use
import { SaveButton, Body, H3 } from '@project/ui';
<SaveButton saved={isSaved} onClick={handleSave} />
<Body>Address</Body>
```

---

## Typography Components

Use typography components instead of raw text with classes:

```tsx
// CORRECT
<H1 color="black">Title</H1>
<Body color="grey-700">Description</Body>
<Caption>Small text</Caption>

// WRONG - Breaks sizing, inconsistent
<h1 className="text-4xl text-black">Title</h1>
<p className="text-base text-gray-700">Description</p>
```

### Color Props
Use `color` prop, NOT `className="text-*"` (tailwind-merge conflicts):

```tsx
// CORRECT
<H1 color="black">Title</H1>

// WRONG - Color may not apply correctly
<H1 className="text-black">Title</H1>
```

---

## Tailwind v4 Best Practices

### No Arbitrary Pixels
Use Tailwind scale or CSS variables. Never `h-[60px]` or `top-[48px]`.

```tsx
// FORBIDDEN - Arbitrary pixels
<div className="h-[60px] py-[48px] gap-[118px]">

// CORRECT - Tailwind scale or CSS variables
<div className="h-header py-12 gap-28">
```

### No Inline Colors
Use Tailwind preset tokens. NEVER use arbitrary hex colors.

```tsx
// FORBIDDEN - Inline hex colors
<div className="bg-[#E9EFFD] text-[#111827] border-[#D3E0FB]">

// CORRECT - Use preset tokens from @theme
<div className="bg-primary-50 text-dark border-primary-100">
```

**If a color doesn't exist in @theme, add it there first!**

### No Inline Styles
Convert all inline styles to Tailwind classes.

```tsx
// FORBIDDEN - Inline styles
<div style={{ background: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>

// CORRECT - Tailwind classes or @theme shadows
<div className="bg-white shadow-header">
```

---

## CSS Variables via @theme

Define spacing/shadow tokens in `globals.css`:

```css
/* globals.css */
@theme {
  --spacing-header: 60px;
  --spacing-container: 323px;
  --shadow-header: 0 4px 12px rgba(0, 0, 0, 0.1);
}
```

Use in components:
```tsx
<div className="h-header top-header shadow-header">
<div className="max-h-[calc(100vh-var(--spacing-header))]">
```

---

## Common Tailwind Spacing Reference

| Class | Pixels | Use for |
|-------|--------|---------|
| `gap-4` | 16px | Mobile gaps |
| `gap-6` | 24px | Section gaps |
| `gap-8` | 32px | Medium gaps |
| `gap-10` | 40px | Desktop gaps |
| `py-12` | 48px | Section padding |
| `py-25` | 100px | Large section padding |
| `h-8` | 32px | Small buttons |
| `h-9` | 36px | Icon buttons |
| `h-10` | 40px | Input height |

---

## Page-Level Layout

Sections use page-level flex gaps, NOT component-level padding:

```tsx
// CORRECT - Page handles spacing via gaps
<main className="flex flex-col gap-15 lg:gap-25">
  <Hero />
  <TabsAds />        {/* No py-* padding */}
  <SolutionsTab />   {/* No py-* padding */}
</main>

// WRONG - Component has section padding
<section className="py-15 lg:py-25">  {/* Remove this! */}
```

### Exception: Colored Background Sections
Sections with colored backgrounds need their own internal padding:

```tsx
<main className="flex flex-col gap-15 lg:gap-25">
  <TabsAds />           {/* White bg - no padding */}
  <FAQSection />        {/* White bg - no padding */}

  {/* Colored sections - wrapped together, each has py-* */}
  <div>
    <AppDownloadBanner />  {/* Blue gradient bg - has py-12 */}
    <Newsletter />         {/* Light blue bg - has py-12 */}
  </div>
</main>
```

---

## No max-width Rule

**NEVER use `max-w-*` on sections or containers.** Use responsive paddings, gaps, and flexes instead.

```tsx
// FORBIDDEN
<div className="max-w-[358px] px-4">

// CORRECT
<div className="w-full px-4">
```

---

## State Transitions (No Flash)

Use `invisible` with `opacity-0` to prevent flash during transitions:

```tsx
// WRONG - Causes flash during transition
className={show ? "opacity-100" : "opacity-0 pointer-events-none absolute"}

// CORRECT - No flash
className={show ? "opacity-100" : "opacity-0 invisible pointer-events-none absolute"}
```

---

## Button Variants

Common button patterns:

```tsx
// Primary (filled)
<Button variant="primary">Submit</Button>

// Secondary (outline)
<Button variant="outline">Cancel</Button>

// Ghost (no border)
<Button variant="ghost">Learn more</Button>

// Icon button
<IconButton icon={<Plus />} />

// Save button (special heart icon)
<SaveButton saved={isSaved} onClick={handleSave} />
```

---

## Component Props Patterns

### All Components Should Accept className
```tsx
interface ComponentProps {
  children: React.ReactNode;
  className?: string;  // Always include
}

export function Component({ children, className }: ComponentProps) {
  return <div className={cn("base-styles", className)}>{children}</div>;
}
```

### Type Consistency
When adding/modifying variant types:
1. Update type definition
2. Update implementation object
3. Update shorthand components

```tsx
// Type mismatch will cause build failure
type ButtonVariant = 'primary' | 'outline-solid';

const variantClasses: Record<ButtonVariant, string> = {
  primary: '...',
  'outline-solid': '...',  // Must match type exactly
};
```

---

## Handlers at Component Level

Click handlers belong inside components, not passed from page:

```tsx
// WRONG - Passing handlers from page
<TabsAds onPropertyClick={(id) => console.log(id)} />

// CORRECT - Handlers inside component
// In TabsAds/index.tsx:
<PropertyCard onClick={(id) => router.push(`/property/${id}`)} />
```

---

## Icons

- **Web:** `lucide-react`
- **Mobile:** `lucide-react-native`
- **NEVER:** MaterialCommunityIcons, @expo/vector-icons
- **NEVER make SVGs** - use lucide icons
