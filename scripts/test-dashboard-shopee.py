#!/usr/bin/env python3
"""
test-dashboard-shopee.py — Teste local (NAO grava Firestore).

Puxa conversionReport da API Shopee e agrega com a MESMA logica do dashboard
(buildShopeePanelAppDayMap / modo PromosApp node_once).

Uso:
  python scripts/test-dashboard-shopee.py
  python scripts/test-dashboard-shopee.py 2026-06-11

Credenciais (nao coloque no codigo — use .env):
  SHOPEE_APP_ID + SHOPEE_SECRET
  OU proxy: VITE_AFFILIATE_GRAPHQL_URL + VITE_BACKFILL_SECRET

Dependencia: pip install requests  (ou use apenas stdlib com --stdlib)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATHS = [
    ROOT / "functions" / ".env.projetoafiliado-9ff07",
    ROOT / ".env",
    Path(__file__).resolve().parent / ".env",
]
API_URL = "https://open-api.affiliate.shopee.com.br/graphql"
PAGE_LIMIT = 500
TZ_BR = timezone(timedelta(hours=-3))


def load_env_files() -> None:
    for p in ENV_PATHS:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def brt_day_range(date_str: str) -> tuple[int, int]:
    start_dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=TZ_BR)
    end_dt = start_dt.replace(hour=23, minute=59, second=59)
    return int(start_dt.timestamp()), int(end_dt.timestamp())


def round_money(v: float) -> float:
    return round(v + 1e-9, 2)


def classify_status(raw: str) -> str:
    s = (raw or "").upper().strip()
    if s == "COMPLETED" or "CONCLU" in s or "COMPLET" in s:
        return "concluida"
    if s in ("CANCELLED", "CANCELED"):
        return "cancelada"
    if s == "UNPAID":
        return "unpaid"
    return "pendente"


def node_once_commission(node: dict) -> float:
    net_c = float(node.get("netCommission") or 0)
    if net_c > 0:
        return net_c
    return float(node.get("totalCommission") or 0)


def build_query(start: int, end: int, scroll_id: str | None) -> str:
    scroll_clause = f', scrollId: {json.dumps(scroll_id)}' if scroll_id else ""
    return (
        f"{{ conversionReport(limit: {PAGE_LIMIT}, "
        f"purchaseTimeStart: {start}, purchaseTimeEnd: {end}{scroll_clause}) "
        "{ nodes { conversionId purchaseTime utmContent totalCommission netCommission "
        "orders { orderId orderStatus items { qty itemPrice actualAmount "
        "fraudStatus attributionType } } } "
        "pageInfo { hasNextPage scrollId } } }"
    )


def auth_header_direct(app_id: str, secret: str, payload: str) -> dict:
    ts = int(time.time())
    sig = hashlib.sha256(f"{app_id}{ts}{payload}{secret}".encode()).hexdigest()
    return {
        "Authorization": f"SHA256 Credential={app_id}, Timestamp={ts}, Signature={sig}",
        "Content-Type": "application/json",
    }


def post_json(url: str, headers: dict, body: dict) -> dict:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            text = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {text[:300]}") from e
    return json.loads(text)


def shopee_fetch_direct(app_id: str, secret: str, query: str) -> dict:
    body = {"query": query}
    payload = json.dumps(body, separators=(",", ":"))
    headers = auth_header_direct(app_id, secret, payload)
    res = post_json(API_URL, headers, body)
    if res.get("errors"):
        raise RuntimeError(f"API Shopee: {res['errors']}")
    return res.get("data") or {}


def shopee_fetch_proxy(proxy_url: str, bearer: str, query: str) -> dict:
    body = {"query": query}
    headers = {
        "Authorization": f"Bearer {bearer}",
        "Content-Type": "application/json",
    }
    res = post_json(proxy_url, headers, body)
    if not res.get("success", True) and res.get("error"):
        raise RuntimeError(res["error"])
    if res.get("errors"):
        raise RuntimeError(f"API via proxy: {res['errors']}")
    return res.get("data") or {}


def resolve_auth() -> tuple[str, callable]:
    load_env_files()
    app_id = (os.environ.get("SHOPEE_APP_ID") or "").strip()
    secret = (os.environ.get("SHOPEE_SECRET") or "").strip()
    if app_id and secret:
        return "direct", lambda q: shopee_fetch_direct(app_id, secret, q)

    proxy_url = (
        os.environ.get("SHOPEE_PROXY_URL")
        or os.environ.get("VITE_AFFILIATE_GRAPHQL_URL")
        or ""
    ).strip()
    proxy_secret = (
        os.environ.get("META_SYNC_SECRET")
        or os.environ.get("VITE_BACKFILL_SECRET")
        or ""
    ).strip()
    if proxy_url and proxy_secret:
        return f"proxy {proxy_url}", lambda q: shopee_fetch_proxy(proxy_url, proxy_secret, q)

    print("ERRO: defina SHOPEE_APP_ID+SHOPEE_SECRET ou VITE_AFFILIATE_GRAPHQL_URL+VITE_BACKFILL_SECRET no .env", file=sys.stderr)
    sys.exit(1)


def fetch_all_conversions(fetch_fn, date_str: str) -> list[dict]:
    start, end = brt_day_range(date_str)
    all_nodes: list[dict] = []
    scroll_id: str | None = None
    page = 0
    while True:
        page += 1
        data = fetch_fn(build_query(start, end, scroll_id))
        report = data.get("conversionReport") or {}
        nodes = report.get("nodes") or []
        all_nodes.extend(nodes)
        print(f"pagina {page}: +{len(nodes)} (total {len(all_nodes)})", file=sys.stderr)
        page_info = report.get("pageInfo") or {}
        if not page_info.get("hasNextPage") or not page_info.get("scrollId"):
            break
        scroll_id = page_info["scrollId"]
    return all_nodes


def aggregate_promosapp(nodes: list[dict]) -> dict:
    """Mesma regra do buildShopeePanelAppDayMap (node_once, split nivel conversao)."""
    pedidos_set: set[str] = set()
    pedidos_concluidos_conv = 0
    pedidos_pendentes_conv = 0
    pedidos_concluidos_pedido = 0
    pedidos_pendentes_pedido = 0
    cancelados_set: set[str] = set()
    unpaid_set: set[str] = set()
    subids: set[str] = set()

    comissao_total = 0.0
    comissao_concluida = 0.0
    comissao_pendente = 0.0
    comissao_nao_paga = 0.0
    comissao_concluida_pedido = 0.0
    comissao_pendente_pedido = 0.0

    itens_vendidos = 0
    faturamento = 0.0

    for node in nodes:
        subid = (node.get("utmContent") or "").strip() or "_outros_canais"
        tc = node_once_commission(node)
        validados: list[tuple[dict, str]] = []

        for ord in node.get("orders") or []:
            st = (ord.get("orderStatus") or "").upper().strip()
            oid = str(ord.get("orderId") or "").strip()
            if st in ("CANCELLED", "CANCELED") and oid:
                cancelados_set.add(oid)

        for ord in node.get("orders") or []:
            st = (ord.get("orderStatus") or "").upper().strip()
            if st in ("CANCELLED", "CANCELED"):
                continue
            oid = str(ord.get("orderId") or "").strip()
            if not oid:
                continue

            if st == "UNPAID":
                if oid not in unpaid_set:
                    unpaid_set.add(oid)
                for it in ord.get("items") or []:
                    comissao_nao_paga += float(it.get("itemTotalCommission") or 0)
                continue

            validados.append((ord, st))
            pedidos_set.add(oid)
            subids.add(subid)

            for it in ord.get("items") or []:
                if (it.get("fraudStatus") or "").upper() == "FRAUD":
                    continue
                qty = int(it.get("qty") or 0) or 1
                price = float(it.get("itemPrice") or 0)
                actual = float(it.get("actualAmount") or 0)
                gmv = actual if actual > 0 else price * qty
                itens_vendidos += qty
                faturamento += gmv

        if not validados:
            continue

        comissao_total += tc
        conv_concluida = all(st == "COMPLETED" for _, st in validados)
        if conv_concluida:
            pedidos_concluidos_conv += len(validados)
            comissao_concluida += tc
        else:
            pedidos_pendentes_conv += len(validados)
            comissao_pendente += tc

        for ord, st in validados:
            com_ped = sum(float(it.get("itemTotalCommission") or 0) for it in (ord.get("items") or []))
            if classify_status(st) == "concluida":
                pedidos_concluidos_pedido += 1
                comissao_concluida_pedido += com_ped
            else:
                pedidos_pendentes_pedido += 1
                comissao_pendente_pedido += com_ped

    pedidos = len(pedidos_set)

    return {
        "subids_ativos": len(subids),
        "itens_vendidos": itens_vendidos,
        "faturamento_bruto": round_money(faturamento),
        "pedidos_validados": pedidos,
        "pedidos_pendentes": pedidos_pendentes_conv,
        "pedidos_concluidos": pedidos_concluidos_conv,
        "pedidos_cancelados": len(cancelados_set),
        "pedidos_unpaid": len(unpaid_set),
        "comissao_total": round_money(comissao_total),
        "comissao_pendente": round_money(comissao_pendente),
        "comissao_concluida": round_money(comissao_concluida),
        "comissao_nao_paga": round_money(comissao_nao_paga),
        "split_pedido_nivel": {
            "pedidos_concluidos": pedidos_concluidos_pedido,
            "pedidos_pendentes": pedidos_pendentes_pedido,
            "comissao_concluida": round_money(comissao_concluida_pedido),
            "comissao_pendente": round_money(comissao_pendente_pedido),
        },
    }


def print_result(m: dict, date_str: str) -> None:
    pedidos = m["pedidos_validados"]
    ticket = m["faturamento_bruto"] / pedidos if pedidos else 0.0

    print()
    print("=" * 48)
    print("   RESULTADO — LOGICA DASHBOARD (split nivel conversao)")
    print(f"   Data: {date_str} (BRT GMT-3)")
    print("=" * 48)
    print(f"SubIDs ativos:        {m['subids_ativos']}")
    print(f"Itens vendidos:       {m['itens_vendidos']}")
    print(f"Fat. bruto (GMV):     R$ {m['faturamento_bruto']:.2f}")
    print(f"Ticket medio:         R$ {ticket:.2f}")
    print("-" * 48)
    print(f"Pedidos validados:    {pedidos}")
    print(f"  - Pendentes:        {m['pedidos_pendentes']}")
    print(f"  - Concluidos:       {m['pedidos_concluidos']}")
    print(f"Pedidos cancelados:   {m['pedidos_cancelados']}")
    print(f"Pedidos UNPAID:       {m['pedidos_unpaid']} (fora dos KPIs)")
    print("-" * 48)
    print(f"Comissao total:       R$ {m['comissao_total']:.2f}")
    print(f"  - Pendente:         R$ {m['comissao_pendente']:.2f}")
    print(f"  - Concluida:        R$ {m['comissao_concluida']:.2f}")
    if m["comissao_nao_paga"] > 0:
        print(f"  - Nao paga (UNPAID): R$ {m['comissao_nao_paga']:.2f}")
    spn = m.get("split_pedido_nivel") or {}
    if spn.get("pedidos_concluidos", 0) > 0:
        print("-" * 48)
        print(f"Detalhe por pedido: {spn.get('pedidos_concluidos', 0)} concl. / "
              f"{spn.get('pedidos_pendentes', 0)} pend.")
        print(f"  Comissao pedido: Concl. R$ {spn.get('comissao_concluida', 0):.2f} · "
              f"Pend. R$ {spn.get('comissao_pendente', 0):.2f}")
    print("=" * 48)
    print()
    print("Notas:")
    print("- Comissao = 1x totalCommission/netCommission POR CONVERSAO (node_once),")
    print("  nao repete em cada pedido da conversao.")
    print("- UNPAID entra em pedidos_unpaid, nao em pedidos_validados.")
    print("- scrollId: paginas seguintes devem ser pedidas em sequencia (<30s).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Teste Shopee — mesma logica do dashboard")
    parser.add_argument("data", nargs="?", default="2026-06-11", help="YYYY-MM-DD (BRT)")
    args = parser.parse_args()

    auth_label, fetch_fn = resolve_auth()
    print(f"Iniciando busca para {args.data}...", file=sys.stderr)
    print(f"Auth: {auth_label}", file=sys.stderr)

    nodes = fetch_all_conversions(fetch_fn, args.data)
    metricas = aggregate_promosapp(nodes)
    print_result(metricas, args.data)


if __name__ == "__main__":
    main()
