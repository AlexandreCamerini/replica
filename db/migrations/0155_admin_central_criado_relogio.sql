-- Administração de coleta, C12: a janela de `criado_em` dos pedidos da central passa a valer pelo RELÓGIO, não pelo início da transação
-- (achado N2 da reverificação da parte C, verificacao/parte-c-opus-v2.md).
--
-- O que faz:
--   Acrescenta, em `adm_pedidos` e em `adm_pedidos_decisao`, mais uma policy RESTRICTIVE de insert para o `admin_central`, `admin_central_criado_relogio`:
--   `criado_em` tem de estar a no máximo 5 s de `clock_timestamp()`. Soma-se (AND) à `admin_central_criado_agora` da 0154, que usa `now()`.
-- Por que:
--   `now()` é o início da transação. Um cliente que abre a transação, espera e insere com o default grava `criado_em` retroagido, passa na frente da fila e acende
--   em falso o aviso "executor parado". Com `clock_timestamp()`, o default (`now()`) de uma transação longa fica fora da janela e o insert é recusado.
--   O uso legítimo da central insere em transação curta e não é afetado.
-- É aditiva: só duas policies. Nenhuma tabela, coluna, grant, policy ou migração existente muda.
-- Para desfazer: `drop policy admin_central_criado_relogio on adm_pedidos; drop policy admin_central_criado_relogio on adm_pedidos_decisao;`.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

create policy admin_central_criado_relogio on adm_pedidos as restrictive for insert to admin_central
  with check (criado_em between clock_timestamp() - interval '5 seconds' and clock_timestamp() + interval '5 seconds');
create policy admin_central_criado_relogio on adm_pedidos_decisao as restrictive for insert to admin_central
  with check (criado_em between clock_timestamp() - interval '5 seconds' and clock_timestamp() + interval '5 seconds');
