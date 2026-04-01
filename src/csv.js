import { readFile } from "node:fs/promises";

/**
 * Parse a CSV string into an array of row arrays, handling quoted fields.
 */
function parseCSVRows(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        current.push(field.trim());
        field = "";
        i++;
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        current.push(field.trim());
        if (current.some((f) => f !== "")) rows.push(current);
        current = [];
        field = "";
        i += ch === "\r" ? 2 : 1;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  current.push(field.trim());
  if (current.some((f) => f !== "")) rows.push(current);

  return rows;
}

/**
 * Read a CSV file and return structured record data.
 * First row is headers. First column is recordType, second is name,
 * remaining columns become the data object.
 */
export async function readRecordsCSV(filePath) {
  const text = await readFile(filePath, "utf-8");
  const rows = parseCSVRows(text);

  if (rows.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const [headers, ...dataRows] = rows;

  return dataRows.map((row) => {
    const data = {};
    for (let i = 2; i < headers.length; i++) {
      if (headers[i]) {
        data[headers[i]] = row[i] || "";
      }
    }
    return {
      recordType: row[0] || "",
      name: row[1] || "",
      data,
    };
  });
}
