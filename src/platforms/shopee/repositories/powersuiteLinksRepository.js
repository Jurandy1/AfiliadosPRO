import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";

function mapLinkDoc(d) {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    createdAt: data.createdAt?.toDate?.() || null,
  };
}

export async function listGeneratedLinks(maxDocs = 200) {
  const colRef = collection(db, COLLECTIONS.POWERSUITE_LINKS);
  const q = query(colRef, orderBy("createdAt", "desc"), limit(maxDocs));
  const snap = await getDocs(q);
  return snap.docs.map(mapLinkDoc);
}

export async function saveGeneratedLink({
  itemId,
  productName,
  imageUrl,
  originUrl,
  shortLink,
  subIds = [],
  commission,
  commissionRate,
  shopName,
}) {
  const colRef = collection(db, COLLECTIONS.POWERSUITE_LINKS);
  const ref = await addDoc(colRef, {
    itemId: String(itemId || ""),
    productName: String(productName || "").trim(),
    imageUrl: imageUrl || "",
    originUrl: String(originUrl || "").trim(),
    shortLink: String(shortLink || "").trim(),
    subIds: (subIds || []).map((s) => String(s).trim()).filter(Boolean),
    commission: Number(commission) || 0,
    commissionRate: Number(commissionRate) || 0,
    shopName: String(shopName || "").trim(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteGeneratedLink(id) {
  if (!id) return;
  await deleteDoc(doc(db, COLLECTIONS.POWERSUITE_LINKS, id));
}
