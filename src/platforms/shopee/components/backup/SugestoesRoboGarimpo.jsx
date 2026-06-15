import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  PlusCircle,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { buscarGarimpoContextual } from "../../services/shopeeApiService";
import { extrairTermosBuscaGarimpo } from "../../utils/garimpoKeywordUtils";
import {
  calcFaixaPrecoGarimpo,
  DEFAULT_BACKUP_GARIMPO_SETTINGS,
  filtrarOfertasGarimpoPorPreco,
  parsePrecoGarimpo,
  readBackupGarimpoSettings,
} from "../../utils/backupGarimpoSettings";
import { fmt } from "../../../../utils/formatters";

export default function SugestoesRoboGarimpo({
  produtoPrincipal,
  grupoId,
  excludeItemIds = [],
  onAddBackupToGrupo,
  showToast,
}) {
  const [listaGarimpada, setListaGarimpada] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [vinculandoId, setVinculandoId] = useState(null);
  const [termoUsado, setTermoUsado] = useState("");
  const [termosTentados, setTermosTentados] = useState([]);
  const [garimpoSettings, setGarimpoSettings] = useState(() => {
    const saved = readBackupGarimpoSettings();
    return { ...DEFAULT_BACKUP_GARIMPO_SETTINGS, ...saved };
  });
  const [fonteGarimpo, setFonteGarimpo] = useState("");
  const [motivoVazio, setMotivoVazio] = useState("");
  const [temOutrasLojas, setTemOutrasLojas] = useState(false);
  const ultimaChaveBusca = useRef("");

  useEffect(() => {
    const onSettings = () => {
      const saved = readBackupGarimpoSettings();
      setGarimpoSettings({ ...DEFAULT_BACKUP_GARIMPO_SETTINGS, ...saved });
    };
    window.addEventListener("afilia:backup-garimpo-settings", onSettings);
    return () => window.removeEventListener("afilia:backup-garimpo-settings", onSettings);
  }, []);

  const precoPrincipal = useMemo(
    () => parsePrecoGarimpo(produtoPrincipal?.preco),
    [produtoPrincipal?.preco],
  );

  const { primario } = extrairTermosBuscaGarimpo(
    produtoPrincipal?.nome,
    produtoPrincipal?.apelido,
  );

  const itemId = produtoPrincipal?.itemId;
  const nomePrincipal = produtoPrincipal?.nome;
  const apelidoPrincipal = produtoPrincipal?.apelido;
  const shopIdPrincipal = produtoPrincipal?.shopId;
  const comissaoPctPrincipal = produtoPrincipal?.comissao_pct;

  const excludeKey = useMemo(
    () => [...new Set([itemId, ...excludeItemIds].filter(Boolean).map(String))].join(","),
    [itemId, excludeItemIds],
  );

  const chaveBusca = useMemo(
    () => `${itemId}_${excludeKey}_${precoPrincipal}_${garimpoSettings.precoToleranciaAcimaPct}_${garimpoSettings.precoToleranciaAbaixoPct}`,
    [itemId, excludeKey, precoPrincipal, garimpoSettings.precoToleranciaAcimaPct, garimpoSettings.precoToleranciaAbaixoPct],
  );

  const dispararGarimpoContextual = useCallback(async (forcar = false) => {
    if (!nomePrincipal && !apelidoPrincipal) return;

    if (!forcar && ultimaChaveBusca.current === chaveBusca) return;

    ultimaChaveBusca.current = chaveBusca;
    setCarregando(true);

    console.group(`[GARIMPO_DBG] Busca para principal "${apelidoPrincipal || nomePrincipal}"`);
    console.log("[GARIMPO_DBG] produtoSanitizado:", {
      itemId, nome: nomePrincipal, apelido: apelidoPrincipal,
      shopId: shopIdPrincipal, preco: precoPrincipal, comissao_pct: comissaoPctPrincipal,
    });
    console.log("[GARIMPO_DBG] excludeItemIds:", excludeItemIds);
    console.log("[GARIMPO_DBG] garimpoSettings:", garimpoSettings);
    console.log("[GARIMPO_DBG] termos extraídos (primario):", primario);
    console.log("[GARIMPO_DBG] forcar:", forcar);

    try {
      const produtoSanitizado = {
        itemId,
        nome: nomePrincipal,
        apelido: apelidoPrincipal,
        shopId: shopIdPrincipal,
        preco: precoPrincipal,
        comissao_pct: comissaoPctPrincipal,
      };

      const resposta = await buscarGarimpoContextual(
        produtoSanitizado,
        excludeItemIds,
        5,
        garimpoSettings,
      );

      console.log("[GARIMPO_DBG] resposta crua de buscarGarimpoContextual:", resposta);
      console.log("[GARIMPO_DBG] resposta keys:", resposta ? Object.keys(resposta) : "null");

      const ofertas = resposta?.ofertas ?? [];
      const termo = resposta?.termoUsado;
      const tentados = resposta?.termosTentados ?? [];
      const fonte = resposta?.fonte;
      const motivo = resposta?.motivoVazio;

      console.log(`[GARIMPO_DBG] ofertas brutas (count=${ofertas.length}):`, ofertas);
      if (ofertas[0]) {
        console.log("[GARIMPO_DBG] keys da 1a oferta:", Object.keys(ofertas[0]));
        console.log("[GARIMPO_DBG] preço bruto da 1a oferta:", {
          priceMin: ofertas[0].priceMin,
          preco: ofertas[0].preco,
          price_min: ofertas[0].price_min,
          priceMax: ofertas[0].priceMax,
          productPriceMin: ofertas[0].productPriceMin,
        });
      }

      console.log("[GARIMPO_DBG] precoPrincipal (parsePrecoGarimpo):", precoPrincipal);

      const filtradas = filtrarOfertasGarimpoPorPreco(ofertas, precoPrincipal, garimpoSettings);
      console.log(`[GARIMPO_DBG] após filtro de preço (count=${filtradas.length}):`, filtradas);

      if (ofertas.length > 0 && filtradas.length === 0) {
        console.warn("[GARIMPO_DBG] ⚠️ FILTRO DE PREÇO ZEROU A LISTA. Provável causa: campo de preço na resposta tem outro nome.");
      }

      setTermoUsado(termo || primario);
      setTermosTentados(tentados.length ? tentados : [termo || primario].filter(Boolean));
      setFonteGarimpo(fonte || "");
      setMotivoVazio(motivo || "");
      setTemOutrasLojas(
        Number(resposta?.ofertasOutrasLojas || 0) > 0
        || filtradas.some((o) => String(o.shopId) !== String(shopIdPrincipal)),
      );
      setListaGarimpada(filtradas.slice(0, 3));
    } catch (err) {
      if (err?.name === "AbortError" || String(err?.message || "").includes("aborted")) {
        console.warn("[GARIMPO_DBG] Busca do garimpo abortada.");
        return;
      }
      console.error("[GARIMPO_DBG] Erro na busca:", err);
      showToast?.(err?.message || "Busca excedeu o tempo. Clique em ↻.", "aviso");
    } finally {
      console.groupEnd();
      setCarregando(false);
    }
  }, [
    chaveBusca,
    nomePrincipal,
    apelidoPrincipal,
    itemId,
    shopIdPrincipal,
    comissaoPctPrincipal,
    precoPrincipal,
    excludeItemIds,
    primario,
    showToast,
    garimpoSettings,
  ]);

  useEffect(() => {
    if (!itemId) return;
    const timer = setTimeout(() => dispararGarimpoContextual(false), 400);
    return () => clearTimeout(timer);
  }, [chaveBusca, itemId, dispararGarimpoContextual]);

  const handleVincular = async (itemGarimpo) => {
    const pctComissao = Number(itemGarimpo.comissao_pct ?? (Number(itemGarimpo.commissionRate || 0) * 100));
    const mapeadoParaBackup = {
      itemId: String(itemGarimpo.itemId),
      shopId: String(itemGarimpo.shopId || "0"),
      nome: itemGarimpo.productName,
      preco: Number(itemGarimpo.priceMin || 0),
      comissao_pct: pctComissao,
      vendas_shopee: Number(itemGarimpo.sales || 0),
      imagem: itemGarimpo.imageUrl || itemGarimpo.imagem || "",
      rating: Number(itemGarimpo.ratingStar || 0),
      loja: itemGarimpo.shopName,
      linkProduto: itemGarimpo.productLink,
      linkAfiliado: itemGarimpo.offerLink,
      periodoFim: itemGarimpo.periodo_fim || null,
    };

    setVinculandoId(itemGarimpo.itemId);
    try {
      await onAddBackupToGrupo(grupoId, mapeadoParaBackup);
      showToast?.("Oferta do Garimpo vinculada ao grupo.", "sucesso");
      setListaGarimpada((prev) => prev.filter((x) => x.itemId !== itemGarimpo.itemId));
    } catch (err) {
      showToast?.(err?.message || String(err), "erro");
    } finally {
      setVinculandoId(null);
    }
  };

  if (!primario && !produtoPrincipal?.nome) return null;

  const labelBusca = termoUsado || primario;
  const faixaPreco = calcFaixaPrecoGarimpo(precoPrincipal, garimpoSettings);

  const mensagemVazia = () => {
    if (motivoVazio === "shopee_indisponivel") {
      return "API Shopee indisponível (rate limit ou timeout). Aguarde alguns minutos e clique em ↻.";
    }
    if (motivoVazio === "todos_ja_no_grupo") {
      return "Todos os backups desta loja já estão neste grupo. O robô precisa da API Shopee para achar produtos novos.";
    }
    return (
      <>
        Nenhuma alternativa com boa comissão na faixa
        {faixaPreco ? ` (${fmt(faixaPreco.min)} – ${fmt(faixaPreco.max)})` : ""} para &quot;{labelBusca}&quot;.
        Tente ↻ ou cadastre um apelido mais curto (ex: &quot;wid leg calca&quot;).
      </>
    );
  };

  return (
    <div className="bg-gradient-to-br from-violet-50 via-white to-indigo-50/20 border border-violet-200 rounded-2xl p-4 space-y-3 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-violet-900 font-extrabold text-xs uppercase tracking-wide">
        <div className="flex items-center gap-1.5 min-w-0">
          <Zap size={14} className="text-violet-600 animate-pulse shrink-0" />
          <span className="truncate">Robô de Garimpo — ofertas semelhantes</span>
        </div>
        <button
          type="button"
          onClick={() => {
            ultimaChaveBusca.current = "";
            dispararGarimpoContextual(true);
          }}
          className="self-end sm:self-auto p-1.5 hover:bg-violet-100 rounded text-violet-600 transition-colors"
          disabled={carregando}
          title="Recarregar garimpo da Shopee"
        >
          <RefreshCw size={12} className={carregando ? "animate-spin" : ""} />
        </button>
      </div>

      {!carregando && labelBusca && (
        <p className="text-[10px] text-violet-700/80 font-semibold normal-case tracking-normal">
          Busca calibrada: <strong>&quot;{labelBusca}&quot;</strong>
          {faixaPreco && (
            <span className="text-slate-500 font-normal block sm:inline sm:ml-1 mt-0.5 sm:mt-0">
              · Preço {fmt(faixaPreco.min)} – {fmt(faixaPreco.max)} (principal {fmt(faixaPreco.precoPrincipal)})
            </span>
          )}
          {(fonteGarimpo === "backup_cadastrado" || fonteGarimpo === "misto") && (
            <span className="text-amber-700 font-normal block sm:inline sm:ml-1">
              · {fonteGarimpo === "misto" ? "Backups + Shopee" : "Backups cadastrados na loja"}
            </span>
          )}
          {temOutrasLojas && (
            <span className="text-violet-700 font-normal block sm:inline sm:ml-1">
              · Inclui lojas concorrentes (ranking por comissão e match)
            </span>
          )}
        </p>
      )}

      {carregando ? (
        <div className="text-[11px] text-slate-400 font-bold py-2 flex items-center gap-2 justify-center">
          <RefreshCw size={12} className="animate-spin text-violet-500 shrink-0" />
          <span className="text-center">Buscando alternativas (até ~30s)…</span>
        </div>
      ) : listaGarimpada.length === 0 ? (
        <p className="text-[11px] text-slate-500 font-medium italic">{mensagemVazia()}</p>
      ) : (
        <div className="space-y-2">
          {listaGarimpada.map((itemGarimpo) => {
            const pctComissao = Number(
              itemGarimpo.comissao_pct ?? (Number(itemGarimpo.commissionRate || 0) * 100),
            );
            const vantagemLucro = pctComissao > Number(produtoPrincipal?.comissao_pct || 0);
            const mesmaLoja = String(itemGarimpo.shopId) === String(produtoPrincipal?.shopId);
            const imagemUrl = itemGarimpo.imageUrl || itemGarimpo.imagem || "";

            return (
              <div
                key={itemGarimpo.itemId}
                className={`p-3 bg-white border rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 transition-all ${
                  vantagemLucro
                    ? "border-amber-300 bg-amber-50/5 shadow-sm"
                    : "border-slate-200"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {imagemUrl ? (
                    <img
                      src={imagemUrl}
                      alt=""
                      className="w-10 h-10 object-cover rounded-lg border shrink-0 bg-slate-100"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg border shrink-0 bg-slate-100 flex items-center justify-center text-slate-300 text-[8px] font-bold">
                      IMG
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {vantagemLucro && (
                        <span className="bg-amber-500 text-white font-extrabold text-[8px] px-1 py-0.5 rounded flex items-center gap-0.5 shrink-0">
                          <Sparkles size={8} />
                          MAIOR COMISSÃO
                        </span>
                      )}
                      {mesmaLoja ? (
                        <span className="bg-blue-100 text-blue-800 font-extrabold text-[8px] px-1 py-0.5 rounded shrink-0">
                          MESMA LOJA
                        </span>
                      ) : (
                        <span className="bg-violet-100 text-violet-800 font-extrabold text-[8px] px-1 py-0.5 rounded shrink-0">
                          OUTRA LOJA
                        </span>
                      )}
                      {itemGarimpo.relevancia >= 40 && (
                        <span className="bg-violet-100 text-violet-800 font-extrabold text-[8px] px-1 py-0.5 rounded shrink-0">
                          {itemGarimpo.relevancia}% match
                        </span>
                      )}
                    </div>
                    <span
                      className="font-extrabold text-slate-800 text-xs block truncate max-w-[220px] sm:max-w-xs mt-0.5"
                      title={itemGarimpo.productName}
                    >
                      {itemGarimpo.productName}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 block truncate max-w-[260px]">
                      {itemGarimpo.shopName}
                      {" · "}
                      ⭐ {Number(itemGarimpo.ratingStar || 0).toFixed(1)}
                      {" · "}
                      {itemGarimpo.sales || 0} vendidos
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                  <div className="text-left sm:text-right">
                    <span className="text-emerald-600 font-extrabold text-xs block">
                      {pctComissao.toFixed(1)}% comissão
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold block">
                      {fmt(itemGarimpo.priceMin || 0)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={vinculandoId === itemGarimpo.itemId}
                      onClick={() => handleVincular(itemGarimpo)}
                      className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-extrabold text-[10px] rounded-lg flex items-center gap-1 shadow-sm"
                    >
                      <PlusCircle size={11} />
                      {vinculandoId === itemGarimpo.itemId ? "…" : "Adicionar rota"}
                    </button>
                    {(itemGarimpo.productLink || itemGarimpo.offerLink) && (
                      <a
                        href={itemGarimpo.productLink || itemGarimpo.offerLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                        title="Validar página da loja"
                      >
                        <ArrowUpRight size={12} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
