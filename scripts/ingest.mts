/**
 * npm run ingest                 build data/index/index.json from data/source/GEP-Jun-2026.pdf (+ embeddings if a key is set)
 * npm run ingest -- --no-embed   structure and chunks only (0 model calls)
 * npm run ingest -- --no-ablation skip embedding the heading-path ablation corpus (saves ~9 minutes)
 */
import { ingest } from "@/lib/pipeline/ingest";

const args = process.argv.slice(2);
const r = await ingest({ embed: !args.includes("--no-embed"), ablation: !args.includes("--no-ablation"), log: (s) => console.log(`· ${s}`) });
console.log(JSON.stringify(r, null, 2));
