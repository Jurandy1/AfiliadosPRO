import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_PAGE_SIZE } from "../../utils/pagination";

export default function PaginationBar({ page, totalPages, total, onPageChange, pageSize = DEFAULT_PAGE_SIZE }) {
  if (total <= pageSize) return null;
  return (
    <div className="px-4 py-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gray-50/50">
      <span className="text-[11px] text-gray-500">
        {total} itens · página {page} de {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 rounded border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 rounded border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
