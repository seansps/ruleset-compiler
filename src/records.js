import { readRecordsCSV } from "./csv.js";
import { createAuthenticatedClient } from "./auth.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the API payload for a single record.
 */
function buildRecordPayload(record, campaignId) {
  return {
    name: record.name,
    campaignId,
    recordType: record.recordType,
    identified: true,
    category: "",
    unidentifiedName: record.name,
    data: record.data,
  };
}

/**
 * Run the records import action.
 */
export async function runRecords(csvFile, opts) {
  const records = await readRecordsCSV(csvFile);
  if (opts.verbose) console.error(`Parsed ${records.length} records from CSV.`);

  const payloads = records.map((r) => buildRecordPayload(r, opts.campaign));

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(payloads, null, 2));
    process.stdout.write("\n");
    console.error(`[dry-run] Would create ${payloads.length} records.`);
    return;
  }

  const client = await createAuthenticatedClient(opts);
  const delay = parseInt(opts.delay, 10) || 250;
  const results = { succeeded: 0, failed: [] };

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    try {
      const result = await client.createRecord(payload);
      results.succeeded++;
      console.error(`  [${i + 1}/${payloads.length}] Created "${payload.name}" (${result._id})`);
    } catch (err) {
      results.failed.push({ index: i + 1, name: payload.name, error: err.message });
      console.error(`  [${i + 1}/${payloads.length}] FAILED "${payload.name}": ${err.message}`);
    }

    if (i < payloads.length - 1) await sleep(delay);
  }

  console.error(`\nDone. ${results.succeeded} created, ${results.failed.length} failed.`);
  if (results.failed.length > 0) {
    console.error("Failures:");
    for (const f of results.failed) {
      console.error(`  Row ${f.index} "${f.name}": ${f.error}`);
    }
  }
}
