import { NextResponse, type NextRequest } from "next/server";
import { data } from "@/lib/data";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const slugs = [...new Set((sp.get("p") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 5);
  const periodRaw = sp.get("period") ?? "career";
  const period = periodRaw === "career" ? "career" : Number(periodRaw);
  if (slugs.length < 2) return NextResponse.json({ errors: ["p precisa de 2 a 5 slugs"] }, { status: 400 });
  if (period !== "career" && (!Number.isInteger(period) || period < 1990 || period > 2100))
    return NextResponse.json({ errors: ["period deve ser career ou um ano"] }, { status: 400 });
  const people = (await Promise.all(slugs.map((s) => data.getPerson(s)))).filter((x) => x !== null).map((x) => x.person);
  if (people.length < 2) return NextResponse.json({ errors: ["menos de 2 pessoas encontradas"] }, { status: 404 });
  const pairs = await data.getAgreement(people.map((p) => p.id), period);
  const slugOf = Object.fromEntries(people.map((p) => [p.id, p.slug]));
  return NextResponse.json({ pairs: pairs.map((x) => ({ ...x, a: slugOf[x.a], b: slugOf[x.b] })) }, { headers: { "Cache-Control": "public, s-maxage=3600" } });
}
