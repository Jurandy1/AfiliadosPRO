import { Menu, RefreshCw, X } from "lucide-react";
import { usePageToolbar } from "./PageToolbarContext";
import FirestoreUsageBadge from "../diagnostics/FirestoreUsageBadge";

export default function Topbar({
  title,
  heroTitle,
  subtitle,
  mobileMenuOpen = false,
  onToggleMenu,
  onOpenFirestoreDiagnostics,
  breadcrumbRoot = "Inicio",
}) {
  const heading = heroTitle || title;
  const { toolbar } = usePageToolbar();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md shadow-sm">
      <div className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {typeof onToggleMenu === "function" && (
            <button
              type="button"
              onClick={onToggleMenu}
              className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
              <span>{breadcrumbRoot}</span>
              <span className="text-slate-300">›</span>
              <span className="text-slate-700 font-semibold truncate">{title}</span>
            </div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight tracking-tight truncate">
              {heading}
            </h1>
            {subtitle && heroTitle && (
              <p className="text-[11px] text-slate-500 mt-0.5 truncate hidden sm:block">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <FirestoreUsageBadge onOpenSettings={onOpenFirestoreDiagnostics} />
          <span className="hidden lg:inline-flex items-center gap-2 bg-emerald-50 border border-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg text-[11px] font-semibold">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Firebase conectado
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 bg-white flex items-center gap-1.5 transition-colors"
            title="Atualizar página"
          >
            <RefreshCw size={13} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      {toolbar ? (
        <div className="px-4 sm:px-5 py-2.5 border-t border-slate-200/70 bg-gradient-to-b from-slate-50/90 to-white">
          {toolbar}
        </div>
      ) : null}
    </header>
  );
}
