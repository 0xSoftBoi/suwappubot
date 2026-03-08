import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.SUWAPPU_API_BASE_URL || "http://localhost:8000";

  try {
    const res = await fetch(`${baseUrl}/webapp/swap/chains`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch chains", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
