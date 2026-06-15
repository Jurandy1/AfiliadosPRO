import { useCallback, useMemo, useRef, useState } from "react";

const ROW_HEIGHT = 36;

/**
 * Tabela SubID com janela virtual (sem dependência extra).
 * Use colGroup + tableClassName iguais no cabeçalho externo para alinhar colunas.
 */
export default function VirtualSubIdTable({
  rows = [],
  maxHeight = 500,
  renderRow,
  colGroup = null,
  tableClassName = "w-full text-xs table-fixed",
  tableStyle = undefined,
  footerRow = null,
  emptyMessage = "Nenhuma campanha",
}) {
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  const { start, end, offsetY, totalHeight } = useMemo(() => {
    const n = rows.length;
    const visible = Math.ceil(maxHeight / ROW_HEIGHT) + 4;
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
    const endIdx = Math.min(n, startIdx + visible);
    return {
      start: startIdx,
      end: endIdx,
      offsetY: startIdx * ROW_HEIGHT,
      totalHeight: n * ROW_HEIGHT,
    };
  }, [rows.length, scrollTop, maxHeight]);

  const slice = rows.slice(start, end);

  if (!rows.length) {
    return (
      <div className="px-4 py-8 text-center text-gray-400 text-xs">{emptyMessage}</div>
    );
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="overflow-auto"
        style={{ maxHeight }}
        onScroll={onScroll}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <table className={tableClassName} style={{ position: "absolute", top: 0, left: 0, right: 0, ...tableStyle }}>
            {colGroup}
            <tbody style={{ transform: `translateY(${offsetY}px)` }}>
              {slice.map((r, i) => renderRow(r, start + i))}
            </tbody>
          </table>
        </div>
      </div>
      {footerRow && (
        <table className={`${tableClassName} border-t border-slate-200`} style={tableStyle}>
          {colGroup}
          <tbody>{footerRow}</tbody>
        </table>
      )}
    </>
  );
}
