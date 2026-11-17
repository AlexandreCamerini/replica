-- Administração de coleta, C11: o `admin_central` não escolhe mais o relógio do pedido (achado G4-1 da verificação da parte C).
--
-- O que faz:
--   Acrescenta, em `adm_pedidos` e em `adm_pedidos_decisao`, uma policy RESTRICTIVE de insert para o `admin_central`, `admin_central_criado_agora`:
--   `criado_em` tem de estar entre now() - 5 s e now() + 5 s. As policies permissivas da 0153 (`admin_central_insere`) continuam; a restritiva soma-se a elas (AND).
-- Por que:
--   Com `criado_em` livre, o cliente da central punha um pedido no passado, passava na frente da fila (SQL_CANDIDATOS ordena por `criado_em`) e acendia em falso o
--   aviso "executor parado" (`fila_velha`). O executor da CLI (outro role, sem esta policy) e o default `now()` não são afetados.
--   `chave_idem` forjada, que furaria o "dois cliques = um pedido", é tratada no executor (recalcula a chave a partir dos parâmetros e recusa a que não confere).
-- É aditiva: só duas policies. Nenhuma tabela, coluna, grant ou migração existente muda.
-- Para desfazer: `drop policy admin_central_criado_agora on adm_pedidos; drop policy admin_central_criado_agora on adm_pedidos_decisao;`.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

create policy admin_central_criado_agora on adm_pedidos as restrictive for insert to admin_central
  with check (criado_em between now() - interval '5 seconds' and now() + interval '5 seconds');
create policy admin_central_criado_agora on adm_pedidos_decisao as restrictive for insert to admin_central
  with check (criado_em between now() - interval '5 seconds' and now() + interval '5 seconds');
