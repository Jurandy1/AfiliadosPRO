import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { saveProductLink } from "../repositories/productsRepository";

export default function LinkEditCell({ produto, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(produto.link_afiliado || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    setSaving(true);
    try {
      await saveProductLink(produto.id, val);
      onSaved();
    } catch (e) {
      alert("Erro ao salvar link: " + e.message);
    }
    setSaving(false);
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setVal(produto.link_afiliado || "");
      setEditing(false);
    }
  };

  const openLink = produto.link_afiliado || produto.link_shopee;

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[120px] sm:min-w-[180px]">
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          placeholder="Cole o link de afiliado..."
          className="flex-1 text-[10px] border border-indigo-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {saving && <Loader2 size={11} className="animate-spin text-indigo-400 shrink-0" />}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1">
      {openLink ? (
        <a
          href={openLink}
          target="_blank"
          rel="noopener"
          className={`text-[10px] inline-flex items-center gap-0.5 ${
            produto.link_afiliado ? "text-indigo-600 font-medium" : "text-gray-400"
          }`}
          title={openLink}
        >
          <ExternalLink size={10} />
          {produto.link_afiliado ? "Afiliado" : "Shopee"}
        </a>
      ) : (
        <span className="text-[10px] text-gray-300">—</span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-gray-300 hover:text-indigo-500 transition-colors ml-0.5"
        title="Editar link de afiliado"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
    </div>
  );
}
