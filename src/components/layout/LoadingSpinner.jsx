import { Loader2 } from "lucide-react";

export default function LoadingSpinner({ label = "Carregando...", className = "py-20" }) {
  return (
    <div className={`flex items-center justify-center text-gray-400 ${className}`}>
      <Loader2 className="animate-spin mr-2" size={18} />
      {label}
    </div>
  );
}
