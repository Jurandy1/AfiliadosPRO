import { pathFromRoute } from "../../../app/routePaths";
import { TRAFFIC_TABS } from "../traffic/trafficNav";

export default function TrafficSubNav({ activeRoute, onNavigate, tabBadges = {} }) {
  return (
    <div className="sticky top-0 z-10 -mx-1 px-1 pt-1 pb-2 bg-[#f8fafc]/95 backdrop-blur-sm">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex gap-0 overflow-x-auto scrollbar-thin px-1 py-1.5">
          {TRAFFIC_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeRoute === tab.routeKey;
            const badge = tabBadges[tab.routeKey];
            const href = pathFromRoute(tab.routeKey);

            return (
              <a
                key={tab.routeKey}
                href={href}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onNavigate(tab.routeKey);
                }}
                title={tab.description}
                className={`relative flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all no-underline ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon size={14} className={active ? "text-white" : "text-gray-400"} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
                {badge > 0 && (
                  <span
                    className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold inline-flex items-center justify-center ${
                      active ? "bg-white text-indigo-700" : "bg-rose-500 text-white"
                    }`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
