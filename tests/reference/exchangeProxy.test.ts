import { describe, it, expect, vi, afterEach } from "vitest";
import { ProxyAgent } from "undici";
import { exchangeFetch, exchangeReachability, resetExchangeProxy, resetExchangeReachability } from "../../src/reference/exchangeProxy";
import { searchEvents } from "../../src/reference/exchange";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetExchangeProxy();
  resetExchangeReachability();
});

const ok = () => new Response(JSON.stringify({ content: [] }), { status: 200, headers: { "content-type": "application/json" } });

describe("exchangeFetch", () => {
  it("goes out directly without EXCHANGE_PROXY, the request as it is", async () => {
    vi.stubEnv("EXCHANGE_PROXY", "");
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    const init = { headers: { accept: "application/json" } };
    await exchangeFetch("https://exch.piwi247.com/customer/api/event/search?query=x", init);
    expect(fetchMock).toHaveBeenCalledWith("https://exch.piwi247.com/customer/api/event/search?query=x", init);
  });

  it("goes through the proxy EXCHANGE_PROXY names, the same agent for every request", async () => {
    vi.stubEnv("EXCHANGE_PROXY", "http://127.0.0.1:8888");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit & { dispatcher?: unknown }) => ok());
    vi.stubGlobal("fetch", fetchMock);
    await exchangeFetch("https://exch.piwi247.com/a", { headers: { accept: "application/json" } });
    await exchangeFetch("https://exch.piwi247.com/b", {});
    const [first, second] = fetchMock.mock.calls.map(([, init]) => init);
    expect(first.dispatcher).toBeInstanceOf(ProxyAgent);
    expect(first.headers).toEqual({ accept: "application/json" });
    expect(second.dispatcher).toBe(first.dispatcher);
  });

  it("carries the exchange's own requests, its search among them", async () => {
    vi.stubEnv("EXCHANGE_PROXY", "http://127.0.0.1:8888");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit & { dispatcher?: unknown }) => ok());
    vi.stubGlobal("fetch", fetchMock);
    await searchEvents("bayern");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/event/search?query=bayern");
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeInstanceOf(ProxyAgent);
  });
});

describe("the exchange's reachability", () => {
  it("keeps since when every request has failed, with the deepest cause's message, until one is answered", async () => {
    vi.stubEnv("EXCHANGE_PROXY", "http://127.0.0.1:8888");
    // What undici throws when the proxy refuses the tunnel (25/10/2026).
    const proxyDown = new TypeError("fetch failed", {
      cause: new Error("Request was cancelled.", { cause: new Error("Proxy response (500) !== 200 when HTTP Tunneling") }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(proxyDown)));
    await expect(exchangeFetch("https://exch.piwi247.com/a", {})).rejects.toBe(proxyDown);
    const first = exchangeReachability();
    expect(first.lastError).toBe("Proxy response (500) !== 200 when HTTP Tunneling");
    expect(first.failingSince).toBeTypeOf("number");

    // A refusal by status is a failure too; the outage's start is kept.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await exchangeFetch("https://exch.piwi247.com/b", {});
    expect(exchangeReachability()).toMatchObject({ failingSince: first.failingSince, lastError: "HTTP 403" });

    // A 404 is the exchange answering.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await exchangeFetch("https://exch.piwi247.com/c", {});
    expect(exchangeReachability()).toEqual({ lastOkAt: expect.any(Number) });
  });
});
