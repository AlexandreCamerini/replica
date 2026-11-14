-- Índice sem leitor em expenses: 0001 criou (supplier_doc) sem nome, virou expenses_supplier_doc_idx.
-- Em produção (2026-11-14, 10 dias de tráfego): 0 leituras, 30 MB. Nenhuma consulta do site, do MCP ou do ETL filtra por
-- supplier_doc com igualdade ou prefixo: o único uso (mcp/src/tools.ts, maiores fornecedores) agrega sobre regexp_replace(supplier_doc),
-- que este btree não atende. Cada escrita em expenses pagava o índice.
-- Ficam de propósito: proposals_summary_trgm (busca por texto de propostas) e asset_declarations_person_id_year_idx
-- (mcp/src/tools.ts lê patrimônio por person_id).
-- Para recriar: create index expenses_supplier_doc_idx on expenses (supplier_doc);
drop index if exists expenses_supplier_doc_idx;
