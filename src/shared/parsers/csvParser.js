import Papa from "papaparse";

export function parseCSVBuffer(arrayBuffer) {
  const encodings = ["utf-8", "iso-8859-1", "windows-1252"];
  const separators = [",", ";"];

  for (const enc of encodings) {
    for (const sep of separators) {
      try {
        const text = new TextDecoder(enc).decode(arrayBuffer);
        const clean = text.replace(/^\uFEFF/, "");
        const result = Papa.parse(clean, {
          header: true,
          delimiter: sep,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
        });
        if (result.data.length > 0 && result.meta.fields.length > 1) {
          return result.data;
        }
      } catch (_) {
        continue;
      }
    }
  }

  const text = new TextDecoder("utf-8").decode(arrayBuffer).replace(/^\uFEFF/, "");
  const firstLine = text.split("\n")[0] || "";
  const sep = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  return Papa.parse(text, {
    header: true,
    delimiter: sep,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  }).data;
}

export function parseCSVText(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split("\n")[0] || "";
  const sep = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  return Papa.parse(clean, {
    header: true,
    delimiter: sep,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  }).data;
}
