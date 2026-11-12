import assert from "node:assert/strict";
import { test } from "node:test";
import { CADEIRAS_CAMARA, LIMITE_SEM_UF, MOTIVO_SEM_UF, PORUF_MOTIVO, TOTAL_CAMARA, cadeirasDaUf, motivoSemMandatos, placarPorUf } from "../data/cadeiras.ts";
import type { VoteValue } from "../data/types.ts";

test("Câmara: as cadeiras por UF somam 513 (LC 78/1993), mínimo 8 e máximo 70", () => {
  const v = Object.values(CADEIRAS_CAMARA);
  assert.equal(v.length, 27);
  assert.equal(v.reduce((s, n) => s + n, 0), TOTAL_CAMARA);
  assert.equal(TOTAL_CAMARA, 513);
  assert.equal(Math.min(...v), 8);
  assert.equal(Math.max(...v), 70);
  assert.equal(CADEIRAS_CAMARA.SP, 70);
  assert.equal(CADEIRAS_CAMARA.MG, 53);
  assert.equal(CADEIRAS_CAMARA.DF, 8);
});

test("Senado: três por UF; sigla desconhecida não tem cadeira", () => {
  assert.equal(cadeirasDaUf("senado", "SP"), 3);
  assert.equal(cadeirasDaUf("camara", "pb"), 12);
  assert.equal(cadeirasDaUf("camara", "XX"), null);
});

test("placar por UF: soma das UFs mais `semUf` fecha com os registros; ordem alfabética; UF sem registro tem 0 registros", () => {
  const votos: { uf: string | null; value: VoteValue; name?: string }[] = [
    { uf: "SP", value: "sim" },
    { uf: "SP", value: "nao" },
    { uf: "AC", value: "sim" },
    { uf: "sp", value: "obstrucao" },
    { uf: null, value: "sim", name: "Zélia" },
    { uf: "ZZ", value: "nao", name: "Álvaro" },
    // 2 sem UF em 20 = 10%: no limite, o placar fica
    ...Array.from({ length: 14 }, () => ({ uf: "RJ", value: "sim" as VoteValue })),
  ];
  const p = placarPorUf({ body: "camara" }, votos);
  assert.equal(p.kind, "placar");
  if (p.kind !== "placar") return;
  assert.deepEqual(p.ufs.map((u) => u.uf), [...p.ufs.map((u) => u.uf)].sort());
  assert.equal(p.ufs.length, 27);
  const sp = p.ufs.find((u) => u.uf === "SP")!;
  assert.equal(sp.cadeiras, 70);
  assert.equal(sp.registros, 3);
  assert.deepEqual(sp.contagem, { sim: 1, nao: 1, abstencao: 0, obstrucao: 1, art17: 0, nao_votou: 0 });
  assert.equal(p.semUf, 2);
  assert.deepEqual(p.semUfNomes, ["Álvaro", "Zélia"]);
  assert.equal(p.motivoSemUf, MOTIVO_SEM_UF);
  assert.equal(p.ufs.reduce((s, u) => s + u.registros, 0) + p.semUf, votos.length);
  // por UF, a soma das contagens é o número de registros
  for (const u of p.ufs) assert.equal(Object.values(u.contagem).reduce((s, n) => s + n, 0), u.registros);
  // registros acima das cadeiras não são corrigidos (bug de carga aparece, não some)
  const muitos = Array.from({ length: 9 }, () => ({ uf: "AC", value: "sim" as VoteValue }));
  const q = placarPorUf({ body: "camara" }, muitos);
  assert.equal(q.kind === "placar" && q.ufs.find((u) => u.uf === "AC")!.registros, 9);
});

test("placar por UF: sem voto individual é lacuna com motivo, nunca tabela de zeros", () => {
  assert.deepEqual(placarPorUf({ body: "senado", isSecret: true }, [{ uf: "SP", value: "sim" }]), { kind: "lacuna", motivo: PORUF_MOTIVO.secreta });
  assert.deepEqual(placarPorUf({ body: "camara", openNoVotes: true }, []), { kind: "lacuna", motivo: PORUF_MOTIVO.semVotos });
  // sem flag da fonte, o motivo é neutro: o banco não sabe por que não há voto individual
  assert.deepEqual(placarPorUf({ body: "camara" }, []), { kind: "lacuna", motivo: PORUF_MOTIVO.semLinhas });
});

test("C2: acima de LIMITE_SEM_UF registros sem UF na data, o placar por UF vira lacuna nomeada inteira", () => {
  assert.equal(LIMITE_SEM_UF, 0.1);
  // 3 sem UF em 20 = 15%: legislatura não carregada, não um placar quase vazio
  const votos = [...Array.from({ length: 17 }, () => ({ uf: "SP", value: "sim" as VoteValue })), ...Array.from({ length: 3 }, () => ({ uf: null, value: "nao" as VoteValue }))];
  const p = placarPorUf({ body: "camara" }, votos);
  assert.deepEqual(p, { kind: "lacuna", motivo: motivoSemMandatos(3, 20), semMandatos: true });
  assert.match(motivoSemMandatos(3, 20), /Não temos os mandatos dessa legislatura carregados/);
  // todos sem UF (ex.: votação de 2021 com a 56ª legislatura fora do banco)
  const todos = placarPorUf({ body: "camara" }, Array.from({ length: 291 }, () => ({ uf: null, value: "sim" as VoteValue })));
  assert.equal(todos.kind === "lacuna" && todos.semMandatos, true);
  // a lacuna de "sem voto individual" não carrega semMandatos
  assert.equal("semMandatos" in placarPorUf({ body: "camara" }, []), false);
});
