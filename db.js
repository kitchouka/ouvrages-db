const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'ouvrages.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ouvrages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    designation TEXT NOT NULL,
    unite TEXT,
    famille TEXT DEFAULT 'Divers',
    ratio_mo REAL DEFAULT 0,
    cout_mat_unit REAL DEFAULT 0,
    prix_vente_unit REAL DEFAULT 0,
    nb_occurrences INTEGER DEFAULT 1,
    source_devis TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    nb_ouvrages INTEGER DEFAULT 0,
    nb_nouveaux INTEGER DEFAULT 0,
    nb_fusionnes INTEGER DEFAULT 0,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
