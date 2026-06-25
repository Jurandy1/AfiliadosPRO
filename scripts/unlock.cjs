const admin = require('firebase-admin');
const fs = require('fs');

const sa = JSON.parse(fs.readFileSync('./functions/serviceAccountKey.json.DESABILITADO', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });

const db = admin.firestore();

async function run() {
  console.log("Removendo lock do shopee_lock no Firestore...");
  await db.collection("sync_state").doc("shopee_lock").set({
    lockedUntil: 0,
    label: null,
    releasedBy: "manual_script"
  }, { merge: true });
  console.log("Lock removido com sucesso!");
  process.exit(0);
}

run().catch(console.error);
