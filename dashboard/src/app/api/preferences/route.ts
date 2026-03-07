import { NextResponse } from "next/server";

const baseUrl = process.env.SUWAPPU_API_BASE_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${baseUrl}/webapp/preferences`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({}, { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const res = await fetch(`${baseUrl}/webapp/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to save preferences", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
