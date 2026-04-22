# Directional Connection Colors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color arcs and restructure the Network-mode sidebar to distinguish outgoing / incoming / mutual data-sharing relationships for a selected agency.

**Architecture:** Direction is derived in-memory from the existing undirected-looking adjacency JSON by building a reverse index at load time. A single pure helper (`classifyArcs`) tags each neighbor of the selected node as `mutual`, `outgoing`, or `incoming`. Map rendering dispatches arc colors on this tag using one `ArcLayer` with per-arc accessors (no new layers). Sidebar gains three split stat rows, an inline legend, and a three-tab connections list. No raw-data-file or backend changes.

**Tech Stack:** React 18 + TypeScript, Zustand, deck.gl `ArcLayer` / `ScatterplotLayer`, Tailwind CSS, `lucide-react` icons.

**Testing note:** This project has no unit-test framework configured (`package.json` scripts = `dev | build | lint | preview`). Verification uses `npm run build` (strict TypeScript check) + `npm run lint` + manual browser checks against the spec's Testing section. Do NOT install vitest/jest — that's out of scope. If a pure-function unit test is desired later, it can be added as a separate PR.

**Spec:** `docs/superpowers/specs/2026-04-21-network-sharing-directional-colors-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/store/networkStore.ts` | modify | Add `reverseAdjacency`, `Direction`/`DirectionalArc` types, `classifyArcs` helper, build reverse index in `loadNetworkData`, rewrite `setSelectedNodeId` |
| `src/components/map/layers/NetworkLayers.tsx` | modify | Add `DIRECTION_COLORS`, swap arc `getSourceColor`/`getTargetColor` to direction-aware, update hover-arc computation to use `classifyArcs` |
| `src/components/panels/NetworkPanelContent.tsx` | modify | Split stat rows, inline legend block (`ArcSwatch` helper), tabbed connections list |

Three files, three self-contained tasks plus a final verification task. Each task ends with a commit.

---

## Task 1 — Store: reverse index, classifier, directional arcs

**Files:**
- Modify: `src/store/networkStore.ts`

- [ ] **Step 1: Add the `Direction` and `DirectionalArc` types + `classifyArcs` + `buildReverseAdjacency` helpers**

Open `src/store/networkStore.ts`. Directly below the existing `NetworkNode` interface (after line 18), add:

```ts
export type Direction = 'mutual' | 'outgoing' | 'incoming';

export interface DirectionalArc {
  source: NetworkNode;
  target: NetworkNode;
  direction: Direction;
}

/** Invert adjacency so we can answer "who shares inbound to X?" in O(1). */
function buildReverseAdjacency(adjacency: Record<string, string[]>): Record<string, string[]> {
  const reverse: Record<string, string[]> = {};
  for (const sourceId in adjacency) {
    for (const targetId of adjacency[sourceId]) {
      (reverse[targetId] ??= []).push(sourceId);
    }
  }
  return reverse;
}

/** Tag each neighbor of `source` as mutual/outgoing/incoming. */
export function classifyArcs(
  source: NetworkNode,
  nodesMap: Map<string, NetworkNode>,
  adjacency: Record<string, string[]>,
  reverseAdjacency: Record<string, string[]>,
): DirectionalArc[] {
  const outgoing = new Set(adjacency[source.id] ?? []);
  const incoming = new Set(reverseAdjacency[source.id] ?? []);
  const neighborIds = new Set<string>();
  outgoing.forEach(id => neighborIds.add(id));
  incoming.forEach(id => neighborIds.add(id));

  const arcs: DirectionalArc[] = [];
  for (const nid of neighborIds) {
    const target = nodesMap.get(nid);
    if (!target) continue;
    const isOut = outgoing.has(nid);
    const isIn = incoming.has(nid);
    const direction: Direction = isOut && isIn ? 'mutual' : isOut ? 'outgoing' : 'incoming';
    arcs.push({ source, target, direction });
  }
  return arcs;
}
```

- [ ] **Step 2: Update the `NetworkState` interface and initial state**

Find the `NetworkState` interface (starts around line 22). Change the `selectedArcs` type and add `reverseAdjacency`:

Replace:
```ts
  adjacency: Record<string, string[]>;
  selectedNodeId: string | null;
  selectedNode: NetworkNode | null;
  selectedArcs: Array<{ source: NetworkNode; target: NetworkNode }>;
```

With:
```ts
  adjacency: Record<string, string[]>;
  reverseAdjacency: Record<string, string[]>;
  selectedNodeId: string | null;
  selectedNode: NetworkNode | null;
  selectedArcs: DirectionalArc[];
```

Find the `create<NetworkState>((set, get) => ({ ... }))` initializer (around line 116). Add `reverseAdjacency: {},` right after the existing `adjacency: {},` line:

Replace:
```ts
  nodesMap: new Map(),
  nodesArray: [],
  adjacency: {},
  selectedNodeId: null,
```

With:
```ts
  nodesMap: new Map(),
  nodesArray: [],
  adjacency: {},
  reverseAdjacency: {},
  selectedNodeId: null,
```

- [ ] **Step 3: Build the reverse index inside `loadNetworkData`**

Find `loadNetworkData` (around line 132). After the `parseGeoJSON` call and before the `set({ ... loadPhase: 'ready' })` call, build the reverse index and include it in the state update.

Replace:
```ts
        const { nodesMap, nodesArray } = parseGeoJSON(nodesGeoJSON);

        set({
          nodesMap,
          nodesArray,
          adjacency,
          loadPhase: 'ready',
        });
```

With:
```ts
        const { nodesMap, nodesArray } = parseGeoJSON(nodesGeoJSON);
        const reverseAdjacency = buildReverseAdjacency(adjacency);

        set({
          nodesMap,
          nodesArray,
          adjacency,
          reverseAdjacency,
          loadPhase: 'ready',
        });
```

- [ ] **Step 4: Rewrite `setSelectedNodeId` to produce directional arcs**

Find `setSelectedNodeId` (around line 177). Replace its full body with a version that calls `classifyArcs`.

Replace:
```ts
  setSelectedNodeId: (id) => {
    const { nodesMap, adjacency } = get();
    if (!id) {
      set({ selectedNodeId: null, selectedNode: null, selectedArcs: [] });
      return;
    }
    const sourceNode = nodesMap.get(id);
    if (!sourceNode) return;

    const connectedIds = adjacency[id] || [];
    const arcs = connectedIds
      .map(cid => nodesMap.get(cid))
      .filter((n): n is NetworkNode => n != null)
      .map(target => ({ source: sourceNode, target }));

    set({
      selectedNodeId: id,
      selectedNode: sourceNode,
      selectedArcs: arcs,
    });
  },
```

With:
```ts
  setSelectedNodeId: (id) => {
    const { nodesMap, adjacency, reverseAdjacency } = get();
    if (!id) {
      set({ selectedNodeId: null, selectedNode: null, selectedArcs: [] });
      return;
    }
    const sourceNode = nodesMap.get(id);
    if (!sourceNode) return;

    const arcs = classifyArcs(sourceNode, nodesMap, adjacency, reverseAdjacency);

    set({
      selectedNodeId: id,
      selectedNode: sourceNode,
      selectedArcs: arcs,
    });
  },
```

- [ ] **Step 5: Verify the store changes compile**

Run:
```bash
npm run build
```

Expected: build succeeds. `selectedArcs` downstream consumers (`NetworkLayers.tsx`, `NetworkPanelContent.tsx`) still type-check because `DirectionalArc` is a strict superset — it adds the `direction` field without removing `source` or `target`. No new TypeScript errors should appear. If they do, stop and reconcile before moving on.

Also run:
```bash
npm run lint
```

Expected: passes (no new lint errors).

- [ ] **Step 6: Manual smoke test**

Run `npm run dev`. Open `http://localhost:3000`, switch to the Network tab, click any agency node. Arcs should render exactly as before (same colors — agency type colors — because `NetworkLayers.tsx` hasn't been touched yet). The sidebar should still say "Shares data with (N)" and list connections. This confirms the store change did not break anything.

- [ ] **Step 7: Commit**

```bash
git add src/store/networkStore.ts
git commit -m "$(cat <<'EOF'
feat(network): derive directional arcs via reverse adjacency index

Add Direction / DirectionalArc types and a pure classifyArcs helper
that tags each neighbor of the selected node as mutual/outgoing/incoming
using both adjacency and a newly-built reverse index. No rendering or
sidebar changes yet - existing consumers keep working because the new
arc type is a strict superset of the old one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Map rendering: direction-aware arc colors

**Files:**
- Modify: `src/components/map/layers/NetworkLayers.tsx`

- [ ] **Step 1: Import new store members**

Open `src/components/map/layers/NetworkLayers.tsx`. Update the top import to pull in `Direction`, `DirectionalArc`, and `classifyArcs` from the store:

Replace:
```ts
import { useNetworkStore } from '../../../store/networkStore';
import type { NetworkNode } from '../../../store/networkStore';
```

With:
```ts
import { useNetworkStore, classifyArcs } from '../../../store/networkStore';
import type { NetworkNode, Direction, DirectionalArc } from '../../../store/networkStore';
```

- [ ] **Step 2: Add the `DIRECTION_COLORS` constant**

Directly below the existing `NODE_COLORS` constant (line 8-14), add:

```ts
const DIRECTION_COLORS: Record<Direction, [number, number, number]> = {
  outgoing: [249, 115, 22],   // orange  #F97316 - selected agency shares to them
  incoming: [56, 189, 248],   // sky blue #38BDF8 - they share to selected agency
  mutual:   [0, 128, 188],    // accent  #0080BC - both directions
};
```

- [ ] **Step 3: Subscribe to `reverseAdjacency`**

Find the block of `useNetworkStore(s => ...)` selectors (around line 31-40). Add one line for `reverseAdjacency`:

After the existing line:
```ts
  const adjacency = useNetworkStore(s => s.adjacency);
```

Add:
```ts
  const reverseAdjacency = useNetworkStore(s => s.reverseAdjacency);
```

- [ ] **Step 4: Update hover state to use `DirectionalArc`**

Find:
```ts
  const [hoveredArcs, setHoveredArcs] = useState<Array<{ source: NetworkNode; target: NetworkNode }>>([]);
```

Replace with:
```ts
  const [hoveredArcs, setHoveredArcs] = useState<DirectionalArc[]>([]);
```

- [ ] **Step 5: Replace the hover-arc construction with `classifyArcs`**

Find `handleNodeHover` (around line 57-82). Inside the `setTimeout` callback, replace the manual arc construction with `classifyArcs`.

Replace:
```ts
        hoverDebounceRef.current = setTimeout(() => {
          // ~16ms ≈ one frame at 60fps
          const connectedIds = adjacency[node.id] || [];
          const arcs = connectedIds
            .map(cid => nodesMap.get(cid))
            .filter((n): n is NetworkNode => n != null)
            .map(target => ({ source: node, target }));
          setHoveredArcs(arcs);
        }, 16);
```

With:
```ts
        hoverDebounceRef.current = setTimeout(() => {
          // ~16ms ≈ one frame at 60fps
          const arcs = classifyArcs(node, nodesMap, adjacency, reverseAdjacency);
          setHoveredArcs(arcs);
        }, 16);
```

Also update the dependency array on `handleNodeHover` (the `useCallback` at the end of this block): `adjacency, nodesMap, hoveredArcs.length` → add `reverseAdjacency`:

Replace:
```ts
  }, [setHoveredNode, hoverArcsEnabled, selectedNodeId, adjacency, nodesMap, hoveredArcs.length]);
```

With:
```ts
  }, [setHoveredNode, hoverArcsEnabled, selectedNodeId, adjacency, reverseAdjacency, nodesMap, hoveredArcs.length]);
```

- [ ] **Step 6: Rewrite the selected-arc `ArcLayer` color accessors**

Find the selected-arc `ArcLayer` block (around line 128-144). Replace its `getSourceColor` and `getTargetColor` with direction-aware versions. The rest of the layer (width, height, greatCircle, etc.) stays unchanged.

Replace:
```ts
      result.push(
        new ArcLayer<{ source: NetworkNode; target: NetworkNode }>({
          id: 'network-arcs',
          data: selectedArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => NODE_COLORS[d.source.type] || NODE_COLORS.other,
          getTargetColor: (d) => NODE_COLORS[d.target.type] || NODE_COLORS.other,
          getWidth: arcWidth * 4,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 4)),
        })
      );
```

With:
```ts
      result.push(
        new ArcLayer<DirectionalArc>({
          id: 'network-arcs',
          data: selectedArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            // Selected-node end: bright for outgoing, faded for incoming, even for mutual.
            const alpha = d.direction === 'outgoing' ? 220 : d.direction === 'incoming' ? 70 : 200;
            return [c[0], c[1], c[2], alpha];
          },
          getTargetColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            // Neighbor end: faded for outgoing, bright for incoming, even for mutual.
            const alpha = d.direction === 'outgoing' ? 70 : d.direction === 'incoming' ? 220 : 200;
            return [c[0], c[1], c[2], alpha];
          },
          getWidth: arcWidth * 4,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 4)),
        })
      );
```

- [ ] **Step 7: Rewrite the hover-arc `ArcLayer` color accessors**

Find the hover-arc `ArcLayer` block (around line 148-162). Replace with direction-aware half-alpha version.

Replace:
```ts
      result.push(
        new ArcLayer<{ source: NetworkNode; target: NetworkNode }>({
          id: 'network-hover-arcs',
          data: hoveredArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => [...(NODE_COLORS[d.source.type] || NODE_COLORS.other), 140] as [number, number, number, number],
          getTargetColor: (d) => [...(NODE_COLORS[d.target.type] || NODE_COLORS.other), 140] as [number, number, number, number],
          getWidth: arcWidth * 3,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 3)),
        })
      );
```

With:
```ts
      result.push(
        new ArcLayer<DirectionalArc>({
          id: 'network-hover-arcs',
          data: hoveredArcs,
          getSourcePosition: (d) => d.source.coordinates,
          getTargetPosition: (d) => d.target.coordinates,
          getSourceColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            const alpha = d.direction === 'outgoing' ? 110 : d.direction === 'incoming' ? 35 : 100;
            return [c[0], c[1], c[2], alpha];
          },
          getTargetColor: (d) => {
            const c = DIRECTION_COLORS[d.direction];
            const alpha = d.direction === 'outgoing' ? 35 : d.direction === 'incoming' ? 110 : 100;
            return [c[0], c[1], c[2], alpha];
          },
          getWidth: arcWidth * 3,
          getHeight: 1,
          greatCircle: true,
          widthMinPixels: 1,
          widthMaxPixels: Math.max(1, Math.ceil(arcWidth * 3)),
        })
      );
```

- [ ] **Step 8: Type-check and lint**

```bash
npm run build
npm run lint
```

Expected: both pass. `selectedArcs.some(a => a.target.id === d.id)` in the `ScatterplotLayer` `getFillColor` accessor (around line 102-108) continues to work against `DirectionalArc` — do not touch it.

- [ ] **Step 9: Manual browser verification**

`npm run dev` → Network tab → click an agency that likely has a mix of mutual/out-only/in-only neighbors (any portal agency with a lot of connections). Verify:

- Arcs now render in **three colors**: accent (mutual), orange (outgoing-only), sky blue (incoming-only).
- Outgoing arcs visibly fade from bright (selected end) → dim (neighbor end).
- Incoming arcs fade from dim (selected end) → bright (neighbor end).
- Mutual arcs are uniformly bright accent.
- Non-connected nodes still dim correctly.
- Hover preview arcs (toggle "Hover Preview" on, deselect any node, hover a node) render with the same three-color scheme at lower opacity.

The sidebar still says "Shares data with (N)" — that's expected; Task 3 handles it.

- [ ] **Step 10: Commit**

```bash
git add src/components/map/layers/NetworkLayers.tsx
git commit -m "$(cat <<'EOF'
feat(network): color arcs by direction with bright-to-faded gradient

Selected-node arcs now use orange (outgoing), sky blue (incoming),
and the brand accent (mutual). Directed arcs fade from the bright
end to the dim end, giving an implicit flow direction without
drawing arrowheads. Hover-preview arcs use the same palette at
half alpha. Single ArcLayer - no new draw calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Sidebar: split stat rows + inline legend

**Files:**
- Modify: `src/components/panels/NetworkPanelContent.tsx`

- [ ] **Step 1: Update imports**

Open `src/components/panels/NetworkPanelContent.tsx`. Update the `lucide-react` import to add `ArrowUpRight` and `ArrowDownLeft`:

Replace:
```ts
import { Search, X, ChevronDown, ChevronUp, Camera, ScanSearch, Car, AlertTriangle, Link2, Users } from 'lucide-react';
```

With:
```ts
import { Search, X, ChevronDown, ChevronUp, Camera, ScanSearch, Car, AlertTriangle, Link2, Users, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useId } from 'react';
```

Also update the type import to bring in `Direction`:

Replace:
```ts
import type { NetworkNode } from '../../store/networkStore';
```

With:
```ts
import type { NetworkNode, Direction, DirectionalArc } from '../../store/networkStore';
```

Note: `useState, useEffect, useMemo, useCallback` are already imported on line 1. Add `useId` either via that line or the separate import shown above — pick one and keep the file consistent.

- [ ] **Step 2: Add direction color constants and the `ArcSwatch` helper**

Below the existing `TYPE_COLORS` block (around line 19-25), add:

```tsx
const DIRECTION_HEX: Record<Direction, string> = {
  outgoing: '#F97316',
  incoming: '#38BDF8',
  mutual:   '#0080BC',
};

const DIRECTION_DOT: Record<Direction, string> = {
  outgoing: 'bg-orange-500',
  incoming: 'bg-sky-400',
  mutual:   'bg-accent',
};

const DIRECTION_TAB_LABEL: Record<Direction, string> = {
  mutual: 'Mutual',
  outgoing: 'Outgoing',
  incoming: 'Incoming',
};

const DIRECTION_EMPTY_MSG: Record<Direction, string> = {
  mutual: 'No mutual connections.',
  outgoing: 'No outgoing-only connections.',
  incoming: 'No incoming-only connections.',
};

/** Small inline SVG arc swatch that matches the map's gradient treatment. */
function ArcSwatch({ direction }: { direction: Direction }) {
  const reactId = useId();
  const gradId = `arc-swatch-${direction}-${reactId}`;
  const color = DIRECTION_HEX[direction];

  if (direction === 'mutual') {
    return (
      <svg width="22" height="10" viewBox="0 0 22 10" className="flex-shrink-0">
        <path d="M2 8 Q 11 -1 20 8" stroke={color} strokeOpacity="0.85" strokeWidth="1.75" fill="none" strokeLinecap="round" />
      </svg>
    );
  }

  const fromOpacity = direction === 'outgoing' ? 0.9 : 0.25;
  const toOpacity   = direction === 'outgoing' ? 0.25 : 0.9;

  return (
    <svg width="22" height="10" viewBox="0 0 22 10" className="flex-shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0%" x2="100%">
          <stop offset="0%"   stopColor={color} stopOpacity={fromOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity={toOpacity} />
        </linearGradient>
      </defs>
      <path d="M2 8 Q 11 -1 20 8" stroke={`url(#${gradId})`} strokeWidth="1.75" fill="none" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 3: Split the single Connections stat row into three directional rows**

Find the Stats block inside `NetworkPanelContent` (around line 200-221). The current `<StatRow icon={Link2} label="Connections" value={formatNumber(selectedNode.connectionCount)} />` line must be replaced with three rows computed from `selectedArcs`.

First, compute the three counts. Find the existing computation block (just above the `return` of the component, around line 104-107):

```ts
  const isLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const connections = selectedArcs.map(a => a.target);
  const visibleConnections = showAll ? connections : connections.slice(0, INITIAL_SHOW_COUNT);
  const hasMore = connections.length > INITIAL_SHOW_COUNT;
```

Replace with:
```ts
  const isLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const mutualCount   = useMemo(() => selectedArcs.filter(a => a.direction === 'mutual').length,   [selectedArcs]);
  const outgoingCount = useMemo(() => selectedArcs.filter(a => a.direction === 'outgoing').length, [selectedArcs]);
  const incomingCount = useMemo(() => selectedArcs.filter(a => a.direction === 'incoming').length, [selectedArcs]);
```

(Do not remove `connections` / `visibleConnections` / `hasMore` yet if they are referenced below — Task 4 removes the old connections list entirely. For now, leave them in place so this task compiles. If TypeScript complains about `connections` no longer being used after you replace the stat row, that's fine; remove them in Task 4.)

Now find the single Connections row inside the Stats block:
```tsx
                <StatRow icon={Link2} label="Connections" value={formatNumber(selectedNode.connectionCount)} />
```

Replace with three conditional rows:
```tsx
                {mutualCount > 0 && (
                  <StatRow icon={Link2} label="Mutual" value={formatNumber(mutualCount)} colorClass={DIRECTION_DOT.mutual} />
                )}
                {outgoingCount > 0 && (
                  <StatRow icon={ArrowUpRight} label="Outgoing only" value={formatNumber(outgoingCount)} colorClass={DIRECTION_DOT.outgoing} />
                )}
                {incomingCount > 0 && (
                  <StatRow icon={ArrowDownLeft} label="Incoming only" value={formatNumber(incomingCount)} colorClass={DIRECTION_DOT.incoming} />
                )}
                {mutualCount + outgoingCount + incomingCount === 0 && (
                  <StatRow icon={Link2} label="Connections" value="0" />
                )}
```

Note: `StatRow` currently does not accept a `colorClass` prop. Update its signature.

Find the existing `StatRow` component (around line 33-41):
```tsx
function StatRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <Icon className="w-4 h-4 text-dark-400 flex-shrink-0" />
      <span className="text-sm text-dark-300 flex-1">{label}</span>
      <span className="text-sm font-medium text-white tabular-nums">{value}</span>
    </div>
  );
}
```

Replace with:
```tsx
function StatRow({ icon: Icon, label, value, colorClass }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <Icon className="w-4 h-4 text-dark-400 flex-shrink-0" />
      <span className="text-sm text-dark-300 flex-1">{label}</span>
      {colorClass && (
        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} aria-hidden />
      )}
      <span className="text-sm font-medium text-white tabular-nums">{value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Add the inline legend block above the connections list**

The existing connections list block starts with `{connections.length > 0 && (` (around line 223-253). We insert the legend just before it, and only render it when the selected node has at least one connection.

Just above `{connections.length > 0 && (`, insert:

```tsx
              {selectedArcs.length > 0 && (
                <div className="mb-4 pb-3 border-b border-dark-700/50 space-y-1.5">
                  <p className="text-xs text-dark-400 uppercase tracking-wider font-medium mb-2">Connection Types</p>
                  <div className="flex items-center gap-2">
                    <ArcSwatch direction="mutual" />
                    <span className="text-xs text-dark-300">Mutual</span>
                    <span className="text-xs text-dark-500 ml-auto">both share</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArcSwatch direction="outgoing" />
                    <span className="text-xs text-dark-300">Outgoing</span>
                    <span className="text-xs text-dark-500 ml-auto">{selectedNode.name.length > 20 ? 'selected' : selectedNode.name} shares to them</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArcSwatch direction="incoming" />
                    <span className="text-xs text-dark-300">Incoming</span>
                    <span className="text-xs text-dark-500 ml-auto">they share to {selectedNode.name.length > 20 ? 'selected' : selectedNode.name}</span>
                  </div>
                </div>
              )}
```

- [ ] **Step 5: Type-check, lint, manual verify**

```bash
npm run build
npm run lint
```

Expected: both pass. If unused-var warnings about `connections`/`visibleConnections`/`hasMore` appear, ignore them for now — Task 4 removes them.

Run `npm run dev`, select any portal agency. Verify:
- Stat rows now show Mutual / Outgoing only / Incoming only as separate rows with colored dots.
- Inline legend block appears above the connections list with three arc swatches matching the map colors.
- The existing connections list still renders (flat "Shares data with" — Task 4 replaces it).

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/NetworkPanelContent.tsx
git commit -m "$(cat <<'EOF'
feat(network): split connections stat into directional rows + inline legend

The selected-node sidebar now shows Mutual / Outgoing / Incoming as
three separate stat rows with color dots matching the arc colors, and
an inline legend block with SVG arc swatches that render the same
gradient treatment as the map. Connections list is unchanged for now -
the tabbed rewrite follows in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Sidebar: tabbed connections list

**Files:**
- Modify: `src/components/panels/NetworkPanelContent.tsx`

- [ ] **Step 1: Add tab state**

Find the top of the `NetworkPanelContent` component body. The existing state is:
```ts
  const [showAll, setShowAll] = useState(false);
```

Replace with:
```ts
  const [showAll, setShowAll] = useState(false);
  const [activeTab, setActiveTab] = useState<Direction>('mutual');
```

- [ ] **Step 2: Reset `showAll` on tab change and selection change**

Find the existing effect:
```ts
  // Reset showAll when selected node changes
  useEffect(() => {
    setShowAll(false);
  }, [selectedNode?.id]);
```

Replace with:
```ts
  // Reset showAll and default tab whenever selection changes
  useEffect(() => {
    setShowAll(false);
    setActiveTab('mutual');
  }, [selectedNode?.id]);

  // Reset showAll whenever the active tab changes
  useEffect(() => {
    setShowAll(false);
  }, [activeTab]);
```

- [ ] **Step 3: Compute per-direction connection buckets**

Find the computation block you last edited:
```ts
  const isLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const mutualCount   = useMemo(() => selectedArcs.filter(a => a.direction === 'mutual').length,   [selectedArcs]);
  const outgoingCount = useMemo(() => selectedArcs.filter(a => a.direction === 'outgoing').length, [selectedArcs]);
  const incomingCount = useMemo(() => selectedArcs.filter(a => a.direction === 'incoming').length, [selectedArcs]);
```

Replace with:
```ts
  const isLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const byDirection = useMemo(() => {
    const buckets: Record<Direction, NetworkNode[]> = { mutual: [], outgoing: [], incoming: [] };
    for (const arc of selectedArcs) buckets[arc.direction].push(arc.target);
    return buckets;
  }, [selectedArcs]);
  const mutualCount   = byDirection.mutual.length;
  const outgoingCount = byDirection.outgoing.length;
  const incomingCount = byDirection.incoming.length;
  const activeConnections = byDirection[activeTab];
  const visibleConnections = showAll ? activeConnections : activeConnections.slice(0, INITIAL_SHOW_COUNT);
  const hasMore = activeConnections.length > INITIAL_SHOW_COUNT;
```

This removes the now-unused separate `useMemo` count calls and gives us the per-tab list.

- [ ] **Step 4: Replace the flat connections list with the tabbed version**

Find the existing connections block:
```tsx
              {/* Connections list */}
              {connections.length > 0 && (
                <div>
                  <p className="text-xs text-dark-400 uppercase tracking-wider font-medium mb-2">
                    Shares data with ({connections.length})
                  </p>
                  <div className="space-y-0.5">
                    {visibleConnections.map(node => (
                      <button
                        key={node.id}
                        onClick={() => handleConnectionClick(node)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-dark-800 transition-colors group"
                      >
                        <span className="text-sm text-dark-200 group-hover:text-white">{node.name}</span>
                      </button>
                    ))}
                  </div>
                  {hasMore && (
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="w-full flex items-center justify-center gap-1.5 mt-2 py-1.5 text-xs text-accent hover:text-accent transition-colors"
                    >
                      {showAll ? (
                        <>Show less <ChevronUp className="w-3 h-3" /></>
                      ) : (
                        <>Show all {connections.length} <ChevronDown className="w-3 h-3" /></>
                      )}
                    </button>
                  )}
                </div>
              )}
```

Replace with:
```tsx
              {/* Tabbed connections list */}
              {selectedArcs.length > 0 && (
                <div>
                  <div className="flex gap-1 mb-2 border-b border-dark-700/50">
                    {(['mutual', 'outgoing', 'incoming'] as const).map(dir => {
                      const count = byDirection[dir].length;
                      const isActive = activeTab === dir;
                      return (
                        <button
                          key={dir}
                          onClick={() => setActiveTab(dir)}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                            isActive ? 'text-white border-accent' : 'text-dark-400 border-transparent hover:text-white'
                          }`}
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${DIRECTION_DOT[dir]}`} aria-hidden />
                          {DIRECTION_TAB_LABEL[dir]} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {activeConnections.length === 0 ? (
                    <p className="text-xs text-dark-500 py-2">{DIRECTION_EMPTY_MSG[activeTab]}</p>
                  ) : (
                    <>
                      <div className="space-y-0.5">
                        {visibleConnections.map(node => (
                          <button
                            key={node.id}
                            onClick={() => handleConnectionClick(node)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-dark-800 transition-colors group"
                          >
                            <span className="text-sm text-dark-200 group-hover:text-white">{node.name}</span>
                          </button>
                        ))}
                      </div>
                      {hasMore && (
                        <button
                          onClick={() => setShowAll(!showAll)}
                          className="w-full flex items-center justify-center gap-1.5 mt-2 py-1.5 text-xs text-accent hover:text-accent transition-colors"
                        >
                          {showAll ? (
                            <>Show less <ChevronUp className="w-3 h-3" /></>
                          ) : (
                            <>Show all {activeConnections.length} <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
```

- [ ] **Step 5: Type-check, lint, manual verify**

```bash
npm run build
npm run lint
```

Expected: both pass, and no unused-variable warnings remain (the old `connections` / `visibleConnections` / `hasMore` scoped to the flat list are gone — `visibleConnections` and `hasMore` are reused from the new computation).

Run `npm run dev`. On the Network tab, click any connection-rich portal agency and verify against the spec's Testing section:

- **Tabbed list:** three tabs (Mutual / Outgoing / Incoming), each showing its count. Default tab is Mutual. Clicking a tab swaps the list.
- **Empty tabs:** click a tab with a 0 count → placeholder message appears ("No incoming-only connections." etc.).
- **Show all / show less** pagination works per-tab and resets when switching tabs.
- **Color dots** next to each tab label match the arc colors.
- Clicking a connection in any tab still flies the map to that agency and selects it (existing `handleConnectionClick` behavior — untouched).
- **Mobile:** resize browser to narrow width. Tabs wrap or remain usable; stat rows and legend stack cleanly.
- **Three test agencies:** verify a mostly-mutual agency (e.g., a big CA PD), an outgoing-heavy agency, and one with incoming-only neighbors. Counts across tabs should look plausible against what you know of the data.
- **Regression:** Escape-to-clear-selection still works. Non-connected nodes still dim when a node is selected. Route / Explore / Density modes unaffected (switch to each and back).

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/NetworkPanelContent.tsx
git commit -m "$(cat <<'EOF'
feat(network): tabbed connections list by direction

Replace the flat 'Shares data with' list with a three-tab block
(Mutual / Outgoing / Incoming), each tab carrying a count and a
color dot. Show-all pagination is preserved per tab and resets on
tab or selection change. Empty tabs show a muted placeholder so
the category's existence is still communicated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Clean build + lint**

```bash
npm run build
npm run lint
```

Expected: both pass with no errors and no new warnings.

- [ ] **Step 2: Full manual QA against the spec's Testing section**

Re-run through the spec's Testing section end-to-end in `npm run dev`. Everything listed there should be green. If any item fails, fix in a follow-up commit rather than amending.

- [ ] **Step 3: Review the commit series**

```bash
git log --oneline master..HEAD
```

Expected: four commits (one per task 1-4) plus the spec commit, totaling five commits on `network-sharing-data-redesign` beyond `master`.

- [ ] **Step 4: Done**

Feature is complete on `network-sharing-data-redesign`. Decide separately (via `superpowers:finishing-a-development-branch` when you're ready) whether to open a PR or merge locally.

---

## Self-Review

**Spec coverage:**
- Data model (reverse index, classifier, types) → Task 1 ✓
- Direction color palette → Task 2 ✓
- Arc source/target alpha table → Task 2 Steps 6 & 7 ✓
- Hover-arc classification via shared helper → Task 2 Steps 1 & 5 ✓
- Node coloring unchanged → Task 2 Step 8 (verification) ✓
- Split stat rows → Task 3 Step 3 ✓
- Inline legend with SVG swatches → Task 3 Steps 2 & 4 ✓
- Tabbed connections list with default Mutual, per-tab pagination, empty placeholders → Task 4 ✓
- Mobile drawer reuse verified → Task 4 Step 5 ✓
- Out-of-scope items (raw data, backend, node colors, floating legend) → none of the tasks touch them ✓

**Placeholder scan:** No TBD/TODO/"etc." in any step. Every code-changing step contains the literal code to add or replace.

**Type consistency:** `Direction`, `DirectionalArc`, and `classifyArcs` are defined in Task 1 and imported consistently in Tasks 2 and 3. `StatRow` signature change in Task 3 Step 3 is the only API surface change in the file and is applied before its new callers. `byDirection` / `activeConnections` / `visibleConnections` / `hasMore` in Task 4 are defined before use in the same task. `reverseAdjacency` store field is added in Task 1 Step 2 and consumed in Task 2 Step 3.

**Reconciliation note:** `NetworkNode.connectionCount` (from the GeoJSON source) may not equal `mutualCount + outgoingCount + incomingCount` if the source data computed it using a different definition (e.g., counted only outbound, or double-counted mutual). The sidebar does not display `connectionCount` anywhere directly after these changes (the stat rows are all derived from `selectedArcs`), and the search-results dropdown continues to display `connectionCount` as "N connections" which is fine as a rough degree indicator. No code change needed for this; it's flagged here so the engineer doesn't panic if the numbers differ.
