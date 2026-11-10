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
    a = _ans(o_que_propoe={"diz": True, "frase": "Cria contribuição sobre a folha", "trecho": "Fica criado imposto novo sobre portos", "pagina": 1})
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


# Casos da revisão independente de 04/11/2026: cada um passava sem aviso antes da correção.
def _one(field, frase, trecho, pagina=1, **extra):
    return validate(_ans(**{field: {"diz": True, "frase": frase, "trecho": trecho, "pagina": pagina, **extra}}), PAGES)


def test_trecho_de_uma_palavra_nao_sustenta_nada():
    _, checks = _one("o_que_propoe", "Cria taxa que reduz o preço", "de")
    assert "trecho_curto" in checks["o_que_propoe"]


def test_numero_por_extenso_conta_como_numero():
    _, checks = _one("o_que_propoe", "Cria contribuição de cinco por cento", "Fica criada a contribuição de 2,5% sobre a folha")
    assert "numero_sem_trecho" in checks["o_que_propoe"]


def test_termo_proibido_em_outra_flexao():
    for frase in ("Cria regra que beneficiará portos", "Muda regras que prejudicam portos", "Cria avanços no porto"):
        _, checks = _one("o_que_propoe", frase, "Fica criada a contribuição de 2,5% sobre a folha")
        assert "termo_proibido" in checks["o_que_propoe"], frase


def test_beneficio_substantivo_nao_e_termo_proibido():
    _, checks = _one("quem_recebe", "Cria benefício para trabalhadores portuários", "A medida reduz o custo do trabalhador portuário avulso", pagina=2)
    assert "termo_proibido" not in checks.get("quem_recebe", [])


def test_pagina_inventada_e_trocada_pela_real_quando_o_trecho_cruza_paginas():
    out, _ = _one("o_que_muda", "Reduz custo do trabalhador portuário", "empresas do setor portuário. JUSTIFICAÇÃO A medida reduz", pagina=999)
    assert out["o_que_muda"]["pagina"] == 1


def test_estimativa_sem_numero_bloqueia():
    out, checks = _one("estimativa_impacto", "Custo estimado não informado", "A medida reduz o custo do trabalhador portuário avulso", pagina=2)
    assert "estimativa_sem_numero" in blocking(checks, out)["estimativa_impacto"]


def test_direcao_fora_da_lista_bloqueia_e_forma_errada_e_recusada():
    from civico_etl.drafting import shape_errors

    out, checks = _one("dinheiro", "Transfere a contribuição ao setor portuário", "Fica criada a contribuição de 2,5% sobre a folha", direcao="foo")
    assert "direcao_invalida" in blocking(checks, out)["dinheiro"]
    assert any("ausente" in e for e in shape_errors({"o_que_propoe": {"diz": False, "frase": "", "trecho": "", "pagina": 0}}))
    assert shape_errors(_ans()) == []


def test_homoglifo_e_hifens_nao_escapam():
    _, checks = _one("o_que_propoe", "Cria regra que beneficiа portos", "Fica criada a contribuição de 2,5% sobre a folha")
    assert "caractere_estranho" in checks["o_que_propoe"]
    _, checks = _one("o_que_propoe", "Cria-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p", "Fica criada a contribuição de 2,5% sobre a folha")
    assert any(i.startswith("frase_longa") for i in checks["o_que_propoe"])
