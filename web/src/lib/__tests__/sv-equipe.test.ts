import assert from "node:assert/strict";
import { test } from "node:test";
import { SEM_FUNCAO, vmEquipe } from "../../components/sv/pessoa/equipe.ts";

// Equipe do gabinete só em agregado (catálogo 08/11, "Não adaptar"): o view model nunca carrega nome de assessor.
const NOMES = ["Ana Beatriz Fictícia", "Carlos Exemplo Teste", "Zuleica Demonstração", "José Sem Função"];
const linhas = [
  { name: NOMES[0], role: "Secretário parlamentar (SP10)", monthlySalaryCents: null, asOf: "2026-11-10" },
  { name: NOMES[1], role: "Secretário parlamentar (SP02)", monthlySalaryCents: null, asOf: "2026-11-10" },
  { name: NOMES[2], role: "Secretário parlamentar (SP02)", monthlySalaryCents: null, asOf: "2026-11-09" },
  { name: NOMES[3], role: null, monthlySalaryCents: null, asOf: "2026-11-10" },
];

test("vmEquipe: nenhum nome de assessor sai no agregado", () => {
  const vm = vmEquipe(linhas);
  assert.ok(vm);
  const json = JSON.stringify(vm);
  for (const n of NOMES) assert.ok(!json.includes(n), `nome no agregado: ${n}`);
  assert.ok(!json.includes("Fictícia") && !json.includes("Zuleica"));
});

test("vmEquipe: funções em ordem alfabética (numérica no nível), 'não informada' por último, total certo", () => {
  const vm = vmEquipe(linhas)!;
  assert.equal(vm.total, 4);
  assert.deepEqual(vm.funcoes, [
    { funcao: "Secretário parlamentar (SP02)", n: 2 },
    { funcao: "Secretário parlamentar (SP10)", n: 1 },
    { funcao: SEM_FUNCAO, n: 1 },
  ]);
  assert.equal(vm.funcoes.reduce((s, f) => s + f.n, 0), vm.total);
  assert.equal(vm.dataLista, "2026-11-10");
});

test("vmEquipe: sem salário publicado, soma é null (lacuna), nunca 0", () => {
  const vm = vmEquipe(linhas)!;
  assert.equal(vm.somaMensal, null);
  assert.equal(vm.semSalario, 0);
});

test("vmEquipe: soma só o publicado e conta quem ficou de fora", () => {
  const vm = vmEquipe([
    { ...linhas[0], monthlySalaryCents: 1_000_000 },
    { ...linhas[1], monthlySalaryCents: 250_050 },
    linhas[2],
    linhas[3],
  ])!;
  assert.equal(vm.somaMensal, 1_250_050);
  assert.equal(vm.semSalario, 2);
});

test("vmEquipe: lista vazia é null (a tela mostra lacuna)", () => {
  assert.equal(vmEquipe([]), null);
});
