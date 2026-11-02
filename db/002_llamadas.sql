-- =====================================================================
--  CENTINELA · Migración 002: llamadas reales que avisa el celular
--  Ejecutar UNA vez en Supabase → SQL Editor → Run
-- =====================================================================
create table if not exists llamadas (
    id          bigserial primary key,
    numero      text,                 -- null = número oculto/privado
    dispositivo text,                 -- ej. celular-juan
    score       int,
    nivel       text,
    nodo        text,                 -- servidor que la atendió (JE/JP)
    creado      timestamptz not null default now()
);
create index if not exists idx_llamadas_creado on llamadas(creado desc);
alter table llamadas enable row level security;
