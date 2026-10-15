import { describe, it, expect, vi, afterEach } from "vitest";
import { ProxyAgent } from "undici";
import { exchangeFetch, resetExchangeProxy } from "../../src/reference/exchangeProxy";
import { searchEvents } from "../../src/reference/exchange";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetExchangeProxy();
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
