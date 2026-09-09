import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const stdin = args[0] === "--stdin";
const check = args[0] === "--check";
const paths = check ? args.slice(1) : args;
const tableConstraint = /^(CHECK|CONSTRAINT|EXCLUDE|FOREIGN|LIKE|ON|PRIMARY|REFERENCES|UNIQUE)\b/i;
const columnConstraint =
  /\s+(?=(CHECK|COLLATE|CONSTRAINT|DEFAULT|GENERATED|NOT|NULL|PRIMARY|REFERENCES|UNIQUE)\b)/i;
let invalid = false;

function alignTableColumns(source: string) {
  const lines = source.split("\n");

  for (let start = 0; start < lines.length; start++) {
    if (!/^CREATE TABLE\b.*\($/i.test(lines[start]!)) continue;

    const endOffset = lines.slice(start + 1).findIndex((line) => line === ");");
    if (endOffset < 0) continue;

    const end = start + endOffset + 1;
    const columns = lines.slice(start + 1, end).flatMap((line, offset) => {
      const match = line.match(/^  ("[^"]+"|\S+)\s+(.+)$/);
      if (!match || tableConstraint.test(match[1]!)) return [];

      const comma = match[2]!.endsWith(",");
      const definition = comma ? match[2]!.slice(0, -1) : match[2]!;
      const constraintStart = definition.search(columnConstraint);
      const type = constraintStart < 0 ? definition : definition.slice(0, constraintStart);
      const constraint = constraintStart < 0 ? "" : definition.slice(constraintStart).trimStart();

      return [
        {
          index: start + offset + 1,
          name: match[1]!,
          type,
          constraint,
          comma,
        },
      ];
    });
    if (columns.length === 0) continue;

    const nameWidth = Math.max(...columns.map(({ name }) => name.length));
    const typeWidth = Math.max(...columns.map(({ type }) => type.length));

    for (const column of columns) {
      const constraint = column.constraint
        ? `${column.constraint.startsWith("NULL") ? "     " : " "}${column.constraint}`
        : "";
      const definition = `  ${column.name.padEnd(nameWidth)} ${column.type.padEnd(typeWidth)}`;
      lines[column.index] =
        (constraint ? definition + constraint : definition.trimEnd()) + (column.comma ? "," : "");
    }

    start = end;
  }

  return lines.join("\n");
}

async function formatSql(source: string) {
  const withoutComments = source
    .split("\n")
    .map((line) =>
      /^\s*-- migrate:(up|down)\s*$/.test(line) ? line : line.replace(/\s*--.*$/, ""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  const formatter = Bun.spawn(["sqruff", "fix", "-", "--format", "none"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  await formatter.stdin.write(withoutComments);
  await formatter.stdin.end();

  const formatted = await new Response(formatter.stdout).text();
  if ((await formatter.exited) !== 0) throw new Error("sqruff failed");
  return alignTableColumns(formatted);
}

if (stdin) {
  process.stdout.write(await formatSql(await Bun.stdin.text()));
} else {
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    const formatted = await formatSql(source);
    if (formatted === source) continue;

    if (check) {
      console.error(`${path} contains unformatted SQL`);
      invalid = true;
    } else {
      await Bun.write(path, formatted);
    }
  }
}

if (invalid) process.exitCode = 1;
