import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

// Para o cabeçalho saber se há sessão sem tornar toda página dinâmica. Só o necessário: nada de e-mail no cliente.
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ signedIn: Boolean(user) }, { headers: { "Cache-Control": "private, no-store" } });
}
