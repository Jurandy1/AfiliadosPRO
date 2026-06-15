import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "./client";

export async function uploadImportFile(file, tipo) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const storageRef = ref(storage, `csv-imports/${tipo}/${ts}_${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  } catch (e) {
    console.warn("Storage upload skipped:", e.message);
    return null;
  }
}
