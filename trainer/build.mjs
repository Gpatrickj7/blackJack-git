// Builds the trainer into one file that runs with no server: blackjack-trainer.html (open it in any browser).
// The engine, the strategy and the app are inlined in order, their imports and exports removed.
import { readFileSync, writeFileSync } from "node:fs";
const here = (f) => new URL(f, import.meta.url);
const strip = (src) => src.replace(/^import .*$/gm, "").replace(/^export /gm, "");
const script = ["engine.mjs", "strategy.mjs", "bots.mjs", "sim.mjs", "career.mjs", "app.js"].map((f) => `// ---- ${f}\n${strip(readFileSync(here(f), "utf8"))}`).join("\n");
if (/^\s*(import|export)\s/m.test(script)) throw new Error("an import or export survived the inlining");
const page = readFileSync(here("page.html"), "utf8") + `\n<script type="module">\n${script}\n</script>\n`;
writeFileSync(here("blackjack-trainer.html"), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
if (process.argv[2]) writeFileSync(process.argv[2], page); // the page alone, for hosting inside another document
console.log(`blackjack-trainer.html: ${(page.length / 1024).toFixed(1)} kB`);
