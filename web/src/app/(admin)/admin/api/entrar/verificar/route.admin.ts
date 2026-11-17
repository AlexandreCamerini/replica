import { verificarCodigo } from "@/lib/admin/entrada";
import { naoUsado, rotaDeEntrada } from "@/lib/admin/rota-entrada";

// POST JSON da entrada da central (verificar). Guarda própria da entrada (modo produção, marca do middleware, mesma origem) em `rotaDeEntrada`. Não é server action.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return rotaDeEntrada(req, (c) => verificarCodigo(c));
}
export { naoUsado as GET, naoUsado as PUT, naoUsado as PATCH, naoUsado as DELETE, naoUsado as OPTIONS, naoUsado as HEAD };
