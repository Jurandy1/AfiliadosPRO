/** Título de seção com ícone Lucide (sem emoji). */
export default function SectionTitle({ icon: Icon, children, className = "", iconClassName = "text-slate-500" }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {Icon ? <Icon size={14} className={`shrink-0 ${iconClassName}`} aria-hidden /> : null}
      <span>{children}</span>
    </div>
  );
}
