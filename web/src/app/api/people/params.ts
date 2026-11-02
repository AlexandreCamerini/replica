import { NextResponse } from "next/server";
import { data, type VoteValue } from "@/lib/data";

// Validação compartilhada das rotas paginadas do crachá. Parâmetro inválido = 400, nunca ignorado em silêncio.
export async function resolvePerson(slug: string) {
  const r = await data.getPerson(slug);
  return r?.person ?? null;
}

export function parseCommon(sp: URLSearchParams) {
  const errors: string[] = [];
  const yearRaw = sp.get("year");
  const year = yearRaw ? Number(yearRaw) : undefined;
  if (yearRaw && (!Number.isInteger(year) || year! < 1990 || year! > 2100)) errors.push("year inválido");
  const cursor = sp.get("cursor") ?? undefined;
  if (cursor && !/^\d{1,6}$/.test(cursor)) errors.push("cursor inválido");
  const limitRaw = sp.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.push("limit deve ser de 1 a 100");
  const q = sp.get("q")?.slice(0, 80) || undefined;
  const topic = sp.get("topic") || undefined;
  return { errors, year, cursor, limit, q, topic };
}

export const VOTE_VALUES: VoteValue[] = ["sim", "nao", "abstencao", "obstrucao", "art17", "nao_votou"];
export const bad = (errors: string[]) => NextResponse.json({ errors }, { status: 400 });
export const notFound = () => NextResponse.json({ error: "pessoa não encontrada" }, { status: 404 });
export const cache = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
