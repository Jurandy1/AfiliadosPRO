import { supabase } from "../../../services/supabase/client";
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
    faturamentoPerdido: Number(p.faturamento_cancelado || 0), // ← novo
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

  // Usa faturamento perdido * taxa estimada 8%
  const fatPerdido = Number(m.faturamentoPerdido || 0);
  if (fatPerdido > 0) return Math.round(fatPerdido * 0.08 * 100) / 100;

  const fraud = String(item.fraudStatus || "").toUpperCase();
  const pendente = Number(m.comissaoPendente || 0);
  const estimada = Number(m.comissaoEstimada || 0);

  if (fraud === "FRAUD") return pendente > 0 ? pendente + estimada : estimada;
  if (fraud === "UNVERIFIED") return pendente > 0 ? pendente : estimada * 0.5;
  if (Number(m.pendentes || 0) >= 8 && pendente > 0) return pendente;
  return 0;
}

function scoreRisco(item) {
  let s = 0;
  if (item.nivel === "critico") s += 1000;
  const fraud = String(item.fraudStatus || "").toUpperCase();
  if (fraud === "FRAUD") s += 500;
  if (fraud === "UNVERIFIED") s += 200;
  s += Number(item.metricas?.taxa || 0) * 100;
  s += Number(item.metricas?.comissaoPerdida || 0) * 2;
  s += Number(item.metricas?.cancelados || 0) * 10;
  s += Number(item.metricas?.pendentes || 0);
  return s;
}

const RISCO_QUERY_LIMIT = 300;

export async function fetchProdutosComIndicadoresRisco() {
  const map = new Map();

  // Data de 90 dias atrás
  const dataCorte = new Date();
  dataCorte.setDate(dataCorte.getDate() - 90);
  const dataCorteStr = dataCorte.toISOString().split("T")[0];

  // 1) Agrega produto_daily dos últimos 90 dias por item_id
  const { data: dailyRows } = await supabase
    .from("produto_daily")
    .select("item_id, nome, comissao, comissao_concluida, comissao_pendente, comissao_cancelada, qtd_itens, faturamento")
    .gte("data", dataCorteStr);

  const agregado = {};
  for (const row of dailyRows || []) {
    const pid = String(row.item_id || "").trim();
    if (!pid || pid === "desconhecido" || pid === "_cauda_longa") continue;
    if (!agregado[pid]) {
      agregado[pid] = {
        id: pid,
        id_item: pid,
        nome: row.nome || pid,
        comissao_estimada: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_cancelada: 0,
        pedidos_concluidos: 0,
        pedidos_pendentes: 0,
        pedidos_cancelados: 0,
        qtd_itens: 0,
        faturamento: 0,
        fraud_status: null,
        display_item_status: null,
        item_notes: null,
        fraud_count: 0,
        unverified_count: 0,
        loja: null,
        link_shopee: null,
      };
    }
    const a = agregado[pid];
    const com = Number(row.comissao || 0);
    const conc = Number(row.comissao_concluida || 0);
    const pend = Number(row.comissao_pendente || 0);
    const canc = Number(row.comissao_cancelada || 0);
    a.comissao_estimada += com;
    a.comissao_concluida += conc;
    a.comissao_pendente += pend;
    a.comissao_cancelada += canc;
    a.qtd_itens += Number(row.qtd_itens || 0);
    a.faturamento += Number(row.faturamento || 0);
    // Estima pedidos pelo split de comissão
    if (canc > 0) a.pedidos_cancelados += 1;
    if (pend > 0) a.pedidos_pendentes += 1;
    if (conc > 0) a.pedidos_concluidos += 1;
  }

  // 4) Agrega log_perdas dos últimos 90 dias por item_id
  const { data: perdasRows } = await supabase
    .from("log_perdas")
    .select("item_id, comissao_perdida, valor_pedido, motivo")
    .gte("data", dataCorteStr)
    .eq("motivo", "CANCELLED");

  for (const row of perdasRows || []) {
    const pid = String(row.item_id || "").trim();
    if (!pid || pid === "ni") continue;
    if (!agregado[pid]) continue; // só enriquece produtos que já têm produto_daily

    const fatPerdido = Number(row.valor_pedido || 0);
    const comPerdida = Number(row.comissao_perdida || 0);

    // Estima comissão perdida: usa comissão real se > 0,
    // senão estima pela taxa média do produto (comissao / faturamento)
    if (!agregado[pid]._fat_perdido) {
      agregado[pid]._fat_perdido = 0;
      agregado[pid]._com_perdida_estimada = 0;
      agregado[pid].pedidos_cancelados = 0;
    }
    agregado[pid]._fat_perdido += fatPerdido;
    agregado[pid]._com_perdida_estimada += comPerdida;
    agregado[pid].pedidos_cancelados += 1;
  }

  // Calcula comissao_cancelada estimada por produto
  for (const p of Object.values(agregado)) {
    if (!p._fat_perdido) continue;
    if (p._com_perdida_estimada > 0) {
      p.comissao_cancelada = p._com_perdida_estimada;
    } else {
      // Estima pela taxa média: (comissao / faturamento) * fat_perdido
      const taxaMedia = p.faturamento > 0 ? p.comissao_estimada / p.faturamento : 0.08;
      p.comissao_cancelada = Math.round(p._fat_perdido * taxaMedia * 100) / 100;
    }
    p.faturamento_cancelado = p._fat_perdido;
    p.pedidos_cancelados = p.pedidos_cancelados || 0;
  }

  // 2) Cruza com tabela produtos para pegar fraud_status, loja, link
  const itemIds = Object.keys(agregado).map(id => `item_${id}`);
  if (itemIds.length > 0) {
    for (let i = 0; i < itemIds.length; i += 100) {
      const chunk = itemIds.slice(i, i + 100);
      const { data: prodRows } = await supabase
        .from("produtos")
        .select("doc_id, id_item, loja, link_shopee, fraud_status, display_item_status, item_notes, fraud_count, unverified_count")
        .in("doc_id", chunk);
      for (const p of prodRows || []) {
        const pid = String(p.id_item || "").trim();
        if (pid && agregado[pid]) {
          agregado[pid].loja = p.loja || null;
          agregado[pid].link_shopee = p.link_shopee || null;
          agregado[pid].fraud_status = p.fraud_status || null;
          agregado[pid].display_item_status = p.display_item_status || null;
          agregado[pid].item_notes = p.item_notes || null;
          agregado[pid].fraud_count = Number(p.fraud_count || 0);
          agregado[pid].unverified_count = Number(p.unverified_count || 0);
        }
      }
    }
  }

  // 3) Busca também produtos com fraud diretamente (que podem não ter produto_daily)
  const { data: fraudRows } = await supabase
    .from("produtos")
    .select("doc_id, id_item, nome, loja, link_shopee, fraud_status, display_item_status, item_notes, fraud_count, unverified_count")
    .in("fraud_status", ["FRAUD", "UNVERIFIED"])
    .limit(300);

  for (const p of fraudRows || []) {
    const pid = String(p.id_item || "").trim();
    if (!pid) continue;
    if (!agregado[pid]) {
      agregado[pid] = {
        id: pid,
        id_item: pid,
        nome: p.nome || pid,
        comissao_estimada: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_cancelada: 0,
        pedidos_concluidos: 0,
        pedidos_pendentes: 0,
        pedidos_cancelados: 0,
        qtd_itens: 0,
        faturamento: 0,
        loja: p.loja || null,
        link_shopee: p.link_shopee || null,
        fraud_status: p.fraud_status || null,
        display_item_status: p.display_item_status || null,
        item_notes: p.item_notes || null,
        fraud_count: Number(p.fraud_count || 0),
        unverified_count: Number(p.unverified_count || 0),
      };
    } else {
      // Atualiza fraud se já existia do produto_daily
      if (!agregado[pid].fraud_status) {
        agregado[pid].fraud_status = p.fraud_status;
        agregado[pid].display_item_status = p.display_item_status;
        agregado[pid].item_notes = p.item_notes;
        agregado[pid].fraud_count = Number(p.fraud_count || 0);
        agregado[pid].unverified_count = Number(p.unverified_count || 0);
      }
    }
  }

  // Filtra só o que tem algum indicador de risco
  return Object.values(agregado).filter(p =>
    p.pedidos_cancelados >= 2 ||
    p.pedidos_pendentes >= 8 ||
    p.comissao_cancelada >= 10 ||          // ← baixa de 20 para 10
    (p.faturamento_cancelado || 0) >= 100 || // ← novo: faturamento perdido >= R$100
    p.fraud_status === "FRAUD" ||
    p.fraud_status === "UNVERIFIED"
  );
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
        mensagem: `${canc} pedido(s) cancelado(s) à taxa ${(taxa * 100).toFixed(0)}%`,
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
