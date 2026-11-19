-- Login do site (provedor `pg`): o código de e-mail passa a ser amarrado ao navegador que o pediu (plano de go-live, Fase 7, item 7.4; runbook-railway §8, ponto c).
-- Tentativa sem o nonce certo não conta nem compara: ninguém queima as 5 tentativas de outra pessoa nem ganha palpite com o código dela.
-- Linhas antigas ficam com '' e não aceitam verificação (quem tinha código pendente na hora da migração pede outro; vale 10 min).
--
-- Numerada 0144, antes da 0150, de propósito: vai junto com a 0143 no Supabase, antes do corte (`MIGRATE_ATE=0144`), porque o código do provedor `pg`
-- que lê esta coluna entra em produção com AUTH_PROVIDER=pg no corte, e o banco do Railway nasce da cópia do Supabase.
-- É aditiva: uma coluna com default. No Supabase é inofensiva (schema `login`, fora do PostgREST, sem uso enquanto AUTH_PROVIDER=supabase).
-- Para desfazer: `alter table login.codes drop column nonce_hash;`
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

alter table login.codes add column if not exists nonce_hash text not null default '';
comment on column login.codes.nonce_hash is 'Hash do nonce do navegador que pediu o código. Só esse navegador verifica e só as tentativas dele contam.';
