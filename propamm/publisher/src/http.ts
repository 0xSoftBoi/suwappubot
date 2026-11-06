import { metrics } from "./log";

export interface HealthView {
  ok: boolean;
  detail: Record<string, unknown>;
}

/** Bound to 127.0.0.1 only. POST /halt is the HTTP kill switch. */
export function startHttp(port: number, health: () => HealthView, onHalt: (reason: string) => Promise<void>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
      // DNS-rebinding / browser-CSRF guard
      if (host !== "127.0.0.1" && host !== "localhost") return new Response("forbidden", { status: 403 });
      if (url.pathname === "/healthz" && req.method === "GET") {
        const h = health();
        return Response.json({ ok: h.ok, ...h.detail }, { status: h.ok ? 200 : 503 });
      }
      if (url.pathname === "/metrics" && req.method === "GET") {
        const lines = Object.entries(metrics).map(([k, v]) => `propamm_publisher_${k}_total ${v}`);
        return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; version=0.0.4" } });
      }
      if (url.pathname === "/halt" && req.method === "POST") {
        if (req.headers.get("origin")) return new Response("forbidden", { status: 403 });
        await onHalt("http POST /halt");
        return Response.json({ halted: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
}
