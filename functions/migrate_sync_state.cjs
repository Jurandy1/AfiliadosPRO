const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.projetoafiliado-9ff07' });

if (!admin.apps.length) {
  const serviceAccount = require('./serviceAccountKey.json.DESABILITADO');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
global.WebSocket = require('ws');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
  const snapshot = await db.collection('sync_state').get();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Converter timestamps do firestore para iso string ou deixar o client Supabase tratar (se for jsonb, precisamos converter ou o supabase falha)
    for (const key of Object.keys(data)) {
      if (data[key] && typeof data[key].toDate === 'function') {
        data[key] = data[key].toDate().toISOString();
      }
    }
    
    const { error } = await supabase.from('sync_state').upsert({
      id: doc.id,
      data_blob: data
    });
    if (error) console.error("Error upserting", doc.id, error);
    else console.log("Upserted", doc.id);
  }
}
run().catch(console.error).then(() => process.exit(0));
