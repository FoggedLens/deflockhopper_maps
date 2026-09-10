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

describe('readBodyWithProgress with assumeCompressed', () => {
  it('reports null percent even when Content-Length is present and no Content-Encoding is visible', async () => {
    // Cross-origin responses do not expose Content-Encoding (not CORS-safelisted),
    // so a gzip-stored file looks uncompressed while the stream yields decoded
    // bytes far beyond Content-Length. Callers that know the publisher stores
    // gzip opt into indeterminate progress up front.
    const body = 'x'.repeat(5000);
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Length': '500' },
    });
    const percents: Array<number | null> = [];
    let lastBytes = 0;
    const text = await readBodyWithProgress(response, (percent, loadedBytes) => {
      percents.push(percent);
      lastBytes = loadedBytes;
    }, { assumeCompressed: true });
    expect(text).toBe(body);
    expect(percents.every((p) => p === null || p === 100)).toBe(true);
    expect(percents.filter((p) => p === 100)).toHaveLength(1);
    expect(lastBytes).toBe(5000);
  });
});
