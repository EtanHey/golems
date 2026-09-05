# Sidebar Navigation & Prev/Next Links — Comparison Audit

**Repos compared:** golems dashboard vs etanheyman.com (golems section)

---

## Summary Table

| Feature | golems dashboard | etanheyman.com |
|--------|------------------|----------------|
| **Nav data source** | Auto-generated from filesystem + frontmatter + `_category_.json` | Hardcoded `sidebarConfig` in Sidebar.tsx + `docsSections` in Header.tsx |
| **Section grouping** | Filesystem folders → categories; `_category_.json` for label/position | Hardcoded section titles + item arrays |
| **Sort order** | `sidebar_position` (frontmatter) + `position` (`_category_.json`); fallback 999, then alphabetical | Manual array order |
| **Prev/next links** | Derived from `flattenNav(getDocsNav())` — same nav tree | Hardcoded `DOC_ORDER` array in page.tsx |
| **Active page highlighting** | Slug match + `startsWith` for children | Exact `pathname === item.href` |
| **Mobile sidebar** | Doc nav hidden on &lt;lg; no mobile doc nav | Header hamburger → dropdown with `docsSections` when on docs page |

---

## 1. Nav Data Source

### golems dashboard

- **Source:** `packages/dashboard/src/lib/docs/index.ts`
- **Mechanism:** `getDocsNav()` walks `content/docs/` via `getAllDocSlugs()`, loads each doc with `getDoc()` (gray-matter), reads `_category_.json` per subfolder
- **Frontmatter used:** `title`, `sidebar_position`
- **Category metadata:** `_category_.json` with `{ label, position }` in `golems/`, `deployment/`, `configuration/`

### etanheyman.com

- **Source:** `app/(golems)/golems/components/Sidebar.tsx` — `sidebarConfig` array
- **Duplicate:** `app/(golems)/golems/components/Header.tsx` — `docsSections` (same structure, for mobile dropdown)
- **Mechanism:** Static TypeScript arrays; no filesystem or frontmatter

---

## 2. Section Grouping

### golems dashboard

- **Grouping:** By filesystem structure
  - Top-level `.md` → top-level nav items
  - `category/page.md` → under category; category label from `_category_.json` or derived from folder name
- **Categories:** `golems`, `deployment`, `configuration` (each has `_category_.json`)

### etanheyman.com

- **Grouping:** Manual sections in config
  - "Getting Started", "Agents", "Tools & Layers", "Infrastructure", "Guides"
- **Mapping:** Each section has explicit `items: [{ title, href }]`

---

## 3. Sort Order

### golems dashboard

- **Pages:** `(a.position ?? 999) - (b.position ?? 999) || a.title.localeCompare(b.title)`
- **Categories:** `Object.entries(categories).sort(([, a], [, b]) => a.position - b.position)`
- **Example frontmatter:** `sidebar_position: 1` (getting-started), `sidebar_position: 2` (architecture), etc.
- **Example `_category_.json`:** `{"label":"Golems","position":3}`, `{"label":"Configuration","position":4}`

### etanheyman.com

- **Order:** Fixed array order in `DOC_ORDER` and `sidebarConfig`/`docsSections`
- **Change process:** Edit code and redeploy

---

## 4. Prev/Next Links

### golems dashboard

- **Source:** `flattenNav(getDocsNav())` — flattened nav tree
- **Logic:** `page.tsx` calls `flattenNav(nav)`, finds current index, prev = `flat[idx - 1]`, next = `flat[idx + 1]`
- **Single source of truth:** Nav tree drives both sidebar and prev/next

### etanheyman.com

- **Source:** `DOC_ORDER` in `app/(golems)/golems/docs/[...slug]/page.tsx`
- **Logic:** `currentIndex = DOC_ORDER.indexOf(slugStr)`, prev/next from adjacent indices
- **Drift risk:** `DOC_ORDER` must stay in sync with `sidebarConfig` and `docsSections` manually

---

## 5. Active Page Highlighting

### golems dashboard

- **Match:** `item.slug === currentSlug` for leaves; `currentSlug.startsWith(c.slug + "/")` for category expansion
- **Parent expansion:** Category expanded if any child (or grandchild) matches

### etanheyman.com

- **Match:** `pathname === item.href` (exact)
- **No parent expansion:** Flat list; no collapsible sections in sidebar

---

## 6. Mobile Sidebar Behavior

### golems dashboard

- **Desktop:** Main sidebar (icons) + doc nav in `docs-client.tsx` (`hidden lg:block`)
- **Mobile:** Doc nav hidden (`hidden lg:block`); no doc-specific mobile nav
- **Docs access:** Via main sidebar "Docs" link; on docs page, no in-page doc nav on mobile

### etanheyman.com

- **Desktop:** Sidebar visible (`hidden md:block`) on docs pages only
- **Mobile:** Header hamburger → dropdown; when `pathname.startsWith('/golems/docs')`, shows "Doc Pages" expandable with `docsSections`
- **Docs access:** Hamburger → Doc Pages → full doc tree in dropdown

---

## Key Question: Can etanheyman.com Switch to golems-Style Config?

**Yes.** To match the golems dashboard system:

### Required Changes

1. **Content location**
   - Ensure docs live under `content/golems/` (or equivalent) with same structure as golems dashboard `content/docs/`
   - Add `sidebar_position` to frontmatter where order matters
   - Add `_category_.json` in subfolders (`golems/`, `configuration/`, etc.) for labels and category order

2. **Add docs lib**
   - Port or adapt `getDocsNav()`, `getAllDocSlugs()`, `getDoc()`, `flattenNav()`, `readCategory()` from `packages/dashboard/src/lib/docs/index.ts`
   - Adjust `DOCS_DIR` / `CONTENT_DIR` for etanheyman.com paths (e.g. `content/golems`)

3. **Replace hardcoded config**
   - **Sidebar.tsx:** Call `getDocsNav()` (or equivalent) instead of `sidebarConfig`
   - **Header.tsx:** Use same nav data for `docsSections` (or derive from `getDocsNav()`)
   - **page.tsx:** Replace `DOC_ORDER` with `flattenNav(getDocsNav())` for prev/next

4. **URL prefix**
   - golems dashboard uses `/docs/`; etanheyman.com uses `/golems/docs/`. Ensure slug→href mapping uses the correct base path.

5. **Optional: collapsible sections**
   - golems dashboard uses expandable categories; etanheyman.com sidebar is flat. To match, add category expansion logic similar to `NavItem` in `docs-client.tsx`.

### Migration Effort

| Task | Effort |
|------|--------|
| Add `sidebar_position` to existing docs | Low (one-time) |
| Add `_category_.json` files | Low (3–5 files) |
| Port docs lib + wire up | Medium |
| Remove `sidebarConfig`, `docsSections`, `DOC_ORDER` | Low |
| Test prev/next, mobile dropdown | Low |

**Recommendation:** Migrating is worthwhile. Single source of truth (filesystem + frontmatter) reduces drift and makes adding/reordering docs a content change instead of a code change.
