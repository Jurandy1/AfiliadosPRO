import { Link2, Search } from "lucide-react";

const TABS = [
  { id: "ofertas", label: "Buscar ofertas", icon: Search },
  { id: "links", label: "Meus links", icon: Link2 },
];

export default function SuperComissoesTabs({ activeTab, onChange, linksCount = 0 }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex gap-1 p-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`relative flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? "bg-orange-500 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={14} />
              {tab.label}
              {tab.id === "links" && linksCount > 0 && (
                <span
                  className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center ${
                    active ? "bg-white text-orange-600" : "bg-orange-100 text-orange-700"
                  }`}
                >
                  {linksCount > 99 ? "99+" : linksCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
