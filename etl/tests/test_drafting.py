"""Validação do rascunho: nunca confiar no que o modelo devolve. Rodar: uv run --with pytest pytest tests/"""

from civico_etl.drafting import FIELDS, SCHEMA, blocking, locate, validate

PAGES = [
    "Art. 1º Fica criada a contribuição de 2,5% sobre a folha\nde pagamento das em-\npresas do setor portuário.",
    "JUSTIFICAÇÃO\nA medida reduz o custo do trabalhador portuário avulso.",
]


def _ans(**over):
    base = {f: {"diz": False, "frase": "", "trecho": "", "pagina": 0} for f in FIELDS}
    base["dinheiro"]["direcao"] = "nao_diz"
    base.update(over)
    return base


def test_schema_exige_todos_os_campos():
    assert set(SCHEMA["required"]) == set(FIELDS)
    assert SCHEMA["properties"]["dinheiro"]["properties"]["direcao"]["enum"] == ["entra", "sai", "dividido", "nao_diz"]


def test_trecho_com_quebra_de_linha_e_hifen_e_encontrado():
    assert locate("folha de pagamento das empresas do setor portuário", PAGES) == 1
    assert locate("trecho que não existe", PAGES) is None


def test_trecho_inventado_bloqueia():
    a = _ans(o_que_propoe={"diz": True, "frase": "Cria contribuição sobre a folha", "trecho": "Fica criado imposto novo", "pagina": 1})
    out, checks = validate(a, PAGES)
    assert "trecho_nao_encontrado" in checks["o_que_propoe"]
    assert blocking(checks, out) == {"o_que_propoe": ["trecho_nao_encontrado"]}


def test_numero_fora_do_trecho_bloqueia_e_pagina_errada_e_corrigida():
    a = _ans(quem_paga={"diz": True, "frase": "Empresas do porto pagam 3% sobre a folha", "trecho": "Fica criada a contribuição de 2,5% sobre a folha", "pagina": 2})
    out, checks = validate(a, PAGES)
    assert "numero_sem_trecho" in checks["quem_paga"]
    assert "pagina_corrigida:2->1" in checks["quem_paga"]
    assert out["quem_paga"]["pagina"] == 1


def test_termo_proibido_sem_acento_tambem_conta():
    a = _ans(o_que_muda={"diz": True, "frase": "Reduz custo, um avanco para o porto", "trecho": "reduz o custo do trabalhador portuário avulso", "pagina": 2})
    _, checks = validate(a, PAGES)
    assert "termo_proibido" in checks["o_que_muda"]


def test_nao_diz_limpa_o_campo_e_nao_bloqueia():
    a = _ans(estimativa_impacto={"diz": False, "frase": "sobra", "trecho": "sobra", "pagina": 3})
    out, checks = validate(a, PAGES)
    assert out["estimativa_impacto"] == {"diz": False, "frase": "", "trecho": "", "pagina": 0}
    assert not blocking(checks, out)


def test_frase_boa_passa_sem_aviso():
    a = _ans(o_que_propoe={"diz": True, "frase": "Cria contribuição de 2,5% sobre a folha das empresas portuárias", "trecho": "Fica criada a contribuição de 2,5% sobre a folha", "pagina": 1})
    _, checks = validate(a, PAGES)
    assert "o_que_propoe" not in checks


def test_placar_da_avaliacao_pune_afirmacao_sem_apoio():
    from evals.rascunho_eval import score

    ok = {f: {"diz": False, "frase": "", "trecho": "", "pagina": 0} for f in FIELDS}
    ok["o_que_propoe"] = {"diz": True, "frase": "Cria contribuição", "trecho": "Fica criada", "pagina": 1}
    rot = {f: {"diz": False} for f in FIELDS} | {"o_que_propoe": {"diz": True, "deve_citar": "criada"}}
    assert score([{"chave": "x", "respostas": ok, "avisos": {}, "rotulos": rot}])["passou"]
    rot_errado = rot | {"o_que_propoe": {"diz": False}}
    r = score([{"chave": "x", "respostas": ok, "avisos": {}, "rotulos": rot_errado}])
    assert r["falso_diz"] > 5 and not r["passou"]
