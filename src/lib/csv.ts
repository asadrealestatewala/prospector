/** CSV helpers shared by the exports and the do-not-contact import. */

/** One CSV cell. Cells that start like a formula get a leading quote so spreadsheets do not run them. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");

/** Parses CSV text (quotes, doubled quotes, commas or semicolons, CRLF). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export type DncImportRow = { value: string; channel?: string; reason?: string; note?: string };

/**
 * Reads a do-not-contact CSV. With a header row, the columns value (or email, phone, number),
 * channel, reason and note are used; without one, the first column is the value.
 */
export function dncRowsFromCsv(text: string): DncImportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const valueAt = find("value", "email", "emailaddress", "phone", "phonenumber", "number", "whatsapp", "contact");
  const hasHeader = valueAt >= 0;
  const v = hasHeader ? valueAt : 0;
  const ch = find("channel", "type");
  const rs = find("reason");
  const nt = find("note", "notes", "comment");
  const channelFromHeader = hasHeader && ["whatsapp"].includes(head[valueAt]) ? "whatsapp" : undefined;
  return (hasHeader ? rows.slice(1) : rows)
    .map((r) => ({
      value: (r[v] ?? "").replace(/^'/, ""),
      channel: ch >= 0 ? r[ch] || undefined : channelFromHeader,
      reason: rs >= 0 ? (r[rs] || undefined)?.toLowerCase().replace(/[\s-]+/g, "_") : undefined,
      note: nt >= 0 ? r[nt] || undefined : undefined,
    }))
    .filter((r) => r.value);
}
