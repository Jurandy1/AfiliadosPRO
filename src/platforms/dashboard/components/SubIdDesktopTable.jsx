import VirtualSubIdTable from "../../../components/tables/VirtualSubIdTable";
import { subIdTableMinWidth } from "./subIdColumns";
import { fmt, fmtNum } from "../../../utils/formatters";

const SUBID_TABLE_CLASS = "w-full text-xs table-fixed min-w-[1080px]";

function SubIdTableColGroup({ subCols }) {
  const cols = [<col key="subid" style={{ width: 108 }} />];
  if (subCols.comissoes) cols.push(<col key="comissoes" style={{ width: 84 }} />);
  if (subCols.gasto) cols.push(<col key="gasto" style={{ width: 76 }} />);
  if (subCols.lucro) cols.push(<col key="lucro" style={{ width: 76 }} />);
  if (subCols.roi) cols.push(<col key="roi" style={{ width: 68 }} />);
  if (subCols.faturamento) cols.push(<col key="faturamento" style={{ width: 84 }} />);
  if (subCols.ticket) cols.push(<col key="ticket" style={{ width: 76 }} />);
  if (subCols.total_vendas) cols.push(<col key="total_vendas" style={{ width: 68 }} />);
  if (subCols.vendas_diretas) cols.push(<col key="vendas_diretas" style={{ width: 68 }} />);
  if (subCols.vendas_indiretas) cols.push(<col key="vendas_indiretas" style={{ width: 72 }} />);
  if (subCols.qtd_itens) cols.push(<col key="qtd_itens" style={{ width: 64 }} />);
  if (subCols.cliques_anuncio) cols.push(<col key="cliques_anuncio" style={{ width: 88 }} />);
  if (subCols.cliques_shopee) cols.push(<col key="cliques_shopee" style={{ width: 88 }} />);
  if (subCols.batimento) cols.push(<col key="batimento" style={{ width: 72 }} />);
  return <colgroup>{cols}</colgroup>;
}

export default function SubIdDesktopTable({ rows, subCols, totals, renderSubIdRow, sortField, sortDir, onSort }) {
  const ThSort = ({ field, label, align = "center", title, subtitle, sortable = true }) => {
    const isSorted = sortField === field;
    return (
      <th 
        className={`px-2 py-2.5 text-${align} leading-tight ${sortable ? 'cursor-pointer hover:bg-slate-800' : ''} transition-colors select-none group`}
        onClick={() => sortable && onSort && onSort(field)}
        title={title}
      >
        <div className={`flex flex-col items-${align === 'left' ? 'start' : 'center'} justify-center`}>
          <div className="flex items-center gap-1">
            <span>{label}</span>
            {sortable && (
              <span className={`text-[10px] ${isSorted ? "text-indigo-400" : "text-slate-600 group-hover:text-slate-400 opacity-50"}`}>
                {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </span>
            )}
          </div>
          {subtitle && <div className="text-[9px] font-normal normal-case text-slate-400 tracking-normal mt-0.5">{subtitle}</div>}
        </div>
      </th>
    );
  };

  const footerRow = (
    <tr key="__total__" className="bg-slate-900 text-white font-extrabold text-[12px]">
      <td className="px-4 py-3">TOTAL</td>
      {subCols.comissoes && <td className="px-3 py-3 text-center text-emerald-400">{fmt(totals.comissoes)}</td>}
      {subCols.gasto && <td className="px-3 py-3 text-center text-rose-400">{fmt(totals.gasto)}</td>}
      {subCols.lucro && (
        <td className={`px-3 py-3 text-center ${totals.lucro >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {fmt(totals.lucro)}
        </td>
      )}
      {subCols.roi && (
        <td className={`px-3 py-3 text-center ${totals.roiTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {totals.gasto > 0 ? (totals.roiTotal * 100).toFixed(2) + "%" : "—"}
        </td>
      )}
      {subCols.faturamento && <td className="px-3 py-3 text-center">{fmt(totals.faturamento)}</td>}
      {subCols.ticket && <td className="px-3 py-3 text-center text-slate-300">{totals.ticketTotal > 0 ? fmt(totals.ticketTotal) : "—"}</td>}
      {subCols.total_vendas && <td className="px-3 py-3 text-center">{fmtNum(totals.total_vendas)}</td>}
      {subCols.vendas_diretas && <td className="px-3 py-3 text-center">{fmtNum(totals.vendas_diretas)}</td>}
      {subCols.vendas_indiretas && <td className="px-3 py-3 text-center">{fmtNum(totals.vendas_indiretas)}</td>}
      {subCols.qtd_itens && <td className="px-3 py-3 text-center">{fmtNum(totals.qtd_itens)}</td>}
      {subCols.cliques_anuncio && <td className="px-3 py-3 text-center text-slate-400">{fmtNum(totals.cliques_anuncio)}</td>}
      {subCols.cliques_shopee && <td className="px-3 py-3 text-center text-slate-400">{fmtNum(totals.cliques_shopee)}</td>}
      {subCols.batimento && (
        <td className="px-4 py-3 text-center text-emerald-400">
          {totals.cliques_anuncio > 0 ? (totals.batTotal * 100).toFixed(2) + "%" : "—"}
        </td>
      )}
    </tr>
  );

  return (
    <div className="table-scroll">
      <table className={SUBID_TABLE_CLASS} style={{ minWidth: subIdTableMinWidth(subCols) }}>
        <SubIdTableColGroup subCols={subCols} />
        <thead>
          <tr className="table-head-row bg-slate-950 text-slate-300 border-b border-slate-800">
            <th className="text-left px-3 py-2.5 font-normal">SubID</th>
            {subCols.comissoes && <ThSort field="comissoes" label="Comissão" />}
            {subCols.gasto && <ThSort field="gasto" label="Gasto" />}
            {subCols.lucro && <ThSort field="lucro" label="Lucro" />}
            {subCols.roi && <ThSort field="roi" label="ROI" />}
            {subCols.faturamento && <ThSort field="faturamento" label="Faturamento" />}
            {subCols.ticket && <ThSort field="ticket_medio" label="Ticket" />}
            {subCols.total_vendas && <ThSort field="total_vendas" label="Vendas" />}
            {subCols.vendas_diretas && <ThSort field="vendas_diretas" label="Diretas" />}
            {subCols.vendas_indiretas && <ThSort field="vendas_indiretas" label="Indiretas" />}
            {subCols.qtd_itens && <ThSort field="qtd_itens" label="Itens" />}
            {subCols.cliques_anuncio && (
              <ThSort
                field="cliques_anuncio"
                label="Cliques Ads"
                title="Cliques no link dos anúncios no período: Meta (meta_ads_daily) + Pinterest (pinClicks), atribuídos ao SubID."
                subtitle="Meta + Pinterest"
              />
            )}
            {subCols.cliques_shopee && (
              <ThSort
                field="cliques_shopee"
                label="Cliques Shopee"
                title="Cliques no link de afiliado registrados no relatório CSV da Shopee (importação shopee_clique → cliques_shopee), filtrados por SubID e período."
                subtitle="CSV painel Shopee"
              />
            )}
            {subCols.batimento && (
              <ThSort
                field="batimento"
                label="% Bat."
                title="Batimento = Cliques Shopee ÷ Cliques Ads. Acima de 100% indica mais cliques na Shopee do que nos anúncios."
                subtitle="Shopee ÷ Ads"
              />
            )}
          </tr>
        </thead>
      </table>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400 text-xs">Nenhuma campanha com esses filtros</div>
      ) : (
        <VirtualSubIdTable
          rows={rows}
          maxHeight={500}
          tableClassName={SUBID_TABLE_CLASS}
          tableStyle={{ minWidth: subIdTableMinWidth(subCols) }}
          colGroup={<SubIdTableColGroup subCols={subCols} />}
          renderRow={(r) => renderSubIdRow(r)}
          footerRow={footerRow}
        />
      )}
    </div>
  );
}
