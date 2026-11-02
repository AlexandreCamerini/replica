import { NextResponse, type NextRequest } from "next/server";
import { data } from "@/lib/data";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 80) return NextResponse.json({ error: "q deve ter de 2 a 80 caracteres" }, { status: 400 });
  const rows = await data.searchPeople(q, 8);
  return NextResponse.json(
    rows.map((h) => ({ slug: h.person.slug, name: h.person.displayName, office: h.officeName, place: h.placeLabel, party: h.party.acronym })),
    { headers: { "Cache-Control": "public, s-maxage=600" } },
  );
}
