# Network & Analysis Slow-Connection Loading Implementation Plan

> **Superseded 2026-09-10:** the two network files are no longer bundled in `/public/`. They are fetched from `https://deflockdata.dontgetflocked.com/` (weekly publish, `VITE_NETWORK_DATA_BASE` override); see `src/services/networkDataService.ts`. Paths quoted below are historical.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Progressive data loading plus on-map progress pills for Network mode (~9 MB) and Analysis mode (~3 MB), so slow connections see content early and always know what's happening.

**Architecture:** Each store commits its data files independently as they arrive (nodes before adjacency; states before counties) and tracks per-file streamed download progress. A shared `StatusPill` component (same visual shell as the existing camera `LoadingPill`) surfaces phase text, progress, and tap-to-retry over the map in both modes, on mobile and desktop. `DensityLayers` shows the fast states choropleth as an interim layer while the default County level is still downloading.

**Tech Stack:** React 18 + TypeScript, Zustand, react-map-gl/MapLibre, deck.gl (network layers), Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-network-analysis-loading-design.md`

## Global Constraints

- All new user-facing strings are plain declarative statements. Never use em dashes in copy. Exact strings: "Loading agencies…", "Loading connections…", "Loading regions…", "Loading county detail…", "Couldn't load network data. Tap to retry.", "Couldn't load analysis data. Tap to retry."
- Shared checkout with concurrent sessions: commit atomically per task, stage only files this plan touches, never `git add -A`.
- Lint gate is zero NEW findings: run `npm run lint` before each commit and introduce no new warnings/errors.
- Do not change existing camera `LoadingPill` copy or behavior (its em-dash string predates the copy rule; leave it).
- `docs/` is gitignored; spec/plan commits use `git add -f`.
- Path alias `@/` maps to `src/`; components under `src/components/map/` use relative imports (`../../store/...`) — follow the file's existing import style.
- Tests: Vitest (`npm run test`), fetch stubbed via `vi.stubGlobal('fetch', ...)`, style per `src/store/cameraStore.test.ts`.

---

### Task 1: Byte-level download progress in `readBodyWithProgress`

The progress callback currently reports only a percent, which is `null` (indeterminate) whenever Cloudflare compresses the response. Extend it to also report decompressed bytes received, so pills can show "2.1 MB" when a percent is unknowable. Existing camera callers pass a one-parameter callback and compile unchanged.

**Files:**
- Modify: `src/services/cameraDataService.ts:14-59`
- Create: `src/services/readBodyWithProgress.test.ts`

**Interfaces:**
- Produces: `export type DownloadProgressCallback = (percent: number | null, loadedBytes: number) => void` and `export interface DownloadProgress { percent: number | null; loadedBytes: number }` in `src/services/cameraDataService.ts`. Tasks 3-6 import both.

- [ ] **Step 1: Write the failing test**

Create `src/services/readBodyWithProgress.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { readBodyWithProgress } from './cameraDataService';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe('readBodyWithProgress', () => {
  it('reports percent and loaded bytes when Content-Length is present and uncompressed', async () => {
    const onProgress = vi.fn();
    const body = streamOf(['hello', 'world']);
    const response = new Response(body, { headers: { 'Content-Length': '10' } });

    const text = await readBodyWithProgress(response, onProgress);

    expect(text).toBe('helloworld');
    // Final call reports completion with total decompressed bytes
    expect(onProgress).toHaveBeenLastCalledWith(100, 10);
    // Mid-stream calls carry a determinate percent and a running byte count
    const midCalls = onProgress.mock.calls.slice(1, -1);
    expect(midCalls.length).toBeGreaterThan(0);
    for (const [percent, loaded] of midCalls) {
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(99);
      expect(loaded).toBeGreaterThan(0);
    }
  });

  it('reports null percent but real byte counts when Content-Encoding is set', async () => {
    const onProgress = vi.fn();
    const body = streamOf(['hello', 'world']);
    const response = new Response(body, {
      headers: { 'Content-Length': '6', 'Content-Encoding': 'br' },
    });

    const text = await readBodyWithProgress(response, onProgress);

    expect(text).toBe('helloworld');
    // Every mid-stream call: indeterminate percent, growing byte count
    const midCalls = onProgress.mock.calls.slice(1, -1);
    expect(midCalls.length).toBeGreaterThan(0);
    for (const [percent, loaded] of midCalls) {
      expect(percent).toBeNull();
      expect(loaded).toBeGreaterThan(0);
    }
    expect(onProgress).toHaveBeenLastCalledWith(100, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/readBodyWithProgress.test.ts`
Expected: FAIL. The indeterminate test fails because the current implementation never calls `onProgress` per-chunk when indeterminate, and no call passes a second argument.

- [ ] **Step 3: Extend the callback and implementation**

In `src/services/cameraDataService.ts`, replace lines 14-15:

```ts
/** Progress for a streamed dataset download. `null` = indeterminate (unknown total). */
export type DownloadProgressCallback = (percent: number | null, loadedBytes: number) => void;

/** Snapshot of a streamed download, stored by consumers for UI display. */
export interface DownloadProgress {
  percent: number | null;
  loadedBytes: number;
}
```

Then update the body of `readBodyWithProgress` (keep the docstring). Full replacement of the function body:

```ts
export async function readBodyWithProgress(
  response: Response,
  onProgress?: DownloadProgressCallback
): Promise<string> {
  const total = Number(response.headers.get('Content-Length') ?? 0);
  const determinate = total > 0 && !response.headers.get('Content-Encoding');

  if (!response.body) {
    onProgress?.(null, 0);
    const text = await response.text();
    onProgress?.(100, text.length);
    return text;
  }

  onProgress?.(determinate ? 0 : null, 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(
      determinate ? Math.min(99, Math.round((loaded / total) * 100)) : null,
      loaded
    );
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(100, loaded);
  return new TextDecoder().decode(merged);
}
```

Note: the camera store's existing callback `(percent) => set({ downloadProgress: percent })` now fires per-chunk even when indeterminate, repeatedly setting `null`. Zustand selector subscribers compare with `Object.is`, so this causes no extra re-renders.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/services/readBodyWithProgress.test.ts`
Expected: PASS (both tests).

Run: `npm run test`
Expected: PASS. Existing `cameraStore.test.ts` must be unaffected (the callback change is parameter-widening only).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/services/cameraDataService.ts src/services/readBodyWithProgress.test.ts
git commit -m "feat: report streamed byte counts from readBodyWithProgress"
```

---

### Task 2: Shared `StatusPill` component and `formatBytes` helper

Extract the floating-pill visual shell so Network and Analysis pills match the camera pill exactly. `LoadingPill` keeps all its behavior and only imports the shared positioning class.

**Files:**
- Create: `src/components/common/StatusPill.tsx`
- Modify: `src/components/common/LoadingPill.tsx:5-7` (replace local `PILL_BASE` with import)
- Modify: `src/components/common/index.ts` (export `StatusPill`)
- Modify: `src/utils/formatting.ts` (add `formatBytes`)
- Create: `src/utils/formatBytes.test.ts`

**Interfaces:**
- Produces: `StatusPill(props: { loading: boolean; text: string; progressText?: string | null; error?: string | null; onRetry?: () => void })` — renders nothing until `loading` has held for 150ms (via `useDelayedFlag`); renders a tap-to-retry button when `error` is set (error wins over loading). Exports `PILL_BASE` string. `formatBytes(bytes: number): string` returns "640 KB" / "2.1 MB".
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test for formatBytes**

Create `src/utils/formatBytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatting';

describe('formatBytes', () => {
  it('formats sub-MB sizes as whole KB with a 1 KB floor', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(640_000)).toBe('640 KB');
  });

  it('formats MB sizes with one decimal', () => {
    expect(formatBytes(2_100_000)).toBe('2.1 MB');
    expect(formatBytes(9_000_000)).toBe('9.0 MB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/utils/formatBytes.test.ts`
Expected: FAIL with "formatting" has no exported member "formatBytes" (or equivalent).

- [ ] **Step 3: Implement formatBytes**

Append to `src/utils/formatting.ts`:

```ts
/**
 * Human-readable size for streamed downloads: "640 KB", "2.1 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/utils/formatBytes.test.ts`
Expected: PASS.

- [ ] **Step 5: Create StatusPill**

Create `src/components/common/StatusPill.tsx`:

```tsx
import { useDelayedFlag } from '@/hooks/useDelayedFlag';

/** Shared shell for pills floating over the map: bottom-center, above the
 *  mobile drawer via --drawer-height. Also imported by LoadingPill. */
export const PILL_BASE =
  'absolute bottom-[calc(var(--drawer-height,80px)+12px)] lg:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 ' +
  'bg-dark-800/95 backdrop-blur rounded-full pl-3 pr-4 py-2 text-sm text-dark-100 whitespace-nowrap';

interface StatusPillProps {
  loading: boolean;
  text: string;
  /** Optional trailing progress, e.g. "42%" or "2.1 MB" */
  progressText?: string | null;
  /** When set, renders the error variant (wins over loading) */
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Generic loading/error pill for mode data downloads (Network, Analysis).
 * Delayed appearance so fast loads never flash a spinner; error state is a
 * tap-to-retry button matching the camera LoadingPill's treatment.
 */
export function StatusPill({ loading, text, progressText, error, onRetry }: StatusPillProps) {
  const show = useDelayedFlag(loading);

  if (error) {
    return (
      <button
        role="status"
        onClick={onRetry}
        className={`${PILL_BASE} border border-danger/40 hover:border-danger transition-colors`}
      >
        <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
        {error}
      </button>
    );
  }

  if (!show) return null;

  return (
    <div className={`${PILL_BASE} border border-hairline`} role="status" aria-live="polite">
      <span className="w-3.5 h-3.5 border-2 border-dark-600 border-t-accent rounded-full animate-spin shrink-0" />
      {text}
      {progressText && (
        <span className="text-xs text-dark-300 tabular-nums">{progressText}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Point LoadingPill at the shared PILL_BASE**

In `src/components/common/LoadingPill.tsx`, delete the local `PILL_BASE` const (lines 5-7) and add to the imports:

```tsx
import { PILL_BASE } from './StatusPill';
```

Everything else in `LoadingPill` stays byte-for-byte identical.

- [ ] **Step 7: Export from the barrel**

In `src/components/common/index.ts`, after the `LoadingPill` line add:

```ts
export { StatusPill } from './StatusPill';
```

- [ ] **Step 8: Verify build and lint**

Run: `npm run build`
Expected: clean TypeScript check + Vite build.
Run: `npm run lint`
Expected: zero new findings.

- [ ] **Step 9: Commit**

```bash
git add src/components/common/StatusPill.tsx src/components/common/LoadingPill.tsx src/components/common/index.ts src/utils/formatting.ts src/utils/formatBytes.test.ts
git commit -m "feat: shared StatusPill shell and formatBytes helper"
```

---

### Task 3: Progressive loading in networkStore

Nodes (3 MB) and adjacency (6 MB) currently commit together. Split them: nodes commit as soon as they parse (`loadPhase: 'ready'`, dots render), adjacency commits separately (`adjacencyReady`), and a selection made mid-load gets its arcs backfilled. Per-file streamed progress is stored for the pill.

**Files:**
- Modify: `src/store/networkStore.ts` (state shape + `loadNetworkData` rewrite)
- Create: `src/store/networkStore.test.ts`

**Interfaces:**
- Consumes: `readBodyWithProgress`, `DownloadProgress` from `src/services/cameraDataService.ts` (Task 1).
- Produces (Task 4 relies on these exact names on `NetworkState`): `adjacencyReady: boolean`; `nodesProgress: DownloadProgress | null`; `adjacencyProgress: DownloadProgress | null`; `loadPhase: 'idle' | 'fetching' | 'ready' | 'error'` where `'ready'` now means NODES are ready (existing `NetworkLoadPhase` type unchanged); `error: string | null` set on any file's failure; `loadNetworkData()` is also the retry action and refetches only what's missing.

- [ ] **Step 1: Write the failing tests**

Create `src/store/networkStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNetworkStore } from './networkStore';

const NODES_URL = '/sharing-network-nodes.geojson';
const ADJ_URL = '/sharing-network-adjacency.json';

function nodeFeature(id: string, lng = -84.4, lat = 33.7) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { id, name: `Agency ${id}`, type: 'pd', isPortal: true, geocodeMethod: 'exact' },
  };
}

const NODES_BODY = JSON.stringify({
  type: 'FeatureCollection',
  features: [nodeFeature('a'), nodeFeature('b'), nodeFeature('c')],
});
const ADJ_BODY = JSON.stringify({ a: ['b'], b: ['a', 'c'] });

/** fetch stub with a manually-resolvable adjacency response */
function stubFetch(opts: { adjacencyDelayed?: boolean; failAdjacency?: boolean; failNodes?: boolean } = {}) {
  let releaseAdjacency: () => void = () => {};
  const adjacencyGate = new Promise<void>(resolve => { releaseAdjacency = resolve; });

  const fetchMock = vi.fn(async (url: string) => {
    if (url === NODES_URL) {
      if (opts.failNodes) return new Response('', { status: 500 });
      return new Response(NODES_BODY, { status: 200 });
    }
    if (url === ADJ_URL) {
      if (opts.adjacencyDelayed) await adjacencyGate;
      if (opts.failAdjacency) return new Response('', { status: 500 });
      return new Response(ADJ_BODY, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, releaseAdjacency };
}

/** Poll until the store satisfies a predicate (progressive commits are async). */
async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useNetworkStore.setState({
    loadPhase: 'idle',
    adjacencyReady: false,
    nodesMap: new Map(),
    nodesArray: [],
    adjacency: {},
    reverseAdjacency: {},
    selectedNodeId: null,
    selectedNode: null,
    selectedArcs: [],
    nodesProgress: null,
    adjacencyProgress: null,
    error: null,
  });
});

describe('loadNetworkData progressive commits', () => {
  it('commits nodes and flips loadPhase to ready before adjacency arrives', async () => {
    const { releaseAdjacency } = stubFetch({ adjacencyDelayed: true });

    const loadPromise = useNetworkStore.getState().loadNetworkData();
    await waitFor(() => useNetworkStore.getState().loadPhase === 'ready');

    expect(useNetworkStore.getState().nodesArray).toHaveLength(3);
    expect(useNetworkStore.getState().adjacencyReady).toBe(false);

    releaseAdjacency();
    await loadPromise;

    expect(useNetworkStore.getState().adjacencyReady).toBe(true);
    expect(useNetworkStore.getState().reverseAdjacency['a']).toEqual(['b']);
  });

  it('backfills arcs for a selection made while adjacency was streaming', async () => {
    const { releaseAdjacency } = stubFetch({ adjacencyDelayed: true });

    const loadPromise = useNetworkStore.getState().loadNetworkData();
    await waitFor(() => useNetworkStore.getState().loadPhase === 'ready');

    useNetworkStore.getState().setSelectedNodeId('a');
    expect(useNetworkStore.getState().selectedArcs).toHaveLength(0);

    releaseAdjacency();
    await loadPromise;

    const arcs = useNetworkStore.getState().selectedArcs;
    expect(arcs).toHaveLength(1);
    expect(arcs[0].target.id).toBe('b');
    expect(arcs[0].direction).toBe('mutual');
  });

  it('keeps nodes usable when only adjacency fails, and retries just adjacency', async () => {
    const { fetchMock } = stubFetch({ failAdjacency: true });

    await useNetworkStore.getState().loadNetworkData();

    expect(useNetworkStore.getState().loadPhase).toBe('ready');
    expect(useNetworkStore.getState().nodesArray).toHaveLength(3);
    expect(useNetworkStore.getState().error).toMatch(/Adjacency/);

    // Retry: only the adjacency URL is refetched
    fetchMock.mockClear();
    stubFetch({});
    await useNetworkStore.getState().loadNetworkData();

    const retried = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(retried).toEqual([ADJ_URL]);
    expect(useNetworkStore.getState().adjacencyReady).toBe(true);
    expect(useNetworkStore.getState().error).toBeNull();
  });

  it('sets loadPhase to error when the nodes fetch fails', async () => {
    stubFetch({ failNodes: true });

    await useNetworkStore.getState().loadNetworkData();

    expect(useNetworkStore.getState().loadPhase).toBe('error');
    expect(useNetworkStore.getState().error).toMatch(/Nodes/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/store/networkStore.test.ts`
Expected: FAIL. `adjacencyReady`, `nodesProgress`, `adjacencyProgress` do not exist on the store; the progressive-commit and partial-retry assertions fail against the all-or-nothing implementation.

- [ ] **Step 3: Rewrite the store's loading state and loadNetworkData**

In `src/store/networkStore.ts`:

Add the import at the top:

```ts
import { readBodyWithProgress, type DownloadProgress } from '../services/cameraDataService';
```

Update the `NetworkLoadPhase` docable state block in `interface NetworkState` — replace the single `loadPhase` line with:

```ts
  /** Nodes lifecycle. 'ready' means agency dots can render; adjacency may still be streaming. */
  loadPhase: NetworkLoadPhase;
  /** True once adjacency + reverseAdjacency are committed. */
  adjacencyReady: boolean;
  nodesProgress: DownloadProgress | null;
  adjacencyProgress: DownloadProgress | null;
```

Add the matching initial values next to `loadPhase: 'idle'`:

```ts
  adjacencyReady: false,
  nodesProgress: null,
  adjacencyProgress: null,
```

Replace the whole `loadNetworkData` implementation with:

```ts
  loadNetworkData: async () => {
    if (get().loadPhase === 'fetching') return;
    if (_initPromise) return _initPromise;

    const needNodes = get().nodesArray.length === 0;
    const needAdjacency = !get().adjacencyReady;
    if (!needNodes && !needAdjacency) return;

    _initPromise = (async () => {
      set({ error: null, ...(needNodes ? { loadPhase: 'fetching' as const } : {}) });

      // Each file commits the moment it lands: nodes unlock the dot layer
      // (and flip loadPhase to 'ready'); adjacency arrives later and
      // backfills arcs for any selection made in the meantime.
      const nodesTask = needNodes
        ? (async () => {
            const response = await fetch('/sharing-network-nodes.geojson');
            if (!response.ok) throw new Error(`Nodes fetch failed: ${response.status}`);
            const text = await readBodyWithProgress(response, (percent, loadedBytes) => {
              set({ nodesProgress: { percent, loadedBytes } });
            });
            const { nodesMap, nodesArray } = parseGeoJSON(JSON.parse(text));
            set({ nodesMap, nodesArray, loadPhase: 'ready', nodesProgress: null });
          })()
        : Promise.resolve();

      const adjacencyTask = needAdjacency
        ? (async () => {
            const response = await fetch('/sharing-network-adjacency.json');
            if (!response.ok) throw new Error(`Adjacency fetch failed: ${response.status}`);
            const text = await readBodyWithProgress(response, (percent, loadedBytes) => {
              set({ adjacencyProgress: { percent, loadedBytes } });
            });
            const adjacency = JSON.parse(text) as Record<string, string[]>;
            const reverseAdjacency = buildReverseAdjacency(adjacency);
            set({ adjacency, reverseAdjacency, adjacencyReady: true, adjacencyProgress: null });

            // Backfill arcs for a selection made while adjacency streamed
            const { selectedNodeId, nodesMap } = get();
            const source = selectedNodeId ? nodesMap.get(selectedNodeId) : undefined;
            if (source) {
              set({ selectedArcs: classifyArcs(source, nodesMap, adjacency, reverseAdjacency) });
            }
          })()
        : Promise.resolve();

      const [nodesResult, adjacencyResult] = await Promise.allSettled([nodesTask, adjacencyTask]);
      _initPromise = null;

      const failure = [nodesResult, adjacencyResult].find(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      if (failure) {
        console.error('[NetworkStore] Failed to load network data:', failure.reason);
        set((state) => ({
          error: failure.reason instanceof Error ? failure.reason.message : 'Failed to load network data',
          // Failed adjacency after committed nodes leaves the dots usable
          loadPhase: nodesResult.status === 'rejected' ? 'error' : state.loadPhase,
          nodesProgress: null,
          adjacencyProgress: null,
        }));
      }
    })();

    return _initPromise;
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/store/networkStore.test.ts`
Expected: PASS (all 4).

Run: `npm run test`
Expected: PASS across the suite.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/store/networkStore.ts src/store/networkStore.test.ts
git commit -m "feat: progressive nodes/adjacency loading in networkStore"
```

---

### Task 4: Network mode UI — pill, panel gating

**Files:**
- Create: `src/components/map/NetworkLoadingPill.tsx`
- Modify: `src/pages/MapPage.tsx:490` (mount pill)
- Modify: `src/components/panels/NetworkPanelContent.tsx` (connections-loading row; gate zero-connection UI on `adjacencyReady`)
- Modify: `docs/superpowers/specs/2026-07-18-network-analysis-loading-design.md` (spec amendment, see Step 4)

**Interfaces:**
- Consumes: `StatusPill`, `formatBytes` (Task 2); `adjacencyReady`, `nodesProgress`, `adjacencyProgress`, `error`, `loadNetworkData` on `useNetworkStore` (Task 3).
- Produces: `NetworkLoadingPill()` component, mounted from MapPage.

- [ ] **Step 1: Create NetworkLoadingPill**

Create `src/components/map/NetworkLoadingPill.tsx`:

```tsx
import { useNetworkStore } from '../../store/networkStore';
import { StatusPill } from '../common/StatusPill';
import { formatBytes } from '../../utils/formatting';

/** Floating progress pill for the Network mode data download. Nodes phase
 *  first (dots), then adjacency (connections). Mobile and desktop. */
export function NetworkLoadingPill() {
  const loadPhase = useNetworkStore(s => s.loadPhase);
  const adjacencyReady = useNetworkStore(s => s.adjacencyReady);
  const nodesProgress = useNetworkStore(s => s.nodesProgress);
  const adjacencyProgress = useNetworkStore(s => s.adjacencyProgress);
  const error = useNetworkStore(s => s.error);
  const loadNetworkData = useNetworkStore(s => s.loadNetworkData);

  const nodesLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const progress = nodesLoading ? nodesProgress : adjacencyProgress;
  const progressText = progress && (progress.percent != null || progress.loadedBytes > 0)
    ? progress.percent != null
      ? `${progress.percent}%`
      : formatBytes(progress.loadedBytes)
    : null;

  return (
    <StatusPill
      loading={(nodesLoading || !adjacencyReady) && !error}
      text={nodesLoading ? 'Loading agencies…' : 'Loading connections…'}
      progressText={progressText}
      error={error ? "Couldn't load network data. Tap to retry." : null}
      onRetry={() => { void loadNetworkData(); }}
    />
  );
}
```

- [ ] **Step 2: Mount from MapPage**

In `src/pages/MapPage.tsx`, add the import next to the other map component imports (line 12 area):

```tsx
import { NetworkLoadingPill } from '@/components/map/NetworkLoadingPill';
```

Then in the Map Overlays block, directly after `{showCameraPill && <LoadingPill />}` (line 490):

```tsx
            {appMode === 'network' && <NetworkLoadingPill />}
```

- [ ] **Step 3: Panel handling for pending adjacency**

In `src/components/panels/NetworkPanelContent.tsx`:

3a. Add `adjacencyReady` to the destructured store values (line 88-94 block):

```ts
    adjacencyReady,
```

3b. The zero-connection UI must not flash while adjacency is still streaming. Wrap the "Connections 0" StatRow (currently `{mutualCount + outgoingCount + incomingCount === 0 && (...)}`) so it requires `adjacencyReady`:

```tsx
                {adjacencyReady && mutualCount + outgoingCount + incomingCount === 0 && (
                  <StatRow icon={Link2} label="Connections" value="0" />
                )}
```

3c. Same for the amber "Outgoing shares not visible" warning (currently `{selectedNode.isPortal && outgoingCount === 0 && mutualCount === 0 && (...)}`):

```tsx
              {adjacencyReady && selectedNode.isPortal && outgoingCount === 0 && mutualCount === 0 && (
```

3d. Add a connections-loading row directly after the stats `</div>` (the block containing the StatRows), inside the `selectedNode ? (...)` branch:

```tsx
              {!adjacencyReady && (
                <div className="mb-4 flex items-center gap-2 py-1" role="status">
                  <span className="w-3.5 h-3.5 border-2 border-dark-600 border-t-accent rounded-full animate-spin shrink-0" />
                  <span className="text-xs text-dark-400">Loading connections…</span>
                </div>
              )}
```

Note: the connection tabs and inline legend are already gated on `selectedArcs.length > 0`, so they stay hidden until the backfill lands; no change needed there. `NetworkPeekSummary` (mobile) already falls back to `node.connectionCount` from node properties, so it needs no change.

- [ ] **Step 4: Amend the spec's mobile-header line**

During implementation research it turned out `NetworkPanel`'s mobile BottomSheet branch is dead code (MapPage renders `NetworkPanel` only when `!isMobile`; mobile uses `MobileTabDrawer`). In `docs/superpowers/specs/2026-07-18-network-analysis-loading-design.md`, replace the line:

```
- Mobile sheet header: "Loading agencies…" instead of "0 agencies" while nodes load.
```

with:

```
- Mobile: the drawer (`MobileTabDrawer`) already renders identity peeks without
  raw counts, and `NetworkPanel`'s BottomSheet branch is dead code (desktop-only
  mount), so no header copy change is needed; the pill provides mobile feedback.
```

- [ ] **Step 5: Verify build and lint**

Run: `npm run build`
Expected: clean.
Run: `npm run lint`
Expected: zero new findings.

- [ ] **Step 6: Commit**

```bash
git add src/components/map/NetworkLoadingPill.tsx src/pages/MapPage.tsx src/components/panels/NetworkPanelContent.tsx
git add -f docs/superpowers/specs/2026-07-18-network-analysis-loading-design.md
git commit -m "feat: network mode loading pill and pending-adjacency panel states"
```

---

### Task 5: Progressive loading in densityStore

States (260 KB) and counties (2.7 MB) commit independently; `loadPhase: 'ready'` now means states are in. Retry keeps whatever already loaded.

**Files:**
- Modify: `src/services/densityDataService.ts:38-57` (accept `onProgress`)
- Modify: `src/store/densityStore.ts` (progressive commits + progress + retry semantics)
- Create: `src/store/densityStore.test.ts`

**Interfaces:**
- Consumes: `readBodyWithProgress`, `DownloadProgressCallback`, `DownloadProgress` from `src/services/cameraDataService.ts` (Task 1).
- Produces (Task 6 relies on these exact names): `loadDensityData(level: 'state' | 'county', onProgress?: DownloadProgressCallback)`; on `DensityState`: `statesProgress: DownloadProgress | null`, `countiesProgress: DownloadProgress | null`, `loadPhase: 'ready'` once STATES commit, `countiesData` remains `null` until counties commit, `retryLoad()` refetches only missing levels.

- [ ] **Step 1: Write the failing tests**

Create `src/store/densityStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDensityStore } from './densityStore';
import { clearDensityCache } from '../services/densityDataService';

const STATES_URL = '/geo/states-metrics.geojson';
const COUNTIES_URL = '/geo/counties-metrics.geojson';

function fc(geoid: string, population = 100000) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      properties: { GEOID: geoid, population, cameraCount: 5 },
    }],
  });
}

function stubFetch(opts: { countiesDelayed?: boolean; failCounties?: boolean; failStates?: boolean } = {}) {
  let releaseCounties: () => void = () => {};
  const countiesGate = new Promise<void>(resolve => { releaseCounties = resolve; });

  const fetchMock = vi.fn(async (url: string) => {
    if (url === STATES_URL) {
      if (opts.failStates) return new Response('', { status: 500 });
      return new Response(fc('13'), { status: 200 });
    }
    if (url === COUNTIES_URL) {
      if (opts.countiesDelayed) await countiesGate;
      if (opts.failCounties) return new Response('', { status: 500 });
      return new Response(fc('13121'), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, releaseCounties };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  clearDensityCache();
  useDensityStore.setState({
    loadPhase: 'idle',
    statesData: null,
    countiesData: null,
    statesProgress: null,
    countiesProgress: null,
    error: null,
  });
});

describe('loadAllLevels progressive commits', () => {
  it('commits states and flips loadPhase to ready before counties arrive', async () => {
    const { releaseCounties } = stubFetch({ countiesDelayed: true });

    const loadPromise = useDensityStore.getState().loadAllLevels();
    await waitFor(() => useDensityStore.getState().loadPhase === 'ready');

    expect(useDensityStore.getState().statesData?.features).toHaveLength(1);
    expect(useDensityStore.getState().countiesData).toBeNull();

    releaseCounties();
    await loadPromise;

    expect(useDensityStore.getState().countiesData?.features).toHaveLength(1);
  });

  it('keeps states usable when only counties fail, and retry refetches only counties', async () => {
    const { fetchMock } = stubFetch({ failCounties: true });

    await useDensityStore.getState().loadAllLevels();

    expect(useDensityStore.getState().loadPhase).toBe('ready');
    expect(useDensityStore.getState().statesData).not.toBeNull();
    expect(useDensityStore.getState().error).not.toBeNull();

    fetchMock.mockClear();
    stubFetch({});
    await useDensityStore.getState().retryLoad();

    const retried = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(c => c[0]).filter(u => u === STATES_URL || u === COUNTIES_URL);
    expect(retried).toEqual([COUNTIES_URL]);
    expect(useDensityStore.getState().countiesData).not.toBeNull();
    expect(useDensityStore.getState().error).toBeNull();
  });

  it('sets loadPhase to error when the states fetch fails', async () => {
    stubFetch({ failStates: true });

    await useDensityStore.getState().loadAllLevels();

    expect(useDensityStore.getState().loadPhase).toBe('error');
    expect(useDensityStore.getState().error).not.toBeNull();
  });
});
```

Note: `loadDensityData` retries 3 times with backoff (1s, 2s), so the two failure tests take a few seconds each; that is expected.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/store/densityStore.test.ts`
Expected: FAIL. `statesProgress`/`countiesProgress` do not exist; states do not commit before counties; retry currently nukes loaded data and refetches both levels.

- [ ] **Step 3: Add onProgress to loadDensityData**

In `src/services/densityDataService.ts`:

Add the import at the top:

```ts
import { readBodyWithProgress, type DownloadProgressCallback } from './cameraDataService';
```

Change the signature (line 38):

```ts
export async function loadDensityData(
  level: 'state' | 'county',
  onProgress?: DownloadProgressCallback
): Promise<GeoJSON.FeatureCollection> {
```

Replace `const data = await response.json() as GeoJSON.FeatureCollection;` (line 57) with:

```ts
        const data = JSON.parse(
          await readBodyWithProgress(response, onProgress)
        ) as GeoJSON.FeatureCollection;
```

(As with the camera loader, when a second caller awaits the deduped in-flight promise its own `onProgress` is simply not attached; the store is the only progress consumer.)

- [ ] **Step 4: Rewrite densityStore loading**

In `src/store/densityStore.ts`, add the import:

```ts
import type { DownloadProgress } from '../services/cameraDataService';
```

In `interface DensityState`, after `countiesData` add:

```ts
  statesProgress: DownloadProgress | null;
  countiesProgress: DownloadProgress | null;
```

and update the docline on `loadPhase`:

```ts
  /** States lifecycle. 'ready' means the states choropleth can render; counties may still be streaming (countiesData null until committed). */
  loadPhase: DensityLoadPhase;
```

Add initial values next to `countiesData: null`:

```ts
  statesProgress: null,
  countiesProgress: null,
```

Replace `loadAllLevels` and `retryLoad` with:

```ts
  loadAllLevels: async () => {
    const { loadPhase, statesData, countiesData } = get();
    if (loadPhase === 'fetching') return;

    const needStates = !statesData;
    const needCounties = !countiesData;
    if (!needStates && !needCounties) return;

    set({ error: null, ...(needStates ? { loadPhase: 'fetching' as const } : {}) });

    // Each level commits as it lands: states (260 KB) unlock the panel and
    // the choropleth fast; counties (2.7 MB) stream in behind.
    const statesTask = needStates
      ? loadDensityData('state', (percent, loadedBytes) => {
          set({ statesProgress: { percent, loadedBytes } });
        }).then((states) => {
          set((state) => ({
            statesData: states,
            loadPhase: 'ready',
            statesProgress: null,
            dataVersion: state.dataVersion + 1,
          }));
        })
      : Promise.resolve();

    const countiesTask = needCounties
      ? loadDensityData('county', (percent, loadedBytes) => {
          set({ countiesProgress: { percent, loadedBytes } });
        }).then((counties) => {
          set((state) => ({
            countiesData: counties,
            countiesProgress: null,
            dataVersion: state.dataVersion + 1,
          }));
        })
      : Promise.resolve();

    const [statesResult, countiesResult] = await Promise.allSettled([statesTask, countiesTask]);

    const failure = [statesResult, countiesResult].find(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    if (failure) {
      console.error('[DensityStore] Failed to load density data:', failure.reason);
      set((state) => ({
        error: failure.reason instanceof Error ? failure.reason.message : 'Failed to load density data',
        // Failed counties after committed states leave the states layer usable
        loadPhase: statesResult.status === 'rejected' ? 'error' : state.loadPhase,
        statesProgress: null,
        countiesProgress: null,
      }));
    }
  },

  retryLoad: async () => {
    // Keep whatever committed; the service caches per level, so only the
    // missing level(s) refetch.
    set({ loadPhase: get().statesData ? 'ready' : 'idle', error: null });
    return get().loadAllLevels();
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/store/densityStore.test.ts`
Expected: PASS (all 3; the failure tests take a few seconds due to service retries).

Run: `npm run test`
Expected: PASS across the suite.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/services/densityDataService.ts src/store/densityStore.ts src/store/densityStore.test.ts
git commit -m "feat: progressive states/counties loading in densityStore"
```

---

### Task 6: Analysis mode UI — pill and interim states layer

While the default County level is still downloading, show the (fast) states choropleth as an interim layer, and float the pill over the map.

**Files:**
- Create: `src/components/map/DensityLoadingPill.tsx`
- Modify: `src/pages/MapPage.tsx` (mount pill)
- Modify: `src/components/map/layers/DensityLayers.tsx` (effectiveLevel)

**Interfaces:**
- Consumes: `StatusPill`, `formatBytes` (Task 2); `statesProgress`, `countiesProgress`, `countiesData`, `error`, `retryLoad` on `useDensityStore` (Task 5); `densitySettings.level` on `useAppModeStore`.
- Produces: `DensityLoadingPill()` component.

- [ ] **Step 1: Create DensityLoadingPill**

Create `src/components/map/DensityLoadingPill.tsx`:

```tsx
import { useAppModeStore } from '../../store';
import { useDensityStore } from '../../store/densityStore';
import { StatusPill } from '../common/StatusPill';
import { formatBytes } from '../../utils/formatting';

/** Floating progress pill for Analysis mode data. States phase first (the
 *  interim choropleth), then county detail while it streams in behind. */
export function DensityLoadingPill() {
  const loadPhase = useDensityStore(s => s.loadPhase);
  const countiesData = useDensityStore(s => s.countiesData);
  const statesProgress = useDensityStore(s => s.statesProgress);
  const countiesProgress = useDensityStore(s => s.countiesProgress);
  const error = useDensityStore(s => s.error);
  const retryLoad = useDensityStore(s => s.retryLoad);
  const level = useAppModeStore(s => s.densitySettings.level);

  const statesLoading = loadPhase === 'idle' || loadPhase === 'fetching';
  const countiesLoading = level === 'county' && !countiesData;
  const progress = statesLoading ? statesProgress : countiesProgress;
  const progressText = progress && (progress.percent != null || progress.loadedBytes > 0)
    ? progress.percent != null
      ? `${progress.percent}%`
      : formatBytes(progress.loadedBytes)
    : null;

  return (
    <StatusPill
      loading={(statesLoading || countiesLoading) && !error}
      text={statesLoading ? 'Loading regions…' : 'Loading county detail…'}
      progressText={progressText}
      error={error ? "Couldn't load analysis data. Tap to retry." : null}
      onRetry={() => { void retryLoad(); }}
    />
  );
}
```

- [ ] **Step 2: Mount from MapPage**

In `src/pages/MapPage.tsx`, add the import:

```tsx
import { DensityLoadingPill } from '@/components/map/DensityLoadingPill';
```

Next to the network pill mount from Task 4:

```tsx
            {appMode === 'density' && <DensityLoadingPill />}
```

- [ ] **Step 3: Interim states layer in DensityLayers**

In `src/components/map/layers/DensityLayers.tsx`:

3a. After the `const { level, metric, ... } = densitySettings;` line (line 98), derive the effective level and switch the source constants to it:

```ts
  // Interim layer: while the (default) County level is still downloading,
  // show the states choropleth so slow connections see data immediately.
  // Same metric, colors, and legend; it reads as detail sharpening when
  // counties land and visibility swaps.
  const effectiveLevel = level === 'county' && !countiesData && statesData ? 'state' : level;
  const activeSource = effectiveLevel === 'state' ? 'density-states' : 'density-counties';
  const inactiveSource = effectiveLevel === 'state' ? 'density-counties' : 'density-states';
```

3b. The selection-clear effect keys on the rendered level so a selected interim state feature never lingers over the county layer. Change `[level]` to `[effectiveLevel]`:

```ts
  // --- Clear selection when the rendered level changes ---
  useEffect(() => {
    setSelectedFeature(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLevel]);
```

3c. The imperative settings effect toggles visibility on level change by comparing `prev.level !== curr.level`, which cannot see the counties-arrived swap. Track the effective level in a ref instead. Add next to the other refs (line 94-96):

```ts
  const prevEffectiveLevel = useRef(effectiveLevel);
```

In the imperative effect (line 158), replace the level-change block:

```ts
      // Level changed → toggle visibility
      if (prev.level !== curr.level) {
```

with:

```ts
      // Rendered level changed (user toggle OR counties arriving) → toggle visibility
      if (prevEffectiveLevel.current !== effectiveLevel) {
```

and inside that block replace the two `curr.level` visibility derivations and the `toggleViewMode` call:

```ts
        const stateVis = effectiveLevel === 'state' ? 'visible' : 'none';
        const countyVis = effectiveLevel === 'county' ? 'visible' : 'none';
        for (const suffix of ['-fill', '-extrusion', '-outline']) {
          if (map.getLayer(`density-states${suffix}`))
            map.setLayoutProperty(`density-states${suffix}`, 'visibility', stateVis);
          if (map.getLayer(`density-counties${suffix}`))
            map.setLayoutProperty(`density-counties${suffix}`, 'visibility', countyVis);
        }
        // After switching level, also ensure the correct view mode is applied
        toggleViewMode(map, curr.viewMode, effectiveLevel, curr.opacity);
```

The other `toggleViewMode` call in the view-mode-changed branch also passes the level; change it to `effectiveLevel`:

```ts
      if (prev.viewMode !== curr.viewMode) {
        toggleViewMode(map, curr.viewMode, effectiveLevel, curr.opacity);
      }
```

At the end of the effect, after `prevSettings.current = curr;`, add:

```ts
    prevEffectiveLevel.current = effectiveLevel;
```

and add `effectiveLevel` to the effect's dependency array:

```ts
  }, [densitySettings, mapgl, effectiveLevel]);
```

3d. The declarative JSX visibility values (line 245-250) switch from `level` to `effectiveLevel`:

```ts
  const stateVis = effectiveLevel === 'state' ? 'visible' : 'none';
  const countyVis = effectiveLevel === 'county' ? 'visible' : 'none';
  const is2d = viewMode === '2d';
  // Hide outlines in 3D — they render on the ground plane and bleed through extrusions
  const stateOutlineVis = (effectiveLevel === 'state' && is2d) ? 'visible' : 'none';
  const countyOutlineVis = (effectiveLevel === 'county' && is2d) ? 'visible' : 'none';
```

Note: click/hover handlers in `MapLibreContainer` query both fill layers; during the interim window the county source holds `EMPTY_FC`, so hits resolve to state features automatically. No change needed there. `DensityLegendBar` and `DensityPeekLegend` show metric/gradient only (no level text), so the interim layer needs no legend change.

- [ ] **Step 4: Verify build and lint**

Run: `npm run build`
Expected: clean.
Run: `npm run lint`
Expected: zero new findings.

- [ ] **Step 5: Commit**

```bash
git add src/components/map/DensityLoadingPill.tsx src/pages/MapPage.tsx src/components/map/layers/DensityLayers.tsx
git commit -m "feat: analysis loading pill and interim states choropleth"
```

---

### Task 7: End-to-end verification on a throttled connection

**Files:** none created; drives the built app.

- [ ] **Step 1: Full test suite, build, lint**

```bash
npm run test
npm run build
npm run lint
```
Expected: all pass, zero new lint findings.

- [ ] **Step 2: Drive the app with the project verify skill**

Invoke the `flockhopper 3:verify` skill (Playwright). Verify with network throttling (Playwright CDP `Network.emulateNetworkConditions`, ~Slow 3G: 400 kbps down, 400ms latency) against the dev server:

1. **Network mode, desktop viewport:** open `/network`. Expect the pill "Loading agencies…" (with KB/MB counter on dev-server responses percent may show instead), then agency dots appear while the pill switches to "Loading connections…", then the pill disappears. Click a node while "Loading connections…" is visible: the panel shows the node's stats plus the "Loading connections…" spinner row, and the connection tabs appear when adjacency lands.
2. **Network mode, mobile viewport (390x844):** same flow; the pill must ride above the drawer (`--drawer-height` offset), not behind it.
3. **Analysis mode, desktop:** open `/analysis`. Expect the pill "Loading regions…" briefly, then the STATES choropleth renders while the pill reads "Loading county detail…", then the map swaps to county polygons and the pill disappears. Panel controls are interactive during the county download.
4. **Analysis mode, level toggle:** while counties are still streaming, switch the level control to States: the pill disappears (states are in), and the map stays on states.
5. **Error paths:** with Playwright route interception, abort `/sharing-network-adjacency.json`; expect dots usable and the pill showing "Couldn't load network data. Tap to retry."; un-abort and tap: connections load. Repeat for `/geo/counties-metrics.geojson` with "Couldn't load analysis data. Tap to retry."
6. **Fast-connection regression (no throttling):** switch into Network and Analysis; no pill flash (delayed flag), features render as before.

- [ ] **Step 3: Fix anything found, re-verify, commit fixes**

Any fixes discovered are committed individually with descriptive messages before proceeding.

- [ ] **Step 4: Commit the plan checkboxes update**

```bash
git add -f docs/superpowers/plans/2026-07-18-network-analysis-loading.md
git commit -m "docs: mark network/analysis loading plan complete"
```
