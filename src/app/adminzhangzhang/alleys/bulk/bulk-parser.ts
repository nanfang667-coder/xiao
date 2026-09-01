import type { BulkAlleySourceRow } from "@/lib/alley-bulk-import";

type TableCell = unknown;

const MAX_BULK_ALLEY_ROWS = 100;

const CITY_HEADERS = new Set([
  "城市",
  "城市名称",
  "所在城市",
  "城市地区",
]);

function cellText(value: TableCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString("zh-CN");
  return String(value).normalize("NFKC").trim();
}

function normalizedHeader(value: TableCell): string {
  return cellText(value)
    .replace(/^\uFEFF/, "")
    .replace(/[\s/_\-—（）()：:]+/g, "");
}

function isMarkdownSeparator(row: TableCell[]): boolean {
  const cells = row.map(cellText).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function tableRowsToBulkSources(rows: TableCell[][]): BulkAlleySourceRow[] {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cellText(cell)));
  if (nonEmptyRows.length < 2) {
    throw new Error("表格至少需要一行标题和一行数据");
  }

  const headers = nonEmptyRows[0].map(cellText);
  const cityIndex = headers.findIndex((header) =>
    CITY_HEADERS.has(normalizedHeader(header)),
  );
  if (cityIndex < 0) {
    throw new Error("没有找到“城市”列，请确认第一行是表头");
  }

  const sources = nonEmptyRows
    .slice(1)
    .filter((row) => !isMarkdownSeparator(row))
    .map((row, index) => ({
      sourceRow: index + 2,
      city: cellText(row[cityIndex]),
      fields: headers.flatMap((header, columnIndex) => {
        if (columnIndex === cityIndex) return [];
        const value = cellText(row[columnIndex]);
        if (!value) return [];
        return [
          {
            label: header || `信息 ${columnIndex + 1}`,
            value,
          },
        ];
      }),
    }))
    .filter((row) => row.city || row.fields.length > 0);

  if (sources.length === 0) throw new Error("表格中没有可导入的数据");
  if (sources.length > MAX_BULK_ALLEY_ROWS) {
    throw new Error(`每次最多导入 ${MAX_BULK_ALLEY_ROWS} 行`);
  }
  return sources;
}

function parseSeparatedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

export function parseBulkTableText(text: string): string[][] {
  const normalized = text.trim();
  if (!normalized) throw new Error("请先粘贴表格内容");

  const firstLine = normalized.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : (firstLine.match(/\|/g)?.length ?? 0) >= 2
      ? "|"
      : ",";
  const rows = parseSeparatedText(normalized, delimiter);

  if (delimiter === "|") {
    return rows.map((row) => {
      const trimmed = [...row];
      if (!trimmed[0]?.trim()) trimmed.shift();
      if (!trimmed.at(-1)?.trim()) trimmed.pop();
      return trimmed;
    });
  }
  return rows;
}