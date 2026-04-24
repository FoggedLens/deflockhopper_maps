# Portal Outgoing-Share Redaction Disclaimer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user selects a transparency-portal agency in the Network panel that has zero outgoing shares, display a disclaimer explaining the zero may reflect a redacted list rather than a true absence.

**Architecture:** Pure UI change to one component (`NetworkPanelContent.tsx`). No data-layer, store, or routing changes. Two conditional renders gated on `selectedNode.isPortal && outgoingCount === 0`: (1) an amber callout block under the stats, (2) specialized copy for the Outgoing tab's empty state. The component is shared by desktop (`NetworkPanel`) and mobile (`MobileTabDrawer`), so one edit covers both.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, `lucide-react` icons (all already in use).

**Spec:** `docs/superpowers/specs/2026-04-23-portal-outgoing-redaction-disclaimer-design.md`

**Testing approach:** The project has no automated test framework configured. Verification is manual via `npm run dev`, plus `npm run build` to catch TypeScript regressions. Each task ends with an explicit manual-verification step.

---

## File Structure

Only one file is modified:

- **Modify:** `src/components/panels/NetworkPanelContent.tsx`
  - Add a conditional callout block after the stats section
  - Adjust the Outgoing-tab empty-state rendering to specialize copy for portals with zero outgoing

No new files, no new dependencies, no exports added or removed.

---

## Task 1: Add the redaction-disclaimer callout under the stats block

**Files:**
- Modify: `src/components/panels/NetworkPanelContent.tsx` (insert a new block after the stats `<div>` that ends near line 303, before the "Connection Types" legend block that starts near line 306)

**Context for the engineer:**
- `selectedNode: NetworkNode | null` is already destructured from the network store (line 99).
- `outgoingCount` is a local `const` computed on line 155: `const outgoingCount = byDirection.outgoing.length;`.
- `AlertTriangle` is already imported from `lucide-react` on line 4 and currently used only for the "Hotlist hits" stat row.
- The existing amber-ish note for "Location approximate" uses `text-amber-500/80` (line 254), so the callout palette is consistent.
- Tailwind classes used below (`bg-amber-500/10`, `border-amber-500/30`, `text-amber-300`, `text-amber-100/90`) match the project's existing Tailwind usage; no config changes required.

- [ ] **Step 1: Open the file and locate the insertion point**

Open `src/components/panels/NetworkPanelContent.tsx`. Find the stats block — it ends with the closing `</div>` after the `selectedNode.population > 0` `StatRow` (currently around line 303). The very next block in the file is the "Inline legend" comment and `{selectedArcs.length > 0 && (...)}` block (currently around line 306).

You will insert the new callout between these two blocks.

- [ ] **Step 2: Insert the callout JSX**

Insert the following block immediately after the stats `</div>` (line ~303) and immediately before the `{/* Inline legend */}` comment:

```tsx
{selectedNode.isPortal && outgoingCount === 0 && (
  <div className="mb-4 flex gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
    <div className="text-xs text-amber-100/90 leading-relaxed">
      <p className="font-medium text-amber-300 mb-1">Outgoing shares not visible</p>
      <p>
        This agency operates a transparency portal but lists zero outgoing shares. Flock portals
        allow agencies to redact their &ldquo;Organizations shared with&rdquo; list, so this may
        mean the information is hidden rather than truly absent. Incoming shares shown above are
        confirmed from other portals.
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 3: Type-check the file**

Run: `npm run build`
Expected: Build completes with no TypeScript errors. If there are errors, they should be unrelated to this change — this insertion uses only already-declared identifiers (`selectedNode`, `outgoingCount`, `AlertTriangle`).

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev`
Navigate to the Network tab. Test each case:

1. **Portal with outgoing > 0** — search for "Abington MA PD" (or any portal with connections) and click it. Expected: no amber callout visible.
2. **Portal with zero outgoing + some incoming** — search for a small-town PD that shows cameras/searches but no arcs going *out* from it. Expected: amber callout appears directly below the stats and above the "Connection Types" legend.
3. **Portal with zero total connections** — search for a fully isolated portal. Expected: amber callout appears; the Connection Types legend does not render (the legend is gated on `selectedArcs.length > 0`, which is correct — the callout does not depend on the legend).
4. **Non-portal agency** (no pink ring on the map; no "Flock Portal" button in the panel). Expected: no amber callout regardless of outgoing count.

If you don't know which agencies to pick, open `public/sharing-network-nodes.geojson` and `public/sharing-network-adjacency.json` and spot-check by id.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/NetworkPanelContent.tsx
git commit -m "feat(network): show redaction disclaimer for portals with zero outgoing shares"
```

---

## Task 2: Specialize the Outgoing-tab empty-state copy for zero-outgoing portals

**Files:**
- Modify: `src/components/panels/NetworkPanelContent.tsx` (the empty-state `<p>` in the tabbed connections list, currently around lines 354–357)

**Context for the engineer:**
- `DIRECTION_EMPTY_MSG` (lines 45–49) is a constant map. Keep it untouched — the override is local to the render site because it depends on the currently selected node.
- The current empty-state render is:
  ```tsx
  {activeConnections.length === 0 ? (
    <p className="text-xs text-dark-500 py-2">
      {activeTab === 'all' ? 'No connections.' : DIRECTION_EMPTY_MSG[activeTab]}
    </p>
  ) : (
    ...
  )}
  ```
- For portals specifically, we want the Outgoing tab to say something redaction-aware instead of "No outgoing-only connections."

- [ ] **Step 1: Replace the empty-state ternary**

Locate the empty-state `<p>` (currently around lines 354–357 — inside `{activeConnections.length === 0 ? (...)}`). Replace the inner expression so the Outgoing tab specializes copy for portals with zero outgoing:

```tsx
{activeConnections.length === 0 ? (
  <p className="text-xs text-dark-500 py-2">
    {activeTab === 'outgoing' && selectedNode.isPortal && outgoingCount === 0
      ? 'No outgoing shares visible. This portal may have redacted its "Organizations shared with" list.'
      : activeTab === 'all'
        ? 'No connections.'
        : DIRECTION_EMPTY_MSG[activeTab]}
  </p>
) : (
```

Note: `selectedNode` is guaranteed non-null inside this branch because this entire block is inside the `selectedNode ? (...) : (...)` ternary that opens around line 235. No optional-chaining is needed.

- [ ] **Step 2: Type-check the file**

Run: `npm run build`
Expected: Build completes with no TypeScript errors.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev` (if not already running). In the Network tab:

1. **Portal with zero outgoing** — select it, then click the "Outgoing" tab. Expected: empty-state text reads `No outgoing shares visible. This portal may have redacted its "Organizations shared with" list.`
2. **Portal with outgoing > 0** — select it, click "Outgoing" tab. Expected: the list renders normally (not the empty-state).
3. **Non-portal agency with zero outgoing** (e.g., an agency that only appears as the target of incoming arcs from others). Select it, click "Outgoing" tab. Expected: empty-state falls back to `No outgoing-only connections.` (unchanged behavior).
4. **Any agency, "Mutual" tab empty, "Incoming" tab empty** — confirm their empty-state copy is unchanged: `No mutual connections.` / `No incoming-only connections.`
5. **Any agency, "All" tab empty** — confirm the "All" empty-state is unchanged: `No connections.`

- [ ] **Step 4: Commit**

```bash
git add src/components/panels/NetworkPanelContent.tsx
git commit -m "feat(network): specialize outgoing-tab empty state for zero-outgoing portals"
```

---

## Task 3: Final verification pass

**Files:** None modified.

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: No new lint errors or warnings in `NetworkPanelContent.tsx`. Pre-existing warnings in other files are acceptable.

- [ ] **Step 3: Combined dev-server smoke test**

Run: `npm run dev`. Walk through the Network panel end-to-end:

- Default load: Portal Agencies Only toggle is on (unchanged).
- Click several portals with varying outgoing counts (0, small, large). Confirm callout appears/disappears correctly.
- For a zero-outgoing portal, click through all four tabs (All, Mutual, Outgoing, Incoming) and confirm copy is correct in each.
- Resize to mobile width (or use device emulation) and confirm the same behavior inside `MobileTabDrawer` (the component is shared, so no separate mobile changes were needed).
- Check that the "Portal Agencies Only", "Hover Preview", and "Arc Thickness" controls at the bottom of the panel still work — they are below the selection details and were not touched.

- [ ] **Step 4: No uncommitted changes**

Run: `git status`
Expected: Working tree clean. Two commits on top of the branch point:
1. `feat(network): show redaction disclaimer for portals with zero outgoing shares`
2. `feat(network): specialize outgoing-tab empty state for zero-outgoing portals`
