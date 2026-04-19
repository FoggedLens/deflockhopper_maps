/**
 * Returns true when the app is running inside an iframe.
 * The try/catch handles cross-origin contexts where accessing window.top may throw.
 */
export function useEmbedMode(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin parent — treat as embedded
    return true;
  }
}
