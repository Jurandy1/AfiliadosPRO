import { idbGet, idbSet } from "../../dashboard/cache/indexedDbCache";

const CACHE_KEY = "powersuite_generated_links";

export async function listGeneratedLinks(maxDocs = 200) {
  const data = await idbGet(CACHE_KEY);
  if (!data) return [];
  return data.slice(0, maxDocs);
}

export async function saveGeneratedLink(payload) {
  const current = await listGeneratedLinks(1000);
  const newLink = {
    id: crypto.randomUUID(),
    itemId: String(payload.itemId || ""),
    productName: String(payload.productName || "").trim(),
    imageUrl: payload.imageUrl || "",
    originUrl: String(payload.originUrl || "").trim(),
    shortLink: String(payload.shortLink || "").trim(),
    subIds: (payload.subIds || []).map((s) => String(s).trim()).filter(Boolean),
    commission: Number(payload.commission) || 0,
    commissionRate: Number(payload.commissionRate) || 0,
    shopName: String(payload.shopName || "").trim(),
    createdAt: new Date().toISOString(),
  };
  
  current.unshift(newLink);
  await idbSet(CACHE_KEY, current.slice(0, 500)); // keep last 500
  return newLink.id;
}

export async function deleteGeneratedLink(id) {
  if (!id) return;
  const current = await listGeneratedLinks(1000);
  const updated = current.filter(x => x.id !== id);
  await idbSet(CACHE_KEY, updated);
}
