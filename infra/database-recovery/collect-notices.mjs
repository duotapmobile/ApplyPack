import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function sourceNotices(text) {
  return [...text.matchAll(/\/\*[\s\S]*?\*\//gu)].map(([comment]) => comment)
    .filter((comment) => /copyright|redistribut|permission|licen[sc]e|warrant|disclaim/iu.test(comment));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("POSTGRES_NOTICE_ARGUMENTS");
  const sections = [];
  const visit = (directory) => {
    for (const entry of readdirSync("/pg-source/" + directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = directory + "/" + entry.name;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && /\.(?:c|h)$/u.test(name)) {
        const comments = sourceNotices(readFileSync("/pg-source/" + name, "utf8"));
        if (comments.length) sections.push(name + "\n" + comments.join("\n"));
      }
    }
  };
  for (const directory of ["src/bin/psql", "src/bin/pg_dump", "src/interfaces/libpq", "src/common", "src/port", "src/include"]) visit(directory);
  if (sections.length < 50) throw new Error("POSTGRES_NOTICES_INCOMPLETE");
  writeFileSync("/out/root/usr/share/applypack/postgresql/CLIENT_SOURCE_NOTICES.txt", sections.join("\n\n") + "\n");
}
