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

// Whether the exchange answers, across its requests (src/alerts/exchange.ts
// tells the admins when it stops): when one last got an answer, and since when
// every one has failed, with the last error. An answer is any HTTP response
// but a refusal of the proxy or the exchange (5xx, 403: the way out of Germany
// down, or a German IP seen); a 404 or a 400 is the exchange answering.
export interface ExchangeReachability {
  lastOkAt?: number;
  failingSince?: number;
  lastError?: string;
}

let reachability: ExchangeReachability = {};

export function exchangeReachability(): ExchangeReachability {
  return { ...reachability };
}

// For the tests.
export function resetExchangeReachability(): void {
  reachability = {};
}

export function recordExchangeAnswer(ok: boolean, error?: unknown, now = Date.now()): void {
  if (ok) {
    reachability = { lastOkAt: now };
    return;
  }
  reachability = { ...reachability, failingSince: reachability.failingSince ?? now, lastError: describeError(error) };
}

// The deepest cause's message: a failed fetch says "fetch failed", its cause
// "Request was cancelled.", and only the cause's cause what happened ("Proxy
// response (500) !== 200 when HTTP Tunneling", 25/10/2026).
function describeError(error: unknown): string {
  let message = "unknown error";
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error || (typeof current === "object" && "message" in current)) {
      const text = String((current as { message: unknown }).message ?? "").trim();
      if (text) message = text;
      current = (current as { cause?: unknown }).cause;
    } else {
      message = String(current);
      break;
    }
  }
  return message.slice(0, 300);
}

const refused = (status: number) => status >= 500 || status === 403 || status === 407;

export async function exchangeFetch(url: string, init: RequestInit): Promise<Response> {
  const via = dispatcher();
  try {
    const res = await fetch(url, via ? ({ ...init, dispatcher: via } as RequestInit) : init);
    recordExchangeAnswer(!refused(res.status), `HTTP ${res.status}`);
    return res;
  } catch (err) {
    recordExchangeAnswer(false, err);
    throw err;
  }
}

export function exchangeWebSocket(url: string): WebSocket {
  const via = dispatcher();
  // Node's WebSocket takes an options object with a dispatcher where the
  // browser's takes the protocols.
  const ws = via ? new WebSocket(url, { dispatcher: via } as unknown as string[]) : new WebSocket(url);
  ws.addEventListener("open", () => recordExchangeAnswer(true));
  ws.addEventListener("error", () => recordExchangeAnswer(false, "the prices' socket failed to connect"));
  return ws;
}
