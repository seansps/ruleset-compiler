import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

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
 * Coerce a raw CSV cell into a typed value:
 *  - cells starting with `{` or `[` are parsed as JSON (nested objects / lists)
 *  - `true` / `false` become booleans
 *  - numbers that round-trip exactly become numbers ("007", "1/4", "1e3"
 *    stay strings — they don't round-trip)
 *  - everything else stays a string
 */
function coerceCell(raw) {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw; // not valid JSON — keep as a plain string
    }
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  if (
    trimmed !== "" &&
    Number.isFinite(Number(trimmed)) &&
    String(Number(trimmed)) === trimmed
  ) {
    return Number(trimmed);
  }

  return raw;
}

/**
 * Assign `value` into `obj` at a dot-separated `path`. Numeric path segments
 * create / index arrays; everything else creates objects.
 * e.g. setPath(obj, "actions.0.name", "Bite") → obj.actions = [{ name: "Bite" }]
 */
function setPath(obj, path, value) {
  const keys = path.split(".");
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (node[key] == null) {
      node[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

/**
 * Walk a value tree and stamp a UUID `_id` onto every object that is an
 * element of an array and doesn't already have one. Realm VTT list entries
 * (actions, traits, etc.) require a unique `_id`.
 */
function assignListIds(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        !item._id
      ) {
        item._id = randomUUID();
      }
      assignListIds(item);
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      assignListIds(value[key]);
    }
  }
}

/**
 * Read a CSV file and return structured record data.
 *
 * First row is headers. First column is recordType, second is name.
 * Each remaining header is a dot-separated path into the record's `data`
 * object — numeric segments build arrays — and each cell value is coerced
 * (JSON / boolean / number / string). Empty cells are skipped so a blank
 * column never clobbers an existing value on update.
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
      const header = headers[i];
      if (!header) continue;
      const raw = row[i] || "";
      if (raw === "") continue; // skip empty cells — don't clobber on update
      setPath(data, header, coerceCell(raw));
    }
    assignListIds(data);
    return {
      recordType: row[0] || "",
      name: row[1] || "",
      data,
    };
  });
}

/**
 * Read a CSV file of effect definitions and return structured effect objects.
 *
 * Effects differ from records: their fields live at the top level (there is
 * no `data` wrapper) and they have no `recordType`. So every header is a
 * dot-separated path into the effect object itself, and one of those headers
 * must be `name` — it is the upsert key. Each cell value is coerced
 * (JSON / boolean / number / string), so the `rules` array is authored as a
 * JSON cell. Empty cells are skipped so a blank column never clobbers an
 * existing value on update.
 *
 * Note: unlike records, effect `rules` are plain config objects (not list
 * sub-records), so no `_id`s are stamped onto them.
 */
export async function readEffectsCSV(filePath) {
  const text = await readFile(filePath, "utf-8");
  const rows = parseCSVRows(text);

  if (rows.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const [headers, ...dataRows] = rows;

  if (!headers.includes("name")) {
    throw new Error('Effects CSV must have a "name" column');
  }

  return dataRows.map((row) => {
    const effect = {};
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue;
      const raw = row[i] || "";
      if (raw === "") continue; // skip empty cells — don't clobber on update
      setPath(effect, header, coerceCell(raw));
    }
    return effect;
  });
}
