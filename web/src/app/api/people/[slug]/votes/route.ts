import { NextResponse, type NextRequest } from "next/server";
import { data, type VoteValue } from "@/lib/data";
import { VOTE_VALUES, bad, cache, notFound, parseCommon, resolvePerson } from "../../params";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const person = await resolvePerson((await params).slug);
  if (!person) return notFound();
  const sp = req.nextUrl.searchParams;
  const c = parseCommon(sp);
  const value = sp.get("value");
  if (value && !VOTE_VALUES.includes(value as VoteValue)) c.errors.push("value inválido");
  if (c.errors.length) return bad(c.errors);
  const page = await data.listVotes(person.id, { ...c, value: (value as VoteValue) || undefined });
  return NextResponse.json(page, { headers: cache });
}
