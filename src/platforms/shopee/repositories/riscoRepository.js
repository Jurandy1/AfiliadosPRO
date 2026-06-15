import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";
import { listarBackups } from "./backupRepository";

function taxaCancelamento(p) {
  const concl = Number(p.pedidos_concluidos || 0);
  const canc = Number(p.pedidos_cancelados || 0);
  const total = concl + canc;
  if (total === 0) return 0;
  return canc / total;
}

function metricasProduto(p) {
  const canc = Number(p.pedidos_cancelados || 0);
  const pend = Number(p.pedidos_pendentes || 0);
  return {
    cancelados: canc,
    taxa: taxaCancelamento(p),
    pendentes: pend,
    comissaoPerdida: Number(p.comissao_cancelada || 0),
    comissaoPendente: Number(p.comissao_pendente || 0),
    comissaoEstimada: Number(p.comissao_estimada || 0),
    concluidos: Number(p.pedidos_concluidos || 0),
  };
}

/** Prejuízo estimado: comissão cancelada + risco em fraude/pendências altas. */
function estimarPrejuizoItem(item) {
  const m = item.metricas || {};
  const perdida = Number(m.comissaoPerdida || 0);
  if (perdida >= 0.01) return perdida;

  const fraud = String(item.fraudStatus || "").toUpperCase();
  const pendente = Number(m.comissaoPendente || 0);
  const estimada = Number(m.comissaoEstimada || 0);

  if (fraud === "FRAUD") {
    return pendente > 0 ? pendente + estimada : estimada;
  }
  if (fraud === "UNVERIFIED") {
    return pendente > 0 ? pendente : estimada * 0.5;
  }
  if (Number(m.pendentes || 0) >= 8 && pendente > 0) {
    return pendente;
  }
  return 0;
}

function scoreRisco(item) {
  const m = item.metricas || {};
  const nivelBonus = item.nivel === "critico" ? 1_000_000 : 100_000;
  const fraudBonus =
    item.fraudStatus === "FRAUD" ? 5_000_000 : item.fraudStatus === "UNVERIFIED" ? 2_000_000 : 0;
  const cancelados = Number(m.cancelados || 0);
  const taxa = Number(m.taxa || 0);
  const pendentes = Number(m.pendentes || 0);
  const comissaoPerdida = Number(m.comissaoPerdida || 0);
  const categoriaBonus =
    {
      fraud_risk: 500_000,
      principal: 50_000,
      cancelamento: 30_000,
      backup: 10_000,
      pendente: 5_000,
      comissao_perdida: 3_000,
    }[item.categoria] || 0;
  const multiplosRiscosBonus = item.categorias?.length > 1 ? 80_000 : 0;

  return (
    nivelBonus +
    fraudBonus +
    categoriaBonus +
    multiplosRiscosBonus +
    cancelados * 10_000 +
    taxa * 50_000 +
    pendentes * 200 +
    comissaoPerdida
  );
}

const RISCO_QUERY_LIMIT = 100;

async function fetchProdutosComIndicadoresRisco() {
  const base = collection(db, COLLECTIONS.PRODUTOS);
  const [cancelSnap, pendSnap, perdaSnap, fraudSnap, unverifiedSnap] = await Promise.all([
    getDocs(query(base, where("pedidos_cancelados", ">=", 2), limit(RISCO_QUERY_LIMIT))).catch(() => ({ docs: [] })),
    getDocs(query(base, where("pedidos_pendentes", ">=", 8), limit(RISCO_QUERY_LIMIT))).catch(() => ({ docs: [] })),
    getDocs(query(base, where("comissao_cancelada", ">=", 20), limit(RISCO_QUERY_LIMIT))).catch(() => ({ docs: [] })),
    getDocs(query(base, where("fraud_status", "==", "FRAUD"), limit(RISCO_QUERY_LIMIT))).catch(() => ({ docs: [] })),
    getDocs(query(base, where("fraud_status", "==", "UNVERIFIED"), limit(RISCO_QUERY_LIMIT))).catch(() => ({ docs: [] })),
  ]);

  const map = new Map();
  for (const snap of [cancelSnap, pendSnap, perdaSnap, fraudSnap, unverifiedSnap]) {
    snap.docs.forEach((d) => {
      map.set(d.id, { id: d.id, ...d.data() });
    });
  }
  return [...map.values()];
}

/** Central de risco: backups + produtos agrupados por itemId, com dados antifraude da API. */
export async function getCentralRisco() {
  const [backups, produtos] = await Promise.all([
    listarBackups(),
    fetchProdutosComIndicadoresRisco(),
  ]);

  const itensAgrupados = {};

  const registrarRisco = (itemId, novoRisco) => {
    if (!itemId) return;

    if (itensAgrupados[itemId]) {
      const existente = itensAgrupados[itemId];

      if (novoRisco.nivel === "critico") existente.nivel = "critico";

      existente.mensagem = `${existente.mensagem} | ${novoRisco.mensagem}`;

      if (!existente.categorias.includes(novoRisco.categoria)) {
        existente.categorias.push(novoRisco.categoria);
      }

      const fraudRank = { FRAUD: 3, UNVERIFIED: 2, VERIFIED: 1 };
      const cur = fraudRank[existente.fraudStatus] || 0;
      const neu = fraudRank[novoRisco.fraudStatus] || 0;
      if (neu > cur) {
        existente.fraudStatus = novoRisco.fraudStatus;
        existente.displayItemStatus = novoRisco.displayItemStatus;
      }

      if (novoRisco.itemNotes && !existente.itemNotes?.includes(novoRisco.itemNotes)) {
        existente.itemNotes = existente.itemNotes
          ? `${existente.itemNotes} // ${novoRisco.itemNotes}`
          : novoRisco.itemNotes;
      }

      if (novoRisco.metricas) {
        const extM = existente.metricas || {};
        const novM = novoRisco.metricas || {};
        existente.metricas = {
          cancelados: Math.max(extM.cancelados || 0, novM.cancelados || 0),
          taxa: Math.max(extM.taxa || 0, novM.taxa || 0),
          pendentes: Math.max(extM.pendentes || 0, novM.pendentes || 0),
          comissaoPerdida: Math.max(extM.comissaoPerdida || 0, novM.comissaoPerdida || 0),
          comissaoPendente: Math.max(extM.comissaoPendente || 0, novM.comissaoPendente || 0),
          comissaoEstimada: Math.max(extM.comissaoEstimada || 0, novM.comissaoEstimada || 0),
          concluidos: Math.max(extM.concluidos || 0, novM.concluidos || 0),
        };
      }
    } else {
      itensAgrupados[itemId] = {
        ...novoRisco,
        categorias: [novoRisco.categoria],
      };
    }
  };

  for (const b of backups) {
    const itemId = b.itemId;
    if (!itemId) continue;

    for (const a of b.alertas || []) {
      registrarRisco(itemId, {
        id: `backup_${itemId}_${a.tipo || a.nivel}`,
        nivel: a.nivel === "critico" ? "critico" : "aviso",
        categoria: "backup",
        titulo: b.apelido || b.nome,
        mensagem: a.mensagem,
        itemId,
        fraudStatus: null,
        displayItemStatus: null,
        itemNotes: null,
        grupoId: b.grupoId || null,
        link: b.linkAfiliado || b.linkProduto || "",
        loja: b.loja,
        acao: b.grupoId ? "backup_grupo" : "backup",
        metricas: { cancelados: 0, taxa: 0, pendentes: 0, comissaoPerdida: 0, comissaoPendente: 0, comissaoEstimada: 0, concluidos: 0 },
      });
    }

    if (b.marcadoPrincipal && (b.alertas || []).some((x) => x.tipo === "comissao_zero" || x.tipo === "comissao_caiu")) {
      registrarRisco(itemId, {
        id: `principal_risco_${itemId}`,
        nivel: "critico",
        categoria: "principal",
        titulo: `Principal em risco: ${b.apelido || b.nome}`,
        mensagem: "Link ativo em tráfego com alerta de comissão.",
        itemId,
        fraudStatus: null,
        displayItemStatus: null,
        itemNotes: null,
        grupoId: b.grupoId || null,
        link: b.linkAfiliado || b.linkProduto || "",
        loja: b.loja,
        acao: "backup_grupo",
        metricas: { cancelados: 0, taxa: 0, pendentes: 0, comissaoPerdida: 0, comissaoPendente: 0, comissaoEstimada: 0, concluidos: 0 },
      });
    }
  }

  for (const p of produtos) {
    const id = String(p.id_item || p.id?.replace(/^item_/, "") || "").trim();
    if (!id) continue;

    const nome = p.nome || id;
    const fraudStatus = String(p.fraud_status || "").toUpperCase().trim() || null;
    const displayItemStatus = p.display_item_status || null;
    const itemNotes = p.item_notes || null;
    const metricasBase = metricasProduto(p);

    if (fraudStatus === "FRAUD") {
      registrarRisco(id, {
        id: `fraud_${id}`,
        nivel: "critico",
        categoria: "fraud_risk",
        titulo: nome,
        mensagem: itemNotes
          ? "Fraude confirmada pela API Shopee."
          : `${Number(p.fraud_count || 0) || "Múltiplas"} conversão(ões) marcadas como FRAUD.`,
        itemId: id,
        loja: p.loja,
        link: p.link_shopee || "",
        fraudStatus: "FRAUD",
        displayItemStatus,
        itemNotes,
        metricas: metricasBase,
        acao: "shopee",
      });
    } else if (fraudStatus === "UNVERIFIED") {
      registrarRisco(id, {
        id: `unverified_${id}`,
        nivel: "critico",
        categoria: "fraud_risk",
        titulo: nome,
        mensagem: itemNotes
          ? "Sinal antifraude: conversões não verificadas pela Shopee."
          : `${Number(p.unverified_count || 0) || "Algumas"} conversão(ões) com status UNVERIFIED.`,
        itemId: id,
        loja: p.loja,
        link: p.link_shopee || "",
        fraudStatus: "UNVERIFIED",
        displayItemStatus,
        itemNotes,
        metricas: metricasBase,
        acao: "shopee",
      });
    }

    const { cancelados: canc, taxa, pendentes: pend, comissaoPerdida } = metricasBase;

    if (canc >= 2 && taxa >= 0.2) {
      registrarRisco(id, {
        id: `cancel_${id}`,
        nivel: taxa >= 0.35 ? "critico" : "aviso",
        categoria: "cancelamento",
        titulo: nome,
        mensagem: `${canc} pedido(s) cancelado(s) · taxa ${(taxa * 100).toFixed(0)}%`,
        itemId: id,
        loja: p.loja,
        link: p.link_shopee || "",
        fraudStatus,
        displayItemStatus,
        itemNotes,
        metricas: metricasBase,
        acao: "shopee",
      });
    }

    if (pend >= 8) {
      registrarRisco(id, {
        id: `pendente_${id}`,
        nivel: "aviso",
        categoria: "pendente",
        titulo: nome,
        mensagem: `${pend} pedido(s) ainda pendentes na Shopee — comissão pode cair.`,
        itemId: id,
        loja: p.loja,
        link: p.link_shopee || "",
        fraudStatus,
        displayItemStatus,
        itemNotes,
        metricas: metricasBase,
        acao: "shopee",
      });
    }

    if (comissaoPerdida >= 20) {
      registrarRisco(id, {
        id: `comissao_perdida_${id}`,
        nivel: "aviso",
        categoria: "comissao_perdida",
        titulo: nome,
        mensagem: `R$ ${comissaoPerdida.toFixed(2)} em comissão perdida por cancelamentos.`,
        itemId: id,
        loja: p.loja,
        link: p.link_shopee || "",
        fraudStatus,
        displayItemStatus,
        itemNotes,
        metricas: metricasBase,
        acao: "shopee",
      });
    }
  }

  const itens = Object.values(itensAgrupados);
  itens.sort((a, b) => scoreRisco(b) - scoreRisco(a));

  const prejuizoTotal = itens.reduce((s, i) => s + estimarPrejuizoItem(i), 0);

  return {
    total: itens.length,
    criticos: itens.filter((i) => i.nivel === "critico").length,
    avisos: itens.filter((i) => i.nivel === "aviso").length,
    prejuizoTotal,
    itens,
  };
}
