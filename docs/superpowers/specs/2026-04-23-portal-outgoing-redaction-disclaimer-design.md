# Portal Outgoing-Share Redaction Disclaimer

**Date:** 2026-04-23
**Status:** Approved for implementation
**Scope:** `src/components/panels/NetworkPanelContent.tsx` (used by both desktop `NetworkPanel` and `MobileTabDrawer`)

## Motivation

In the Network tab, 378 of 906 transparency portals (~42%) show zero outgoing shares. Of those, 325 still receive incoming shares from other agencies — indicating they have an active network presence but no visible outgoing list. Flock transparency portals allow agencies to redact their "Organizations shared with" list, so a displayed zero is indistinguishable from "not shown."

The underlying data (`public/sharing-network-nodes.geojson` and `sharing-network-adjacency.json`) does not carry a `redacted` / `outgoingHidden` flag. We cannot distinguish a true zero from a redacted zero at the data layer.

Users viewing a portal with zero outgoing shares currently see no indication that the absence may be a reporting artifact rather than an empirical fact. This risks understating the sharing network's scope.

## Goal

When a user selects a transparency-portal agency in the Network panel and that portal has zero outgoing connections, display a disclaimer explaining that the displayed zero may reflect a redacted list rather than a true absence.

## Non-Goals

- Filtering zero-outgoing portals from the map or search.
- Changing the existing "Portal Agencies Only" toggle behavior (already defaults to `true`).
- Distinguishing truly-zero from redacted at the data layer.
- Applying the disclaimer to non-portal agencies (they have no public shares list to redact).
- Any change to other app modes (Route, Explore, Density).

## Design

Two surfaces, both scoped to `selectedNode.isPortal === true && outgoingCount === 0`:

### 1. Callout block under the stats

**Placement:** In `NetworkPanelContent.tsx`, immediately after the stats block (after the closing `</div>` of the block ending at line 303 in the current file), before the "Connection Types" inline legend.

**Condition:** `selectedNode.isPortal && outgoingCount === 0`.

**Markup (approximate):**

```tsx
<div className="mb-4 flex gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
  <div className="text-xs text-amber-100/90 leading-relaxed">
    <p className="font-medium text-amber-300 mb-1">Outgoing shares not visible</p>
    <p>
      This agency operates a transparency portal but lists zero outgoing shares. Flock portals allow
      agencies to redact their &ldquo;Organizations shared with&rdquo; list, so this may mean the
      information is hidden rather than truly absent. Incoming shares shown above are confirmed from
      other portals.
    </p>
  </div>
</div>
```

`AlertTriangle` is already imported from `lucide-react` at the top of the file.

### 2. Outgoing-tab empty-state override

**Placement:** The empty-state rendered at lines 354–357 of the current file.

**Current behavior:** When `activeConnections.length === 0`, renders `DIRECTION_EMPTY_MSG[activeTab]` (for the `outgoing` tab: `"No outgoing-only connections."`).

**New behavior:** If `activeTab === 'outgoing'` and `selectedNode?.isPortal && outgoingCount === 0`, render the redaction-aware copy instead:

```
No outgoing shares visible. This portal may have redacted its "Organizations shared with" list.
```

For all other cases, keep the existing `DIRECTION_EMPTY_MSG` text.

**Implementation sketch:**

```tsx
{activeConnections.length === 0 ? (
  <p className="text-xs text-dark-500 py-2">
    {activeTab === 'outgoing' && selectedNode?.isPortal && outgoingCount === 0
      ? 'No outgoing shares visible. This portal may have redacted its "Organizations shared with" list.'
      : activeTab === 'all' ? 'No connections.' : DIRECTION_EMPTY_MSG[activeTab]}
  </p>
) : ( ... )}
```

## Copy (final)

**Callout heading:** `Outgoing shares not visible`

**Callout body:**
> This agency operates a transparency portal but lists zero outgoing shares. Flock portals allow agencies to redact their "Organizations shared with" list, so this may mean the information is hidden rather than truly absent. Incoming shares shown above are confirmed from other portals.

**Tab empty-state:**
> No outgoing shares visible. This portal may have redacted its "Organizations shared with" list.

## Files Changed

- `src/components/panels/NetworkPanelContent.tsx` — add conditional callout; specialize outgoing-tab empty-state text.

No new files. No data-layer changes. No new dependencies. No store changes.

## Testing

Manual verification on dev server:
- Select a portal with outgoing > 0 (e.g., Abington MA PD, 112 connections): no callout, unchanged behavior.
- Select a portal with outgoing = 0 and incoming > 0: callout visible under stats; Outgoing tab shows redaction copy.
- Select a portal with 0 total connections: callout visible; Outgoing tab shows redaction copy.
- Select a non-portal agency with 0 outgoing: no callout; Outgoing tab shows existing "No outgoing-only connections." copy.
- Verify on mobile via `MobileTabDrawer` (same component, should just work).

## Risks

- **Over-applying the disclaimer to truly-zero portals.** Accepted — per decision, the harm of false reassurance (hiding the redaction caveat) outweighs the harm of a false caveat on the ~53 fully-isolated portals.
- **Copy density.** The callout adds ~3 lines to the selected-node panel. Mitigated by only showing it conditionally.
