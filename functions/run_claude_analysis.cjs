const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
const txt = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
const env = {};
txt.split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"\r]/g, '');
});

const sup = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL_NAME = "claude-sonnet-4-6";

async function getAggregatedData() {
    // Get last 2 days of data
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setUTCDate(today.getUTCDate() - 2);

    const dataA = twoDaysAgo.toISOString().split('T')[0];
    const dataB = yesterday.toISOString().split('T')[0];
    const dataC = today.toISOString().split('T')[0];

    // Fetch comissoes (Shopee)
    const { data: subidData } = await sup.from('subid_daily')
        .select('*')
        .gte('data', dataA)
        .lte('data', dataB);

    // Fetch gasto (Meta)
    const { data: metaData } = await sup.from('meta_ads_daily')
        .select('*')
        .gte('data', dataA)
        .lte('data', dataB);

    const campanhas = {};

    // Aggregate Meta
    (metaData || []).forEach(row => {
        if (!row.subid) return;
        if (!campanhas[row.subid]) campanhas[row.subid] = { subid: row.subid, gasto: 0, cliques: 0, comissao: 0 };
        campanhas[row.subid].gasto += Number(row.gasto || 0);
        campanhas[row.subid].cliques += Number(row.cliques || 0);
    });

    // Aggregate Shopee
    (subidData || []).forEach(row => {
        if (!row.subid) return;
        if (!campanhas[row.subid]) campanhas[row.subid] = { subid: row.subid, gasto: 0, cliques: 0, comissao: 0 };
        campanhas[row.subid].comissao += Number(row.comissoes_estimadas || row.comissoes || 0);
    });

    // Fetch active subids to filter out paused campaigns
    const { data: activeAds } = await sup.from('meta_ads').select('subid_vinculado').eq('status', 'Ativo');
    const activeSubids = new Set((activeAds || []).map(a => a.subid_vinculado));

    return Object.values(campanhas)
      .filter(c => (c.gasto > 0 || c.comissao > 0) && activeSubids.has(c.subid))
      .map(c => {
        c.roi = c.gasto > 0 ? ((c.comissao - c.gasto) / c.gasto) * 100 : (c.comissao > 0 ? 100 : 0);
        c.roi = c.roi.toFixed(2) + '%';
        c.gasto = c.gasto.toFixed(2);
        c.comissao = c.comissao.toFixed(2);
        return c;
    });
}

async function runClaudeAnalysis() {
    // Definimos a "data" do relatório como a data de hoje (baseada no momento de execução)
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    const dataRelatorio = today.toISOString().split('T')[0];

    // 1. Checa se já existe relatório pra hoje para não gastar tokens
    const { data: analiseExistente } = await sup.from('ai_daily_analysis')
        .select('id')
        .eq('data', dataRelatorio)
        .single();

    if (analiseExistente) {
        console.log(`[INFO] O relatório de hoje (${dataRelatorio}) já foi gerado. Pulando para economizar tokens.`);
        return;
    }

    console.log("Coletando dados do Supabase...");
    const dados = await getAggregatedData();
    console.log(`Encontradas ${dados.length} campanhas com dados recentes.`);
    
    if (dados.length === 0) {
        console.log("Nenhum dado para analisar.");
        return;
    }

    // Limit to top 5 for the test to avoid huge prompt
    const top5 = dados.sort((a,b) => b.gasto - a.gasto).slice(0, 5);
    
    const dadosTexto = JSON.stringify(top5, null, 2);

    const systemPrompt = `Você é um Analista de Tráfego Sênior. 
Abaixo estão os dados agregados das campanhas ativas nos últimos 2 dias.
O 'gasto' vem da Meta (Facebook Ads) e a 'comissao' vem da plataforma de afiliados (Shopee).
Seu objetivo é analisar os dados (Custos, Cliques, Comissões e ROI) e entregar um relatório matinal direto ao ponto:
1. Faça um resumo da situação.
2. Destaque quais campanhas estão com ROI crítico (prejuízo grande) e sugira se devem ser pausadas ou não.
3. Destaque as campanhas validadas que estão performando bem.
Seja breve e direto ao ponto. Use Markdown estruturado com tabelas, alertas e emojis apropriados.`;

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
                max_tokens: 1024,
                temperature: 0.2,
                system: systemPrompt,
                messages: [
                    { role: "user", content: "Analise estas campanhas:\n" + dadosTexto }
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

        // 2. Salva no Supabase
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

runClaudeAnalysis();
