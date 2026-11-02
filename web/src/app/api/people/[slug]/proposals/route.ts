import { NextResponse, type NextRequest } from "next/server";
import { data } from "@/lib/data";
import { bad, cache, notFound, parseCommon, resolvePerson } from "../../params";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const person = await resolvePerson((await params).slug);
  if (!person) return notFound();
  const sp = req.nextUrl.searchParams;
  const c = parseCommon(sp);
  const type = sp.get("type");
  const role = sp.get("role");
  if (type && type !== "lei" && type !== "pedido") c.errors.push("type deve ser lei ou pedido");
  if (role && role !== "autor" && role !== "coautor") c.errors.push("role deve ser autor ou coautor");
  if (c.errors.length) return bad(c.errors);
  const page = await data.listProposals(person.id, { ...c, type: (type as "lei" | "pedido") || undefined, role: (role as "autor" | "coautor") || undefined });
  return NextResponse.json(page, { headers: cache });
}
