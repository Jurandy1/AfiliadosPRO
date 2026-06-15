/**
 * Pinterest Ads — leitura Firestore (importação manual via CSV).
 */

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";

export async function getPinterest(importacaoId = null) {
  const base = collection(db, COLLECTIONS.PINTEREST);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
