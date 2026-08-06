/**
 * Endpoint-contract tests.
 *
 * These exist because of a real incident: the SDK shipped to npm pointing at
 * raw `src/*.ts`, and separately a whole namespace's routes could drift from
 * the API without anything failing. Asserting the exact method, path, query
 * string and JSON body catches both classes of mistake before a publish.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Suwappu, SuwappuError } from "../index.js";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

let seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
/** Overrides the next response body, for error-path tests. */
let nextStatus = 200;
let nextBody: unknown = null;

const OK = {
  success: true,
  approvals: [],
  events: [],
  killswitches: [],
  wallets: [],
  swaps: [],
  pagination: { total: 3, limit: 5, offset: 0, has_more: true },
  code: "ABC123",
  expires_at: "2026-01-01T00:00:00Z",
  challenge: "chal",
  valid: true,
  scope: "org",
  active: true,
};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      let body: unknown = null;
      if (req.method !== "GET") {
        const text = await req.text();
        body = text ? JSON.parse(text) : null;
      }
      seen.push({ method: req.method, path: url.pathname + url.search, body });
      const status = nextStatus;
      const payload = nextBody ?? OK;
      nextStatus = 200;
      nextBody = null;
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

function client() {
  seen = [];
  return new Suwappu({ apiKey: "test-key", baseUrl });
}

describe("swap simulation & history", () => {
  it("simulateSwap posts snake_case fields", async () => {
    const c = client();
    await c.simulateSwap({ quoteId: "q1", walletAddress: "0xabc" });
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/swap/simulate",
      body: { quote_id: "q1", wallet_address: "0xabc" },
    });
  });

  it("listSwaps forwards filters and maps pagination to camelCase", async () => {
    const c = client();
    const res = await c.listSwaps({ status: "completed", limit: 5 });
    expect(seen[0].method).toBe("GET");
    expect(seen[0].path).toBe("/v1/agent/swaps?status=completed&limit=5");
    expect(res.pagination).toEqual({ total: 3, limit: 5, offset: 0, hasMore: true });
  });

  it("listSwaps omits undefined params rather than sending 'undefined'", async () => {
    const c = client();
    await c.listSwaps();
    expect(seen[0].path).toBe("/v1/agent/swaps");
  });
});

describe("agent wallets & linking", () => {
  it("createWallet unwraps the wallet envelope", async () => {
    const c = client();
    nextBody = { wallet: { address: "0xdead" } };
    const w = await c.agent.createWallet();
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/agent/wallets" });
    expect(w.address).toBe("0xdead");
  });

  it("listWallets returns [] when the agent has no wallet yet", async () => {
    const c = client();
    expect(await c.agent.listWallets()).toEqual([]);
  });

  it("linkCode maps expires_at to expiresAt", async () => {
    const c = client();
    const r = await c.agent.linkCode();
    expect(seen[0].path).toBe("/v1/agent/link/code");
    expect(r).toEqual({ code: "ABC123", expiresAt: "2026-01-01T00:00:00Z" });
  });
});

describe("approvals", () => {
  it("list forwards the status filter", async () => {
    const c = client();
    await c.approvals.list({ status: "pending" });
    expect(seen[0].path).toBe("/v1/agent/approvals?status=pending");
  });

  it("url-encodes ids so they cannot escape the path", async () => {
    const c = client();
    await c.approvals.get("a/../b 1");
    expect(seen[0].path).toBe("/v1/agent/approvals/a%2F..%2Fb%201");
  });

  it("approve sends the step-up challenge under its wire name", async () => {
    const c = client();
    await c.approvals.approve("a1", { stepUpChallenge: "ch" });
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/approvals/a1/approve",
      body: { step_up_challenge: "ch" },
    });
  });

  it("deny and stepUpChallenge hit their routes", async () => {
    const c = client();
    await c.approvals.deny("a1");
    await c.approvals.stepUpChallenge("a1");
    expect(seen.map((s) => s.path)).toEqual([
      "/v1/agent/approvals/a1/deny",
      "/v1/agent/approvals/a1/step-up/challenge",
    ]);
  });
});

describe("audit chain", () => {
  it("maps snake_case event fields to camelCase", async () => {
    const c = client();
    nextBody = {
      events: [
        { id: 7, event_type: "swap.executed", agent_id: "ag1", created_at: "2026-01-01" },
      ],
    };
    const [e] = await c.audit.list({ eventType: "swap.executed", limit: 10 });
    expect(seen[0].path).toBe("/v1/agent/audit?event_type=swap.executed&limit=10");
    expect(e).toMatchObject({ id: 7, eventType: "swap.executed", agentId: "ag1" });
  });

  it("verify hits the verify route", async () => {
    const c = client();
    const r = await c.audit.verify();
    expect(seen[0].path).toBe("/v1/agent/audit/verify");
    expect(r.valid).toBe(true);
  });
});

describe("kill switch", () => {
  it("set posts scope/active/reason", async () => {
    const c = client();
    await c.killswitch.set({ scope: "org", active: true, reason: "incident" });
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/v1/agent/killswitch",
      body: { scope: "org", active: true, reason: "incident" },
    });
  });

  it("list maps scope_id to scopeId", async () => {
    const c = client();
    nextBody = { killswitches: [{ scope: "agent", scope_id: "ag1", active: false }] };
    const [k] = await c.killswitch.list();
    expect(k).toEqual({ scope: "agent", scopeId: "ag1", active: false, reason: null });
  });
});

describe("error handling", () => {
  it("surfaces the API error_code on SuwappuError", async () => {
    const c = client();
    nextStatus = 403;
    nextBody = { success: false, error_code: "POLICY_VIOLATION", message: "blocked" };
    try {
      await c.killswitch.list();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SuwappuError);
      expect((err as SuwappuError).status).toBe(403);
      expect((err as SuwappuError).code).toBe("POLICY_VIOLATION");
    }
  });

  it("does not choke on a non-JSON error body", async () => {
    const c = client();
    nextStatus = 502;
    nextBody = "upstream exploded";
    await expect(c.audit.verify()).rejects.toBeInstanceOf(SuwappuError);
  });
});

describe("auth header", () => {
  it("is omitted entirely when no api key is configured", async () => {
    const bare = new Suwappu({ apiKey: "", baseUrl });
    seen = [];
    await bare.listSwaps();
    expect(seen).toHaveLength(1);
  });
});
