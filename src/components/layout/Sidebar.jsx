import { X } from "lucide-react";
import { ROUTES, NAV_ITEMS } from "../../app/routes";
import { pathFromRoute } from "../../app/routePaths";
import { isTrafficRoute } from "../../platforms/meta/traffic/trafficNav";

export default function Sidebar({ activeRoute, alertCount, onNavigate, onCloseMobile }) {
  const renderRouteButton = (key, { nested = false } = {}) => {
    const route = ROUTES[key];
    if (!route) return null;
    const Icon = route.icon;
    const active = activeRoute === key;

    const href = pathFromRoute(key);

    return (
      <a
        key={key}
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onNavigate(key);
        }}
        className={`w-full flex items-center gap-2.5 text-[13px] transition-colors duration-150 no-underline ${
          nested ? "py-2 pl-3 pr-2 ml-2 border-l border-slate-700/70" : "py-2.5 px-3"
        } ${active ? "nav-item-active" : "nav-item-idle"}`}
      >
        <Icon
          size={nested ? 14 : 16}
          className={active ? "text-brand-400 shrink-0" : "text-slate-500 shrink-0"}
        />
        <span className="truncate">{route.title}</span>
        {route.showBadge && alertCount > 0 && (
          <span className="ml-auto bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] px-1 rounded-full font-bold inline-flex items-center justify-center">
            {alertCount}
          </span>
        )}
      </a>
    );
  };

  return (
    <aside className="w-[252px] bg-sidebar text-slate-400 flex flex-col h-full border-r border-slate-800/50">
      <div className="px-5 py-5 flex items-center justify-between border-b border-slate-800/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-lg shadow-brand-900/30 shrink-0">
            A
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold text-[15px] leading-tight truncate">Afiliado Teste</div>
            <div className="text-[10px] text-slate-500 font-medium mt-0.5">Shoppe · Meta · Pinterest</div>
          </div>
        </div>
        {typeof onCloseMobile === "function" && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white shrink-0"
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 py-3 overflow-y-auto px-3">
        {NAV_ITEMS.map((item, idx) => {
          if (item.type === "label") {
            const trafficGroupActive = item.text === "Tráfego" && isTrafficRoute(activeRoute);
            return (
              <div
                key={`label-${item.text}-${idx}`}
                className={`px-3 text-[10px] uppercase tracking-[0.14em] font-semibold ${
                  idx === 0 ? "pt-1 pb-2" : "pt-5 pb-2"
                } ${trafficGroupActive ? "text-brand-400" : "text-slate-500"}`}
              >
                {item.text}
              </div>
            );
          }

          if (item.type === "route") {
            return renderRouteButton(item.key, { nested: Boolean(item.nested) });
          }

          return null;
        })}
      </nav>

      <div className="px-5 py-4 border-t border-slate-800/80 text-[10px] text-slate-500">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-slate-400 truncate">Jurandy Santana</span>
        </div>
        <div className="flex justify-between items-center text-[9px] mt-2 text-slate-600">
          <span>Firebase · Vercel</span>
          <span className="bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-400">v2.4</span>
        </div>
      </div>
    </aside>
  );
}
