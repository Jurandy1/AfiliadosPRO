"use strict";

/**
 * Detector de polling: registra cada execução de sync no Supabase.
 * Permite descobrir quando Shopee/Meta consolidam dados novos
 * e ajustar a frequência dos schedulers com base no padrão real.
 *
 * Tabela: sync_polling_log (criada via SQL no Supabase)
 */

/**
 * Registra uma execução de scheduler/sync.
 * Falha silenciosa — não bloqueia o sync.
 *
 * @param {Object} supabase     - client Supabase já instanciado
 * @param {Object} evento
 * @param {"shopee"|"meta"} evento.plataforma
 * @param {string} evento.label        - rótulo do sync (ex: "incremental_cursor")
 * @param {number} evento.nodes        - registros que a API devolveu (0 = nada novo)
 * @param {number} [evento.duracaoMs]  - tempo de execução
 */
async function registrarSyncEvent(supabase, { plataforma, label, nodes, duracaoMs }) {
  if (!supabase) return;

  const agora = new Date();
  const brtMs = agora.getTime() - 3 * 60 * 60 * 1000;
  const brt = new Date(brtMs);

  try {
    const { error } = await supabase.from("sync_polling_log").insert({
      plataforma,
      label: String(label || "").slice(0, 100),
      nodes: Math.max(0, Math.floor(Number(nodes) || 0)),
      duracao_ms: duracaoMs ? Math.floor(duracaoMs) : null,
      hora_brt: brt.getUTCHours(),
      dia_semana: brt.getUTCDay(),
    });
    if (error) {
      console.warn("[syncPollingDetector] insert:", error.message);
    }
  } catch (err) {
    console.warn("[syncPollingDetector] falhou:", err?.message || err);
  }
}

/**
 * Última execução que trouxe dados (nodes > 0). Útil pro dashboard.
 */
async function getUltimaAtualizacao(supabase, plataforma = "shopee") {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("sync_polling_log")
      .select("created_at, label, nodes")
      .eq("plataforma", plataforma)
      .gt("nodes", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Histograma de quantas vezes a plataforma trouxe dados em cada hora BRT,
 * nos últimos N dias. Base pra ajustar frequência dos schedulers.
 */
async function getJanelaTipica(supabase, plataforma = "shopee", dias = 7) {
  if (!supabase) return null;
  try {
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const { data, error } = await supabase
      .from("sync_polling_log")
      .select("hora_brt")
      .eq("plataforma", plataforma)
      .eq("veio_com_dado", true)
      .gte("created_at", desde);
    if (error || !data) return null;
    const histograma = {};
    for (const row of data) {
      histograma[row.hora_brt] = (histograma[row.hora_brt] || 0) + 1;
    }
    return histograma;
  } catch {
    return null;
  }
}

module.exports = { registrarSyncEvent, getUltimaAtualizacao, getJanelaTipica };
