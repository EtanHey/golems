# Table of Contents: golems dashboard vs etanheyman.com

Comparison of how Table of Contents is generated in both repos when rendering docs.

---

## Summary

| Feature | golems dashboard | etanheyman.com |
|---------|------------------|----------------|
| **Where headings extracted** | Build-time (server) in `renderMarkdown()` | Runtime (client) in `useEffect` via DOM query |
| **Heading level depth** | h2 + h3 only | h2 + h3 + h4 |
| **Scroll spy / active tracking** | Yes — scroll event listener on container | Yes — IntersectionObserver with `rootMargin: '-80px 0px -70% 0px'` |
| **Mobile behavior** | Hidden (`hidden xl:block`) | Hidden (`hidden xl:block`) |
| **Dependencies** | gray-matter, marked, custom regex on HTML | gray-matter, MDXRemote, rehype-slug, remark-gfm, rehype-pretty-code |
| **ID generation** | Custom `slugify()` in `lib/docs` | rehype-slug (github-slugger) |
| **Min headings to show TOC** | None (shows if `toc.length > 0`) | 3+ (`if (headings.length < 3) return null`) |

---

## golems dashboard

### Location

- **Page:** `packages/dashboard/src/app/(dashboard)/docs/[...slug]/page.tsx`
- **TOC extraction:** `packages/dashboard/src/lib/docs/index.ts` → `renderMarkdown()`
- **TOC rendering:** `packages/dashboard/src/app/(dashboard)/docs/[...slug]/docs-client.tsx` → `TableOfContents` component

### How headings are extracted

1. **gray-matter** parses frontmatter; first H1 is stripped from content before rendering.
2. **marked** converts markdown → HTML.
3. **Regex** on the HTML output: `/<h([23])>([\s\S]*?)<\/h\1>/g` matches `<h2>` and `<h3>` only.
4. For each match:
   - Strip HTML tags from inner text → `plainText`
   - `slugify(plainText)` → id (lowercase, non-word chars removed, spaces → `-`)
   - Deduplicate: append `-1`, `-2`, … if id already used
   - Inject `id` into heading: `<h2 id="foo">...</h2>`
   - Push `{ id, text, level }` to `toc` array

### Heading levels

- **h2** and **h3** only. h4+ are not in the TOC and do not get IDs from this pipeline.

### Scroll spy

- `handleScroll` callback on the scroll container (via `getScrollParent(contentRef.current)`).
- For each TOC item, checks `rect.top - containerRect.top <= offset` (offset = 100px).
- Sets `activeId` to the last heading that has passed the threshold.
- Edge case: near bottom of page → activate last heading.

### Mobile

- TOC hidden on viewports &lt; `xl` via `hidden xl:block` on the aside.

### Dependencies

- `gray-matter` — frontmatter
- `marked` — markdown → HTML
- `shiki` — code highlighting (post-process)
- Custom regex — no rehype/remark plugins for TOC

---

## etanheyman.com

### Location

- **Page:** `app/(golems)/golems/docs/[...slug]/page.tsx`
- **TOC component:** `app/(golems)/golems/components/TableOfContents.tsx`

### How headings are extracted

1. **gray-matter** parses frontmatter; content passed to MDX as-is (no H1 strip).
2. **MDXRemote** renders markdown with remark/rehype.
3. **rehype-slug** adds `id` attributes to all headings (h1–h6) during rehype transform.
4. **Client-side:** `TableOfContents` runs in `useEffect`:
   - `document.querySelector('article').querySelectorAll('h2, h3, h4')`
   - For each element: `{ id: el.id, text: el.textContent.trim(), level: parseInt(el.tagName[1]) }`
   - Skips elements without `id` or `textContent`.

### Heading levels

- **h2**, **h3**, and **h4**. h1 and h5+ are not in the TOC.

### Scroll spy

- **IntersectionObserver** with `rootMargin: '-80px 0px -70% 0px'`, `threshold: 0`.
- When a heading enters the observed zone, it becomes active.
- Updates URL hash via `history.replaceState(null, '', `#${id}`)`.
- Auto-scrolls TOC nav to keep active item visible (unless user is hovering TOC).

### Mobile

- TOC hidden on viewports &lt; `xl` via `hidden xl:block`.

### Dependencies

- `gray-matter` — frontmatter
- `next-mdx-remote` — MDX rendering
- `remark-gfm` — GitHub Flavored Markdown
- `rehype-slug` — adds IDs (uses github-slugger)
- `rehype-pretty-code` — syntax highlighting

---

## Single-sourcing compatibility

If the same markdown is used in both repos:

| Aspect | Compatible? | Notes |
|--------|-------------|-------|
| **Heading levels** | No | Dashboard: h2+h3. etanheyman: h2+h3+h4. h4 sections would appear in etanheyman TOC only. |
| **ID generation** | Possibly different | Dashboard: custom `slugify()`. etanheyman: rehype-slug (github-slugger). May differ for emojis, non-Latin chars, edge cases. |
| **Anchor links** | May break | `#some-heading` could resolve differently if slug algorithms diverge. |
| **First H1** | Different handling | Dashboard strips first H1 from content. etanheyman does not. |
| **Markdown syntax** | Same | Both support standard `##`, `###`, `####`. No special syntax assumptions. |

### Recommendations for single-sourcing

1. **Align heading depth** — Either add h4 to dashboard TOC or drop h4 from etanheyman TOC.
2. **Align slug algorithm** — Use github-slugger (or equivalent) in dashboard instead of custom `slugify()` so anchor links match.
3. **Align H1 handling** — Decide whether to strip the first H1 in both or neither.
4. **TOC visibility threshold** — Dashboard shows TOC whenever `toc.length > 0`; etanheyman requires 3+ headings. Consider aligning.
