# RTL (Right-to-Left) Context

> Use this context for Hebrew, Arabic, or other RTL language projects.

---

## Core RTL Rules

**RTL is one of the most common sources of UI bugs. Always verify these patterns.**

### 1. Flex Order is Reversed
In RTL flex containers:
- **FIRST** element appears on the **RIGHT** (start)
- **LAST** element appears on the **LEFT** (end)

```tsx
// RTL: Text on RIGHT, Actions on LEFT
<div className="flex justify-between" dir="rtl">
  <div>Text content here</div>     {/* Appears RIGHT */}
  <div>Action items here</div>     {/* Appears LEFT */}
</div>

// WRONG order for RTL
<div className="flex justify-between" dir="rtl">
  <div>Action items here</div>     {/* Appears RIGHT - WRONG! */}
  <div>Text content here</div>     {/* Appears LEFT - WRONG! */}
</div>
```

### 2. RTL Must Propagate
Inner flex containers may not inherit `dir="rtl"` from parent.

```tsx
// CORRECT - Add dir="rtl" to inner containers if needed
<div dir="rtl">
  <div className="flex" dir="rtl">  {/* Explicit RTL */}
    {/* Content */}
  </div>
</div>
```

### 3. Text Alignment
- Hebrew/Arabic text should be `text-right`, `items-end`
- Use `text-start` / `text-end` for logical alignment (preferred)

```tsx
// Preferred - Logical properties
<p className="text-start">Right-aligned in RTL</p>

// Or explicit
<p className="text-right">Hebrew text</p>
```

### 4. Use Screen Positions in Communication
Say "LEFT side of screen" not "first in DOM" when describing layout.

---

## RTL Quick Reference

| DOM Order | Visual Position (RTL) | Use When |
|-----------|----------------------|----------|
| FIRST | RIGHT (start) | Text content, labels |
| LAST | LEFT (end) | Buttons, actions, icons |

---

## RTL Scroll Behavior

RTL scroll uses negative `scrollLeft` values:

```tsx
// Check scroll position in RTL
const isAtStart = Math.abs(scrollLeft) < 10;
const isAtEnd = Math.abs(scrollLeft) + containerWidth >= scrollWidth - 10;

// RTL scroll buttons: INVERTED
scrollBy({ left: +200 }) // → scrolls toward START (RIGHT visually)
scrollBy({ left: -200 }) // → scrolls toward END (LEFT visually)
```

---

## Button Icons in RTL

Icons should appear AFTER text in RTL (visually on the LEFT):

```tsx
// CORRECT - Icon on LEFT visually in RTL
<PrimaryButton rightIcon={<Phone />}>חייג לבעל הדירה</PrimaryButton>

// WRONG - Icon on RIGHT visually in RTL
<PrimaryButton leftIcon={<Phone />}>חייג לבעל הדירה</PrimaryButton>
```

---

## Logical CSS Properties

Use logical properties for automatic RTL support:

| Physical | Logical | RTL Behavior |
|----------|---------|--------------|
| `pl-4` | `ps-4` | padding-start → padding-RIGHT in RTL |
| `pr-4` | `pe-4` | padding-end → padding-LEFT in RTL |
| `ml-4` | `ms-4` | margin-start → margin-RIGHT in RTL |
| `mr-4` | `me-4` | margin-end → margin-LEFT in RTL |
| `left-0` | `start-0` | start → RIGHT in RTL |
| `right-0` | `end-0` | end → LEFT in RTL |

---

## Dynamic Text Alignment (React Native)

```tsx
const { i18n } = useTranslation();
const isRTL = i18n.language?.startsWith('he') || i18n.language?.startsWith('ar');
const textAlign = isRTL ? 'text-right' : 'text-left';

// CORRECT - Dynamic alignment
<Text className={`text-base font-bold ${textAlign}`}>
  {t('some.label')}
</Text>

// WRONG - Hardcoded alignment
<Text className="text-base font-bold text-right">
  {t('some.label')}
</Text>
```

---

## What Stays LTR (Always)

**Numbers and numerical UI elements should ALWAYS be LTR:**
- Room selectors (1, 2, 3, 4, 5, 6+)
- Price histograms (low prices on left, high on right)
- Price sliders and range inputs
- Phone numbers
- Dates and times

```tsx
// Numbers always LTR - DO NOT reverse for Hebrew
const displayOptions = [1, 2, 3, 4, 5, '6+'];  // Always this order
```

---

## What Changes with Language

| Element | RTL Behavior |
|---------|--------------|
| Labels/titles | Right-aligned |
| Input text | Align based on content language |
| Icon positions | Leading/trailing based on language |
| Flex direction | Use `flex-row-reverse` when needed |

---

## RTL Checklist Before Committing

- [ ] Text content appears on the RIGHT side
- [ ] Action items (buttons, QR codes, etc.) appear on the LEFT side
- [ ] Hebrew/Arabic text is right-aligned
- [ ] Flex containers have `dir="rtl"` when needed
- [ ] Icons are on the correct side of buttons
- [ ] Scroll behavior is correct (if applicable)
- [ ] Numbers/prices remain LTR

---

## Figma → RTL Implementation

When implementing from Figma designs:

| Visual Position (RTL) | DOM Order | Tailwind |
|----------------------|-----------|----------|
| RIGHT | First | `items-start`, `justify-start` |
| LEFT | Last | `items-end`, `justify-end` |
