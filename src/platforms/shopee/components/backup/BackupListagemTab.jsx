import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Archive, Check, Copy, RefreshCw, Search, SlidersHorizontal,
  Star, Store, Trash2,
} from "lucide-react";
import {
  atualizarBackup,
  atualizarBackupsEmLote,
  editarBackupMeta,
  listarBackups,
  removerBackup,
} from "../../repositories/backupRepository";
import { fmt, fmtNum } from "../../../../utils/formatters";

function formatTempoAtras(date) {
  if (!date) return "—";
  const passado = Date.now() - date.getTime();
  const min = Math.floor(passado / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function formatPeriodoComissao(periodoFim) {
  if (!periodoFim) return null;
  const diff = periodoFim - Math.floor(Date.now() / 1000);
  if (diff < 0) return { texto: "ENCERRADO", critico: true };
  const dias = Math.floor(diff / 86400);
  if (dias < 7) return { texto: `Termina em ${dias} dia(s)`, critico: true };
  if (dias < 30) return { texto: `Termina em ${dias} dias`, critico: false };
  return { texto: `Válido por ${dias} dias`, critico: false };
}

export default function BackupListagemTab({ refreshTrigger, showToast, askConfirm, onChanged }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroAlerta, setFiltroAlerta] = useState("todos");
  const [filtroGrupo, setFiltroGrupo] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [ordenacao, setOrdenacao] = useState("recentes");
  const [expandirFiltros, setExpandirFiltros] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [itensPorPagina] = useState(8);
  const [itensSelecionados, setItensSelecionados] = useState([]);
  const [atualizandoId, setAtualizandoId] = useState(null);
  const [varrendoLote, setVarrendoLote] = useState(false);

  const carregar = async (opcoes = {}) => {
    setLoading(true);
    try {
      setBackups(await listarBackups(opcoes));
    } catch (err) {
      console.error("Erro carregando backups:", err);
      showToast?.("Erro ao carregar backups.", "erro");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [refreshTrigger]);

  const categoriasUnicas = useMemo(() => {
    const cats = backups.map((b) => b.category || "Geral");
    return ["todas", ...new Set(cats)];
  }, [backups]);

  useEffect(() => {
    setPagina(1);
  }, [busca, filtroAlerta, filtroGrupo, filtroCategoria, ordenacao]);

  const backupsFiltrados = useMemo(() => {
    let lista = [...backups];
    const t = busca.trim().toLowerCase();
    if (t) {
      lista = lista.filter((b) =>
        (b.nome || "").toLowerCase().includes(t)
        || (b.apelido || "").toLowerCase().includes(t)
        || (b.loja || "").toLowerCase().includes(t)
        || String(b.itemId || "").includes(t),
      );
    }
    if (filtroAlerta === "alertas") lista = lista.filter((b) => (b.alertas?.length || 0) > 0);
    else if (filtroAlerta === "criticos") lista = lista.filter((b) => b.alertas?.some((a) => a.nivel === "critico"));
    else if (filtroAlerta === "saudaveis") lista = lista.filter((b) => !b.alertas?.length);
    if (filtroGrupo === "vinculados") lista = lista.filter((b) => b.grupoId);
    else if (filtroGrupo === "livres") lista = lista.filter((b) => !b.grupoId);
    if (filtroCategoria !== "todas") lista = lista.filter((b) => (b.category || "Geral") === filtroCategoria);

    lista.sort((a, b) => {
      if (ordenacao === "recentes") return (b.cadastrado_em?.getTime?.() || 0) - (a.cadastrado_em?.getTime?.() || 0);
      if (ordenacao === "comissao_reais") {
        return ((b.preco * b.comissao_pct) / 100) - ((a.preco * a.comissao_pct) / 100);
      }
      if (ordenacao === "comissao_pct") return (b.comissao_pct || 0) - (a.comissao_pct || 0);
      if (ordenacao === "vendas") return (b.vendas_shopee || 0) - (a.vendas_shopee || 0);
      if (ordenacao === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
      if (ordenacao === "esquecidos") {
        return (a.ultima_verificacao?.getTime?.() || 0) - (b.ultima_verificacao?.getTime?.() || 0);
      }
      return 0;
    });
    return lista;
  }, [backups, busca, filtroAlerta, filtroGrupo, filtroCategoria, ordenacao]);

  const totalPaginas = Math.max(1, Math.ceil(backupsFiltrados.length / itensPorPagina));
  const backupsPaginados = useMemo(() => {
    const i = (pagina - 1) * itensPorPagina;
    return backupsFiltrados.slice(i, i + itensPorPagina);
  }, [backupsFiltrados, pagina, itensPorPagina]);

  const filtrosAtivos = filtroAlerta !== "todos" || filtroGrupo !== "todos"
    || filtroCategoria !== "todas" || ordenacao !== "recentes";

  const toggleSelecionarTudo = () => {
    const idsPagina = backupsPaginados.map((b) => b.itemId);
    if (idsPagina.every((id) => itensSelecionados.includes(id))) {
      setItensSelecionados((prev) => prev.filter((id) => !idsPagina.includes(id)));
    } else {
      setItensSelecionados((prev) => [...new Set([...prev, ...idsPagina])]);
    }
  };

  const handleRefresh = async (itemId) => {
    setAtualizandoId(itemId);
    try {
      await atualizarBackup(itemId);
      await carregar({ force: true });
      showToast?.("Oferta atualizada via API Shopee.", "sucesso");
      onChanged?.();
    } catch (err) {
      showToast?.(err?.message || String(err), "erro");
    } finally {
      setAtualizandoId(null);
    }
  };

  const handleMassScan = async (itemIds) => {
    setVarrendoLote(true);
    try {
      const results = await atualizarBackupsEmLote(itemIds);
      await carregar({ force: true });
      const ok = results.filter((r) => r.ok).length;
      showToast?.(`Varredura: ${ok}/${itemIds.length} atualizados.`, ok === itemIds.length ? "sucesso" : "aviso");
      onChanged?.();
    } catch (err) {
      showToast?.(err?.message || String(err), "erro");
    } finally {
      setVarrendoLote(false);
    }
  };

  const handleDelete = async (itemId, nome) => {
    const ok = await askConfirm?.("Remover backup", `Remover "${nome}" dos backups?`);
    if (!ok) return;
    try {
      await removerBackup(itemId);
      await carregar();
      showToast?.("Backup removido.", "sucesso");
      onChanged?.();
    } catch (err) {
      showToast?.(err?.message || String(err), "erro");
    }
  };

  const handleMassDelete = async (itemIds) => {
    const ok = await askConfirm?.(
      "Exclusão em massa",
      `Remover ${itemIds.length} produto(s) permanentemente?`,
    );
    if (!ok) return;
    for (const id of itemIds) {
      try {
        await removerBackup(id);
      } catch {
        /* continua */
      }
    }
    await carregar();
    showToast?.("Remoção em lote concluída.", "sucesso");
    onChanged?.();
  };

  const copiarLink = (link) => {
    if (!link) {
      showToast?.("Nenhum link disponível.", "aviso");
      return;
    }
    navigator.clipboard.writeText(link).then(() => showToast?.("Link copiado!", "sucesso"));
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-500 text-sm">Carregando...</div>;
  }

  if (backups.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
        <Archive size={36} className="mx-auto text-slate-300 mb-2" />
        <div className="text-slate-700 font-bold text-sm">Nenhum produto cadastrado</div>
        <div className="text-xs text-slate-500 mt-1">Use a aba Cadastrar para adicionar sua primeira oferta.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 text-slate-400" size={15} />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, apelido, loja ou ID Shopee..."
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-orange-500 font-semibold"
          />
        </div>
        <button
          type="button"
          onClick={() => setExpandirFiltros(!expandirFiltros)}
          className={`w-full md:w-auto px-4 py-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 shrink-0 ${
            expandirFiltros ? "bg-orange-600 border-orange-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <SlidersHorizontal size={14} />
          Filtros avançados
          {filtrosAtivos && !expandirFiltros && <span className="w-2 h-2 rounded-full bg-amber-400" />}
        </button>
      </div>

      {expandirFiltros && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Alertas</label>
            <select value={filtroAlerta} onChange={(e) => setFiltroAlerta(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-semibold">
              <option value="todos">Todos</option>
              <option value="saudaveis">Sem alertas</option>
              <option value="alertas">Com alerta</option>
              <option value="criticos">Críticos</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Grupo</label>
            <select value={filtroGrupo} onChange={(e) => setFiltroGrupo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-semibold">
              <option value="todos">Todos</option>
              <option value="vinculados">Em grupo</option>
              <option value="livres">Livres</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Categoria</label>
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-semibold">
              {categoriasUnicas.map((cat) => (
                <option key={cat} value={cat}>{cat === "todas" ? "Todas" : cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Ordenar</label>
            <select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white font-semibold">
              <option value="recentes">Mais recentes</option>
              <option value="comissao_reais">Maior comissão (R$)</option>
              <option value="comissao_pct">Maior comissão (%)</option>
              <option value="vendas">Vendas Shopee</option>
              <option value="rating">Rating</option>
              <option value="esquecidos">Verificação mais antiga</option>
            </select>
          </div>
        </div>
      )}

      {itensSelecionados.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-orange-900 font-bold">
            {itensSelecionados.length} selecionado(s)
          </span>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 w-full sm:w-auto">
            <button
              type="button"
              disabled={varrendoLote}
              onClick={() => { handleMassScan(itensSelecionados); setItensSelecionados([]); }}
              className="col-span-2 sm:col-span-1 px-3 py-2 bg-orange-600 text-white font-bold text-[11px] rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <RefreshCw size={12} className={varrendoLote ? "animate-spin" : ""} />
              Varrer selecionados
            </button>
            <button
              type="button"
              onClick={() => { handleMassDelete(itensSelecionados); setItensSelecionados([]); }}
              className="px-3 py-2 bg-rose-50 text-rose-700 font-bold text-[11px] rounded-lg border border-rose-100 flex items-center gap-1"
            >
              <Trash2 size={12} />
              Excluir
            </button>
            <button type="button" onClick={() => setItensSelecionados([])} className="px-2.5 py-2 bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg">
              Limpar
            </button>
          </div>
        </div>
      )}

      {backupsFiltrados.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-500">
          Nenhuma oferta com os filtros ativos.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-1 text-[10px] text-slate-400 font-bold uppercase">
            <button type="button" onClick={toggleSelecionarTudo} className="flex items-center gap-2 hover:text-slate-600">
              <span className={`w-4 h-4 border rounded flex items-center justify-center ${backupsPaginados.every((b) => itensSelecionados.includes(b.itemId)) ? "bg-orange-600 border-orange-600 text-white" : "border-slate-300"}`}>
                {backupsPaginados.every((b) => itensSelecionados.includes(b.itemId)) && <Check size={10} strokeWidth={4} />}
              </span>
              Selecionar página
            </button>
            <span className="uppercase tracking-wider">Total filtrado: {backupsFiltrados.length}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {backupsPaginados.map((b) => {
              const comissaoR$ = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
              const periodoInfo = formatPeriodoComissao(b.periodoFim);
              const sel = itensSelecionados.includes(b.itemId);
              return (
                <div key={b.docId} className={`bg-white border rounded-2xl p-3.5 shadow-sm ${sel ? "border-orange-400 bg-orange-50/30" : "border-slate-200"}`}>
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => setItensSelecionados((p) => (p.includes(b.itemId) ? p.filter((x) => x !== b.itemId) : [...p, b.itemId]))} className="mt-0.5 shrink-0">
                      <span className={`w-4 h-4 border rounded flex items-center justify-center ${sel ? "bg-orange-600 border-orange-600 text-white" : "border-slate-300"}`}>
                        {sel && <Check size={10} strokeWidth={4} />}
                      </span>
                    </button>
                    {b.imagem && <img src={b.imagem} alt="" className="w-14 h-14 object-cover rounded-xl border border-slate-100 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {b.marcadoPrincipal && (
                          <span className="bg-orange-500 text-white text-[8px] font-extrabold px-1 py-0.5 rounded flex items-center gap-0.5 shrink-0">
                            <Check size={8} strokeWidth={4} />
                            ATIVO PRINCIPAL
                          </span>
                        )}
                        <span className={`text-[8px] font-extrabold px-1 py-0.5 rounded shrink-0 ${
                          b.grupoId
                            ? "bg-slate-100 text-slate-600"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200/40"
                        }`}>
                          {b.grupoId ? "EM GRUPO" : "DISPONÍVEL/LIVRE"}
                        </span>
                        <span className="font-bold text-slate-800 text-xs truncate">{b.apelido || b.nome}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5 font-semibold">
                        <Store size={11} />
                        {b.loja}
                        <span>·</span>
                        {b.category || "Geral"}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] mt-1.5 font-bold">
                        <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{fmt(b.preco)}</span>
                        <span className="text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">{b.comissao_pct}% ({fmt(comissaoR$)})</span>
                      </div>
                      <div className="text-[9px] text-slate-400 mt-1 font-semibold flex flex-wrap items-center gap-1">
                        <span>Último scan {formatTempoAtras(b.ultima_verificacao)}</span>
                        {periodoInfo && (
                          <>
                            <span>·</span>
                            <span className={periodoInfo.critico ? "text-rose-600 font-extrabold" : ""}>{periodoInfo.texto}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{fmtNum(b.vendas_shopee)} vend. Shopee</span>
                      </div>
                    </div>
                  </div>
                  {b.alertas?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {b.alertas.map((a, i) => (
                        <div key={i} className={`text-[10px] p-2 rounded-lg font-semibold flex items-center gap-1.5 ${a.nivel === "critico" ? "bg-rose-50 text-rose-800 border border-rose-100" : "bg-amber-50 text-amber-800 border border-amber-100"}`}>
                          <AlertTriangle size={12} />
                          {a.mensagem}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 pt-2 border-t border-slate-100 grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                    <button type="button" disabled={atualizandoId === b.itemId} onClick={() => handleRefresh(b.itemId)} className="px-2.5 py-1.5 text-[10px] font-bold bg-orange-50 text-orange-700 rounded-lg flex items-center justify-center gap-1 disabled:opacity-50">
                      <RefreshCw size={10} className={atualizandoId === b.itemId ? "animate-spin" : ""} />
                      Atualizar
                    </button>
                    <button type="button" onClick={() => copiarLink(b.linkAfiliado || b.linkProduto)} className="px-2.5 py-1 text-[10px] font-bold bg-slate-50 text-slate-600 rounded-lg flex items-center gap-1">
                      <Copy size={10} />
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await editarBackupMeta(b.itemId, { marcadoPrincipal: !b.marcadoPrincipal });
                        await carregar();
                        showToast?.("Marca de principal alterada.", "sucesso");
                      }}
                      className="px-2.5 py-1 text-[10px] font-bold bg-amber-50 text-amber-700 rounded-lg flex items-center gap-1"
                    >
                      <Star size={10} />
                      {b.marcadoPrincipal ? "Desmarcar" : "Ativo"}
                    </button>
                    <button type="button" onClick={() => handleDelete(b.itemId, b.apelido || b.nome)} className="px-2.5 py-1 text-[10px] font-bold bg-rose-50 text-rose-700 rounded-lg flex items-center gap-1">
                      <Trash2 size={10} />
                      Remover
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 disabled:opacity-40">
                Anterior
              </button>
              <span className="text-xs text-slate-500 font-semibold">{pagina} / {totalPaginas}</span>
              <button type="button" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 disabled:opacity-40">
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
