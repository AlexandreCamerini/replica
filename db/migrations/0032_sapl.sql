-- W3-B / D126–D129: Câmaras Municipais via SAPL (Interlegis), sem tela por enquanto.
-- Tabelas sapl_* guardam o que cada SAPL publica, por câmara e id da fonte; NÃO alimentam proposals/votes/attendance
-- (promover para o modelo comum é decisão do agente de tela/arquitetura: D129). person_id só com casamento único (D128).
create table sapl_houses (
  id bigint generated always as identity primary key,
  place_id uuid not null unique references places(id) on delete restrict,
  body_id uuid references legislative_bodies(id) on delete set null,
  base_url text,                            -- https://sapl.<cidade>.<uf>.leg.br (registro do Interlegis)
  registry_url text not null,               -- página do Interlegis "órgãos atendidos" onde a URL foi achada
  registry_status text,                     -- "Funcionando" etc., como o Interlegis publica
  status text not null check (status in ('ok','sem_sapl_no_registro','sem_api','fora_do_ar','robots_bloqueia')),
  note text,
  legislature_number int, legislature_start date, legislature_end date,
  checked_at timestamptz not null default now(),
  loaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sapl_parlamentares (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  sapl_id int not null,
  nome_parlamentar text not null,
  nome_completo text,
  sexo char(1),
  ativo boolean,
  foto_url text,
  person_id uuid references people(id) on delete set null,
  match_status text not null default 'nao_tentado' check (match_status in ('casado','ambiguo','sem_candidato','fora_da_legislatura','nao_tentado')),
  match_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, sapl_id)
);
create index on sapl_parlamentares (person_id);

create table sapl_mandatos (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  sapl_id int not null,
  parlamentar_sapl_id int not null,
  legislature_number int,
  started_on date, ended_on date,
  titular boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, sapl_id)
);

create table sapl_materias (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  sapl_id int not null,
  type_sigla text not null, type_name text not null,
  number int not null, year smallint not null,
  presented_on date,
  summary text not null,
  in_progress boolean,
  url text not null,                        -- página da matéria no SAPL
  text_url text,                            -- PDF do texto original
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, sapl_id)
);
create index on sapl_materias (house_id, year);

create table sapl_autorias (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  materia_sapl_id int not null,
  autor_sapl_id int not null,
  autor_nome text,
  parlamentar_sapl_id int,                  -- null: autor não é vereador (Executivo, Mesa, comissão)
  primeiro_autor boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, materia_sapl_id, autor_sapl_id)
);
create index on sapl_autorias (house_id, parlamentar_sapl_id);

create table sapl_sessoes (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  sapl_id int not null,
  starts_on date not null, starts_time text,
  name text not null,                       -- "1ª Ordinária da 2ª Sessão Legislativa da 20ª Legislatura"
  type_id int,
  finished boolean,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, sapl_id)
);

create table sapl_presencas (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  sessao_sapl_id int not null,
  parlamentar_sapl_id int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, sessao_sapl_id, parlamentar_sapl_id)
);

create table sapl_votos (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  sapl_id int not null,
  votacao_sapl_id int not null,
  parlamentar_sapl_id int not null,
  voto text not null,                       -- como a fonte escreve: Sim, Não, Abstenção, Não Votou...
  voted_at timestamptz,
  description text,                         -- __str__ da fonte (matéria, sessão, resultado)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, sapl_id)
);
create index on sapl_votos (house_id, parlamentar_sapl_id);

do $$
declare t text;
begin
  foreach t in array array['sapl_houses','sapl_parlamentares','sapl_mandatos','sapl_materias','sapl_autorias','sapl_sessoes','sapl_presencas','sapl_votos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select on %I to web_reader', t);
    execute format('create policy public_read on %I for select to web_reader using (true)', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;
