# Next.js Context

> Use this context for Next.js projects (App Router).

> **Note**: This context targets **Next.js 15+**. Key differences from older versions:
> - The `params` and `searchParams` props are now Promises that must be awaited
> - Dynamic route handlers use `params: Promise<{ slug: string }>` instead of `params: { slug: string }`

---

## Project Structure (App Router)

```
app/
├── (routes)/         # Route groups
├── api/              # API routes
├── components/       # React components
└── lib/              # Utilities, types
```

### Component Patterns
- Server components by default
- Add `'use client'` only when needed (hooks, interactivity)
- Keep client components small and focused

---

## Server vs Client Components

### Server Components (Default)
```typescript
// No 'use client' directive - runs on server
import { createClient } from '@/lib/supabase/server';

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.from('items').select('*');
  return <div>{/* render data */}</div>;
}
```

### Client Components
```typescript
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function Component() {
  const [data, setData] = useState([]);
  // Use hooks, handle interactivity
}
```

---

## API Routes

```typescript
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('items').select('*');

    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
```

---

## Server Actions

```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createItem(formData: FormData) {
  const supabase = await createClient();
  // Validate with zod, perform action
  revalidatePath('/items');
}
```

---

## next-intl Internationalization

### Setup

**src/i18n/routing.ts:**
```typescript
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es', 'he'],
  defaultLocale: 'en',
  localePrefix: 'as-needed'
});
```

**src/i18n/request.ts:**
```typescript
import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});
```

**src/middleware.ts:**
```typescript
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/']
};
```

### Navigation APIs

**src/i18n/navigation.ts:**
```typescript
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

### Usage in Components

**Server Components:**
```typescript
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('dashboard');
  return <h1>{t('welcome')}</h1>;
}
```

**Client Components:**
```typescript
'use client';

import { useTranslations } from 'next-intl';

export default function Component() {
  const t = useTranslations('dashboard');
  return <h1>{t('welcome')}</h1>;
}
```

### Message Files

**messages/en.json:**
```json
{
  "dashboard": {
    "welcome": "Welcome{name}!",
    "items": "{count, plural, =0 {No items} =1 {One item} other {# items}}"
  }
}
```

### Provider Setup

> **Next.js 15+**: The `params` prop is now a Promise that must be awaited.

```typescript
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

### Type Safety

**global.d.ts:**
```typescript
import en from './messages/en.json';

type Messages = typeof en;

declare global {
  interface IntlMessages extends Messages {}
}
```

### Navigation with Locale

```typescript
import { Link } from '@/i18n/navigation';

// Basic
<Link href="/about">About</Link>

// Switch locale
<Link href="/" locale="es">Español</Link>

// Router
const router = useRouter();
router.push('/about');
router.replace('/about', { locale: 'es' });
```

### Formatting

```typescript
import { useFormatter } from 'next-intl';

function Component() {
  const format = useFormatter();

  format.dateTime(new Date(), { year: 'numeric', month: 'short', day: 'numeric' });
  format.number(499.9, { style: 'currency', currency: 'USD' });
  format.relativeTime(date, now);
}
```

### Rich Text

```json
{ "terms": "Please accept our <link>terms</link>" }
```

```typescript
t.rich('terms', {
  link: (chunks) => <a href="/terms">{chunks}</a>
});
```

### Guidelines
- Email addresses should NOT be translated - keep them hardcoded
- URLs, phone numbers, and contact details remain constant across languages
- Only translate user-facing text labels and content
- After updating `en.json`, always update other locale files too

---

## Performance Optimization

### Above-the-Fold Content
- Use **server components** for above-the-fold content wherever possible
- Replace framer-motion/JS animations with **CSS @keyframes** for entrance animations
- Use native `<a>` or Next.js `<Link>` instead of `onClick` + `router.push`
- Pre-compute data at build time instead of using `useState`/`useEffect`

**Why**: First Contentful Paint (FCP) is blocked until JS hydrates. Server components stream HTML immediately.

### Dynamic Imports
```typescript
import dynamic from 'next/dynamic';

const HeavyComponent = dynamic(
  () => import('@/components/HeavyComponent'),
  { ssr: false }
);
```

Use `ssr: false` when:
- Component uses React Query hooks
- Component imports from barrel files that pull in hooks
- Component needs browser-only APIs

---

## Common Imports

```typescript
import { Database } from '@/types/database.types';
import { createClient } from '@/lib/supabase/[server|client]';
import toast from 'react-hot-toast';
import dayjs from '@/lib/utils/dayjs';
```
