import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  History,
  Info,
  Lightbulb,
  Gem,
  Package,
  PauseCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Star,
  Store,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  lookupProdutoShopee,
  salvarBackup,
  listarBackups,
  atualizarBackupsEmLote,
  editarBackupMeta,
  buscarSimilaresDaLoja,
  buscarSimilaresShopApi,
  getHistoricoProduto,
  atualizarGrupoBackup,
  salvarBackupComGrupo,
  salvarEVincularBackupAoGrupo,
  criarGrupo,
  listarGrupos,
  adicionarBackupAoGrupo,
  removerBackupDoGrupo,
  trocarPrincipal,
  removerGrupo,
  carregarGrupoComProdutos,
  carregarGruposComProdutos,
} from "../repositories/backupRepository";
import { fmt, fmtNum } from "../../../utils/formatters";
import BackupToast from "../components/backup/BackupToast";
import BackupConfirmDialog from "../components/backup/BackupConfirmDialog";
import LoadingSpinner from "../../../components/layout/LoadingSpinner";
import SugestoesRoboGarimpo from "../components/backup/SugestoesRoboGarimpo";
import BackupGarimpoConfigTab from "../components/backup/BackupGarimpoConfigTab";
import { analisarOportunidadesGrupo } from "../utils/backupInsights";
import { categoriaProduto, enriquecerGrupoComHistorico } from "../utils/backupGrupoUtils";

const BackupListagemTab = lazy(() => import("../components/backup/BackupListagemTab"));
const BackupGarimpoHistoricoTab = lazy(() => import("../components/backup/BackupGarimpoHistoricoTab"));
const BackupRadarRecompraTab = lazy(() => import("../components/backup/BackupRadarRecompraTab"));

function BackupTabFallback({ label = "Carregando…" }) {
  return <LoadingSpinner label={label} className="py-10" />;
}

function formatTempoAtras(date) {
  if (!date) return "—";
  const passado = Date.now() - date.getTime();
  const min = Math.floor(passado / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function formatPeriodoComissao(periodoFim) {
  if (!periodoFim) return null;
  const agora = Math.floor(Date.now() / 1000);
  const diff = periodoFim - agora;
  if (diff < 0) return { texto: "ENCERRADO", critico: true };
  const dias = Math.floor(diff / 86400);
  if (dias < 7) return { texto: `Termina em ${dias} dia(s)`, critico: true };
  if (dias < 30) return { texto: `Termina em ${dias} dias`, critico: false };
  return { texto: `Válido por ${dias} dias`, critico: false };
}

function vereditoAutomatico(produto, historico) {
  if (produto.comissao_pct === 0) {
    return {
      nivel: "ruim",
      texto: "Não compensa — comissão 0%",
      detalhes: "Produto saiu do programa de afiliados. Procure alternativa.",
    };
  }

  const comissaoR$ = (produto.preco * produto.comissao_pct) / 100;

  if (comissaoR$ < 1) {
    return {
      nivel: "ruim",
      texto: `Comissão muito baixa — apenas R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Não compensa investir tráfego pago. CPC médio Meta é R$ 0,10-0,30 e taxa de conversão típica é 1-3%.",
    };
  }

  if (historico?.ja_vendeu && historico.comissao_total_minha > 50) {
    return {
      nivel: "bom",
      texto: `Histórico positivo — você já ganhou ${fmt(historico.comissao_total_minha)}`,
      detalhes: `Vendeu ${historico.vendas_minhas} vezes esse produto. Continua promovendo.`,
    };
  }

  if (historico?.ja_vendeu && historico.comissao_pct_quando_vendi > 0
      && produto.comissao_pct > historico.comissao_pct_quando_vendi * 1.5) {
    return {
      nivel: "bom",
      texto: "Oportunidade — comissão subiu",
      detalhes: `Comissão subiu de ${historico.comissao_pct_quando_vendi}% para ${produto.comissao_pct}% desde que você vendeu.`,
    };
  }

  if (comissaoR$ >= 3) {
    return {
      nivel: "bom",
      texto: `Comissão decente — R$ ${comissaoR$.toFixed(2)} por venda`,
      detalhes: "Vale testar com pequeno orçamento.",
    };
  }

  return {
    nivel: "atencao",
    texto: `Comissão moderada — R$ ${comissaoR$.toFixed(2)} por venda`,
    detalhes: "Avaliar concorrência e CPC do nicho antes de promover.",
  };
}

function ProdutoCard({ produto, historico, onSalvar, jaSalvoComoBackup }) {
  const [apelido, setApelido] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const veredito = vereditoAutomatico(produto, historico);
  const periodoInfo = formatPeriodoComissao(produto.periodoFim);
  const comissaoR$ = (produto.preco * produto.comissao_pct) / 100;

  const handleSalvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(produto, { apelido });
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setSalvando(false);
    }
  };

  const vereditoStyle = {
    bom: "bg-green-50 border-green-200 text-green-800",
    atencao: "bg-orange-50 border-orange-200 text-orange-800",
    ruim: "bg-red-50 border-red-200 text-red-800",
  };

  const VereditoIcon = veredito.nivel === "bom"
    ? CheckCircle2
    : veredito.nivel === "atencao"
      ? Lightbulb
      : AlertTriangle;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        {produto.imagem && (
          <img
            src={produto.imagem}
            alt={produto.nome}
            className="w-full sm:w-24 h-40 sm:h-24 object-cover rounded border border-gray-200 flex-shrink-0"
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-800 truncate">{produto.nome}</div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            <Store size={12} className="text-gray-400" />
            <span>{produto.loja}</span>
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Star size={12} className="text-gray-400" />
              {produto.rating}
            </span>
            <span>{fmtNum(produto.vendas_shopee)} vendas Shopee</span>
          </div>

          <div className="mt-2 flex gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Preço</div>
              <div className="font-bold text-gray-900">{fmt(produto.preco)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Comissão</div>
              <div className="font-bold text-blue-700">
                {produto.comissao_pct}% ({fmt(comissaoR$)})
              </div>
            </div>
          </div>
        </div>
      </div>

      {periodoInfo && (
        <div className={`mt-3 p-2 rounded text-xs flex items-start gap-2 ${periodoInfo.critico ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-600"}`}>
          <Clock size={14} className="shrink-0 mt-0.5" />
          <span>{periodoInfo.texto}</span>
        </div>
      )}

      {historico?.ja_vendeu && (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
          <div className="font-semibold text-blue-900 mb-1 flex items-center gap-2">
            <BarChart3 size={14} />
            <span>Sua performance histórica:</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-blue-800">
            <div>• Vendas: <strong>{historico.vendas_minhas}</strong></div>
            <div>• Comissão: <strong>{fmt(historico.comissao_total_minha)}</strong></div>
            <div>• GMV: <strong>{fmt(historico.gmv_total_meu)}</strong></div>
          </div>
          {historico.preco_quando_vendi > 0 && historico.preco_quando_vendi !== produto.preco && (
            <div className="text-blue-700 mt-1">
              Preço quando vendeu: {fmt(historico.preco_quando_vendi)} → agora {fmt(produto.preco)}
            </div>
          )}
        </div>
      )}
      {historico && !historico.ja_vendeu && (
        <div className="mt-3 p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600 flex items-start gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>Você nunca vendeu esse produto antes.</span>
        </div>
      )}

      <div className={`mt-3 p-3 border rounded ${vereditoStyle[veredito.nivel]}`}>
        <div className="font-semibold text-sm flex items-center gap-2">
          <VereditoIcon size={14} />
          <span>{veredito.texto}</span>
        </div>
        <div className="text-xs mt-1">{veredito.detalhes}</div>
      </div>

      {!jaSalvoComoBackup ? (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            placeholder="Apelido (opcional)"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            className="flex-1 text-sm px-2 py-2 sm:py-1.5 border border-gray-300 rounded"
            disabled={salvando}
          />
          <button
            type="button"
            onClick={handleSalvar}
            disabled={salvando}
            className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            <span className="inline-flex items-center gap-2">
              <Save size={14} />
              <span>{salvando ? "Salvando..." : "Salvar"}</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={14} />
          <span>Já está nos seus backups.</span>
        </div>
      )}

      {erro && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {erro}
        </div>
      )}
    </div>
  );
}

function AbaCadastrar({ onCadastrado }) {
  const [url, setUrl] = useState("");
  const [resultado, setResultado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  const handleBuscar = async () => {
    if (!url.trim()) {
      setErro("Cole um link Shopee");
      return;
    }
    setLoading(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await lookupProdutoShopee(url.trim());
      if (!res.success) {
        setErro(res.error || "Erro desconhecido");
      } else {
        setResultado(res);
      }
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSalvar = async (produto, opcoes) => {
    const { sugestao } = await salvarBackupComGrupo(produto, opcoes);
    if (sugestao && window.confirm(
      `Salvo! Existe o grupo "${sugestao.nome}" (${sugestao.principalNome}). Adicionar a esse grupo?`,
    )) {
      await adicionarBackupAoGrupo(sugestao.grupoId, produto.itemId);
    }
    if (resultado) {
      setResultado({ ...resultado, jaSalvoComoBackup: true });
    }
    if (onCadastrado) onCadastrado();
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Cole o link Shopee:
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://shopee.com.br/product/420243547/10011438006"
            className="flex-1 px-3 py-2.5 sm:py-2 border border-gray-300 rounded text-sm"
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
          />
          <button
            type="button"
            onClick={handleBuscar}
            disabled={loading}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300 shrink-0"
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 text-amber-600 mt-0.5" />
          <span>Não suporta links curtos (s.shopee.com.br). Cole o link completo da página do produto.</span>
        </p>
      </div>

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {erro}
        </div>
      )}

      {resultado && (
        <ProdutoCard
          produto={resultado.produto}
          historico={resultado.historico}
          onSalvar={handleSalvar}
          jaSalvoComoBackup={resultado.jaSalvoComoBackup}
        />
      )}
    </div>
  );
}

function AbaSimilar({ backups }) {
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const [similares, setSimilares] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleBuscar = async (b) => {
    setProdutoSelecionado(b);
    setLoading(true);
    try {
      let lista = [];
      if (b.shopId) {
        lista = await buscarSimilaresShopApi(b.shopId, b.itemId);
      }
      if (!lista.length && b.loja) {
        lista = await buscarSimilaresDaLoja(b.loja, b.itemId);
      }
      setSimilares(lista);
    } catch (err) {
      console.error("Erro buscando similares:", err);
      setSimilares([]);
    } finally {
      setLoading(false);
    }
  };

  if (backups.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded border border-gray-200">
        <div className="flex justify-center mb-2">
          <Search size={32} className="text-gray-400" />
        </div>
        <div className="text-gray-700 font-medium">Cadastre produtos primeiro</div>
        <div className="text-sm text-gray-500 mt-1">Você precisa ter backups cadastrados pra buscar similares.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Escolha um produto principal:
        </label>
        <select
          onChange={(e) => {
            const b = backups.find((x) => x.itemId === e.target.value);
            if (b) handleBuscar(b);
          }}
          value={produtoSelecionado?.itemId || ""}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        >
          <option value="">— Selecione —</option>
          {backups.map((b) => (
            <option key={b.docId} value={b.itemId}>
              {b.apelido || b.nome} ({b.loja})
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="text-center py-6 text-gray-500">Buscando similares...</div>}

      {produtoSelecionado && !loading && similares.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded text-gray-600">
          Nenhum produto similar da loja "{produtoSelecionado.loja}" encontrado no seu histórico de vendas.
        </div>
      )}

      {!loading && similares.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600 mb-2">
            {similares.length} alternativas da loja <strong>{produtoSelecionado.loja}</strong> (API Shopee + histórico):
          </div>
          {similares.map((s) => (
            <div key={s.itemId || s.docId} className="bg-white border border-gray-200 rounded p-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 line-clamp-2 sm:truncate">{s.nome}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {fmt(s.preco)} · {Number(s.comissao_pct || 0).toFixed(1)}%
                  {s.is_mall && <span className="ml-1 text-red-600">Mall</span>}
                  {" · "}{fmt(s.comissao_total || (s.preco * (s.comissao_pct || 0)) / 100)} comissão
                  {" · "}{fmtNum(s.vendas)} vendas
                  {s.rating > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-600">
                      {" · "}
                      <Star size={10} className="fill-current shrink-0" />
                      {Number(s.rating).toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
              <a
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto text-center sm:ml-3 px-3 py-2 sm:py-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 rounded flex-shrink-0"
              >
                <span className="inline-flex items-center gap-0.5">
                  Ver <ChevronRight size={12} />
                </span>
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AbaGrupos({ refreshTrigger, onChange, showToast, askConfirm }) {
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grupoExpandido, setGrupoExpandido] = useState(null);
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [modalAdicionar, setModalAdicionar] = useState(null);
  const [modalTrocar, setModalTrocar] = useState(null);
  const [rotatePreselect, setRotatePreselect] = useState("");
  const [criterio, setCriterio] = useState("comissao");
  const [refreshingGrupoId, setRefreshingGrupoId] = useState(null);
  const [buscaGrupo, setBuscaGrupo] = useState("");
  const [filtroCategoriaGrupo, setFiltroCategoriaGrupo] = useState("todas");

  const carregar = async () => {
    setLoading(true);
    try {
      const lista = await listarGrupos();
      const comProdutos = await carregarGruposComProdutos(lista);
      const completos = await Promise.all(
        comProdutos.map((g) => enriquecerGrupoComHistorico(g)),
      );
      setGrupos(completos);
    } catch (err) {
      console.error("Erro carregando grupos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [refreshTrigger]);

  const categoriasDeGrupos = useMemo(() => {
    const set = new Set();
    grupos.forEach((g) => {
      const p = g.produtos?.[g.principalItemId];
      if (p) set.add(categoriaProduto(p));
    });
    return ["todas", ...Array.from(set)];
  }, [grupos]);

  const gruposFiltrados = useMemo(() => {
    let result = [...grupos];
    const termo = buscaGrupo.trim().toLowerCase();
    if (termo) {
      result = result.filter((g) => {
        const principal = g.produtos?.[g.principalItemId];
        return (
          (g.nome || "").toLowerCase().includes(termo)
          || (principal?.nome || "").toLowerCase().includes(termo)
          || (principal?.apelido || "").toLowerCase().includes(termo)
        );
      });
    }
    if (filtroCategoriaGrupo !== "todas") {
      result = result.filter((g) => {
        const principal = g.produtos?.[g.principalItemId];
        return principal && categoriaProduto(principal) === filtroCategoriaGrupo;
      });
    }
    return result;
  }, [grupos, buscaGrupo, filtroCategoriaGrupo]);

  if (loading) {
    return <div className="text-center py-8 text-slate-500 text-sm">Carregando grupos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-3 text-slate-400" size={14} />
          <input
            type="text"
            value={buscaGrupo}
            onChange={(e) => setBuscaGrupo(e.target.value)}
            placeholder="Pesquisar por nicho, nome do grupo ou produto principal..."
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-orange-500 font-semibold"
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
          <span className="text-xs font-bold text-slate-500 hidden sm:inline">Nicho:</span>
          <select
            value={filtroCategoriaGrupo}
            onChange={(e) => setFiltroCategoriaGrupo(e.target.value)}
            className="flex-1 md:flex-none px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-bold bg-white uppercase"
          >
            <option value="todas">Todos os nichos</option>
            {categoriasDeGrupos.filter((c) => c !== "todas").map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCriandoGrupo(true)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shrink-0"
          >
            <Plus size={14} />
            Criar grupo
          </button>
        </div>
      </div>

      {gruposFiltrados.length === 0 && !criandoGrupo && (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <Archive size={36} className="mx-auto text-slate-300 mb-2" />
          <p className="text-slate-600 text-xs font-bold">Nenhum grupo encontrado</p>
          <p className="text-slate-400 text-[11px] mt-1">Ajuste os filtros ou crie um novo agrupamento.</p>
        </div>
      )}

      {criandoGrupo && (
        <ModalCriarGrupo
          onClose={() => setCriandoGrupo(false)}
          onCriado={async () => {
            setCriandoGrupo(false);
            await carregar();
            if (onChange) onChange();
            showToast?.("Grupo criado com sucesso.", "sucesso");
          }}
        />
      )}

      {gruposFiltrados.map((grupo) => (
        <CardGrupo
          key={grupo.docId}
          grupo={grupo}
          expandido={grupoExpandido === grupo.docId}
          criterio={criterio}
          onCriterioChange={setCriterio}
          onToggleExpand={() => setGrupoExpandido(grupoExpandido === grupo.docId ? null : grupo.docId)}
          onAdicionarBackup={() => setModalAdicionar(grupo.docId)}
          onTrocarPrincipal={() => {
            setRotatePreselect("");
            setModalTrocar({ grupoId: grupo.docId, principalAtual: grupo.principalItemId });
          }}
          onRotacionarInsight={(itemId) => {
            setRotatePreselect(itemId);
            setGrupoExpandido(grupo.docId);
            setModalTrocar({ grupoId: grupo.docId, principalAtual: grupo.principalItemId });
          }}
          onRemoverBackup={async (itemId) => {
            const ok = await askConfirm?.("Remover do grupo", "Remover este backup do grupo?");
            if (!ok) return;
            await removerBackupDoGrupo(grupo.docId, itemId);
            await carregar();
            if (onChange) onChange();
            showToast?.("Backup removido do grupo.", "sucesso");
          }}
          onRemoverGrupo={async () => {
            const ok = await askConfirm?.(
              "Remover grupo",
              `Remover o grupo "${grupo.nome}"? Os produtos não serão deletados.`,
            );
            if (!ok) return;
            await removerGrupo(grupo.docId);
            await carregar();
            if (onChange) onChange();
            showToast?.("Grupo removido.", "sucesso");
          }}
          refreshingGrupo={refreshingGrupoId === grupo.docId}
          onRefreshGrupo={async () => {
            setRefreshingGrupoId(grupo.docId);
            try {
              await atualizarGrupoBackup(grupo.docId);
              await carregar();
              if (onChange) onChange();
            } catch (err) {
              alert(err?.message || String(err));
            } finally {
              setRefreshingGrupoId(null);
            }
          }}
          showToast={showToast}
          onAddBackupToGrupo={async (grupoId, produto) => {
            await salvarEVincularBackupAoGrupo(grupoId, produto);
            await carregar();
            if (onChange) onChange();
          }}
        />
      ))}

      {modalAdicionar && (
        <ModalAdicionarBackup
          grupoId={modalAdicionar}
          onClose={() => setModalAdicionar(null)}
          onAdicionado={async () => {
            setModalAdicionar(null);
            await carregar();
            if (onChange) onChange();
          }}
        />
      )}

      {modalTrocar && (
        <ModalTrocarPrincipal
          grupo={grupos.find((g) => g.docId === modalTrocar.grupoId)}
          criterio={criterio}
          preselectItemId={rotatePreselect}
          onClose={() => { setModalTrocar(null); setRotatePreselect(""); }}
          onTrocado={async () => {
            setModalTrocar(null);
            setRotatePreselect("");
            await carregar();
            if (onChange) onChange();
            showToast?.("Principal trocado com sucesso.", "sucesso");
          }}
        />
      )}
    </div>
  );
}

function ModalCriarGrupo({ onClose, onCriado }) {
  const [nome, setNome] = useState("");
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [buscaModal, setBuscaModal] = useState("");
  const [principalSelecionado, setPrincipalSelecionado] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    listarBackups().then((lista) => {
      const livres = lista.filter((b) => !b.grupoId);
      setBackupsDisponiveis(livres);
    });
  }, []);

  const backupsFiltrados = useMemo(() => {
    const t = buscaModal.trim().toLowerCase();
    if (!t) return backupsDisponiveis;
    return backupsDisponiveis.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
  }, [backupsDisponiveis, buscaModal]);

  const handleCriar = async () => {
    setLoading(true);
    setErro(null);
    try {
      await criarGrupo(nome, principalSelecionado);
      onCriado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-lg max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
            <Target size={16} />
            <span>Criar grupo de backup</span>
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Fechar"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do grupo:</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Estilete 6 Lâminas"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Produto principal:</label>
            {backupsFiltrados.length === 0 && backupsDisponiveis.length > 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Nenhum resultado pra "{buscaModal}"</p>
            ) : backupsDisponiveis.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                Nenhum produto livre disponível. Cadastre primeiro na aba "Cadastrar".
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={buscaModal}
                  onChange={(e) => setBuscaModal(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full px-3 py-2 mb-3 border border-gray-300 rounded-md text-sm"
                />
                <select
                  value={principalSelecionado}
                  onChange={(e) => setPrincipalSelecionado(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  disabled={loading}
                >
                  <option value="">— Selecione o principal —</option>
                  {backupsFiltrados.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.apelido || b.nome} — {b.loja}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {erro && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {erro}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCriar}
              disabled={loading || !nome.trim() || !principalSelecionado}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {loading ? "Criando..." : "Criar grupo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalAdicionarBackup({ grupoId, onClose, onAdicionado }) {
  const [modo, setModo] = useState("link");
  const [url, setUrl] = useState("");
  const [produtoEncontrado, setProdutoEncontrado] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [backupsDisponiveis, setBackupsDisponiveis] = useState([]);
  const [buscaModalAdd, setBuscaModalAdd] = useState("");
  const [existenteSelecionado, setExistenteSelecionado] = useState("");

  useEffect(() => {
    listarBackups().then((lista) => {
      const livres = lista.filter((b) => !b.grupoId);
      setBackupsDisponiveis(livres);
    });
  }, []);

  const backupsFiltradosAdd = useMemo(() => {
    const t = buscaModalAdd.trim().toLowerCase();
    if (!t) return backupsDisponiveis;
    return backupsDisponiveis.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
  }, [backupsDisponiveis, buscaModalAdd]);

  const handleBuscarLink = async () => {
    setLoading(true);
    setErro(null);
    setProdutoEncontrado(null);
    try {
      const res = await lookupProdutoShopee(url.trim());
      if (!res.success) {
        setErro(res.error || "Erro desconhecido");
        return;
      }

      if (res.jaSalvoComoBackup) {
        const backups = await listarBackups();
        const existente = backups.find((b) => b.itemId === res.produto.itemId);
        if (existente?.grupoId && existente.grupoId !== grupoId) {
          setErro(`Este produto já está no grupo "${existente.grupoId}". Remova de lá primeiro pra adicionar aqui.`);
          return;
        }
      }

      setProdutoEncontrado(res);
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmarLink = async () => {
    if (!produtoEncontrado) return;
    setLoading(true);
    setErro(null);
    try {
      if (!produtoEncontrado.jaSalvoComoBackup) {
        await salvarBackup(produtoEncontrado.produto, {});
      }
      await adicionarBackupAoGrupo(grupoId, produtoEncontrado.produto.itemId);
      onAdicionado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAdicionarExistente = async () => {
    if (!existenteSelecionado) return;
    setLoading(true);
    setErro(null);
    try {
      await adicionarBackupAoGrupo(grupoId, existenteSelecionado);
      onAdicionado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-lg max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 text-sm sm:text-base">+ Adicionar backup ao grupo</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Fechar"><X size={16} /></button>
        </div>

        <div className="flex gap-1 mb-3 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setModo("link")}
            className={`px-3 py-1.5 text-sm ${modo === "link" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}
          >
            Colar link
          </button>
          <button
            type="button"
            onClick={() => setModo("existente")}
            className={`px-3 py-1.5 text-sm ${modo === "existente" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-600"}`}
          >
            Produto já cadastrado
          </button>
        </div>

        {modo === "link" && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://shopee.com.br/product/..."
                className="flex-1 px-3 py-2.5 sm:py-2 border border-gray-300 rounded text-sm"
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleBuscarLink}
                disabled={loading || !url.trim()}
                className="w-full sm:w-auto px-3 py-2.5 sm:py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300 shrink-0"
              >
                {loading ? "..." : "Buscar"}
              </button>
            </div>

            {produtoEncontrado && (
              <div className="p-3 border border-gray-200 rounded">
                <div className="flex gap-3">
                  {produtoEncontrado.produto.imagem && (
                    <img src={produtoEncontrado.produto.imagem} alt="" className="w-16 h-16 object-cover rounded" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{produtoEncontrado.produto.nome}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Store size={12} className="text-gray-400" />
                      <span>{produtoEncontrado.produto.loja}</span>
                    </div>
                    <div className="text-xs mt-1">
                      {fmt(produtoEncontrado.produto.preco)} · {produtoEncontrado.produto.comissao_pct}%
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleConfirmarLink}
                  disabled={loading}
                  className="mt-3 w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? "Adicionando..." : "Adicionar ao grupo"}
                </button>
              </div>
            )}
          </div>
        )}

        {modo === "existente" && (
          <div className="space-y-3">
            {backupsDisponiveis.length === 0 ? (
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded">
                Nenhum produto livre. Cadastre primeiro na aba "Cadastrar" ou use a aba "Colar Link".
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={buscaModalAdd}
                  onChange={(e) => setBuscaModalAdd(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full px-3 py-2 mb-3 border border-gray-300 rounded-md text-sm"
                />
                {backupsFiltradosAdd.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhum resultado pra "{buscaModalAdd}"</p>
                ) : (
                <select
                  value={existenteSelecionado}
                  onChange={(e) => setExistenteSelecionado(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">— Selecione um produto —</option>
                  {backupsFiltradosAdd.map((b) => (
                    <option key={b.itemId} value={b.itemId}>
                      {b.apelido || b.nome} — {b.loja}
                    </option>
                  ))}
                </select>
                )}
                <button
                  type="button"
                  onClick={handleAdicionarExistente}
                  disabled={loading || !existenteSelecionado}
                  className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading ? "Adicionando..." : "Adicionar ao grupo"}
                </button>
              </>
            )}
          </div>
        )}

        {erro && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {erro}
          </div>
        )}
      </div>
    </div>
  );
}

function ModalTrocarPrincipal({ grupo, criterio, preselectItemId, onClose, onTrocado }) {
  const [motivo, setMotivo] = useState("sem_estoque");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [novoSelecionado, setNovoSelecionado] = useState(preselectItemId || "");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (preselectItemId) setNovoSelecionado(preselectItemId);
  }, [preselectItemId, grupo?.docId]);

  if (!grupo) return null;

  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") {
      const aR = (Number(a.preco || 0) * Number(a.comissao_pct || 0)) / 100;
      const bR = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
      return bR - aR;
    }
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

  const recomendado = backupsOrdenados[0];

  const handleTrocar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const motivoFinal = motivo === "outro" ? motivoTexto : motivo.replace(/_/g, " ");
      await trocarPrincipal(grupo.docId, novoSelecionado, motivoFinal);
      onTrocado();
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-lg max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 text-sm sm:text-base">Pausar principal e trocar</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Fechar"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo:</label>
            <div className="space-y-1">
              {[
                ["sem_estoque", "Sem estoque"],
                ["comissao_baixa", "Comissão muito baixa"],
                ["preco_alto", "Preço subiu demais"],
                ["link_quebrado", "Link quebrado"],
                ["outro", "Outro"],
              ].map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="motivo"
                    value={id}
                    checked={motivo === id}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {motivo === "outro" && (
              <input
                type="text"
                value={motivoTexto}
                onChange={(e) => setMotivoTexto(e.target.value)}
                placeholder="Descreva o motivo"
                className="mt-2 w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            )}
          </div>

          {recomendado && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
              <div className="inline-flex items-center gap-2">
                <Lightbulb size={14} className="text-yellow-700" />
                <strong>Recomendado:</strong>
                <span>{recomendado.apelido || recomendado.nome} ({recomendado.loja})</span>
              </div>
              <div className="text-xs text-yellow-700 mt-1">
                Ordenado por: {criterio === "comissao" ? "comissão (R$)" : criterio === "rating" ? "rating" : "vendas Shopee"}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Escolha o novo principal:</label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {backupsOrdenados.map((b, idx) => {
                const comissaoR$ = (Number(b.preco || 0) * Number(b.comissao_pct || 0)) / 100;
                return (
                  <label key={b.itemId} className="flex items-start gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="novoPrincipal"
                      value={b.itemId}
                      checked={novoSelecionado === b.itemId}
                      onChange={(e) => setNovoSelecionado(e.target.value)}
                      className="mt-0.5"
                    />
                    {b.imagem && <img src={b.imagem} alt="" className="w-12 h-12 object-cover rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.apelido || b.nome}
                      {idx === 0 && <span className="ml-2 text-xs text-green-700 font-semibold">Recomendado</span>}
                      </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Store size={12} className="text-gray-400" />
                      <span>{b.loja}</span>
                    </div>
                    <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{fmt(b.preco)} · {b.comissao_pct}% ({fmt(comissaoR$)})</span>
                      <span className="inline-flex items-center gap-1">
                        <Star size={12} className="text-gray-400" />
                        <span>{b.rating || "—"}</span>
                      </span>
                    </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {erro && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {erro}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTrocar}
              disabled={loading || !novoSelecionado || (motivo === "outro" && !motivoTexto.trim())}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300"
            >
              {loading ? "Trocando..." : "Confirmar troca"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardGrupo({ grupo, expandido, criterio, onCriterioChange, onToggleExpand, onAdicionarBackup, onTrocarPrincipal, onRotacionarInsight, onRemoverBackup, onRemoverGrupo, onRefreshGrupo, refreshingGrupo, showToast, onAddBackupToGrupo }) {
  const principal = grupo.produtos[grupo.principalItemId];
  const backups = (grupo.backupItemIds || [])
    .map((id) => grupo.produtos[id])
    .filter(Boolean);

  const comissaoR$Do = (p) => (Number(p?.preco || 0) * Number(p?.comissao_pct || 0)) / 100;

  const fmtPct = (n) => {
    const num = Number(n || 0);
    if (Number.isInteger(num)) return `${num}%`;
    return `${num.toFixed(1)}%`;
  };

  const backupsOrdenados = [...backups].sort((a, b) => {
    if (criterio === "comissao") return comissaoR$Do(b) - comissaoR$Do(a);
    if (criterio === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (criterio === "vendas") return Number(b.vendas_shopee || 0) - Number(a.vendas_shopee || 0);
    return 0;
  });

  const calcularSugestao = () => {
    if (!principal || backupsOrdenados.length === 0) return null;
    const melhor = backupsOrdenados[0];
    if (!melhor) return null;
    if (criterio === "comissao") {
      const cP = comissaoR$Do(principal);
      const cB = comissaoR$Do(melhor);
      if (cB > cP) {
        const diff = cB - cP;
        const pct = cP > 0 ? ((cB - cP) / cP) * 100 : 100;
        return {
          melhor,
          motivo: `Comissão R$ ${diff.toFixed(2)} maior por venda (+${pct.toFixed(0)}%)`,
          detalhe: `Principal: ${fmt(cP)} · Backup: ${fmt(cB)}`,
        };
      }
    }
    if (criterio === "rating") {
      const rP = Number(principal.rating || 0);
      const rB = Number(melhor.rating || 0);
      if (rB > rP) return { melhor, motivo: `Rating melhor (${rB.toFixed(1)} vs ${rP.toFixed(1)})`, detalhe: "Produtos com melhor avaliação convertem mais." };
    }
    if (criterio === "vendas") {
      const vP = Number(principal.vendas_shopee || 0);
      const vB = Number(melhor.vendas_shopee || 0);
      if (vB > vP) return { melhor, motivo: `Mais vendido (${vB} vs ${vP} vendas Shopee)`, detalhe: "Produtos com mais histórico tendem a converter melhor." };
    }
    return null;
  };

  const sugestao = calcularSugestao();
  const backupsReserva = (grupo.backupItemIds || []).map((id) => grupo.produtos[id]).filter(Boolean);
  const insights = principal ? analisarOportunidadesGrupo(principal, backupsReserva) : null;

  const ProdutoCardShopee = ({ produto, badge, badgeColor = "#3b82f6", isPrincipal = false }) => {
    const comissaoR$ = comissaoR$Do(produto);
    const handleCopiarLink = () => {
      const link = produto.linkAfiliado || produto.linkProduto || "";
      if (link) {
        navigator.clipboard.writeText(link).then(() => alert("Link copiado!"));
      } else {
        alert("Nenhum link disponível para este produto.");
      }
    };

    return (
      <div
        className={`bg-white rounded-lg overflow-hidden relative flex flex-col h-full box-border ${
          isPrincipal ? "border-2 border-orange-500" : "border border-gray-200"
        }`}
      >
        <div
          className="absolute top-0 left-0 text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-br-md z-10"
          style={{ background: badgeColor }}
        >
          {badge}
        </div>

        <div className="relative pt-[100%] bg-gray-100">
          {produto.imagem ? (
            <img
              src={produto.imagem}
              alt={produto.nome}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <Package size={28} strokeWidth={1.25} />
            </div>
          )}
        </div>

        <div className="p-2 flex-1 flex flex-col gap-1">
          <p className="text-[11px] text-gray-900 m-0 leading-snug line-clamp-2 min-h-[30px]">
            {produto.apelido || produto.nome}
          </p>

          <p className="text-[13px] font-bold text-[#ee4d2d] m-0">
            {fmt(produto.preco)}
          </p>

          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] bg-[#fff0eb] text-[#ee4d2d] px-1.5 py-0.5 rounded font-semibold">
              {fmtPct(produto.comissao_pct)} comissão
            </span>
            {comissaoR$ > 0 && (
              <span className="text-[10px] text-green-600 font-semibold">
                +{fmt(comissaoR$)}
              </span>
            )}
          </div>

          {produto.vendas_shopee > 0 && (
            <p className="text-[10px] text-gray-500 m-0">
              {fmtNum(produto.vendas_shopee)} vendidos
            </p>
          )}

          {produto.rating > 0 && (
            <p className="text-[10px] text-amber-500 m-0 flex items-center gap-0.5">
              {Array.from({ length: 5 }, (_, i) => {
                const filled = i < Math.round(Number(produto.rating || 0));
                return (
                  <Star
                    key={i}
                    size={10}
                    className={filled ? "text-amber-500 fill-amber-500" : "text-gray-300"}
                  />
                );
              })}
              <span className="ml-0.5">{Number(produto.rating).toFixed(1)}</span>
            </p>
          )}

          <div className="flex gap-1 mt-auto pt-1">
            <button
              type="button"
              onClick={handleCopiarLink}
              className={`flex-1 text-[11px] py-1.5 px-1 rounded font-medium text-white border-0 cursor-pointer ${
                isPrincipal ? "bg-[#ee4d2d] hover:bg-[#d73211]" : "bg-gray-900 hover:bg-gray-800"
              }`}
            >
              Obter link
            </button>
            <button
              type="button"
              onClick={() => onRemoverBackup(produto.itemId)}
              className="px-2 py-1.5 bg-transparent border border-gray-200 rounded cursor-pointer text-red-500"
              title="Remover"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {isPrincipal && (
            <button
              type="button"
              onClick={onTrocarPrincipal}
              disabled={backups.length === 0}
              className="w-full text-[10px] py-1 border border-orange-500 text-orange-500 rounded bg-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-orange-50"
            >
              <span className="inline-flex items-center justify-center gap-1">
                <PauseCircle size={12} />
                Pausar e trocar
              </span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-slate-300 overflow-hidden transition-all">
      <div className="p-4 sm:p-5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div
          className="flex flex-1 items-center gap-4 cursor-pointer min-w-0"
          onClick={onToggleExpand}
          onKeyDown={(e) => e.key === "Enter" && onToggleExpand()}
          role="button"
          tabIndex={0}
        >
          <div className="relative shrink-0">
            {principal?.imagem ? (
              <img
                src={principal.imagem}
                alt={principal.nome || "Produto principal"}
                className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl border border-slate-200 shadow-sm"
              />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400">
                <Package size={28} />
              </div>
            )}
            <span className="absolute -bottom-1 -right-1 bg-orange-600 text-white font-extrabold text-[8px] px-1 py-0.5 rounded-md border border-white max-w-[4.5rem] truncate uppercase">
              {categoriaProduto(principal)}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Target className="text-orange-500 shrink-0" size={16} />
              <h4 className="font-extrabold text-slate-900 text-sm sm:text-base truncate">{grupo.nome}</h4>
            </div>
            <div className="text-xs text-slate-500 mt-1 font-semibold flex flex-wrap items-center gap-1.5">
              <span>
                Link ativo:{" "}
                <strong className="text-orange-600">
                  {principal ? (principal.apelido || principal.nome?.substring(0, 35)) : "—"}
                </strong>
              </span>
              <span className="text-slate-300 hidden sm:inline">•</span>
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg text-[10px] font-extrabold">
                {backups.length} reserva(s)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-2">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                Lucro histórico:{" "}
                <span className="text-emerald-600 font-extrabold text-xs ml-0.5">
                  {fmt(grupo.lucro_historico || 0)}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                GMV:{" "}
                <span className="text-slate-800 font-extrabold text-xs ml-0.5">
                  {fmt(grupo.gmv_historico || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-start md:justify-end shrink-0 w-full md:w-auto">
          {insights && (
            <div className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Lightbulb size={11} className="text-amber-700" />
              {insights.length} alerta{insights.length !== 1 ? "s" : ""}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdicionarBackup(); }}
            className="flex-1 sm:flex-none text-xs bg-orange-50 hover:bg-orange-100 border border-orange-200/50 text-orange-600 font-extrabold px-3 py-1.5 rounded-xl text-center"
          >
            + Vincular backup
          </button>
          {onRefreshGrupo && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRefreshGrupo(); }}
              disabled={refreshingGrupo}
              className="p-2 text-slate-400 hover:text-blue-600 rounded-xl disabled:opacity-50"
              title="Atualizar grupo"
            >
              <RefreshCw size={16} className={refreshingGrupo ? "animate-spin" : ""} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemoverGrupo(); }}
            className="p-2 text-slate-400 hover:text-rose-600 rounded-xl"
            title="Remover grupo"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            className="p-1 text-slate-400 hover:text-slate-800"
            aria-label={expandido ? "Recolher" : "Expandir"}
          >
            {expandido ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
          </button>
        </div>
      </div>

      {expandido && (
        <div className="bg-slate-50/50 border-t border-slate-100 p-4 sm:p-5 space-y-4">
          {principal && onAddBackupToGrupo && (
            <SugestoesRoboGarimpo
              produtoPrincipal={principal}
              grupoId={grupo.docId}
              excludeItemIds={grupo.backupItemIds || []}
              onAddBackupToGrupo={onAddBackupToGrupo}
              showToast={showToast}
            />
          )}

          {insights && (
            <div className="mb-3 p-4 bg-gradient-to-br from-amber-50 to-orange-50/50 border border-amber-200 rounded-2xl space-y-3">
              <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs uppercase">
                <Lightbulb size={14} className="text-amber-600" />
                Contingência Advisor
              </div>
              {insights.map((ins, insIdx) => (
                <div key={insIdx} className="bg-white border border-amber-200/60 p-3 rounded-xl flex flex-col sm:flex-row justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className={`shrink-0 mt-0.5 ${ins.tipo === "critico" ? "text-rose-600" : "text-amber-600"}`} />
                    <div>
                      <div className="font-bold text-slate-900 text-xs">{ins.titulo}</div>
                      <p className="text-slate-600 text-xs mt-1">{ins.mensagem}</p>
                    </div>
                  </div>
                  {ins.backupId && onRotacionarInsight && (
                    <button
                      type="button"
                      onClick={() => onRotacionarInsight(ins.backupId)}
                      className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] rounded-xl shrink-0"
                    >
                      Rotacionar agora
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {sugestao && (
            <div className="mb-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
              <div className="font-semibold text-blue-900 text-sm flex items-center gap-1">
                <Lightbulb size={14} />
                <span>Sugestão</span>
              </div>
              <div className="text-sm text-blue-800 mt-1">
                Trocar por <strong>{sugestao.melhor.apelido || sugestao.melhor.nome}</strong>
              </div>
              <div className="text-xs text-blue-700 mt-1">
                <strong>Motivo:</strong> {sugestao.motivo}
              </div>
              <button
                type="button"
                onClick={onTrocarPrincipal}
                className="mt-2 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
              >
                Trocar agora
              </button>
            </div>
          )}

          {backups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
              <span className="text-gray-600 w-full sm:w-auto">Ordenar por:</span>
              {[
                ["comissao", "Comissão"],
                ["rating", "Rating"],
                ["vendas", "Vendas"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onCriterioChange(id)}
                  className={`px-2 py-0.5 rounded ${criterio === id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 mb-3">
            {principal && (
              <ProdutoCardShopee
                produto={principal}
                badge="Principal"
                badgeColor="#f97316"
                isPrincipal
              />
            )}

            {backupsOrdenados.map((b, idx) => (
              <ProdutoCardShopee
                key={b.itemId}
                produto={b}
                badge={`Backup ${idx + 1}${idx === 0 && sugestao ? " · sugerido" : ""}`}
                badgeColor={idx === 0 && sugestao ? "#16a34a" : "#3b82f6"}
                isPrincipal={false}
              />
            ))}

            <button
              type="button"
              onClick={onAdicionarBackup}
              className="border-2 border-dashed border-gray-300 rounded-lg bg-transparent flex flex-col items-center justify-center gap-1.5 min-h-[180px] sm:min-h-[200px] cursor-pointer text-gray-400 text-xs hover:border-orange-300 hover:text-orange-500 hover:bg-orange-50/30 transition-colors col-span-2 sm:col-span-1"
            >
              <Plus size={20} />
              <span>Adicionar backup</span>
            </button>
          </div>

          {grupo.historico && grupo.historico.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-medium text-gray-700 mb-1">
                <span className="inline-flex items-center gap-1">
                  <History size={12} />
                  Histórico de trocas ({grupo.historico.length})
                </span>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...grupo.historico].reverse().map((h, i) => {
                  const dt = h.data?.toDate?.() || new Date(h.data);
                  return (
                    <div key={i} className="text-xs p-2 bg-gray-50 rounded">
                      <div className="font-medium text-gray-700">{dt.toLocaleString("pt-BR")}</div>
                      <div className="text-gray-600">Motivo: {h.motivo}</div>
                      <div className="text-gray-500">
                        {grupo.produtos[h.principalAntigo]?.loja || "?"} → {grupo.produtos[h.principalNovo]?.loja || "?"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const BACKUP_INITIAL_TAB_KEY = "backup_initial_tab";

const BACKUP_TABS = ["grupos", "cadastrar", "listagem", "similar", "garimpo", "recompra"];

function getInitialBackupTab() {
  try {
    const stored = sessionStorage.getItem(BACKUP_INITIAL_TAB_KEY);
    if (stored && BACKUP_TABS.includes(stored)) {
      sessionStorage.removeItem(BACKUP_INITIAL_TAB_KEY);
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "grupos";
}

export default function BackupPage() {
  const [aba, setAba] = useState(getInitialBackupTab);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [backupsParaAbaSimilar, setBackupsParaAbaSimilar] = useState([]);
  const [backupsCount, setBackupsCount] = useState(0);
  const [gruposCount, setGruposCount] = useState(0);
  const [toast, setToast] = useState(null);
  const [varrendoTudo, setVarrendoTudo] = useState(false);
  const [dialog, setDialog] = useState({
    isOpen: false, titulo: "", mensagem: "", onConfirm: () => {}, onCancel: () => {},
  });

  const showToast = (mensagem, tipo = "info") => setToast({ mensagem, tipo });

  const askConfirm = (titulo, mensagem) => new Promise((resolve) => {
    setDialog({
      isOpen: true,
      titulo,
      mensagem,
      onConfirm: () => { setDialog((d) => ({ ...d, isOpen: false })); resolve(true); },
      onCancel: () => { setDialog((d) => ({ ...d, isOpen: false })); resolve(false); },
    });
  });

  useEffect(() => {
    listarBackups().then((b) => setBackupsCount(b.length)).catch(() => {});
    listarGrupos().then((g) => setGruposCount(g.length)).catch(() => {});
    if (aba === "similar" || aba === "listagem") {
      listarBackups().then(setBackupsParaAbaSimilar).catch(console.error);
    }
  }, [aba, refreshTrigger]);

  const handleCadastrado = () => setRefreshTrigger((x) => x + 1);

  const handleVarrerTodas = async () => {
    const lista = await listarBackups({ force: true });
    if (!lista.length) {
      showToast("Nenhum backup cadastrado.", "aviso");
      return;
    }
    const ok = await askConfirm(
      "Varrer todas as ofertas",
      `Consultar a API Shopee para ${lista.length} produto(s)? Pode levar alguns minutos.`,
    );
    if (!ok) return;
    setVarrendoTudo(true);
    try {
      const results = await atualizarBackupsEmLote(lista.map((b) => b.itemId));
      const sucesso = results.filter((r) => r.ok).length;
      showToast(
        `Varredura concluída: ${sucesso}/${lista.length} atualizados.`,
        sucesso === lista.length ? "sucesso" : "aviso",
      );
      handleCadastrado();
    } catch (err) {
      showToast(err?.message || String(err), "erro");
    } finally {
      setVarrendoTudo(false);
    }
  };

  const tabs = [
    { id: "grupos", label: `Ninhos/Grupos (${gruposCount})`, shortLabel: `Grupos (${gruposCount})`, icon: Target },
    { id: "cadastrar", label: "Cadastrar link", shortLabel: "Cadastrar", icon: Plus },
    { id: "listagem", label: `Meus Backups (${backupsCount})`, shortLabel: `Backups (${backupsCount})`, icon: Archive },
    { id: "garimpo", label: "Garimpo inteligente", shortLabel: "Garimpo", icon: Gem },
    { id: "recompra", label: "Radar de recompra", shortLabel: "Recompra", icon: RefreshCw },
    { id: "similar", label: "Rastrear similares", shortLabel: "Similares", icon: Search },
    { id: "garimpo_config", label: "Configurações", shortLabel: "Config", icon: Settings },
  ];

  return (
    <div className="px-3 sm:px-4 py-4 max-w-6xl mx-auto space-y-4">
      <BackupConfirmDialog {...dialog} />
      {toast && <BackupToast {...toast} onClose={() => setToast(null)} />}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 translate-x-12 -translate-y-8 opacity-5 pointer-events-none">
          <Archive size={200} />
        </div>
        <div className="relative z-10">
          <h1 className="text-xl sm:text-2xl font-extrabold flex items-center gap-2">
            <Archive size={22} className="text-orange-500" />
            Backup & Contingência Pro
          </h1>
          <p className="text-slate-400 text-xs mt-1.5 max-w-xl font-medium">
            Proteja links, garimpo por histórico real e radar de recompra. Verificação automática diária às 6h (BRT).
          </p>
        </div>
        <button
          type="button"
          onClick={handleVarrerTodas}
          disabled={varrendoTudo}
          className="relative z-10 w-full md:w-auto px-5 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shrink-0"
        >
          <RefreshCw size={14} className={varrendoTudo ? "animate-spin" : ""} />
          {varrendoTudo ? "Varrendo links..." : "Varrer todas as ofertas"}
        </button>
      </div>

      <div className="flex gap-0.5 sm:gap-1 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 border-b border-slate-200 pb-0.5 scrollbar-thin">
        {tabs.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setAba(opt.id)}
              className={`px-3 sm:px-4 py-2.5 sm:py-3 text-[11px] sm:text-xs font-bold rounded-t-xl border-b-2 flex items-center gap-1 sm:gap-1.5 whitespace-nowrap transition-all shrink-0 ${
                aba === opt.id
                  ? "border-orange-600 text-orange-600 bg-orange-50/50"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{opt.label}</span>
              <span className="sm:hidden">{opt.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {aba === "cadastrar" && <AbaCadastrar onCadastrado={handleCadastrado} />}
      {aba === "listagem" && (
        <Suspense fallback={<BackupTabFallback label="Carregando backups…" />}>
          <BackupListagemTab
            refreshTrigger={refreshTrigger}
            showToast={showToast}
            askConfirm={askConfirm}
            onChanged={handleCadastrado}
          />
        </Suspense>
      )}
      {aba === "grupos" && (
        <AbaGrupos
          refreshTrigger={refreshTrigger}
          onChange={handleCadastrado}
          showToast={showToast}
          askConfirm={askConfirm}
        />
      )}
      {aba === "similar" && <AbaSimilar backups={backupsParaAbaSimilar} />}
      {aba === "garimpo_config" && <BackupGarimpoConfigTab showToast={showToast} />}
      {aba === "garimpo" && (
        <Suspense fallback={<BackupTabFallback label="Carregando garimpo…" />}>
          <BackupGarimpoHistoricoTab showToast={showToast} />
        </Suspense>
      )}
      {aba === "recompra" && (
        <Suspense fallback={<BackupTabFallback label="Carregando radar…" />}>
          <BackupRadarRecompraTab showToast={showToast} />
        </Suspense>
      )}
    </div>
  );
}
