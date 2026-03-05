import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const baseUrl = process.env.SUWAPPU_API_BASE_URL || "http://localhost:8000";
  const url = new URL(req.url);
  const chain = url.searchParams.get("chain") || "";
  const search = url.searchParams.get("search") || "";

  const qp = new URLSearchParams();
  if (chain) qp.set("chain", chain);
  if (search) qp.set("search", search);

  try {
    const res = await fetch(`${baseUrl}/webapp/swap/tokens?${qp.toString()}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch tokens", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
