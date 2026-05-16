import { NextResponse } from "next/server";

const backend = () => process.env.BACKEND_URL ?? "http://127.0.0.1:8765";

/**
 * Explicit proxy so POST bodies always reach the Express/FastAPI backend as-is.
 * Rewrites can behave inconsistently for some POST + JSON setups in dev/prod.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const upstream = await fetch(`${backend()}/api/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw.length ? raw : "{}",
  });
  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new NextResponse(text, { status: upstream.status, headers: { "Content-Type": ct } });
}
