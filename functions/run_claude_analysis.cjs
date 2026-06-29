const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPathLocal = path.join(__dirname, '../.env.local');
const envPathProd = path.join(__dirname, '../.env');
const env = { ...process.env }; // Start with process.env for Cloud Functions

if (fs.existsSync(envPathLocal)) {
    const txt = fs.readFileSync(envPathLocal, 'utf8');
    txt.split('\n').forEach(l => {
      const i = l.indexOf('=');
      if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"\r]/g, '');
    });
} else if (fs.existsSync(envPathProd)) {
    const txt = fs.readFileSync(envPathProd, 'utf8');
    txt.split('\n').forEach(l => {
      const i = l.indexOf('=');
      if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"\r]/g, '');
    });
}

const sup = createClient(env.VITE_SUPABASE_URL || env.SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
const MODEL_NAME = "claude-sonnet-4-6";

// Limiares da regra de negócio (alinhados com o cliente em 2026-06-29).
// Centralizados aqui para auditoria e ajuste sem caçar pelo código.
const CLIQUES_MIN_DIA1 = 50;      // volume mínimo de cliques no dia 1 do teste
const ROI_DIA_D = -5;             // dia 3: "próximo do azul" = ROI ≥ -5%
const ROI_MIN_MONITORAMENTO = 30; // ROI < 30% conta como dia ruim
const DIAS_RUINS_PARA_PAUSAR = 5; // 5 dias com ROI < 30% em janela de 7
const JANELA_MONITORAMENTO = 7;   // janela rolling em dias corridos

/**
 * @param {Object} [opts]
 * @param {string} [opts.dataHoje]   Data D-1 a analisar (YYYY-MM-DD). Default = ontem real.
 * @param {boolean} [opts.usarSubidsComGasto] Se true, ignora meta_ads.status='Ativo' e
 *   considera todos os subids com gasto ou comissão em D-1. Útil para reprocessar
 *   histórico — em produção fica false (comportamento default).
 */
async function getAggregatedData(opts = {}) {
    // Data alvo: D-1 (dia fechado) — pode ser sobrescrita para análise histórica.
    let dataHoje = opts.dataHoje;
    if (!dataHoje) {
        const todayReal = new Date();
        todayReal.setUTCHours(0, 0, 0, 0);
        const hojeDate = new Date(todayReal);
        hojeDate.setUTCDate(todayReal.getUTCDate() - 1);
        dataHoje = hojeDate.toISOString().split('T')[0];
    }
    const hojeDate = new Date(dataHoje + 'T00:00:00Z');

    const ontemDate = new Date(hojeDate);
    ontemDate.setUTCDate(hojeDate.getUTCDate() - 1);
    const dataOntem = ontemDate.toISOString().split('T')[0];

    // Janela de 7 dias inclusiva: dataHoje (D-1) + 6 dias anteriores = 7 dias
    const sevenDaysAgo = new Date(hojeDate);
    sevenDaysAgo.setUTCDate(hojeDate.getUTCDate() - (JANELA_MONITORAMENTO - 1));
    const data7Dias = sevenDaysAgo.toISOString().split('T')[0];

    const { data: subidData } = await sup.from('subid_daily')
        .select('*')
        .gte('data', data7Dias)
        .lte('data', dataHoje);

    const { data: metaData } = await sup.from('meta_ads_daily')
        .select('*')
        .gte('data', data7Dias)
        .lte('data', dataHoje);

    const activeAdsMap = {};
    if (opts.usarSubidsComGasto) {
        // Reprocessar histórico: considera todos os subids com atividade em D-1.
        // Inferência: assume MONITORAMENTO com data_inicio_fase recuada o suficiente
        // para dia_fase ≥ 1 — não temos snapshot histórico de meta_ads.
        const subidsComAtividade = new Set();
        (metaData || []).forEach(r => { if ((r.gasto || 0) > 0) subidsComAtividade.add(r.subid); });
        (subidData || []).forEach(r => { if ((r.comissoes_estimadas || 0) > 0 || (r.comissoes || 0) > 0) subidsComAtividade.add(r.subid); });
        subidsComAtividade.delete('(sem_subid)');
        subidsComAtividade.forEach(subid => {
            activeAdsMap[subid] = {
                subid_vinculado: subid,
                fase: 'MONITORAMENTO',
                data_inicio_fase: data7Dias, // 7 dias atrás → dia_fase será ~7 em D-1
            };
        });
    } else {
        const { data: activeAds } = await sup.from('meta_ads').select('*').eq('status', 'Ativo');
        (activeAds || []).forEach(a => { activeAdsMap[a.subid_vinculado] = a; });
    }

    const metricas = [];

    // Pre-calculate daily metrics (join meta_ads_daily + subid_daily)
    const dates = [];
    for (let d = new Date(sevenDaysAgo); d <= hojeDate; d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
    }

    Object.keys(activeAdsMap).forEach(subid => {
        const a = activeAdsMap[subid];
        const fase = a.fase || 'TESTE';
        const dataInicioFaseReal = a.data_inicio_fase || dataHoje;

        const subidMetrics = dates.map(dt => {
            const m = (metaData || []).find(x => x.subid === subid && x.data === dt) || { gasto: 0, cliques: 0 };
            const s = (subidData || []).find(x => x.subid === subid && x.data === dt) || { comissoes_estimadas: 0, pedidos: 0, vendas_diretas: 0 };
            
            const gasto = Number(m.gasto || 0);
            const comissao = Number(s.comissoes_estimadas || s.comissoes || 0);
            const roi = gasto > 0 ? ((comissao - gasto) / gasto) * 100 : (comissao > 0 ? 100 : null);
            
            const timeDiff = new Date(dt).getTime() - new Date(dataInicioFaseReal).getTime();
            const dia_fase = Math.floor(timeDiff / (1000 * 3600 * 24)) + 1;

            return {
                subid,
                data: dt,
                gasto,
                comissao,
                cliques: Number(m.cliques || 0),
                roi,
                fase,
                dia_fase
            };
        });
        
        // Mantém o histórico completo de 7 dias para a IA analisar
        metricas.push(...subidMetrics);
    });

    const resultados = [];

    Object.keys(activeAdsMap).forEach(subid => {
        const a = activeAdsMap[subid];
        const dataInicioFaseReal = a.data_inicio_fase || dataHoje;
        const mSubid = metricas.filter(m => m.subid === subid);
        
        const mHoje = mSubid.find(m => m.data === dataHoje);
        const mOntem = mSubid.find(m => m.data === dataOntem);

        if (!mHoje) return; // Se por algum erro mHoje não existir, ignora

        // Campanha ativada APÓS D-1 (dia_fase <= 0) ainda não tem dado consolidado
        // para analisar. Sem isso o ROI vira 100% espúrio (comissão > 0, gasto = 0)
        // ou a decisão fica indefinida. Pula — voltarão amanhã com dia_fase = 1.
        if (mHoje.dia_fase <= 0) return;

        // Sem gasto em nenhum dia da janela → não é campanha de tráfego pago,
        // é comissão orgânica (ex: bio, story). Não cabe nessa análise.
        const gastoTotal7d = mSubid.reduce((s, m) => s + (m.gasto || 0), 0);
        if (gastoTotal7d <= 0) return;

        const roi_hoje = mHoje.roi || 0;
        const roi_ontem = mOntem ? (mOntem.roi || 0) : 0;
        const cliques_hoje = mHoje.cliques || 0;

        // ROI médio dos últimos 7 dias (todos os dias com gasto, independente da fase)
        const valid7_all = mSubid.filter(m => m.roi !== null);
        const roi_medio_7d = valid7_all.length > 0 ? (valid7_all.reduce((acc, curr) => acc + curr.roi, 0) / valid7_all.length) : 0;

        // Monitoramento: rolling 7 dias corridos (não dias-na-fase). Bate com "5 de 7 dias" do cliente.
        const dias_ruins_7d = valid7_all.filter(m => m.roi < ROI_MIN_MONITORAMENTO).length;
        const dias_com_dados_7d = valid7_all.length;

        const fase = mHoje.fase;
        const dia_fase = mHoje.dia_fase;
        let decisao = 'INDEFINIDO';
        let motivo = '';

        if (fase === 'TESTE') {
            if (dia_fase === 1) {
                // Cliente: prejuízo abaixo de 70% E cliques batendo
                if (roi_hoje < -70) {
                    decisao = 'PAUSAR';
                    motivo = `ROI ${roi_hoje.toFixed(1)}% no dia 1 do teste — prejuízo acima do tolerável (-70%)`;
                } else if (cliques_hoje < CLIQUES_MIN_DIA1 && mHoje.gasto > 0) {
                    decisao = 'PAUSAR';
                    motivo = `${cliques_hoje} cliques no dia 1 — abaixo do mínimo de ${CLIQUES_MIN_DIA1}. Curva sem volume não valida o teste`;
                } else {
                    decisao = 'AGUARDAR';
                    motivo = `Dia 1 do teste — ROI ${roi_hoje.toFixed(1)}% dentro do tolerável e ${cliques_hoje} cliques`;
                }
            } else if (dia_fase === 2) {
                // Cliente: precisa melhorar. Decisão: PAUSAR só se piorou E ROI ainda negativo.
                if (roi_hoje < -70) {
                    decisao = 'PAUSAR';
                    motivo = `ROI ${roi_hoje.toFixed(1)}% no dia 2 — prejuízo crítico`;
                } else if (roi_hoje <= roi_ontem && roi_hoje < 0) {
                    decisao = 'PAUSAR';
                    motivo = `Dia 2 do teste piorou (ROI hoje ${roi_hoje.toFixed(1)}% vs ontem ${roi_ontem.toFixed(1)}%) e segue negativo — não está caminhando para validação`;
                } else if (roi_hoje < roi_ontem) {
                    decisao = 'ATENCAO';
                    motivo = `Dia 2 já positivo (${roi_hoje.toFixed(1)}%) mas caiu vs ontem (${roi_ontem.toFixed(1)}%)`;
                } else {
                    decisao = 'AGUARDAR';
                    motivo = `Dia 2 do teste melhorando (ROI ${roi_hoje.toFixed(1)}% vs ${roi_ontem.toFixed(1)}% ontem)`;
                }
            } else if (dia_fase === 3) {
                // Cliente: Dia D — ROI azul ou próximo. Decidi -5% como "próximo do azul".
                if (roi_hoje >= ROI_DIA_D) {
                    decisao = 'AGUARDAR';
                    motivo = `Dia D (3) com ROI ${roi_hoje.toFixed(1)}% — próximo do azul, qualifica para aprovação amanhã se mantiver`;
                } else {
                    decisao = 'PAUSAR';
                    motivo = `Dia D (3) com ROI ${roi_hoje.toFixed(1)}% — abaixo do limiar de ${ROI_DIA_D}% que indica caminho para validação`;
                }
            } else if (dia_fase >= 4) {
                // Cliente: no máximo dia 4 ser aprovado.
                if (roi_hoje >= 0) {
                    decisao = 'APROVAR';
                    motivo = `Dia ${dia_fase} do teste com ROI ${roi_hoje.toFixed(1)}% no azul — promovido para Monitoramento`;
                } else {
                    decisao = 'PAUSAR';
                    motivo = `Dia ${dia_fase} do teste sem entrar no azul (ROI ${roi_hoje.toFixed(1)}%) — prazo de validação esgotado`;
                }
            }
        } else if (fase === 'MONITORAMENTO') {
            // Cliente: 5 de 7 dias com ROI < 30% desativa.
            if (dias_ruins_7d >= DIAS_RUINS_PARA_PAUSAR) {
                decisao = 'PAUSAR';
                motivo = `${dias_ruins_7d} de ${dias_com_dados_7d} dias com ROI < ${ROI_MIN_MONITORAMENTO}% nos últimos ${JANELA_MONITORAMENTO} dias — não sustenta mais a operação`;
            } else if (dias_ruins_7d >= 3) {
                decisao = 'ATENCAO';
                motivo = `${dias_ruins_7d} dias com ROI < ${ROI_MIN_MONITORAMENTO}% nos últimos ${JANELA_MONITORAMENTO} dias — aproximando do limite de ${DIAS_RUINS_PARA_PAUSAR}`;
            } else {
                decisao = 'MANTER';
                motivo = `Monitoramento saudável: ${dias_com_dados_7d - dias_ruins_7d} dias com ROI ≥ ${ROI_MIN_MONITORAMENTO}% em ${dias_com_dados_7d} avaliados`;
            }
        }

        // Série diária dos últimos 7 dias — Claude consegue ver tendência, não só snapshot
        const serie_7d = mSubid
            .filter(m => m.gasto > 0 || m.comissao > 0)
            .map(m => ({
                data: m.data,
                gasto: parseFloat((m.gasto || 0).toFixed(2)),
                comissao: parseFloat((m.comissao || 0).toFixed(2)),
                cliques: m.cliques || 0,
                roi: m.roi !== null ? parseFloat(m.roi.toFixed(1)) : null,
            }));

        resultados.push({
            subid,
            fase,
            dia_fase,
            roi_hoje: parseFloat(roi_hoje.toFixed(2)),
            roi_ontem: parseFloat(roi_ontem.toFixed(2)),
            roi_medio_7d: parseFloat(roi_medio_7d.toFixed(2)),
            dias_ruins_7d,
            dias_com_dados_7d,
            gasto_hoje: mHoje.gasto,
            comissao_hoje: mHoje.comissao,
            cliques_hoje,
            decisao,
            motivo,
            serie_7d,
        });
    });

    return resultados;
}

async function runClaudeAnalysis() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dataRelatorio = today.toISOString().split('T')[0];

    // D-1: dia fechado mais recente (Shopee tem 24-48h de atraso)
    const d1 = new Date(today);
    d1.setUTCDate(today.getUTCDate() - 1);
    const dataHojeRef = d1.toISOString().split('T')[0];

    // maybeSingle não dá erro PGRST116 quando não acha — evita exception silenciosa
    const { data: analiseExistente } = await sup.from('ai_daily_analysis')
        .select('id')
        .eq('data', dataRelatorio)
        .maybeSingle();

    if (analiseExistente) {
        console.log(`[INFO] O relatório de hoje (${dataRelatorio}) já foi gerado.`);
        return;
    }

    console.log("Coletando dados e calculando decisões...");
    const dados = await getAggregatedData();
    console.log(`Encontradas ${dados.length} campanhas com dados recentes.`);
    
    if (dados.length === 0) {
        console.log("Nenhuma campanha analisável em D-1. Inserindo standby...");
        const analiseGerada = [
            "### 🤖 Consultor de Tráfego: Modo Standby",
            "",
            `Não há campanhas com dados consolidados em **${dataHojeRef}** (D-1) para analisar.`,
            "",
            "Possíveis motivos:",
            "- As campanhas ativas hoje foram iniciadas após D-1 (ainda sem fechamento).",
            "- Não havia campanhas rodando em D-1.",
            "- A Shopee ainda não consolidou comissões de D-1 (atraso de 24-48h).",
            "",
            "A análise volta automaticamente amanhã às 10h, quando o próximo D-1 fechar.",
        ].join("\n");

        const { error: insertError } = await sup.from('ai_daily_analysis').insert({
            data: dataRelatorio,
            analise_markdown: analiseGerada,
            modelo: MODEL_NAME
        });

        if (insertError) {
            console.error("Erro ao salvar fallback no Supabase:", insertError);
        } else {
            console.log("✅ Análise de standby salva com sucesso!");
        }
        return;
    }

    // Processar auto-updates (Passo 4)
    for (const d of dados) {
        if (d.decisao === 'APROVAR') {
            console.log(`[AUTO] Promovendo subid ${d.subid} para MONITORAMENTO.`);
            await sup.from('meta_ads').update({
                fase: 'MONITORAMENTO',
                data_inicio_fase: dataRelatorio,
                aprovada_em: dataRelatorio
            }).eq('subid_vinculado', d.subid);
        } else if (d.decisao === 'PAUSAR') {
            console.log(`[AUTO] Pausando subid ${d.subid} por baixa performance.`);
            await sup.from('meta_ads').update({
                fase: 'PAUSADA',
                status: 'Pausado'
            }).eq('subid_vinculado', d.subid);
        }
    }

    // Filtra do payload do Claude: campanha sem atividade em D-1 que esteja em MANTER
    // não merece linha no ranking (são as zeradas R$0,00 que poluíam o relatório).
    // Quem tem atividade em D-1 OU precisa de atenção (PAUSAR/ATENCAO/AGUARDAR/APROVAR)
    // entra sempre.
    const todas = dados
        .filter(d => (d.gasto_hoje + d.comissao_hoje) > 0 || d.decisao !== 'MANTER')
        .sort((a, b) => (b.gasto_hoje + b.comissao_hoje) - (a.gasto_hoje + a.comissao_hoje));

    // Agregados sobre TODAS analisadas (totais reais), independente do filtro de exibição
    const totalGasto = dados.reduce((s, d) => s + (d.gasto_hoje || 0), 0);
    const totalComissao = dados.reduce((s, d) => s + (d.comissao_hoje || 0), 0);
    const lucroLiquido = totalComissao - totalGasto;
    const roiGeral = totalGasto > 0 ? ((lucroLiquido / totalGasto) * 100) : 0;

    const portfolio = {
        data_referencia_d1: dataHojeRef,
        campanhas_avaliadas: dados.length,         // total que passou pelo motor de regras
        campanhas_no_ranking: todas.length,        // total no payload de exibição
        campanhas_omitidas_estaveis: dados.length - todas.length, // MANTER sem atividade em D-1
        em_teste: dados.filter(d => d.fase === 'TESTE').length,
        em_monitoramento: dados.filter(d => d.fase === 'MONITORAMENTO').length,
        pausadas_hoje: dados.filter(d => d.decisao === 'PAUSAR').length,
        aprovadas_hoje: dados.filter(d => d.decisao === 'APROVAR').length,
        gasto_total: parseFloat(totalGasto.toFixed(2)),
        comissao_total: parseFloat(totalComissao.toFixed(2)),
        lucro_liquido: parseFloat(lucroLiquido.toFixed(2)),
        roi_geral: parseFloat(roiGeral.toFixed(2)),
    };

    const payload = { portfolio, campanhas: todas };
    const dadosTexto = JSON.stringify(payload, null, 2);

    const systemPrompt = `Você é o Consultor de Tráfego Sênior do dashboard de afiliado Shopee + Meta Ads.

CONTEXTO TEMPORAL OBRIGATÓRIO
- A Shopee tem 24-48h de atraso na atribuição de comissão. O dia "fechado" mais recente é D-1.
- Neste relatório, "hoje" = D-1 (ontem real) e "ontem" = D-2. Deixe explícito no Resumo.

SOBRE O PAYLOAD
- \`portfolio.campanhas_avaliadas\`: TODAS analisadas pelo motor (incluindo as estáveis).
- \`portfolio.campanhas_no_ranking\`: as que aparecem em \`campanhas\` (filtramos as MANTER sem atividade em D-1 — são as estáveis e sem mudança).
- \`portfolio.campanhas_omitidas_estaveis\`: quantas estáveis ficaram de fora — mencione no Resumo se houver, não invente "faltam dados".
- Os totais financeiros (gasto/comissão/lucro/ROI) cobrem TODO o portfólio avaliado, não só o ranking.

REGRAS DE DECISÃO (já calculadas no campo \`decisao\` de cada campanha — não recalcule, apenas explique):

FASE TESTE:
- Dia 1: PAUSAR se ROI < -70%, ou se cliques < ${CLIQUES_MIN_DIA1} com gasto > 0 (curva sem volume não valida). Senão AGUARDAR.
- Dia 2: PAUSAR se ROI < -70% OU se piorou vs ontem e segue negativo. ATENCAO se positivo mas caiu. Senão AGUARDAR.
- Dia 3 (Dia D): AGUARDAR se ROI ≥ ${ROI_DIA_D}% (próximo do azul). PAUSAR se abaixo.
- Dia 4+: APROVAR se ROI ≥ 0% (vira MONITORAMENTO). Senão PAUSAR.

FASE MONITORAMENTO (rolling 7 dias corridos):
- PAUSAR se ${DIAS_RUINS_PARA_PAUSAR} de ${JANELA_MONITORAMENTO} dias têm ROI < ${ROI_MIN_MONITORAMENTO}%.
- ATENCAO se 3-4 dias.
- MANTER caso contrário.

O sistema JÁ aplicou as ações APROVAR/PAUSAR no banco. Seu papel é interpretar e explicar.

ESTRUTURA OBRIGATÓRIA DO RELATÓRIO (use exatamente esta ordem e títulos):

# 📊 Relatório Matinal — D-1

## 1. Resumo Executivo
- Uma linha explicando o delay D-1 da Shopee.
- Linha de totais: **Total Gasto:** R$ X | **Total Comissão:** R$ Y | **Lucro Líquido:** R$ Z | **ROI Geral:** W%
- 2-4 linhas interpretando a saúde geral do portfólio e destacando o que mais chama atenção (campanhas que puxaram pra cima, que queimaram caixa, mix teste vs monitoramento).

## 2. Ranking de Campanhas
Tabela única com TODAS as campanhas recebidas, ordenadas por ROI decrescente:

| Campanha | Fase | Dia/Janela | Gasto | Cliques | Comissão | ROI | ROI 7d | Decisão |

Use emojis no ROI: ✅ se ≥30%, 🟢 se 0-29%, 🟡 se -30 a -1, 🔴 se < -30.
Coluna "Dia/Janela": TESTE mostra "D{dia_fase}/4", MONITORAMENTO mostra "{dias_ruins_7d}/{dias_com_dados_7d} ruins".
NÃO omita nenhuma campanha do payload.

## 3. Ações do Sistema
Para cada campanha com decisao APROVAR ou PAUSAR, um bloco curto:

### \`<subid>\` — <APROVADA p/ Monitoramento | PAUSADA>
- ROI hoje: X% | ROI 7d: Y% | Gasto: R$ Z | Cliques: N
- **Motivo:** <use o campo \`motivo\` do payload, parafraseado se ficar mais claro>

## 4. Em Observação
Bullets de 1 linha para campanhas com decisao ATENCAO ou AGUARDAR, agrupados por fase. Ex:
- \`subid\` (TESTE D2/4): ROI -8% melhorando vs ontem (-15%). Olho no Dia D amanhã.

## 5. Plano de Ação Resumido
3-6 bullets priorizados (Pausar urgente > Reduzir budget > Escalar quem está no azul). Inclua o subid em crase e uma ação concreta.

REGRAS DE FORMATAÇÃO
- Subids sempre em crase: \`flare01\`, nunca soltos.
- ROI sempre com sinal e %: "+12,3%" ou "-43,4%".
- Valores em R$ com vírgula decimal e ponto milhar: "R$ 1.234,56".
- Não recalcule métricas. Use os números do payload.
- Não invente campanhas que não vieram no payload.
- Não escreva disclaimers sobre você mesmo ou sobre limites do modelo.
- Português direto e seco, sem floreios.`;

    console.log(`Enviando ${todas.length} campanhas para o ${MODEL_NAME}...`);

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                max_tokens: 8192,
                temperature: 0.2,
                system: systemPrompt,
                messages: [
                    { role: "user", content: "Gere o relatório matinal a partir destes dados (todas as campanhas devem aparecer no Ranking):\n" + dadosTexto }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erro na API do Claude: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        const analiseGerada = result.content[0].text;
        
        console.log("\n==== RESPOSTA DO CLAUDE ====\n");
        console.log(analiseGerada);
        console.log("\n============================\n");

        const { error: insertError } = await sup.from('ai_daily_analysis').insert({
            data: dataRelatorio,
            analise_markdown: analiseGerada,
            modelo: MODEL_NAME
        });

        if (insertError) {
            console.error("Erro ao salvar no Supabase:", insertError);
        } else {
            console.log("✅ Análise salva com sucesso no Supabase!");
        }

    } catch (e) {
        console.error(e.message);
    }
}

module.exports = { runClaudeAnalysis, getAggregatedData };

// Se o script for executado diretamente pelo terminal
if (require.main === module) {
    runClaudeAnalysis();
}
