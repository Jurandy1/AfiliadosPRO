import { getHistoricoProduto } from "../repositories/backupRepository";

/** Soma comissão/GMV das vendas suas em todos os membros do grupo. */
export async function enriquecerGrupoComHistorico(grupo) {
  const ids = [grupo.principalItemId, ...(grupo.backupItemIds || [])].filter(Boolean);
  let lucro_historico = 0;
  let gmv_historico = 0;

  await Promise.all(
    ids.map(async (id) => {
      const h = await getHistoricoProduto(id);
      if (h?.ja_vendeu) {
        lucro_historico += Number(h.comissao_total_minha || 0);
        gmv_historico += Number(h.gmv_total_meu || 0);
      }
    }),
  );

  return { ...grupo, lucro_historico, gmv_historico };
}

export function categoriaProduto(produto) {
  if (!produto) return "Geral";
  return produto.category || produto.categoria || "Geral";
}
