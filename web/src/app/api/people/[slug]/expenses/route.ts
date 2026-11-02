import { NextResponse, type NextRequest } from "next/server";
import { data } from "@/lib/data";
import { bad, cache, notFound, parseCommon, resolvePerson } from "../../params";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const person = await resolvePerson((await params).slug);
  if (!person) return notFound();
  const sp = req.nextUrl.searchParams;
  const c = parseCommon(sp);
  if (c.errors.length) return bad(c.errors);
  const page = await data.listExpenses(person.id, { ...c, category: sp.get("category") || undefined });
  return NextResponse.json(page, { headers: cache });
}
