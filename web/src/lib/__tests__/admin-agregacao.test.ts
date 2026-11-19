import assert from "node:assert/strict";
import { test } from "node:test";
import { agregarPais, agregarUf, chaveDaFicha, formatarContagem, ufDoIbge, verRegistros } from "../admin/agregacao.ts";
import { CLASSES, MOTIVOS_SEM_MAPA, NIVEL_POR_KIND, TEXTO_MOTIVO } from "../admin/tipos.ts";
import type { Classe, Ficha, Nivel } from "../admin/tipos.ts";

const f = (classe: Classe, chave: string, territorio: Ficha["territorio"], extra: Partial<Ficha> = {}): Ficha => ({
  classe, chave, rotulo: `r-${chave}`, territorio, fontes: [], ...extra,
});
const mun = (ibge: string) => ({ ibge, nivel: "municipio" as Nivel });
const uf = (ibge: string) => ({ ibge, nivel: "uf" as Nivel });
const pais = { ibge: "BR", nivel: "pais" as Nivel };

const conjunto = (): Ficha[] => [
  f("vinculo_sapl", "1", mun("3550308")),
  f("vinculo_sapl", "2", mun("3509502")),
  f("vinculo_sapl", "3", uf("35")),
  f("cobertura", "3550308:votos", mun("3550308")),
  f("contato_mandato", "m1", mun("3550308")),
  f("contato_mandato", "m2", uf("33")),
  f("cobertura", "3304557:gastos", mun("3304557")),
  f("cobertura", "BR:x", pais),
  f("cobertura", "sem:y", null),
  f("identidade", "9", null),
  f("vinculo_sapl", "4", null, { motivoSemTerritorio: "vinculo_corrigido_aguardando_validacao" }),
];

const somaMunicipios = (a: ReturnType<typeof agregarUf>) => [...a.porMunicipio.values()].reduce((s, c) => s + c.total, 0);

function confere(fichas: Ficha[]) {
  const p = agregarPais(fichas);
  const distintas = new Set(fichas.map(chaveDaFicha)).size;
  const somaUfs = [...p.porUf.values()].reduce((s, c) => s + c.total, 0);
  assert.equal(somaUfs + p.semTerritorio.total, p.total, "soma das UFs + sem território = total");
  assert.equal(p.total, distintas, "total = fichas distintas");
  for (const [ibge, c] of p.porUf) {
    const a = agregarUf(fichas, ibge);
    assert.equal(somaMunicipios(a) + a.daUfSemMunicipio.total, c.total, `UF ${ibge}`);
    assert.equal(a.total, c.total);
  }
}

test("critério 16: conjunto fabricado, todas as UFs", () => {
  const fichas = conjunto();
  confere(fichas);
  const p = agregarPais(fichas);
  assert.deepEqual([...p.porUf.keys()], ["33", "35"]);
  assert.equal(p.porUf.get("35")?.total, 5);
  assert.equal(p.porUf.get("33")?.total, 2);
  assert.equal(p.semTerritorio.total, 4);
  assert.equal(p.total, 11);
  const sp = agregarUf(fichas, "35");
  assert.equal(sp.daUfSemMunicipio.total, 1);
  assert.equal(sp.porMunicipio.get("3550308")?.total, 3);
});

test("critério 16: propriedade com 400 fichas aleatórias (semente fixa)", () => {
  let s = 20260716;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ufs = ["11", "12", "29", "33", "35", "41", "53"];
  const fichas: Ficha[] = [];
  for (let i = 0; i < 400; i++) {
    const classe = CLASSES[Math.floor(rnd() * 4)];
    const chave = String(Math.floor(rnd() * 250)); // repetições de propósito
    const u = ufs[Math.floor(rnd() * ufs.length)];
    const r = rnd();
    const territorio = r < 0.5 ? mun(u + String(Math.floor(rnd() * 5)).padStart(5, "0")) : r < 0.7 ? uf(u) : r < 0.8 ? pais : null;
    fichas.push(f(classe, chave, territorio, { fontes: [`fonte${i}`] }));
  }
  // repetições com território igual por construção: fixa o território pela primeira ocorrência
  const primeiro = new Map<string, Ficha["territorio"]>();
  const coerentes = fichas.map((x) => {
    const id = chaveDaFicha(x);
    if (!primeiro.has(id)) primeiro.set(id, x.territorio);
    return { ...x, territorio: primeiro.get(id) ?? null };
  });
  confere(coerentes);
  assert.equal(agregarPais(coerentes).conflitos.length, 0);
  // com conflitos permitidos as igualdades também valem
  confere(fichas);
});

test("critério 17: duas fontes = 1 ficha; Câmara e mandato no mesmo município = 2", () => {
  const dupla = [
    f("vinculo_sapl", "7", mun("3550308"), { fontes: ["interlegis"] }),
    f("vinculo_sapl", "7", mun("3550308"), { fontes: ["sapl-proprio"] }),
  ];
  const p = agregarPais(dupla);
  assert.equal(p.total, 1);
  assert.equal(p.porUf.get("35")?.total, 1);
  assert.deepEqual(verRegistros(dupla)[0].ficha.fontes.sort(), ["interlegis", "sapl-proprio"]);
  const duas = [f("vinculo_sapl", "7", mun("3550308")), f("contato_mandato", "7", mun("3550308"))];
  assert.equal(agregarPais(duas).total, 2);
  assert.equal(agregarUf(duas, "35").porMunicipio.get("3550308")?.total, 2);
});

test("critério 17: mesma ficha com territórios diferentes vai a conflitos, não ao mapa", () => {
  const fichas = [f("cobertura", "a:b", mun("3550308")), f("cobertura", "a:b", mun("3304557"))];
  const p = agregarPais(fichas);
  assert.equal(p.porUf.size, 0);
  assert.equal(p.semTerritorio.total, 1);
  assert.deepEqual(p.semTerritorio.porMotivo.territorio_nao_resolvido, ["cobertura:a:b"]);
  assert.equal(p.conflitos.length, 1);
  assert.equal(p.conflitos[0].territorios.length, 2);
  assert.equal(verRegistros(fichas)[0].motivo, "territorio_nao_resolvido");
  // território vs. sem território também é conflito
  assert.equal(agregarPais([f("cobertura", "z", mun("3550308")), f("cobertura", "z", null)]).conflitos.length, 1);
});

test("critério 18: sem território nunca no mapa; todas em Ver registros com motivo", () => {
  const fichas = conjunto();
  const p = agregarPais(fichas);
  const noMapa = new Set<string>();
  for (const c of p.porUf.values()) c.ids.forEach((i) => noMapa.add(i));
  for (const uf2 of p.porUf.keys()) for (const c of agregarUf(fichas, uf2).porMunicipio.values()) c.ids.forEach((i) => noMapa.add(i));
  const lista = verRegistros(fichas);
  assert.equal(lista.length, p.total);
  for (const id of p.semTerritorio.ids) {
    assert.ok(!noMapa.has(id), `${id} no mapa`);
    const r = lista.find((x) => x.id === id);
    assert.ok(r?.motivo && (MOTIVOS_SEM_MAPA as readonly string[]).includes(r.motivo));
    assert.equal(r.textoMotivo, TEXTO_MOTIVO[r.motivo]);
    assert.ok(r.textoMotivo && r.textoMotivo.length > 10);
  }
  const mot = (id: string) => lista.find((x) => x.id === id)?.motivo;
  assert.equal(mot("cobertura:BR:x"), "alcance_nacional");
  assert.equal(mot("cobertura:sem:y"), "territorio_nao_resolvido");
  assert.equal(mot("identidade:9"), "classe_sem_territorio");
  assert.equal(mot("vinculo_sapl:4"), "vinculo_corrigido_aguardando_validacao");
  // sem-ponto aparece também nas visões de UF e município
  assert.equal(verRegistros(fichas, { nivel: "uf", ibge: "35" }).filter((x) => x.motivo).length, 4);
  assert.equal(verRegistros(fichas, { nivel: "municipio", ibge: "3550308" }).filter((x) => x.motivo).length, 4);
  // ibge inválido também não vai ao mapa
  const inv = [f("cobertura", "i", mun("123"))];
  assert.equal(agregarPais(inv).porUf.size, 0);
  assert.equal(verRegistros(inv)[0].motivo, "territorio_nao_resolvido");
});

test("ficha de UF: aproximada na visão de município, sem município na agregação da UF", () => {
  const fichas = conjunto();
  const v = verRegistros(fichas, { nivel: "municipio", ibge: "3550308" }).filter((x) => !x.motivo);
  assert.deepEqual(v.map((x) => [x.id, x.aproximada]), [
    ["vinculo_sapl:1", false],
    ["vinculo_sapl:3", true],
    ["cobertura:3550308:votos", false],
    ["contato_mandato:m1", false],
  ]);
  assert.deepEqual(agregarUf(fichas, "35").daUfSemMunicipio.ids, ["vinculo_sapl:3"]);
});

test("ordenação: classe fixa e chave; rótulo não influi", () => {
  const a = conjunto();
  const b = a.map((x, i) => ({ ...x, rotulo: `zz${a.length - i}` })).reverse();
  assert.deepEqual(verRegistros(a).map((x) => x.id), verRegistros(b).map((x) => x.id));
  assert.deepEqual(agregarPais(a).semTerritorio.ids, agregarPais(b).semTerritorio.ids);
  const ids = verRegistros(a).map((x) => x.id);
  const rank = (id: string) => CLASSES.indexOf(id.split(":")[0] as Classe);
  for (let i = 1; i < ids.length; i++) assert.ok(rank(ids[i - 1]) <= rank(ids[i]));
});

test("ufDoIbge", () => {
  assert.equal(ufDoIbge("3550308"), "35");
  assert.equal(ufDoIbge("35"), "35");
  for (const x of ["", "355", "35503080", "ab", "35 ", "BR"]) assert.equal(ufDoIbge(x), null, x);
});

test("formatarContagem", () => {
  assert.equal(formatarContagem(0), "0 fichas");
  assert.equal(formatarContagem(1), "1 ficha");
  assert.equal(formatarContagem(2), "2 fichas");
  assert.throws(() => formatarContagem(-1), RangeError);
  assert.throws(() => formatarContagem(1.5), RangeError);
});

test("contrato com o ETL (classes._NIVEL): kind -> nível; região fora; identidade sem território", () => {
  assert.deepEqual(NIVEL_POR_KIND, { municipio: "municipio", uf: "uf", pais: "pais" });
  assert.equal(NIVEL_POR_KIND["regiao"], undefined);
  const p = agregarPais([f("identidade", "1", mun("3550308"))]);
  assert.equal(p.porUf.size, 0);
  assert.deepEqual(p.semTerritorio.porMotivo.classe_sem_territorio, ["identidade:1"]);
});
