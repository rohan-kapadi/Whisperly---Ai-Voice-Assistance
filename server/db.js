import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.resolve(dataDir, 'assistant.db');
const db = new DatabaseSync(dbPath);

// Initialize schema according to project.md §7
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    remind_at TEXT,
    created_at TEXT NOT NULL,
    done INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

console.log(`[Database] SQLite initialized at: ${dbPath}`);

/**
 * Add a reminder
 */
export function addReminder(text, remindAt = null) {
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO reminders (text, remind_at, created_at, done)
    VALUES (?, ?, ?, 0)
  `);
  const result = stmt.run(text, remindAt, createdAt);
  return {
    id: Number(result.lastInsertRowid),
    text,
    remind_at: remindAt,
    created_at: createdAt,
    done: 0
  };
}

/**
 * List all reminders
 */
export function listReminders() {
  const stmt = db.prepare(`
    SELECT id, text, remind_at, created_at, done
    FROM reminders
    ORDER BY id DESC
    LIMIT 20
  `);
  return stmt.all();
}

/**
 * Add a note
 */
export function addNote(text) {
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notes (text, created_at)
    VALUES (?, ?)
  `);
  const result = stmt.run(text, createdAt);
  return {
    id: Number(result.lastInsertRowid),
    text,
    created_at: createdAt
  };
}

/**
 * Query notes matching query string
 */
export function queryNotes(query = '') {
  const term = `%${query.trim()}%`;
  const stmt = db.prepare(`
    SELECT id, text, created_at
    FROM notes
    WHERE text LIKE ?
    ORDER BY id DESC
    LIMIT 10
  `);
  return stmt.all(term);
}

export default db;
