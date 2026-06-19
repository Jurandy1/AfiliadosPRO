import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Variáveis de ambiente do Supabase não encontradas. O cliente pode não funcionar corretamente.");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
