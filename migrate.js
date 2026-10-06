/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node.js CommonJS script. */
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const XLSX = require("xlsx");

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const EXCEL_FILE = path.resolve(process.cwd(), "tracker.xlsx");
const USER_ID = "REPLACE_WITH_SUPABASE_AUTH_USER_UUID";
const BATCH_SIZE = 500;

const SHEET_MONTHS = {
  DEC: { month: 12, year: 2025 },
  JAN: { month: 1, year: 2026 },
  FEB: { month: 2, year: 2026 },
  MAR: { month: 3, year: 2026 },
  APR: { month: 4, year: 2026 },
  MAY: { month: 5, year: 2026 },
  JUN: { month: 6, year: 2026 },
  JULY: { month: 7, year: 2026 },
  AUG: { month: 8, year: 2026 },
  SEP: { month: 9, year: 2026 },
  OCT: { month: 10, year: 2026 },
};

const SUMMARY_PHRASES = [
  "prev balance",
  "total credit",
  "total debit",
  "net balance",
];

const MONTH_HEADER_PATTERN =
  /^(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)(?:[\s/_-]*\d{2,4})?$/i;

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function parseAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || isEmpty(value)) {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/[,$£€¥₹\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function rowContainsSummary(row) {
  return row.slice(3).some((cell) => {
    const text = String(cell ?? "").toLowerCase();
    return SUMMARY_PHRASES.some((phrase) => text.includes(phrase));
  });
}

function isMonthHeader(row) {
  return row.some(
    (cell) =>
      typeof cell === "string" && MONTH_HEADER_PATTERN.test(cell.trim()),
  );
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTag(value) {
  if (isEmpty(value)) {
    return "general";
  }
  return String(value).trim() || "general";
}

function makeTransaction(type, amount, tag, date) {
  return {
    user_id: USER_ID,
    date,
    type,
    amount,
    tag,
  };
}

function validateConfiguration() {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(USER_ID)) {
    throw new Error("Set USER_ID in migrate.js to your Supabase auth user UUID.");
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  if (!fs.existsSync(EXCEL_FILE)) {
    throw new Error(`Excel file not found: ${EXCEL_FILE}`);
  }

  return { supabaseUrl, serviceRoleKey };
}

function collectTransactions(workbook) {
  const transactions = [];
  const skipped = { summary: 0, emptyOrZeroAmounts: 0 };
  let processedRows = 0;
  let processedSheets = 0;

  for (const [sheetName, { month, year }] of Object.entries(SHEET_MONTHS)) {
    const actualSheetName = workbook.SheetNames.find(
      (name) => name.toUpperCase() === sheetName,
    );
    if (!actualSheetName) {
      console.warn(`Sheet "${sheetName}" not found; skipping it.`);
      continue;
    }

    processedSheets += 1;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[actualSheetName], {
      header: 1,
      defval: "",
      raw: true,
      blankrows: true,
    });

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      processedRows += 1;

      if (rowIndex === 0 && isMonthHeader(row)) {
        skipped.summary += 1;
        continue;
      }

      const credit = parseAmount(row[0]);
      const debit = parseAmount(row[1]);
      const hasCredit = credit !== null && credit > 0;
      const hasDebit = debit !== null && debit > 0;

      if (!hasCredit && !hasDebit && rowContainsSummary(row)) {
        skipped.summary += 1;
        continue;
      }

      if (!hasCredit && !hasDebit) {
        skipped.emptyOrZeroAmounts += 1;
        continue;
      }

      // Keep inferred dates within the actual number of days in each month.
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const day = Math.min(rowIndex + 1, lastDayOfMonth);
      const date = formatDate(year, month, day);
      const tag = getTag(row[2]);

      if (hasCredit) {
        transactions.push(makeTransaction("credit", credit, tag, date));
      }
      if (hasDebit) {
        transactions.push(makeTransaction("debit", debit, tag, date));
      }
    }
  }

  return { transactions, skipped, processedRows, processedSheets };
}

async function insertTransactions(supabase, transactions) {
  let inserted = 0;
  for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
    const batch = transactions.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("transactions").insert(batch);
    if (error) {
      throw new Error(
        `Insert failed for batch starting at record ${start + 1}: ${error.message}`,
        { cause: error },
      );
    }
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${transactions.length} transaction(s).`);
  }
  return inserted;
}

async function main() {
  const { supabaseUrl, serviceRoleKey } = validateConfiguration();
  const workbook = XLSX.readFile(EXCEL_FILE);
  const { transactions, skipped, processedRows, processedSheets } =
    collectTransactions(workbook);

  console.log(`Workbook: ${EXCEL_FILE}`);
  console.log(`Sheets processed: ${processedSheets}`);
  console.log(`Rows examined: ${processedRows}`);
  console.log(
    `Rows skipped: ${skipped.summary + skipped.emptyOrZeroAmounts} ` +
      `(summary/header: ${skipped.summary}, empty/zero/non-positive amounts: ${skipped.emptyOrZeroAmounts})`,
  );
  console.log(`Transaction records ready: ${transactions.length}`);

  if (transactions.length === 0) {
    console.log("Nothing to insert.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const inserted = await insertTransactions(supabase, transactions);
  console.log(`Migration complete: ${inserted} transaction(s) inserted.`);
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
