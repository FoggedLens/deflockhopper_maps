/**
 * Synchronous WebGL feature detection.
 *
 * Creates an off-DOM canvas, tries to acquire a WebGL2/WebGL/experimental-WebGL
 * context, releases it immediately via WEBGL_lose_context to free the GPU
 * context slot, and returns whether a context could be acquired.
 *
 * Cost is sub-millisecond on healthy devices. The throwaway context is
 * explicitly released so it does not count against the browser's concurrent
 * WebGL context limit (Chrome ~16, iOS Safari ~8) until garbage collection.
 */
export function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) return false;

    const loseContext = gl.getExtension('WEBGL_lose_context');
    loseContext?.loseContext();

    return true;
  } catch {
    return false;
  }
}
