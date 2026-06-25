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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL_NAME = "claude-sonnet-4-6";

async function getAggregatedData() {
    const todayReal = new Date();
    todayReal.setUTCHours(0,0,0,0);
    
    // "hoje" for analysis purposes is yesterday (D-1) due to Shopee delay.
    const hojeDate = new Date(todayReal);
    hojeDate.setUTCDate(todayReal.getUTCDate() - 1);
    const dataHoje = hojeDate.toISOString().split('T')[0];

    // "ontem" for analysis purposes is D-2
    const ontemDate = new Date(hojeDate);
    ontemDate.setUTCDate(hojeDate.getUTCDate() - 1);
    const dataOntem = ontemDate.toISOString().split('T')[0];

    // 7 days ago relative to D-1
    const sevenDaysAgo = new Date(hojeDate);
    sevenDaysAgo.setUTCDate(hojeDate.getUTCDate() - 7);
    const data7Dias = sevenDaysAgo.toISOString().split('T')[0];

    // Fetch comissoes (Shopee)
    const { data: subidData } = await sup.from('subid_daily')
        .select('*')
        .gte('data', data7Dias)
        .lte('data', dataHoje);

    // Fetch gasto (Meta)
    const { data: metaData } = await sup.from('meta_ads_daily')
        .select('*')
        .gte('data', data7Dias)
        .lte('data', dataHoje);

    // Fetch active subids
    const { data: activeAds } = await sup.from('meta_ads').select('*').eq('status', 'Ativo');
    const activeAdsMap = {};
    (activeAds || []).forEach(a => {
        activeAdsMap[a.subid_vinculado] = a;
    });

    const metricas = [];

    // Pre-calculate daily metrics (join meta_ads_daily + subid_daily)
    const dates = [];
    for (let d = new Date(sevenDaysAgo); d <= hojeDate; d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
    }

    Object.keys(activeAdsMap).forEach(subid => {
        const a = activeAdsMap[subid];
        const fase = a.fase || 'TESTE';
        const dataInicio = a.data_inicio_fase || dataHoje;

        const subidMetrics = dates.map(dt => {
            const m = (metaData || []).find(x => x.subid === subid && x.data === dt) || { gasto: 0, cliques: 0 };
            const s = (subidData || []).find(x => x.subid === subid && x.data === dt) || { comissoes_estimadas: 0, pedidos: 0, vendas_diretas: 0 };
            
            const gasto = Number(m.gasto || 0);
            const comissao = Number(s.comissoes_estimadas || s.comissoes || 0);
            const roi = gasto > 0 ? ((comissao - gasto) / gasto) * 100 : (comissao > 0 ? 100 : null);
            
            const timeDiff = new Date(dt).getTime() - new Date(dataInicio).getTime();
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
        
        metricas.push(...subidMetrics.filter(m => new Date(m.data) >= new Date(dataInicio)));
    });

    const resultados = [];

    Object.keys(activeAdsMap).forEach(subid => {
        const mSubid = metricas.filter(m => m.subid === subid);
        
        const mHoje = mSubid.find(m => m.data === dataHoje);
        const mOntem = mSubid.find(m => m.data === dataOntem);
        
        if (!mHoje) return; // No data for D-1, skip

        const roi_hoje = mHoje.roi || 0;
        const roi_ontem = mOntem ? (mOntem.roi || 0) : 0;
        
        const valid7 = mSubid.filter(m => m.roi !== null);
        const dias_abaixo_30 = valid7.filter(m => m.roi < 30).length;
        const roi_medio_7d = valid7.length > 0 ? (valid7.reduce((acc, curr) => acc + curr.roi, 0) / valid7.length) : 0;

        const fase = mHoje.fase;
        const dia_fase = mHoje.dia_fase;
        let decisao = 'INDEFINIDO';

        if (fase === 'TESTE') {
            if (dia_fase === 1) {
                decisao = roi_hoje < -70 ? 'PAUSAR' : 'AGUARDAR';
            } else if (dia_fase === 2) {
                if (roi_hoje < -70) decisao = 'PAUSAR';
                else if (roi_hoje < roi_ontem) decisao = 'ATENCAO';
                else decisao = 'AGUARDAR';
            } else if (dia_fase === 3) {
                if (roi_hoje >= -10) decisao = 'AGUARDAR';
                else if (roi_hoje < -30) decisao = 'PAUSAR';
                else decisao = 'ATENCAO';
            } else if (dia_fase >= 4) {
                decisao = roi_hoje >= 0 ? 'APROVAR' : 'PAUSAR';
            }
        } else if (fase === 'MONITORAMENTO') {
            if (dias_abaixo_30 >= 5) decisao = 'PAUSAR';
            else if (dias_abaixo_30 >= 3) decisao = 'ATENCAO';
            else decisao = 'MANTER';
        }

        resultados.push({
            subid,
            fase,
            dia_fase,
            roi_hoje: parseFloat(roi_hoje.toFixed(2)),
            roi_ontem: parseFloat(roi_ontem.toFixed(2)),
            dias_abaixo_30,
            roi_medio_7d: parseFloat(roi_medio_7d.toFixed(2)),
            gasto_hoje: mHoje.gasto,
            comissao_hoje: mHoje.comissao,
            cliques_hoje: mHoje.cliques,
            decisao
        });
    });

    return resultados;
}

async function runClaudeAnalysis() {
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    const dataRelatorio = today.toISOString().split('T')[0];

    const { data: analiseExistente } = await sup.from('ai_daily_analysis')
        .select('id')
        .eq('data', dataRelatorio)
        .single();

    if (analiseExistente) {
        console.log(`[INFO] O relatório de hoje (${dataRelatorio}) já foi gerado.`);
        return;
    }

    console.log("Coletando dados e calculando decisões...");
    const dados = await getAggregatedData();
    console.log(`Encontradas ${dados.length} campanhas com dados recentes.`);
    
    if (dados.length === 0) {
        console.log("Nenhum dado para analisar.");
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

    // Limit to top 15 for Claude to analyze
    const top = dados.sort((a,b) => b.gasto_hoje - a.gasto_hoje).slice(0, 15);
    const dadosTexto = JSON.stringify(top, null, 2);

    const systemPrompt = `Você é um Consultor de Tráfego Sênior. 
Abaixo estão os dados agregados das campanhas ativas.
IMPORTANTE: A análise foca no dia fechado de ontem (D-1) porque a Shopee tem 1 dia de atraso (deixe isso claro no início do Resumo).
O sistema interno JÁ CALCULOU matematicamente a decisão para cada SubID (campo "decisao").
As decisões possíveis são: PAUSAR, ATENCAO, AGUARDAR, APROVAR, MANTER. O sistema inclusive já efetuou pausas nas campanhas necessárias.

Seu objetivo é gerar um relatório matinal explicando a situação em linguagem natural:
1. Faça um resumo da situação do portfólio.
2. Explique os motivos das decisões tomadas pelo sistema. Confirme ou justifique as razões pelas quais o sistema recomendou (ex: se pausou, explique o porquê baseado no ROI e Fase. Se aprovou, comemore a promoção para Escala).
3. Seja breve e direto ao ponto. Use Markdown estruturado com tabelas, alertas e emojis apropriados. Use a mesma taxonomia (Ranking de Campanhas, etc) para se integrar bem à interface.`;

    console.log(`Enviando para o ${MODEL_NAME}...`);
    
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
                max_tokens: 1500,
                temperature: 0.2,
                system: systemPrompt,
                messages: [
                    { role: "user", content: "Analise estas campanhas e explique as decisões tomadas pelo sistema:\n" + dadosTexto }
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

module.exports = { runClaudeAnalysis };

// Se o script for executado diretamente pelo terminal
if (require.main === module) {
    runClaudeAnalysis();
}
