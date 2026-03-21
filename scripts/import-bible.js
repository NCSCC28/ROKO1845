#!/usr/bin/env node
/**
 * One-shot importer for Bible data.
 *
 * What it does:
 * 1) Runs the raw dataset SQL (supabase_import.sql) to fill staging table bible_dataset.
 * 2) Runs the existing migration to upsert into bible_verses.
 * 3) Runs the cleanup migration that drops bible_dataset.
 *
 * Prereqs:
 * - Node 18+
 * - env DATABASE_URL set to your Supabase Postgres connection string
 *   (service-role recommended, begins with postgres://...).
 * - Files:
 *    IMPORT_SQL_PATH (default: supabase/data/kjv_supabase_import.sql)
 *    INTEGRATE_SQL_PATH (default: supabase/migrations/20260221190100_integrate_bible_dataset_into_bible_verses.sql)
 *    CLEANUP_SQL_PATH (default: supabase/migrations/20260221190200_cleanup_bible_dataset.sql)
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run import:bible
 *
 * Safe re-run:
 * - The integrate step uses UPSERT, so re-running won’t duplicate rows.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const env = process.env;

const CONFIG = {
  importSql:
    env.IMPORT_SQL_PATH ||
    path.join(process.cwd(), 'supabase', 'data', 'kjv_supabase_import.sql'),
  integrateSql:
    env.INTEGRATE_SQL_PATH ||
    path.join(process.cwd(), 'supabase', 'migrations', '20260221190100_integrate_bible_dataset_into_bible_verses.sql'),
  cleanupSql:
    env.CLEANUP_SQL_PATH ||
    path.join(process.cwd(), 'supabase', 'migrations', '20260221190200_cleanup_bible_dataset.sql'),
  statementTimeoutMs: Number(env.STATEMENT_TIMEOUT_MS || 120000),
};

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required (service role connection string). Aborting.');
  process.exit(1);
}

const readSql = (filePath, label) => {
  const exists = fs.existsSync(filePath);
  if (!exists) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
};

const runSql = async (client, sql, label) => {
  console.log(`\n=== Running ${label} ===`);
  await client.query(`SET statement_timeout = ${CONFIG.statementTimeoutMs};`);
  await client.query(sql);
  console.log(`Completed ${label}`);
};

async function main() {
  const client = new Client({
    connectionString: env.DATABASE_URL,
    application_name: 'bible-import-script',
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const importSql = readSql(CONFIG.importSql, 'IMPORT_SQL_PATH');
    const integrateSql = readSql(CONFIG.integrateSql, 'INTEGRATE_SQL_PATH');
    const cleanupSql = readSql(CONFIG.cleanupSql, 'CLEANUP_SQL_PATH');

    await runSql(client, importSql, '1) Raw import (bible_dataset)');
    await runSql(client, integrateSql, '2) Integrate into bible_verses');
    await runSql(client, cleanupSql, '3) Cleanup staging table');

    console.log('\nAll steps done. Verify counts, e.g.:');
    console.log("  select count(*) from bible_verses;");
    console.log("  select count(*) from bible_verses where testament='Old';");
    console.log("  select count(*) from bible_verses where testament='New';");
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();

