#!/usr/bin/env node
/**
 * Roda a Análise IA contra dados REAIS do banco para um D-1 escolhido.
 *
 * Uso:
 *   node test_analise_real.cjs 2026-06-28              # só exibe, não grava
 *   node test_analise_real.cjs 2026-06-28 --grava      # grava em ai_daily_analysis
 */

const fs = require('fs');
const path = require('path');
const env = { ...process.env };
['../.env.local', '../.env'].forEach((p) => {
    const fp = path.join(__dirname, p);
    if (fs.existsSync(fp)) {
        fs.readFileSync(fp, 'utf8').split('\n').forEach((l) => {
            const i = l.indexOf('=');
            if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"\r]/g, '');
        });
    }
});
Object.assign(process.env, env);

const dataAlvo = process.argv[2] || '2026-06-28';
const gravar = process.argv.includes('--grava');

console.log(`\n==== Teste da Análise IA contra dados reais ====`);
console.log(`D-1 alvo: ${dataAlvo}`);
console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'AUSENTE (vai pular Claude)'}`);
console.log(`Modo gravação: ${gravar ? '💾 SIM (vai salvar em ai_daily_analysis)' : '👀 NÃO (apenas exibe)'}\n`);

const { createClient } = require('@supabase/supabase-js');
const sup = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { getAggregatedData } = require('./run_claude_analysis.cjs');

(async () => {
    const { dataRef, campanhas: dados } = await getAggregatedData({ dataHoje: dataAlvo, usarSubidsComGasto: true });
    console.log(`Data analisada: ${dataRef} — campanhas: ${dados.length}`);

    const porDecisao = dados.reduce((a, d) => { a[d.decisao] = (a[d.decisao] || 0) + 1; return a; }, {});
    console.log(`Decisões:`, porDecisao);

    const totalGasto = dados.reduce((s, d) => s + d.gasto_hoje, 0);
    const totalComissao = dados.reduce((s, d) => s + d.comissao_hoje, 0);
    const lucro = totalComissao - totalGasto;
    const roi = totalGasto > 0 ? (lucro / totalGasto) * 100 : 0;

    const todas = dados
        .filter(d => (d.gasto_hoje + d.comissao_hoje) > 0 || d.decisao !== 'MANTER')
        .sort((a, b) => (b.gasto_hoje + b.comissao_hoje) - (a.gasto_hoje + a.comissao_hoje));

    const portfolio = {
        data_referencia_d1: dataAlvo,
        campanhas_avaliadas: dados.length,
        campanhas_no_ranking: todas.length,
        campanhas_omitidas_estaveis: dados.length - todas.length,
        em_teste: dados.filter(d => d.fase === 'TESTE').length,
        em_monitoramento: dados.filter(d => d.fase === 'MONITORAMENTO').length,
        pausadas_hoje: porDecisao.PAUSAR || 0,
        aprovadas_hoje: porDecisao.APROVAR || 0,
        gasto_total: parseFloat(totalGasto.toFixed(2)),
        comissao_total: parseFloat(totalComissao.toFixed(2)),
        lucro_liquido: parseFloat(lucro.toFixed(2)),
        roi_geral: parseFloat(roi.toFixed(2)),
    };
    console.log(`\nPortfólio:`, portfolio);

    const payload = { portfolio, campanhas: todas };
    const dadosTexto = JSON.stringify(payload, null, 2);
    console.log(`\nTamanho do payload: ${dadosTexto.length} chars (~${Math.round(dadosTexto.length / 4)} tokens)`);

    if (!process.env.ANTHROPIC_API_KEY) {
        console.log('\n⏭️  Sem ANTHROPIC_API_KEY — pulando Claude.');
        return;
    }

    const CLIQUES_MIN_DIA1 = 50, ROI_DIA_D = -5, ROI_MIN_MONITORAMENTO = 30, DIAS_RUINS_PARA_PAUSAR = 5, JANELA_MONITORAMENTO = 7;
    const systemPrompt = `Você é o Consultor de Tráfego Sênior do dashboard de afiliado Shopee + Meta Ads.

CONTEXTO TEMPORAL OBRIGATÓRIO
- A Shopee tem 24-48h de atraso na atribuição de comissão. O dia "fechado" mais recente é D-1.
- Neste relatório, "hoje" = D-1 (ontem real) e "ontem" = D-2. Deixe explícito no Resumo.

REGRAS DE DECISÃO (já calculadas no campo \`decisao\` — não recalcule, apenas explique):

FASE TESTE:
- Dia 1: PAUSAR se ROI < -70%, ou se cliques < ${CLIQUES_MIN_DIA1} com gasto > 0. Senão AGUARDAR.
- Dia 2: PAUSAR se ROI < -70% OU se piorou vs ontem e segue negativo. ATENCAO se positivo mas caiu. Senão AGUARDAR.
- Dia 3 (Dia D): AGUARDAR se ROI ≥ ${ROI_DIA_D}%. PAUSAR se abaixo.
- Dia 4+: APROVAR se ROI ≥ 0%. Senão PAUSAR.

FASE MONITORAMENTO (rolling 7 dias corridos):
- PAUSAR se ${DIAS_RUINS_PARA_PAUSAR} de ${JANELA_MONITORAMENTO} dias têm ROI < ${ROI_MIN_MONITORAMENTO}%.
- ATENCAO se 3-4 dias. MANTER caso contrário.

ESTRUTURA OBRIGATÓRIA:

# 📊 Relatório Matinal — D-1

## 1. Resumo Executivo
- Uma linha sobre o delay D-1 da Shopee.
- Linha exata: **Total Gasto:** R$ X | **Total Comissão:** R$ Y | **Lucro Líquido:** R$ Z | **ROI Geral:** W%
- 2-4 linhas interpretando a saúde geral.

## 2. Ranking de Campanhas
Tabela única com TODAS as campanhas, ordenadas por ROI desc:
| Campanha | Fase | Dia/Janela | Gasto | Cliques | Comissão | ROI | ROI 7d | Decisão |
Emojis no ROI: ✅ ≥30%, 🟢 0-29%, 🟡 -30 a -1, 🔴 < -30. NÃO omita nenhuma.

## 3. Ações do Sistema
Para cada APROVAR ou PAUSAR, um bloco no formato EXATO (o front parseia):

### \`<subid>\` — ROI: <±X,X>%

Gasto R$ <Z> → Comissão R$ <W> → <Lucro ou Prejuízo>: R$ <V>

<2-4 linhas de análise contextual.>

**Recomendação:** <ação concreta usando \`motivo\` do payload.>

## 4. Em Observação
Mesmo formato da seção 3 para cada ATENCAO/AGUARDAR.

## 5. Plano de Ação Resumido
3-6 bullets priorizados (Pausar > Reduzir > Manter > Escalar) com \`subid\` e ação concreta.

Subids em crase. ROI com sinal e %. R$ com vírgula decimal. Não invente nada.`;

    console.log('\n🤖 Chamando Claude...');
    const startedAt = Date.now();
    const MODEL_NAME = 'claude-sonnet-4-6';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL_NAME,
            max_tokens: 12000,
            temperature: 0.2,
            system: systemPrompt,
            messages: [{ role: 'user', content: 'Gere o relatório matinal (todas as campanhas no Ranking):\n' + dadosTexto }],
        }),
    });

    if (!response.ok) {
        console.error(`❌ Claude erro ${response.status}:`, await response.text());
        return;
    }

    const result = await response.json();
    const md = result.content[0].text;
    console.log(`\n✅ Claude respondeu em ${Date.now() - startedAt}ms (${md.length} chars)`);

    if (gravar) {
        const hoje = new Date();
        hoje.setUTCHours(0, 0, 0, 0);
        const dataRegistro = hoje.toISOString().split('T')[0];
        console.log(`\n💾 Gravando em ai_daily_analysis (data=${dataRegistro})...`);

        // Apaga registro anterior do mesmo dia (caso exista) para sobrescrever
        await sup.from('ai_daily_analysis').delete().eq('data', dataRegistro);
        const { error } = await sup.from('ai_daily_analysis').insert({
            data: dataRegistro,
            analise_markdown: md,
            modelo: MODEL_NAME,
        });

        if (error) {
            console.error('❌ Erro ao gravar:', error);
        } else {
            console.log(`✅ Gravado! Atualize o site para ver.`);
        }
    } else {
        console.log(`\n========== MARKDOWN GERADO ==========\n`);
        console.log(md);
        console.log(`\n=====================================\n`);
    }
})();
