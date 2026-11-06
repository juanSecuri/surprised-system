"""CENTINELA · capa de datos (Supabase + SQLite local degradado)."""
import json, sqlite3, time
from datetime import datetime, timezone
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from .config import DATABASE_URL, LOCAL_DB, LATIDO_SEG, POOL_MIN, NODO, log
from .utilidades import pais_de, calcular_score, nivel_de

pool = ConnectionPool(DATABASE_URL, min_size=POOL_MIN, max_size=4, max_idle=60, open=False,
    kwargs={"row_factory": dict_row, "connect_timeout": 5, "prepare_threshold": None}) if DATABASE_URL else None

def q(sql: str, params=(), uno=False, todos=False):
    if pool is None:
        raise RuntimeError("DATABASE_URL no configurada")
    with pool.connection(timeout=4) as conn:
        cur = conn.execute(sql, params)
        if uno: return cur.fetchone()
        if todos: return cur.fetchall()
        return None

_db_estado = {"ok": False, "t": time.time()}

def db_ok() -> bool:
    if time.time() - _db_estado["t"] < LATIDO_SEG + 10:
        return _db_estado["ok"]
    try:
        q("select 1", uno=True)
        ok = True
    except Exception:
        ok = False
    _db_estado.update(ok=ok, t=time.time())
    return ok

def local():
    c = sqlite3.connect(LOCAL_DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("create table if not exists pendientes (id integer primary key autoincrement, payload text not null, creado text default current_timestamp)")
    c.execute("create table if not exists cache (numero text primary key, data text not null, actualizado text default current_timestamp)")
    return c

def evento(tipo: str, detalle: str = ""):
    try: q("insert into eventos (nodo, tipo, detalle) values (%s,%s,%s)", (NODO, tipo, detalle))
    except Exception: pass

def marcar_db(ok: bool): _db_estado.update(ok=ok, t=time.time())

def recalcular(conn, numero: str):
    r = conn.execute("""
        select count(*) total, count(distinct coalesce(reportero, id::text)) unicos,
               max(creado) ultimo, min(creado) primero,
               mode() within group (order by categoria) cat
        from reportes where numero = %s""", (numero,)).fetchone()
    n = conn.execute("select verificado from numeros where numero=%s", (numero,)).fetchone()
    dias = (datetime.now(timezone.utc) - r["ultimo"]).days if r["ultimo"] else 999
    score = calcular_score(r["unicos"], dias, numero, n["verificado"] if n else False)
    conn.execute("""update numeros set score=%s, nivel=%s, total_reportes=%s, reporteros_unicos=%s,
                    categoria_principal=%s, ultimo_reporte=coalesce(%s, ultimo_reporte),
                    primer_reporte=coalesce(%s, primer_reporte) where numero=%s""",
                 (score, nivel_de(score), r["total"], r["unicos"], r["cat"], r["ultimo"], r["primero"], numero))

def guardar_reporte(p: dict) -> int:
    with pool.connection(timeout=4) as conn:
        conn.execute("insert into numeros (numero, pais) values (%s,%s) on conflict do nothing", (p["numero"], pais_de(p["numero"])))
        rid = conn.execute("""insert into reportes (numero, categoria, descripcion, canal, reportero, nodo, clasificado_por, creado)
                              values (%s,%s,%s,%s,%s,%s,%s, coalesce(%s::timestamptz, now())) returning id""",
                           (p["numero"], p.get("categoria"), p.get("descripcion"), p["canal"], p["reportero"], p["nodo"], "usuario" if p.get("categoria") else None, p.get("creado"))).fetchone()["id"]
        recalcular(conn, p["numero"])
    return rid

def ficha(numero: str) -> dict:
    try:
        n = q("select * from numeros where numero=%s", (numero,), uno=True)
        ult = q("""select categoria, descripcion, canal, creado from reportes where numero=%s order by creado desc limit 5""", (numero,), todos=True)
        if n: data = {**n, "conocido": True, "ultimos_reportes": ult}
        else:
            s = calcular_score(0, 999, numero, False)
            data = {"numero": numero, "pais": pais_de(numero), "score": s, "nivel": nivel_de(s), "total_reportes": 0, "reporteros_unicos": 0, "categoria_principal": None, "resumen_ia": None, "verificado": False, "conocido": False, "ultimos_reportes": []}
        data = json.loads(json.dumps(data, default=str))
        with local() as c: c.execute("insert or replace into cache (numero, data) values (?,?)", (numero, json.dumps(data)))
        data["modo"] = "normal"
        return data
    except Exception as e:
        log.warning("Supabase no disponible, usando caché local: %s", e)
        with local() as c: row = c.execute("select data from cache where numero=?", (numero,)).fetchone()
        if row: data = json.loads(row["data"])
        else:
            s = calcular_score(0, 999, numero, False)
            data = {"numero": numero, "pais": pais_de(numero), "score": s, "nivel": nivel_de(s), "total_reportes": None, "conocido": False, "ultimos_reportes": []}
        data["modo"] = "degradado"
        return data

def stats_completas():
    gen = q("""select (select count(*) from numeros) numeros, (select count(*) from reportes) reportes,
                      (select count(*) from reportes where creado > now() - interval '24 hours') reportes_24h,
                      (select count(*) from numeros where nivel = 'alto') alto_riesgo""", uno=True)
    gen["por_categoria"] = q("""select coalesce(categoria, 'sin clasificar') categoria, count(*) total from reportes group by 1 order by 2 desc""", todos=True)
    gen["por_canal"] = q("select canal, count(*) total from reportes group by 1 order by 2 desc", todos=True)
    gen["por_dia"] = q("""select date_trunc('day', creado)::date dia, count(*) total from reportes where creado > now() - interval '14 days' group by 1 order by 1""", todos=True)
    return gen

def top_numeros(limite: int = 10):
    return q("""select numero, pais, score, nivel, total_reportes, categoria_principal, ultimo_reporte from numeros where verificado = false order by score desc, total_reportes desc limit %s""", (min(limite, 50),), todos=True)

def recientes_reportes(limite: int = 15):
    return q("""select r.numero, r.categoria, r.canal, r.nodo, r.creado, n.nivel, n.score from reportes r join numeros n using (numero) order by r.creado desc limit %s""", (min(limite, 50),), todos=True)

def cluster_data():
    nodos = q("""select *, (ultimo_latido > now() - make_interval(secs => %s)) as online from nodos order by nombre""", (LATIDO_SEG * 3,), todos=True)
    ev = q("select nodo, tipo, detalle, creado from eventos order by creado desc limit 15", todos=True)
    return {"nodos": nodos, "eventos": ev}
