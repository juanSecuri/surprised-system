-- =====================================================================
--  CENTINELA · Esquema de base de datos (PostgreSQL / Supabase)
--  Ejecutar UNA sola vez en Supabase → SQL Editor → New query → Run
-- =====================================================================

-- Números telefónicos conocidos por el sistema
create table if not exists numeros (
    numero              text primary key,          -- formato E.164: +573001234567
    pais                text,
    score               int  not null default 0,   -- 0..100 riesgo calculado
    nivel               text not null default 'bajo',  -- bajo | medio | alto
    total_reportes      int  not null default 0,
    reporteros_unicos   int  not null default 0,
    categoria_principal text,
    resumen_ia          text,                      -- resumen generado por Ollama
    verificado          boolean not null default false, -- true = número legítimo (lista blanca)
    primer_reporte      timestamptz not null default now(),
    ultimo_reporte      timestamptz not null default now()
);

-- Cada reporte que hace una persona (web, Telegram, Android...)
create table if not exists reportes (
    id          bigserial primary key,
    numero      text not null references numeros(numero) on delete cascade,
    categoria   text,                 -- estafa, telemarketing, cobranza, encuesta, wangiri, suplantacion, extorsion, otro
    descripcion text,
    canal       text not null default 'web',
    reportero   text,                 -- hash anónimo (nunca se guarda la IP real)
    nodo        text,                 -- JE o JP: qué servidor atendió el reporte
    clasificado_por text,             -- usuario | ia
    creado      timestamptz not null default now()
);
create index if not exists idx_reportes_numero on reportes(numero);
create index if not exists idx_reportes_creado on reportes(creado desc);

-- Latidos (heartbeat) de cada servidor del clúster
create table if not exists nodos (
    nombre         text primary key,   -- JE | JP
    rol            text,               -- principal | respaldo
    ip_tailscale   text,
    hostname       text,
    cpu            real,
    ram            real,
    disco          real,
    temp           real,
    version        text,
    iniciado       timestamptz,
    ultimo_latido  timestamptz
);

-- Bitácora de eventos del clúster (arranques, failover, sincronizaciones)
create table if not exists eventos (
    id      bigserial primary key,
    nodo    text,
    tipo    text,
    detalle text,
    creado  timestamptz not null default now()
);
create index if not exists idx_eventos_creado on eventos(creado desc);

-- Llamadas reales que avisa el celular (MacroDroid / Atajos)
create table if not exists llamadas (
    id          bigserial primary key,
    numero      text,
    dispositivo text,
    score       int,
    nivel       text,
    nodo        text,
    creado      timestamptz not null default now()
);
create index if not exists idx_llamadas_creado on llamadas(creado desc);

-- Seguridad: activar RLS sin políticas bloquea la API REST pública de Supabase
-- (clave anon). Nuestros servidores entran con el usuario postgres, que no se ve afectado.
alter table numeros  enable row level security;
alter table reportes enable row level security;
alter table nodos    enable row level security;
alter table eventos  enable row level security;
alter table llamadas enable row level security;
