import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Chamado pelo derive.stats no fim de cada ETL. Bearer REVALIDATE_SECRET; tags limitadas a um alfabeto curto.
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let body: { tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string" && /^[a-z0-9:_-]{1,80}$/.test(t)).slice(0, 5000) : [];
  if (!tags.length) return NextResponse.json({ error: "tags vazias" }, { status: 400 });
  for (const t of tags) revalidateTag(t);
  return NextResponse.json({ revalidated: tags.length });
}
