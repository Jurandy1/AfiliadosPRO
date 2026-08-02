import { useEffect, useMemo, useState } from "react";
import { listarBackups, listarGrupos } from "../../repositories/backupRepository";
import { fmt, temFaixaPreco } from "../../../../utils/formatters";

function tempoAtras(ms) {
  if (!ms || !Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

const ACCENTS = {
  neutral: "before:bg-slate-300",
  green: "before:bg-emerald-500",
  red: "before:bg-rose-500",
  amber: "before:bg-amber-500",
  blue: "before:bg-sky-500",
  orange: "before:bg-orange-500",
  violet: "before:bg-violet-500",
};

const VALUE_TONES = {
  neutral: "text-slate-900",
  green: "text-emerald-700",
  red: "text-rose-700",
  amber: "text-amber-700",
  blue: "text-sky-700",
  orange: "text-orange-700",
  violet: "text-violet-700",
};

function StatCard({ label, valor, sub, delta, accent = "neutral", onClick, title }) {
  const clickable = typeof onClick === "function";
  const base = "group relative bg-white border border-slate-200 rounded-lg px-3.5 py-3 text-left transition"
    + " before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-[3px] before:rounded-t-lg";
  const interactive = clickable
    ? "hover:border-slate-300 hover:shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-900/10"
    : "";
  const Tag = clickable ? "button" : "div";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`${base} ${ACCENTS[accent] || ACCENTS.neutral} ${interactive} w-full`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums leading-none ${VALUE_TONES[accent] || VALUE_TONES.neutral}`}>
        {valor}
      </div>
      {sub || delta ? (
        <div className="mt-1.5 flex items-baseline gap-2">
          {delta ? (
            <span className="text-[10px] font-semibold text-slate-600 tabular-nums">
              {delta}
            </span>
          ) : null}
          {sub ? (
            <span className="text-[11px] text-slate-500 truncate">
              {sub}
            </span>
          ) : null}
        </div>
      ) : null}
      {clickable ? (
        <span className="absolute bottom-2 right-3 text-slate-300 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition">
          →
        </span>
      ) : null}
    </Tag>
  );
}

function comR$(b) {
  return (Number(b?.preco || 0) * Number(b?.comissao_pct || 0)) / 100;
}

export default function BackupOverviewStats({ refreshTrigger, onOpenBackups, onOpenGrupos }) {
  const [backups, setBackups] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      try {
        const [b, g] = await Promise.all([listarBackups(), listarGrupos()]);
        if (cancelado) return;
        setBackups(b || []);
        setGrupos(g || []);
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [refreshTrigger]);

  const stats = useMemo(() => {
    const total = backups.length;
    const emGrupo = backups.filter((b) => b.grupoId).length;
    const livres = total - emGrupo;

    const okApi = backups.filter((b) => b.status_api === "ok").length;
    const foraApi = backups.filter((b) => b.status_api === "produto_nao_encontrado").length;

    // Sinais críticos por produto (usados no card único "Sinais críticos")
    let semComissao = 0;
    let comissaoBaixa = 0;
    let ratingRuim = 0;
    let semVendasShopee = 0;
    let precoSubiuMuito = 0;
    for (const b of backups) {
      const preco = Number(b.preco || 0);
      const pct = Number(b.comissao_pct || 0);
      if (pct === 0 && b.status_api === "ok") semComissao++;
      if (preco > 0 && pct > 0 && (preco * pct) / 100 < 1) comissaoBaixa++;
      const r = Number(b.rating || 0);
      if (r > 0 && r < 4.0) ratingRuim++;
      if (Number(b.vendas_shopee || 0) === 0 && b.status_api === "ok") semVendasShopee++;
      const subiu = (b.alertas || []).some((a) => a?.tipo === "preco_subiu");
      if (subiu) precoSubiuMuito++;
    }
    const sinaisCriticos = foraApi + semComissao + comissaoBaixa + ratingRuim
      + semVendasShopee + precoSubiuMuito;

    // Rotação: para cada grupo, o principal vs melhor backup do grupo (por comissão R$).
    const backupById = Object.fromEntries(backups.map((b) => [String(b.itemId), b]));
    const rotacoesRecomendadas = [];
    for (const g of grupos) {
      const principalId = String(g.principalItemId || "");
      if (!principalId) continue;
      const principal = backupById[principalId];
      if (!principal) continue;
      const ids = (g.backupItemIds || []).map(String);
      const backupsDoGrupo = ids.map((id) => backupById[id]).filter(Boolean);
      if (!backupsDoGrupo.length) continue;
      let melhor = null;
      let melhorCom = -Infinity;
      for (const b of backupsDoGrupo) {
        if (b.status_api !== "ok") continue;
        const c = comR$(b);
        if (c > melhorCom) {
          melhorCom = c;
          melhor = b;
        }
      }
      if (!melhor) continue;
      const cP = comR$(principal);
      const diff = melhorCom - cP;
      if (diff > 0.05) {
        rotacoesRecomendadas.push({
          grupoId: g.docId,
          grupoNome: g.nome,
          principalNome: principal.apelido || principal.nome || principalId,
          melhorNome: melhor.apelido || melhor.nome || melhor.itemId,
          principalCom: cP,
          melhorCom,
          diff,
        });
      }
    }
    rotacoesRecomendadas.sort((a, b) => b.diff - a.diff);
    const rotacaoTopo = rotacoesRecomendadas[0] || null;

    const comFaixaVariantes = backups.filter((b) => temFaixaPreco(b.precoMin, b.precoMax)).length;

    const comissoesR$ = backups
      .map((b) => (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100)
      .filter((v) => v > 0);
    const somaCom = comissoesR$.reduce((s, v) => s + v, 0);
    const mediaComR$ = comissoesR$.length ? somaCom / comissoesR$.length : 0;
    const topCom = comissoesR$.length ? Math.max(...comissoesR$) : 0;

    let scanMaisAntigoMs = null;
    let scanMaisRecenteMs = null;
    for (const b of backups) {
      const t = b.ultima_verificacao?.getTime?.();
      if (!t) continue;
      if (scanMaisAntigoMs == null || t < scanMaisAntigoMs) scanMaisAntigoMs = t;
      if (scanMaisRecenteMs == null || t > scanMaisRecenteMs) scanMaisRecenteMs = t;
    }
    const idadeMaisAntigoMs = scanMaisAntigoMs ? Date.now() - scanMaisAntigoMs : null;
    const idadeMaisRecenteMs = scanMaisRecenteMs ? Date.now() - scanMaisRecenteMs : null;

    const lojaCount = {};
    for (const b of backups) {
      const k = b.loja || "—";
      lojaCount[k] = (lojaCount[k] || 0) + 1;
    }
    const topLojas = Object.entries(lojaCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const gruposComPrincipal = grupos.filter((g) => g.principalItemId).length;
    const gruposSemBackup = grupos.filter(
      (g) => !g.backupItemIds || g.backupItemIds.length === 0,
    ).length;

    return {
      total, emGrupo, livres,
      okApi, foraApi,
      semComissao, comissaoBaixa, ratingRuim, semVendasShopee, precoSubiuMuito,
      sinaisCriticos,
      rotacoes: rotacoesRecomendadas, rotacaoTopo,
      comFaixaVariantes,
      mediaComR$, topCom,
      idadeMaisAntigoMs, idadeMaisRecenteMs,
      topLojas,
      totalGrupos: grupos.length, gruposComPrincipal, gruposSemBackup,
    };
  }, [backups, grupos]);

  const open = (preset) => {
    if (typeof onOpenBackups === "function") onOpenBackups(preset || {});
  };

  const abrirGrupos = () => {
    if (typeof onOpenGrupos === "function") onOpenGrupos();
  };

  if (loading && !backups.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg px-3.5 py-3 text-[11px] text-slate-500">
        Carregando resumo…
      </div>
    );
  }

  if (!stats.total) return null;

  const pctCoberto = stats.total ? Math.round((stats.okApi / stats.total) * 100) : 0;

  const sinaisSub = (() => {
    const partes = [];
    if (stats.foraApi) partes.push(`${stats.foraApi} fora do afiliado`);
    if (stats.semComissao) partes.push(`${stats.semComissao} sem comissão`);
    if (stats.comissaoBaixa) partes.push(`${stats.comissaoBaixa} < R$ 1`);
    if (stats.ratingRuim) partes.push(`${stats.ratingRuim} rating < 4`);
    if (stats.semVendasShopee) partes.push(`${stats.semVendasShopee} sem vendas`);
    if (stats.precoSubiuMuito) partes.push(`${stats.precoSubiuMuito} preço subiu`);
    return partes.slice(0, 2).join(" · ") || "tudo saudável";
  })();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatCard
          label="Backups"
          valor={stats.total}
          sub={`${stats.emGrupo} em grupo · ${stats.livres} livres`}
          onClick={() => open({})}
          title="Ver todos os produtos protegidos"
        />
        <StatCard
          label="Cobertura API"
          valor={stats.okApi}
          delta={`${pctCoberto}%`}
          sub="retornam no afiliado"
          accent="green"
          onClick={() => open({ status: "ok" })}
          title="Produtos com status_api = ok no último refresh"
        />
        <StatCard
          label="Fora do afiliado"
          valor={stats.foraApi}
          sub={stats.foraApi > 0 ? "revisar link" : "nenhum"}
          accent={stats.foraApi > 0 ? "red" : "neutral"}
          onClick={() => open({ status: "fora" })}
          title="produto_nao_encontrado — o link precisa ser trocado"
        />
        <StatCard
          label="Sinais críticos"
          valor={stats.sinaisCriticos}
          sub={sinaisSub}
          accent={stats.sinaisCriticos > 0 ? "red" : "neutral"}
          onClick={() => open({ sinal: "critico" })}
          title="Fora do afiliado + comissão zero + comissão < R$1 + rating < 4 + sem vendas + preço subiu"
        />
        <StatCard
          label="Scan mais antigo"
          valor={tempoAtras(stats.idadeMaisAntigoMs)}
          sub={stats.idadeMaisRecenteMs != null ? `novo ${tempoAtras(stats.idadeMaisRecenteMs)}` : null}
          accent={stats.idadeMaisAntigoMs && stats.idadeMaisAntigoMs > 24 * 3600 * 1000 ? "amber" : "neutral"}
          onClick={() => open({ ordenacao: "esquecidos" })}
          title="Cron roda 3×/dia. Clique para ordenar pelo scan mais antigo."
        />
        <StatCard
          label="Comissão média"
          valor={fmt(stats.mediaComR$)}
          sub={stats.topCom > 0 ? `topo ${fmt(stats.topCom)}` : null}
          accent="blue"
          onClick={() => open({ ordenacao: "comissao_reais" })}
          title="Média de comissão em R$ por venda. Clique para ordenar pela maior."
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <StatCard
          label="Trocar principal"
          valor={stats.rotacoes.length}
          delta={stats.rotacaoTopo ? `+${fmt(stats.rotacaoTopo.diff)}` : null}
          sub={stats.rotacaoTopo
            ? `${stats.rotacaoTopo.grupoNome}: backup rende mais`
            : "principal é o melhor em todos"}
          accent={stats.rotacoes.length > 0 ? "violet" : "neutral"}
          onClick={abrirGrupos}
          title="Grupos onde um backup tem comissão R$ maior que o principal — oportunidade de rotacionar"
        />
        <StatCard
          label="Variantes com faixa"
          valor={stats.comFaixaVariantes}
          sub={stats.comFaixaVariantes > 0
            ? `${Math.round((stats.comFaixaVariantes / stats.total) * 100)}% dos itens (priceMin ≠ priceMax)`
            : "todos têm preço único"}
          accent={stats.comFaixaVariantes > 0 ? "amber" : "neutral"}
          onClick={() => open({ variantes: "com_faixa" })}
          title="Produtos onde a Shopee devolve faixa de preço (variantes de tamanho/cor)"
        />
        <StatCard
          label="Loja com mais backups"
          valor={stats.topLojas[0] ? stats.topLojas[0][0] : "—"}
          delta={stats.topLojas[0] ? `${stats.topLojas[0][1]} itens` : null}
          sub={stats.topLojas.slice(1, 3).map(([n, c]) => `${n} (${c})`).join(" · ") || null}
          onClick={() => stats.topLojas[0] && open({ busca: stats.topLojas[0][0] })}
          title="Ranking por número de produtos por loja"
        />
      </div>

      {stats.totalGrupos > 0 ? (
        <div className="text-[10px] text-slate-400 font-medium tracking-wide px-1">
          {stats.totalGrupos} grupo(s) · {stats.gruposComPrincipal} com principal ativo
          {stats.gruposSemBackup > 0 ? ` · ${stats.gruposSemBackup} sem reservas` : ""}
        </div>
      ) : null}
    </div>
  );
}
