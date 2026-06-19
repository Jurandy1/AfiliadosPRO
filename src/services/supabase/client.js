import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://emlsrzqgftoyslharcqd.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_A4LE1Lo6ydyIc-hyPuWygg_HUSQDRFM";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Variáveis de ambiente do Supabase não encontradas. O cliente pode não funcionar corretamente.");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
