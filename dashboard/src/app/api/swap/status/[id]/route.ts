import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const baseUrl = process.env.SUWAPPU_API_BASE_URL || "http://localhost:8000";
  const { id } = await params;

  try {
    const res = await fetch(`${baseUrl}/webapp/swap/status/${id}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch swap status", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
