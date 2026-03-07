import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const baseUrl = process.env.SUWAPPU_API_BASE_URL || "http://localhost:8000";
  const adminKey = process.env.SUWAPPU_ADMIN_API_KEY || "";

  const url = new URL(req.url);
  const limit = url.searchParams.get("limit") || "5";
  const offset = url.searchParams.get("offset");
  const status = url.searchParams.get("status");
  const userId = url.searchParams.get("userId");

  const qp = new URLSearchParams({ limit });
  if (offset) qp.set("offset", offset);
  if (status) qp.set("status", status);
  if (userId) qp.set("user_id", userId);

  try {
    const res = await fetch(`${baseUrl}/admin/swaps?${qp.toString()}`, {
      cache: "no-store",
      headers: adminKey ? { "X-Admin-Key": adminKey } : {},
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch swaps", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
