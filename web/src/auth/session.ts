// The data routes answer 401 when the session has ended. api.ts tells the
// auth context through this event, so that the dashboard gives way to the
// login page instead of an error banner.
const UNAUTHORIZED_EVENT = "coteradar:unauthorized";

export function announceUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

export function onUnauthorized(listener: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, listener);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, listener);
}
