import { vi } from 'vitest';

/** Test helper: JSON response body. */
export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

export type FetchRoute = [
  match: string,
  respond: (url: string) => Response | Promise<Response>,
];

export type FetchMock = ReturnType<typeof vi.fn<
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>
>>;

/**
 * Stub global fetch with a mock that answers by URL substring (first match
 * wins); unmatched URLs 404. Returns the mock for call inspection. Tests that
 * exercise the tile host / companion resolution chain issue several fetches
 * per operation, so routing by URL keeps them robust to call order.
 */
export function fetchByUrl(routes: FetchRoute[]): FetchMock {
  const mock: FetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const hit = routes.find(([m]) => url.includes(m));
    return Promise.resolve(hit ? hit[1](url) : new Response('nope', { status: 404 }));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Calls whose URL contains `match`. */
export const callsTo = (mock: FetchMock, match: string) =>
  mock.mock.calls.filter((c) => String(c[0]).includes(match));
