import { NextResponse, type NextRequest } from "next/server";
import { data } from "@/lib/data";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 60) return NextResponse.json({ error: "q deve ter de 2 a 60 caracteres" }, { status: 400 });
  const rows = await data.searchPlaces(q, 10);
  return NextResponse.json(
    rows.map((p) => ({ ibge: p.ibge, name: p.name, uf: p.uf, kind: p.kind })),
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
