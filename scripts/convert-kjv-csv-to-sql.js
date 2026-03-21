#!/usr/bin/env node
/**
 * Converts the local kjv.csv file into a Supabase-ready SQL import file.
 *
 * Input:  CSV with columns [Verse ID, Book Name, Book Number, Chapter, Verse, Text].
 * Output: SQL that recreates bible_dataset and bulk inserts all rows.
 *
 * Defaults:
 *   KJV_CSV_PATH     = C:\\Users\\Aditya\\OneDrive\\Desktop\\kjv.csv
 *   OUTPUT_SQL_PATH  = <repo>/supabase/data/kjv_supabase_import.sql
 */

import fs from 'node:fs';
import path from 'node:path';

const inputPath =
  process.env.KJV_CSV_PATH || 'C:\\\\Users\\\\Aditya\\\\OneDrive\\\\Desktop\\\\kjv.csv';
const outputPath =
  process.env.OUTPUT_SQL_PATH || path.join(process.cwd(), 'supabase', 'data', 'kjv_supabase_import.sql');

if (!fs.existsSync(inputPath)) {
  console.error(`Input CSV not found at ${inputPath}`);
  process.exit(1);
}

const parseCsvLine = (line) => {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current);
  return fields;
};

const sanitizeText = (text) =>
  text
    // remove UTF-8 pilcrow artifacts like "¶ "
    .replace(/^¶\s*/u, '')
    // normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

const escapeSql = (value) => value.replace(/'/g, "''");

const csvContent = fs.readFileSync(inputPath, 'utf8').trim();
const lines = csvContent.split(/\r?\n/);
const header = lines.shift();
if (!header) {
  console.error('CSV is empty.');
  process.exit(1);
}

const rows = lines.map((line, index) => {
  const cols = parseCsvLine(line);
  if (cols.length < 6) {
    throw new Error(`Line ${index + 2} malformed: expected 6 columns, got ${cols.length}`);
  }

  const book = cols[1].trim();
  const chapter = cols[3].trim();
  const verse = cols[4].trim();
  const text = sanitizeText(cols[5]);
  const citation = `${book} ${chapter}:${verse}`;

  return `('${escapeSql(citation)}', '${escapeSql(book)}', '${escapeSql(chapter)}', '${escapeSql(verse)}', '${escapeSql(text)}')`;
});

const sqlParts = [];
sqlParts.push('DROP TABLE IF EXISTS bible_dataset;');
sqlParts.push(
  'CREATE TABLE IF NOT EXISTS bible_dataset (\n    citation TEXT,\n    book TEXT,\n    chapter TEXT,\n    verse TEXT,\n    text TEXT,\n    id SERIAL PRIMARY KEY\n);'
);
sqlParts.push('TRUNCATE TABLE bible_dataset;');

// Chunk the inserts to keep statements manageable for Postgres.
const chunkSize = 1000;
for (let i = 0; i < rows.length; i += chunkSize) {
  const chunk = rows.slice(i, i + chunkSize).join(',\n');
  sqlParts.push(`INSERT INTO bible_dataset (citation, book, chapter, verse, text) VALUES\n${chunk};`);
}

fs.writeFileSync(outputPath, sqlParts.join('\n\n'), 'utf8');
console.log(`Wrote ${rows.length} rows to ${outputPath}`);
