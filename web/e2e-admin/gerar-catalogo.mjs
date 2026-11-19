// Gera web/src/lib/admin/catalogo.json a partir do catálogo de coletores em Python (etl/civico_etl/catalogo). Só LÊ o Python: sem banco, sem rede, sem escrever em etl/.
// Uso (de web/):  UV_CACHE_DIR="$TMPDIR/uv-cache" node e2e-admin/gerar-catalogo.mjs          grava o JSON
//                 node e2e-admin/gerar-catalogo.mjs --conferir                                 só confere (sai 1 se o arquivo difere do Python)
// O JSON é o que o build usa (o formulário de "Abrir rodada" lista só o que o catálogo declara). O teste admin-catalogo.test.ts compara o arquivo com a saída do Python.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(AQUI, "..");
export const ETL = path.resolve(WEB, "..", "etl");
export const ARQUIVO = path.join(WEB, "src", "lib", "admin", "catalogo.json");

// O catálogo não tem rótulo legível: o rótulo é o próprio id (nada é inventado aqui). `recortes` = os recortes que o coletor ACEITA (anos, ufs, casas, ibges ou o nome de um extra, como "escopo").
// `modos` = só os que o coletor suporta; `modos_recusados` traz o motivo declarado no catálogo.
const PY = String.raw`
import json
from civico_etl.catalogo import COLETORES
saida = []
for c in COLETORES:
    saida.append({
        "id": c.id,
        "rotulo": c.id,
        "territorio": c.territorio,
        "fontes": [f.slug for f in c.fontes],
        "modos": [m for m in ("descobrir", "recoletar", "reprocessar") if c.modos[m].suporta],
        "modos_recusados": {m: c.modos[m].motivo for m in ("descobrir", "recoletar", "reprocessar") if not c.modos[m].suporta},
        "recortes": list(c.recortes_aceitos),
        "exige_chave": c.env is not None,
    })
print(json.dumps({"fonte": "etl/civico_etl/catalogo (COLETORES)", "coletores": saida}, ensure_ascii=False, sort_keys=True, indent=2))
`;

/** Roda o Python do ETL. `uv run --frozen` primeiro; sem uv, `python3` com o pacote no caminho. Devolve { ok, json?, motivo? }. */
export function catalogoDoPython() {
  const tmp = process.env.TMPDIR || os.tmpdir();
  const env = { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || path.join(tmp, "uv-cache") };
  for (const [cmd, args] of [
    ["uv", ["run", "--frozen", "python", "-c", PY]],
    ["python3", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(ETL)})\n${PY}`]],
  ]) {
    const r = spawnSync(cmd, args, { cwd: ETL, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    if (r.status === 0 && r.stdout.trim().startsWith("{")) return { ok: true, texto: r.stdout, json: JSON.parse(r.stdout) };
  }
  return { ok: false, motivo: "nem `uv run --frozen python` nem `python3` conseguiram importar civico_etl.catalogo" };
}

function principal() {
  const r = catalogoDoPython();
  if (!r.ok) {
    console.error(r.motivo);
    process.exit(2);
  }
  if (process.argv.includes("--conferir")) {
    const atual = fs.existsSync(ARQUIVO) ? JSON.parse(fs.readFileSync(ARQUIVO, "utf8")) : null;
    const igual = JSON.stringify(atual) === JSON.stringify(r.json);
    console.log(igual ? "catalogo.json confere com o Python" : "catalogo.json DIFERE do Python: rode node e2e-admin/gerar-catalogo.mjs");
    process.exit(igual ? 0 : 1);
  }
  fs.writeFileSync(ARQUIVO, r.texto.endsWith("\n") ? r.texto : r.texto + "\n");
  console.log(`gravado ${path.relative(WEB, ARQUIVO)}: ${r.json.coletores.length} coletores`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal();
