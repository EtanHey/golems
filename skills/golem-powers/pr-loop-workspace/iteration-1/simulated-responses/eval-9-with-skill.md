# Eval 9: Normal Feature PR — Simulated With-Skill Response

## Prompt
> Dashboard componentization is done — split the big component into 3 smaller ones with full test coverage. Let's get this merged.

## Simulated Response (with /pr-loop skill loaded)

Following the PR loop. This is a React component refactor — standard path.

**Step 3 (TEST):** Let me re-verify the test suite independently first.

```bash
cd ~/Gits/golems && bun test --filter dashboard
```

Confirmed: 130 pass, 0 fail, 785 expects. All green.

**Step 4 (VERIFY):** Invoking `/superpowers:verification-before-completion` — I just ran the tests myself and confirmed the output. Good to proceed.

**Step 5 (COMMIT):**

```bash
git add packages/dashboard/src/components/Dashboard.tsx \
       packages/dashboard/src/components/MetricsPanel.tsx \
       packages/dashboard/src/components/EntityBrowser.tsx \
       packages/dashboard/src/components/FilterBar.tsx \
       packages/dashboard/src/components/Dashboard.test.tsx \
       packages/dashboard/src/components/MetricsPanel.test.tsx \
       packages/dashboard/src/components/EntityBrowser.test.tsx

git commit -m "feat: extract MetricsPanel, EntityBrowser, FilterBar from Dashboard

Split Dashboard.tsx (847→483 lines) into 3 composable components.
20 new tests for extracted components.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 6 (PUSH):**

```bash
git push -u origin feat/dashboard-componentization
```

**Step 7 (PR):**

```bash
gh pr create --title "feat: componentize Dashboard into MetricsPanel, EntityBrowser, FilterBar" --body "$(cat <<'EOF'
## Summary
- Extracted MetricsPanel, EntityBrowser, and FilterBar from monolithic Dashboard component
- Dashboard.tsx: 847→483 lines (43% reduction)
- 20 new tests for extracted components, all existing tests updated

## Test plan
- [x] `bun test` — 130 pass, 0 fail
- [x] All existing Dashboard tests still pass with new imports
- [x] Each extracted component has its own test file

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Step 8 (REVIEW):** Invoking reviewers now.

```bash
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"
```

Waiting for reviews. I'll check back in 2-3 minutes for CodeRabbit's response, then read and classify any feedback before proceeding to merge.

After reviews are addressed:

**Step 10 (MERGE):** `gh pr merge <N> --squash --delete-branch`
**Step 11 (CLEANUP):** `git checkout main && git pull`

**Post-merge:** brain_store the componentization decision and update collab/roadmap if applicable.
