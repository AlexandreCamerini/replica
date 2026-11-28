-- 0159: orçamento de envios de código POR ORIGEM no login da central (auditoria de 11/2026, M12).
--
-- O problema: `login.central_codigos` limita os envios por E-MAIL (3 por hora). Quem passa o Turnstile pode gastar os 3 envios do e-mail de um admin e travar o login
-- real por 1 h (cada pedido ainda sobrescreve o código pendente). O limite por e-mail sozinho não distingue quem pede.
--
-- O que faz:
--   1. `login.central_envios_origem`: um registro por envio de código que ESTE sistema aceitou, com o hash da origem (HMAC do IP com chave derivada do SESSION_SECRET: o banco
--      nunca guarda o IP) e o instante. A aplicação recusa o envio quando a origem já tem ORIGEM_POR_HORA (3) envios na última hora. Junto, o limite por e-mail sobe de 3 para
--      6 (login-core.ts): uma única origem nunca esgota o orçamento de um admin, são necessárias pelo menos duas.
--   2. Grants só para `admin_central`: `select, insert`. Sem `update` nem `delete`: linhas velhas (mais de 1 dia) ficam; a limpeza é do dono do banco
--      (`delete from login.central_envios_origem where enviado_em < now() - interval '7 days'`). Cresce no máximo 3 linhas por origem por hora, e só para admin com captcha válido.
--
-- Limites declarados: a conferência é uma instrução SQL, mas contar e inserir não é serializado entre pedidos simultâneos da mesma origem (podem passar 1–2 a mais).
-- IP compartilhado (rede de escritório, NAT) divide o orçamento. Atacante com vários IPs ainda gasta o orçamento do e-mail, só fica mais caro.
--
-- É aditiva: uma tabela, um índice e grants. Nada existente muda.
-- Para desfazer: `drop table login.central_envios_origem;`
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md. ORDEM: aplicar ANTES de publicar o código que a usa; o código novo sem a tabela recusa todo envio.

create table login.central_envios_origem (
  origem_hash text not null check (origem_hash ~ '^[0-9a-f]{64}$'),
  enviado_em timestamptz not null
);
comment on table login.central_envios_origem is 'Envios de código da central por origem (hash do IP, nunca o IP). Orçamento por hora da origem; só o admin_central lê e insere.';
create index central_envios_origem_idx on login.central_envios_origem (origem_hash, enviado_em desc);

grant select, insert on login.central_envios_origem to admin_central;
