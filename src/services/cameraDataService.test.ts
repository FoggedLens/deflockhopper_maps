import { describe, it, expect, vi } from 'vitest';
import {
  clearCameraCache,
  loadBundledCameras,
  readBodyWithProgress,
} from './cameraDataService';

function chunkStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

const enc = new TextEncoder();

describe('COUNTRIES', () => {
  it('uses the development US camera-data URL override', async () => {
    const dataUrl = 'https://fixture.test/cameras.geojson';
    vi.stubEnv('VITE_CAMERA_DATA_URL_US', dataUrl);
    vi.resetModules();

    try {
      const { COUNTRIES } = await import('./cameraDataService');

      expect(COUNTRIES.us.dataUrl).toBe(dataUrl);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('readBodyWithProgress', () => {
  it('reports determinate percent when Content-Length is present and no Content-Encoding', async () => {
    const chunks = [enc.encode('{"a":'), enc.encode('1}')];
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const response = new Response(chunkStream(chunks), {
      headers: { 'Content-Length': String(total) },
    });
    const onProgress = vi.fn();

    const text = await readBodyWithProgress(response, onProgress);

    expect(text).toBe('{"a":1}');
    // starts at 0, ends at 100, intermediate values are numbers 0-100 ascending
    const calls = onProgress.mock.calls.map(c => c[0]);
    expect(calls[0]).toBe(0);
    expect(calls[calls.length - 1]).toBe(100);
    expect(calls.every(v => typeof v === 'number')).toBe(true);
  });

  it('reports null (indeterminate) when Content-Encoding is set', async () => {
    const response = new Response(chunkStream([enc.encode('{"a":1}')]), {
      headers: { 'Content-Length': '3', 'Content-Encoding': 'gzip' },
    });
    const onProgress = vi.fn();

    const text = await readBodyWithProgress(response, onProgress);

    expect(text).toBe('{"a":1}');
    const calls = onProgress.mock.calls.map(c => c[0]);
    expect(calls[0]).toBeNull();
    expect(calls[calls.length - 1]).toBe(100); // completion is always signalled
  });

  it('reports null when Content-Length is missing', async () => {
    const response = new Response(chunkStream([enc.encode('[]')]));
    const onProgress = vi.fn();
    await readBodyWithProgress(response, onProgress);
    expect(onProgress.mock.calls[0][0]).toBeNull();
  });

  it('works without a callback', async () => {
    const response = new Response(chunkStream([enc.encode('{"ok":true}')]));
    await expect(readBodyWithProgress(response)).resolves.toBe('{"ok":true}');
  });
});

describe('loadBundledCameras', () => {
  it('hydrates direction spans from FeatureCollection properties', async () => {
    const featureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-84.4, 33.7] },
        properties: {
          osmId: 123,
          osmType: 'node',
          direction: 90,
          directions: [90, 255, 0],
          directionSpan: 10,
          directionSpans: [null, 10, null],
        },
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(featureCollection), { status: 200 })
    ));

    clearCameraCache();

    try {
      const [camera] = await loadBundledCameras();

      expect(camera.direction).toBe(90);
      expect(camera.directions).toEqual([90, 255, 0]);
      expect(camera).toMatchObject({
        directionSpan: 10,
        directionSpans: [null, 10, null],
      });
    } finally {
      clearCameraCache();
      vi.unstubAllGlobals();
    }
  });

  it('hydrates direction spans from legacy flat-array records', async () => {
    const cameras = [{
      osmId: 123,
      osmType: 'node',
      lat: 33.7,
      lon: -84.4,
      direction: 90,
      directions: [90, 255, 0],
      directionSpan: 10,
      directionSpans: [null, 10, null],
    }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cameras), { status: 200 })
    ));

    clearCameraCache();

    try {
      const [camera] = await loadBundledCameras();

      expect(camera.direction).toBe(90);
      expect(camera.directions).toEqual([90, 255, 0]);
      expect(camera).toMatchObject({
        directionSpan: 10,
        directionSpans: [null, 10, null],
      });
    } finally {
      clearCameraCache();
      vi.unstubAllGlobals();
    }
  });
});
