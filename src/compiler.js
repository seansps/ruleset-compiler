import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Checks if a value is a file reference object: { "file": "path/to/file" }
 */
function isFileRef(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.file === "string" &&
    Object.keys(value).length === 1
  );
}

/**
 * Recursively walk an object and resolve all { file: "..." } references
 * to file contents. Returns a new object with resolved values.
 */
async function resolveFileRefs(obj, dir, verbose = false) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return Promise.all(obj.map((item) => resolveFileRefs(item, dir, verbose)));
  }

  if (isFileRef(obj)) {
    const filePath = join(dir, obj.file);
    if (verbose) console.log(`  Reading file: ${obj.file}`);
    return readFile(filePath, "utf-8");
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = await resolveFileRefs(value, dir, verbose);
  }
  return result;
}

/**
 * Default fields for list-type records.
 */
const LIST_DEFAULTS = {
  showAddButton: false,
  showDeleteButton: false,
  addButtonText: "",
  allowedListTypes: [],
  newItemName: "",
  newItemUnidentifiedName: "",
  stackDuplicates: false,
  disableDrop: false,
  countFieldName: "",
  emptyListText: "",
  singleRow: false,
  maxLength: 0,
  filterCriteria: [],
  orderCriteria: [],
  minX: 500,
  minY: 60,
  hideFromCompendium: true,
  icon: "",
  filters: {},
};

/**
 * Default fields for non-list records.
 */
const RECORD_DEFAULTS = {
  minX: 500,
  minY: 400,
  hideFromCompendium: false,
  icon: "",
  filters: {},
};

/**
 * Fill in default fields for a record definition.
 */
function fillRecordDefaults(record) {
  const defaults = record.isList ? LIST_DEFAULTS : RECORD_DEFAULTS;
  for (const [key, value] of Object.entries(defaults)) {
    if (record[key] === undefined) {
      record[key] = value;
    }
  }
}

/**
 * Compile a ruleset directory into the API payload.
 */
export async function compile(directory, { verbose = false } = {}) {
  const dir = resolve(directory);
  const configPath = join(dir, "ruleset.config.json");

  if (verbose) console.log(`Reading config: ${configPath}`);
  const configRaw = await readFile(configPath, "utf-8");
  const config = JSON.parse(configRaw);

  // Build records array
  if (verbose) console.log(`Compiling ${config.records.length} record types...`);
  const records = [];
  for (const rec of config.records) {
    const compiled = { ...rec };

    // Resolve tab HTML files
    compiled.tabs = await Promise.all(
      rec.tabs.map(async (tab) => {
        const layout = tab.file
          ? await (async () => {
              const filePath = join(dir, tab.file);
              if (verbose) console.log(`  Reading tab: ${tab.file}`);
              return readFile(filePath, "utf-8");
            })()
          : tab.layout || "";
        const result = { name: tab.name, layout };
        // Preserve any other tab properties except 'file'
        for (const [key, value] of Object.entries(tab)) {
          if (key !== "name" && key !== "file" && key !== "layout") {
            result[key] = value;
          }
        }
        return result;
      })
    );

    // Resolve jsonImport file references (script/postScript can use { file: "..." })
    if (compiled.jsonImport) {
      compiled.jsonImport = await resolveFileRefs(compiled.jsonImport, dir, verbose);
    }

    // Resolve pdfExport file references (script can use { file: "..." })
    if (compiled.pdfExport) {
      compiled.pdfExport = await resolveFileRefs(compiled.pdfExport, dir, verbose);
    }

    // Resolve wizard step HTML files (file → layout, mirroring tabs)
    if (compiled.wizard && Array.isArray(compiled.wizard.steps)) {
      compiled.wizard = {
        ...compiled.wizard,
        steps: await Promise.all(
          compiled.wizard.steps.map(async (step) => {
            const layout = step.file
              ? await (async () => {
                  const filePath = join(dir, step.file);
                  if (verbose) console.log(`  Reading wizard step: ${step.file}`);
                  return readFile(filePath, "utf-8");
                })()
              : step.layout || "";
            const result = { name: step.name, layout };
            for (const [key, value] of Object.entries(step)) {
              if (key !== "name" && key !== "file" && key !== "layout") {
                result[key] = value;
              }
            }
            return result;
          })
        ),
      };
    }

    fillRecordDefaults(compiled);
    records.push(compiled);
  }

  // Build settings — resolve all file references
  if (verbose) console.log("Resolving settings file references...");
  let settings = config.settings ? await resolveFileRefs(config.settings, dir, verbose) : {};

  // For rollTypes, transform file → handleResult
  if (settings.rollTypes && Array.isArray(settings.rollTypes)) {
    settings.rollTypes = await Promise.all(
      settings.rollTypes.map(async (rt) => {
        const handleResult = rt.file
          ? await (async () => {
              const filePath = join(dir, rt.file);
              if (verbose) console.log(`  Reading rollType: ${rt.file}`);
              return readFile(filePath, "utf-8");
            })()
          : rt.handleResult || "";
        return { name: rt.name, handleResult };
      })
    );
  }

  // Build final payload
  const payload = {
    name: config.name,
    description: config.description || "",
    records,
    settings,
  };

  if (config.version !== undefined) payload.version = config.version;
  if (config.published !== undefined) payload.published = config.published;

  // Cross-ruleset import compatibility. Referenced by rulesetId (stable across
  // dev/prod for official rulesets), so this passes through verbatim with no
  // API lookup — keeping compile() pure. See the backend rulesetCompatibilitySchema.
  if (config.compatibility !== undefined) payload.compatibility = config.compatibility;

  if (verbose) {
    console.log(`Compiled: ${payload.name}`);
    console.log(`  Records: ${records.length}`);
    console.log(`  Roll types: ${settings.rollTypes?.length || 0}`);
    const importerCount = records.filter((r) => r.jsonImport).length;
    if (importerCount > 0) console.log(`  Records with jsonImport: ${importerCount}`);
  }

  return payload;
}
