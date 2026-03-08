import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const baseUrl = process.env.SUWAPPU_API_BASE_URL || "http://localhost:8000";

  try {
    const body = await req.json();
    const res = await fetch(`${baseUrl}/webapp/swap/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch quote", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
