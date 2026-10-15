import { ProxyAgent } from "undici";

// The exchange refuses German IPs (403 from OVH and Hetzner in Germany,
// 15/10/2026: Betfair's exchange is not licensed there), which the server is
// on for the German bookmakers. Its requests alone, the HTTP ones and its
// prices' websocket, may go through a proxy outside Germany: EXCHANGE_PROXY,
// an HTTP proxy's address ("http://127.0.0.1:8888"). Without it, they go out
// directly, like every other request. Only prices are read there, no bet is
// ever placed.

let agent: ProxyAgent | null | undefined;

// Read once, when first needed: the worker loads .env before.
function dispatcher(): ProxyAgent | undefined {
  if (agent === undefined) {
    const url = process.env.EXCHANGE_PROXY?.trim();
    agent = url ? new ProxyAgent(url) : null;
  }
  return agent ?? undefined;
}

// For the tests: forget the proxy read, so that the next request reads it again.
export function resetExchangeProxy(): void {
  agent = undefined;
}

export function exchangeFetch(url: string, init: RequestInit): Promise<Response> {
  const via = dispatcher();
  return fetch(url, via ? ({ ...init, dispatcher: via } as RequestInit) : init);
}

export function exchangeWebSocket(url: string): WebSocket {
  const via = dispatcher();
  // Node's WebSocket takes an options object with a dispatcher where the
  // browser's takes the protocols.
  return via ? new WebSocket(url, { dispatcher: via } as unknown as string[]) : new WebSocket(url);
}
