import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractPdf, sha256, type Extracted } from "./extract";

export const SOURCE_PDF = path.join(process.cwd(), "data", "source", "GEP-Jun-2026.pdf");
const CACHE = path.join(process.cwd(), ".cache", "extract");

/** Extraction is deterministic for a given file, so it is cached by content hash (≈10 s → 0.2 s). */
export async function loadExtracted(pdfPath = SOURCE_PDF): Promise<Extracted> {
  const hash = sha256(new Uint8Array(await readFile(pdfPath)));
  const file = path.join(CACHE, `${hash}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as Extracted;
  } catch { /* miss */ }
  const ex = await extractPdf(pdfPath);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(ex));
  return ex;
}
