# Network Sharing — Directional Connection Colors

**Date:** 2026-04-21
**Branch:** `network-sharing-data-redesign`
**Scope:** Network mode only (`NetworkLayers.tsx`, `NetworkPanelContent.tsx`, `networkStore.ts`)

## Goal

In Network mode, distinguish **outgoing**, **incoming**, and **mutual** data-sharing relationships for a selected agency using three distinct arc colors on the map and a restructured sidebar. No changes to raw data files or the backend.

## Non-Goals

- No changes to `public/sharing-network-adjacency.json` or `public/sharing-network-nodes.geojson`.
- No changes to node coloring (nodes remain colored by agency type).
- No on-map floating legend; the legend lives inline in the sidebar.
- No changes to Route / Explore / Density modes.
- No changes to the `connectionCount` field stored on each node.

## Data model

### Source of truth

`adjacency: Record<string, string[]>` already exists and is interpreted as: `A: [B]` means **"A shares data outbound to B."** This interpretation is confirmed and does not change.

### Derived structure

Add one in-memory structure, built once during `loadNetworkData()`:

```ts
// Inverse of adjacency: who shares inbound to me?
reverseAdjacency: Record<string, string[]>
```

Build pass is O(E) over `adjacency`, executed once in `loadNetworkData()` immediately after the fetch resolves, before `set({ loadPhase: 'ready' })`.

### Edge classification (per-selection)

When a node `X` is selected, each neighbor `Y` in `adjacency[X] ∪ reverseAdjacency[X]` is tagged:

| `X → Y` in adjacency? | `Y → X` in adjacency? | Direction    |
|-----------------------|-----------------------|--------------|
| ✓                     | ✓                     | `mutual`     |
| ✓                     | ✗                     | `outgoing`   |
| ✗                     | ✓                     | `incoming`   |

Classification is implemented once as a pure helper (e.g., `classifyArcs(node, nodesMap, adjacency, reverseAdjacency): DirectionalArc[]`) exported from `networkStore.ts`. It is called from two places: `setSelectedNodeId` (replacing the current arc-building logic) and the hover-arc debounced callback inside `NetworkLayers.tsx`. Same function, same output shape, same colors downstream.

### Types

```ts
export type Direction = 'mutual' | 'outgoing' | 'incoming'

export interface DirectionalArc {
  source: NetworkNode
  target: NetworkNode
  direction: Direction
}
```

`selectedArcs: DirectionalArc[]` replaces the existing untagged `selectedArcs` array. Same for `hoveredArcs` state local to `NetworkLayers`.

`NetworkNode.connectionCount` remains unchanged. It is used only in the search-results preview and still represents total degree, which is valid.

## Rendering

All rendering changes are in `src/components/map/layers/NetworkLayers.tsx`.

### Direction color palette

```ts
const DIRECTION_COLORS: Record<Direction, [number, number, number]> = {
  outgoing: [249, 115, 22],   // #F97316 orange
  incoming: [56, 189, 248],   // #38BDF8 sky blue
  mutual:   [0, 128, 188],    // #0080BC accent
}
```

### Arc color accessors

The existing single `ArcLayer` for selected arcs continues to be a single layer (one draw call). Per-arc direction is read from the tagged arc and colors dispatch on it:

| Direction  | `getSourceColor` (selected node end) | `getTargetColor` (neighbor end) |
|------------|--------------------------------------|---------------------------------|
| `outgoing` | orange @ 220 alpha                   | orange @ 70 alpha               |
| `incoming` | blue @ 70 alpha                      | blue @ 220 alpha                |
| `mutual`   | accent @ 200 alpha                   | accent @ 200 alpha              |

The bright-to-faded gradient on directed arcs reads as implicit flow direction, so no arrowheads are drawn. Mutual arcs have no fade — both endpoints equally prominent.

### Hover-preview arcs

Same palette, but all alpha values halved (matches the existing semi-transparent preview treatment).

### Node coloring

Unchanged. `ScatterplotLayer` continues to color nodes by agency type (`NODE_COLORS`). The existing "dim non-connected nodes while a node is selected" logic continues to work — `selectedArcs.some(a => a.target.id === d.id)` still returns a correct answer against the new tagged arc array.

### Layer count

Still two layers max (`ScatterplotLayer` for nodes, `ArcLayer` for selected arcs, optional `ArcLayer` for hover arcs). No split-by-direction. Performance parity with current implementation.

## Sidebar (`NetworkPanelContent.tsx`)

Changes are scoped to the `selectedNode` branch. The no-selection description and the global settings block (portal toggle, hover preview, arc thickness) are unchanged.

### 1. Split stat rows

Replace the current single `🔗 Connections: N` row with three compact rows, each prefixed by a color dot that matches the arc color:

- `🔗 Mutual` — accent dot — count
- `↗ Outgoing only` — orange dot — count
- `↙ Incoming only` — blue dot — count

Rows with a count of 0 are hidden. No grand-total row. Icons: `Link2` (mutual), `ArrowUpRight` (outgoing), `ArrowDownLeft` (incoming), all from `lucide-react`.

### 2. Inline legend

A compact legend block sits directly above the connections tabs, visible only while a node is selected. Three rows:

- accent arc swatch — **Mutual**
- orange arc swatch — **Outgoing** — "selected agency shares to them"
- blue arc swatch — **Incoming** — "they share to selected agency"

Each swatch is a small inline SVG (~12–16 px wide) rendered with the same fade gradient as the map, so legend and map read identically. The block is hidden when nothing is selected.

### 3. Tabbed connections list

Replaces the current `"Shares data with (N)"` block. Three tabs across the top:

- **Mutual (N)** — default tab
- **Outgoing (N)**
- **Incoming (N)**

Clicking a tab swaps the list below. Visual treatment follows existing tab patterns in the codebase.

- Default tab selection: `mutual` (typically largest bucket, most operationally meaningful).
- Empty tabs show a one-line muted placeholder, e.g., "No outgoing-only connections," rather than being hidden.
- The `INITIAL_SHOW_COUNT = 10` / "Show all N" / "Show less" pattern is preserved. A single `showAll` local state is shared across tabs and resets whenever the active tab changes or the selected node changes. This keeps state minimal and matches user expectation that switching categories starts fresh.

### Mobile

No mobile-specific changes. `MobileTabDrawer` reuses `NetworkPanelContent`, so the tabbed connections list and split stat rows carry over automatically.

## Store changes (`src/store/networkStore.ts`)

New state:

```ts
reverseAdjacency: Record<string, string[]>
```

Initial value: `{}`. Populated in `loadNetworkData()`.

Modified state:

```ts
// Was:
selectedArcs: Array<{ source: NetworkNode; target: NetworkNode }>
// Becomes:
selectedArcs: DirectionalArc[]
```

Modified action: `setSelectedNodeId(id)` now computes directional arcs using both `adjacency` and `reverseAdjacency`.

No change to: `loadPhase`, `nodesMap`, `nodesArray`, `adjacency`, `selectedNodeId`, `selectedNode`, `hoveredNode`, `hoverArcsEnabled`, `arcWidth`, `searchQuery`, `typeFilter`, `portalOnly`, `error`, or any action besides `setSelectedNodeId` and `loadNetworkData`.

## Testing

- Manual verification with three known test cases: a mostly-mutual agency, an outgoing-heavy agency, and (if any exists) an incoming-heavy agency.
- Confirm sum of the three split counts ≥ `connectionCount` in all cases (they may diverge slightly if `connectionCount` was computed with a different definition — a reconciliation note goes into the implementation plan).
- Confirm arc colors and sidebar stat-row colors match visually.
- Confirm hover preview arcs pick up the new palette.
- Mobile drawer: verify tabs and legend render correctly at narrow widths.
- Regression check: node dimming when a node is selected still works.
- Regression check: Escape-to-clear-selection still works.
- Regression check: other app modes (Route, Explore, Density) are unaffected.

## Files changed

- `src/store/networkStore.ts` — add `reverseAdjacency`, change `selectedArcs` shape, update `loadNetworkData` and `setSelectedNodeId`.
- `src/components/map/layers/NetworkLayers.tsx` — new `DIRECTION_COLORS` constant, direction-aware arc color accessors, updated hover-arc classification.
- `src/components/panels/NetworkPanelContent.tsx` — split stat rows, inline legend block, tabbed connections list.

## Out of scope (explicit)

- Changing node colors.
- Floating on-map legend.
- Adding filters for direction (e.g., "show only outgoing connections").
- Editing the raw adjacency JSON or regenerating it.
- Modifying `connectionCount` semantics.
- Any backend or worker changes.
