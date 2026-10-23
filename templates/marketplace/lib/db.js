import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "data.sqlite");
if (process.env.RESET_DB === "1") rmSync(file, { force: true });

export const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

// Run fn inside a transaction; rolls back if it throws. Use for anything that checks then writes.
export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Runs every db/*.sql file in name order. Use CREATE TABLE IF NOT EXISTS.
export function runMigrations(dir) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, f), "utf8"));
  }
}
