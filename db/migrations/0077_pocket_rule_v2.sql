-- Regra 1, versão 2 (03/11/2026): "crédito" sozinho trazia "crédito extraordinário" (verba entre ministérios)
-- e "créditos de energia", que não são dinheiro da pessoa. Fica "linha de crédito"; "juros" continua.
-- A v1 permanece na tabela: a página "Como escolhemos" mostra as versões anteriores.
insert into pocket_rules (version, topic_slugs, terms, term_pattern, published_on) values (
  2,
  array['economia', 'trabalho', 'assistencia'],
  array['tributo', 'imposto', 'alíquota', 'contribuição', 'salário', 'benefício', 'aposentadoria', 'pensão',
        'tarifa', 'preço', 'juros', 'linha de crédito', 'FGTS', 'renda', 'dívida'],
  '\m(tribut|impost|aliquot|contribuic|salari|benefici|aposentad|pensao|pensoes|tarifa|preco|juros|linhas? de credito|fgts|renda|divida)',
  date '2026-11-03'
);
