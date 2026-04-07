const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3040;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer - in-memory storage for Excel files
const upload = multer({ storage: multer.memoryStorage() });

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function detectFamille(designation) {
  const d = normalizeText(designation);

  const familles = [
    {
      name: 'Maçonnerie',
      keywords: ['macon', 'agglo', 'parpaing', 'beton', 'mur', 'enduit', 'crepi', 'chape', 'dalle', 'coffrage', 'ferraillage', 'arme', 'saignee', 'jambage', 'seuil', 'linteau']
    },
    {
      name: 'Terrassement',
      keywords: ['terras', 'decap', 'fouille', 'tranchee', 'remblai', 'gravat', 'decharge', 'evacuation', 'deblai', 'excavation']
    },
    {
      name: 'Plomberie',
      keywords: ['plomb', 'pvc', 'tuyau', 'canalisation', 'raccord', 'wc', 'sanitaire', 'eau', 'eu', 'ep', 'siphon', 'robinet', 'vanne']
    },
    {
      name: 'Charpente/Couverture',
      keywords: ['charpente', 'chevron', 'faitage', 'couverture', 'tuile', 'ardoise', 'zinc', 'gouttiere', 'cheneau', 'zinguerie']
    },
    {
      name: 'Menuiserie',
      keywords: ['porte', 'fenetre', 'baie', 'menuiserie', 'portail', 'volet', 'huisserie', 'chassis']
    },
    {
      name: 'Électricité',
      keywords: ['elec', 'tableau', 'cable', 'gaine', 'prise', 'interrupteur', 'luminaire', 'disjoncteur']
    },
    {
      name: 'Isolation',
      keywords: ['isolant', 'isolation', 'laine', 'polystyrene', 'ite', 'iti']
    },
    {
      name: 'Carrelage',
      keywords: ['carrela', 'faience', 'pose', 'joint', 'ragreage']
    },
    {
      name: 'Peinture',
      keywords: ['peinture', 'lasure', 'enduit de finition', 'ravalement']
    }
  ];

  for (const famille of familles) {
    for (const kw of famille.keywords) {
      if (d.includes(kw)) return famille.name;
    }
  }

  return 'Divers';
}

function parseExcel(buffer, filename) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Use "Devis" sheet if exists, else first sheet
  let sheetName = workbook.SheetNames.includes('Devis')
    ? 'Devis'
    : workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const ouvrages = [];

  for (const row of rows) {
    const ref = String(row[0] || '').trim();
    if (!/^L\d+$/.test(ref)) continue;

    const designation = String(row[1] || '').trim();
    if (!designation) continue;

    const qte = parseFloat(row[2]) || 0;
    const unite = String(row[3] || '').trim();
    const pu_ht_unitaire = parseFloat(row[4]) || 0;
    // row[5] = total_ht (unused in ratios)
    const heures_total = parseFloat(row[7]) || 0;
    const achat_mat_total = parseFloat(row[8]) || 0;

    const ratio_mo = qte > 0 ? heures_total / qte : 0;
    const cout_mat_unit = qte > 0 ? achat_mat_total / qte : 0;
    const prix_vente_unit = pu_ht_unitaire;
    const famille = detectFamille(designation);

    ouvrages.push({
      code: ref,
      designation,
      unite,
      famille,
      ratio_mo,
      cout_mat_unit,
      prix_vente_unit,
      source: filename
    });
  }

  return ouvrages;
}

function mergeOuvrage(parsed, filename) {
  const normalizedNew = normalizeText(parsed.designation);

  // Search for exact normalized match
  const existing = db.prepare('SELECT * FROM ouvrages WHERE LOWER(designation) = ?').get(normalizedNew);

  if (existing) {
    // Weighted average for ratios
    const n = existing.nb_occurrences;
    const new_ratio_mo = (existing.ratio_mo * n + parsed.ratio_mo) / (n + 1);
    const new_cout_mat = (existing.cout_mat_unit * n + parsed.cout_mat_unit) / (n + 1);

    let sources = [];
    try {
      sources = JSON.parse(existing.source_devis || '[]');
    } catch {
      sources = [];
    }
    if (!sources.includes(filename)) sources.push(filename);

    db.prepare(`
      UPDATE ouvrages SET
        ratio_mo = ?,
        cout_mat_unit = ?,
        nb_occurrences = nb_occurrences + 1,
        source_devis = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(new_ratio_mo, new_cout_mat, JSON.stringify(sources), existing.id);

    return { action: 'fusionne', id: existing.id };
  } else {
    // Check with normalized comparison
    const allOuvrages = db.prepare('SELECT * FROM ouvrages').all();
    const match = allOuvrages.find(o => normalizeText(o.designation) === normalizedNew);

    if (match) {
      const n = match.nb_occurrences;
      const new_ratio_mo = (match.ratio_mo * n + parsed.ratio_mo) / (n + 1);
      const new_cout_mat = (match.cout_mat_unit * n + parsed.cout_mat_unit) / (n + 1);

      let sources = [];
      try {
        sources = JSON.parse(match.source_devis || '[]');
      } catch {
        sources = [];
      }
      if (!sources.includes(filename)) sources.push(filename);

      db.prepare(`
        UPDATE ouvrages SET
          ratio_mo = ?,
          cout_mat_unit = ?,
          nb_occurrences = nb_occurrences + 1,
          source_devis = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(new_ratio_mo, new_cout_mat, JSON.stringify(sources), match.id);

      return { action: 'fusionne', id: match.id };
    } else {
      // Create new
      const result = db.prepare(`
        INSERT INTO ouvrages (code, designation, unite, famille, ratio_mo, cout_mat_unit, prix_vente_unit, nb_occurrences, source_devis)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        parsed.code,
        parsed.designation,
        parsed.unite,
        parsed.famille,
        parsed.ratio_mo,
        parsed.cout_mat_unit,
        parsed.prix_vente_unit,
        JSON.stringify([filename])
      );

      return { action: 'nouveau', id: result.lastInsertRowid };
    }
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// GET /api/ouvrages
app.get('/api/ouvrages', (req, res) => {
  const { famille, search, sort } = req.query;

  let query = 'SELECT * FROM ouvrages WHERE 1=1';
  const params = [];

  if (famille && famille !== 'all') {
    query += ' AND famille = ?';
    params.push(famille);
  }

  if (search) {
    query += ' AND (designation LIKE ? OR code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const validSorts = ['designation', 'ratio_mo', 'prix_vente_unit', 'nb_occurrences', 'famille'];
  const sortCol = validSorts.includes(sort) ? sort : 'designation';
  query += ` ORDER BY ${sortCol}`;

  const ouvrages = db.prepare(query).all(...params);
  res.json(ouvrages);
});

// POST /api/ouvrages
app.post('/api/ouvrages', (req, res) => {
  const { code, designation, unite, famille, ratio_mo, cout_mat_unit, prix_vente_unit, notes } = req.body;

  if (!designation) return res.status(400).json({ error: 'designation required' });

  const result = db.prepare(`
    INSERT INTO ouvrages (code, designation, unite, famille, ratio_mo, cout_mat_unit, prix_vente_unit, nb_occurrences, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(code || null, designation, unite || null, famille || 'Divers', ratio_mo || 0, cout_mat_unit || 0, prix_vente_unit || 0, notes || null);

  const ouvrage = db.prepare('SELECT * FROM ouvrages WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(ouvrage);
});

// PUT /api/ouvrages/:id
app.put('/api/ouvrages/:id', (req, res) => {
  const { id } = req.params;
  const { code, designation, unite, famille, ratio_mo, cout_mat_unit, prix_vente_unit, notes } = req.body;

  const existing = db.prepare('SELECT * FROM ouvrages WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE ouvrages SET
      code = ?,
      designation = ?,
      unite = ?,
      famille = ?,
      ratio_mo = ?,
      cout_mat_unit = ?,
      prix_vente_unit = ?,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    code ?? existing.code,
    designation ?? existing.designation,
    unite ?? existing.unite,
    famille ?? existing.famille,
    ratio_mo ?? existing.ratio_mo,
    cout_mat_unit ?? existing.cout_mat_unit,
    prix_vente_unit ?? existing.prix_vente_unit,
    notes ?? existing.notes,
    id
  );

  const updated = db.prepare('SELECT * FROM ouvrages WHERE id = ?').get(id);
  res.json(updated);
});

// DELETE /api/ouvrages/:id
app.delete('/api/ouvrages/:id', (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM ouvrages WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// POST /api/import
app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filename = req.file.originalname;
  let parsedOuvrages;

  try {
    parsedOuvrages = parseExcel(req.file.buffer, filename);
  } catch (err) {
    return res.status(400).json({ error: 'Erreur parsing Excel: ' + err.message });
  }

  let nb_nouveaux = 0;
  let nb_fusionnes = 0;
  const resultOuvrages = [];

  for (const parsed of parsedOuvrages) {
    const result = mergeOuvrage(parsed, filename);
    if (result.action === 'nouveau') nb_nouveaux++;
    else nb_fusionnes++;

    const ouvrage = db.prepare('SELECT * FROM ouvrages WHERE id = ?').get(result.id);
    resultOuvrages.push({ ...ouvrage, action: result.action });
  }

  // Save import log
  db.prepare(`
    INSERT INTO imports (filename, nb_ouvrages, nb_nouveaux, nb_fusionnes)
    VALUES (?, ?, ?, ?)
  `).run(filename, parsedOuvrages.length, nb_nouveaux, nb_fusionnes);

  res.json({
    filename,
    nb_ouvrages: parsedOuvrages.length,
    nb_nouveaux,
    nb_fusionnes,
    ouvrages: resultOuvrages
  });
});

// GET /api/imports
app.get('/api/imports', (req, res) => {
  const imports = db.prepare('SELECT * FROM imports ORDER BY imported_at DESC').all();
  res.json(imports);
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const total_ouvrages = db.prepare('SELECT COUNT(*) as count FROM ouvrages').get().count;
  const nb_familles = db.prepare('SELECT COUNT(DISTINCT famille) as count FROM ouvrages').get().count;
  const top_familles = db.prepare(`
    SELECT famille, COUNT(*) as count FROM ouvrages
    GROUP BY famille ORDER BY count DESC
  `).all();

  res.json({ total_ouvrages, nb_familles, top_familles });
});

// GET /api/ouvrages/export/csv
app.get('/api/ouvrages/export/csv', (req, res) => {
  const ouvrages = db.prepare('SELECT * FROM ouvrages ORDER BY designation').all();

  const headers = ['id', 'code', 'designation', 'unite', 'famille', 'ratio_mo', 'cout_mat_unit', 'prix_vente_unit', 'nb_occurrences', 'source_devis', 'notes', 'created_at', 'updated_at'];

  const csvRows = [
    headers.join(';'),
    ...ouvrages.map(o =>
      headers.map(h => {
        const val = o[h] ?? '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(';')
    )
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ouvrages-db.csv"');
  res.send('\uFEFF' + csvRows.join('\n'));
});

// ─── Paramètres ──────────────────────────────────────────────────────────────

app.get('/api/parametres', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM parametres').all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

app.put('/api/parametres', (req, res) => {
  const { taux_horaire, coef_fg, marge_mat } = req.body;
  const update = db.prepare('INSERT OR REPLACE INTO parametres (key, value) VALUES (?, ?)');
  const updateAll = db.transaction(() => {
    if (taux_horaire !== undefined) update.run('taux_horaire', parseFloat(taux_horaire));
    if (coef_fg !== undefined) update.run('coef_fg', parseFloat(coef_fg));
    if (marge_mat !== undefined) update.run('marge_mat', parseFloat(marge_mat));
  });
  updateAll();
  const rows = db.prepare('SELECT key, value FROM parametres').all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

// GET /api/ouvrages/prix-calcule — prix de vente calculé pour tous les ouvrages
app.get('/api/ouvrages/prix-calcule', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM parametres').all();
  const params = {};
  rows.forEach(r => params[r.key] = r.value);

  const { taux_horaire = 45, coef_fg = 1.36, marge_mat = 0.30 } = params;

  const ouvrages = db.prepare('SELECT id, ratio_mo, cout_mat_unit FROM ouvrages').all();
  const result = ouvrages.map(o => ({
    id: o.id,
    prix_calcule: parseFloat(((o.ratio_mo * taux_horaire * coef_fg) + (o.cout_mat_unit * (1 + marge_mat))).toFixed(2))
  }));
  res.json({ parametres: params, ouvrages: result });
});

// ─── Template Excel devis ─────────────────────────────────────────────────────
app.get('/api/template/devis', (req, res) => {
  const paramRows = db.prepare('SELECT key, value FROM parametres').all();
  const params = {};
  paramRows.forEach(r => params[r.key] = r.value);
  const { taux_horaire = 45, coef_fg = 1.36, marge_mat = 0.30 } = params;

  const ouvrages = db.prepare('SELECT * FROM ouvrages ORDER BY famille, designation').all();
  const nbOuvrages = ouvrages.length;

  const wb = XLSX.utils.book_new();

  // ── Feuille Base (cachée, source RECHERCHEV) ──────────────────────────────
  // Col A=désignation, B=unité, C=ratio_mo, D=cout_mat_unit, E=prix_vente_calculé
  const baseHeader = ['Désignation', 'Unité', 'Ratio MO (h/u)', 'Matériaux (€/u)', 'Prix Vente HT (€/u)', 'Famille'];
  const baseData = [baseHeader, ...ouvrages.map(o => [
    o.designation,
    o.unite || '',
    parseFloat(o.ratio_mo.toFixed(4)),
    parseFloat(o.cout_mat_unit.toFixed(2)),
    parseFloat(((o.ratio_mo * taux_horaire * coef_fg) + (o.cout_mat_unit * (1 + marge_mat))).toFixed(2)),
    o.famille
  ])];
  const wsBase = XLSX.utils.aoa_to_sheet(baseData);
  wsBase['!cols'] = [{ wch: 55 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsBase, 'Base');

  // Plage Base pour VLOOKUP : Base!$A$2:$E$N
  const baseRange = `Base!$A$2:$E$${nbOuvrages + 1}`;
  // Plage désignations pour validation : Base!$A$2:$A$N
  const desigRange = `Base!$A$2:$A$${nbOuvrages + 1}`;

  // ── Feuille Devis ─────────────────────────────────────────────────────────
  const NB_LIGNES = 40;
  const FIRST_DATA_ROW = 71; // ligne Excel où commence la première ligne ouvrage

  // Helper : cellule Excel
  const cell = (col, row) => `${col}${row}`;

  // Construire le tableau de lignes (AOA)
  const rows = [];

  // -- En-tête entreprise (lignes 1-9)
  rows.push(['HERES Construction']);
  rows.push(['12 Rue de la tannerie 77 250 ECUELLES  MORET SUR LOING']);
  rows.push(['06 86 27 82 27 / tel & fax 01 60 70 22 51   RCS Melun B 439 371 014']);
  rows.push(['Maçonnerie – Couverture – Béton armé – Carrelage']);
  rows.push(['SIRET N° 439 371 014 00028']);
  rows.push(['Certificat QUALIBAT RGE E106948 code 431']);
  rows.push(['Site internet : heres-construction.fr']);
  rows.push(['Email : heresconstruction@orange.fr']);
  rows.push([]); // ligne 9

  // -- Bloc client (lignes 10-17)
  rows.push(['Client :', '', '', '[ NOM CLIENT ]']); // 10
  rows.push(['', '', '', '[ ADRESSE ]']); // 11
  rows.push(['', '', '', '[ CODE POSTAL VILLE ]']); // 12
  rows.push(['Ecuelles, le', new Date()]); // 13
  rows.push(['', '', '', 'Tel : [ TEL CLIENT ]']); // 14
  rows.push([]); // 15
  rows.push(['Devis N°', '[ NUMÉRO DEVIS ]']); // 16
  rows.push(['[ TITRE DES TRAVAUX ]']); // 17
  rows.push([]); // 18

  // -- Adresse travaux (lignes 19-21)
  rows.push(['Adresse des travaux :']); // 19
  rows.push(['[ ADRESSE DES TRAVAUX ]']); // 20
  rows.push(['Date de la visite préalable :', '', new Date()]); // 21
  rows.push(['Date prévisionnelle de démarrage :']); // 22
  rows.push([]); // 23

  // -- Texte commercial (lignes 24-30)
  rows.push(['DEVIS']); // 24
  rows.push([]); // 25
  rows.push(['   Veuillez trouver ci-joint notre meilleure offre pour les travaux décrits ci-joints.']); // 26
  rows.push(['Je me tiens à votre disposition au 06 86 27 82 27 pour tout complément d\'information.']); // 27
  rows.push([]); // 28
  rows.push(['  En souhaitant que notre offre vous convienne, je vous prie d\'agréer, Madame, Monsieur,']); // 29
  rows.push(['l\'expression de mes sentiments distingués.']); // 30
  rows.push(['', '', '', 'Rémi SCHLEGEL']); // 31

  // -- Conditions (lignes 32-45)
  for (let i = 0; i < 10; i++) rows.push([]); // 32-41
  rows.push(['  Notre offre est établie sur la base économique actuelle et révisable selon l\'indice de la construction.']); // 42
  rows.push(['Terme de paiement : 20% à la commande, 80% à l\'avancement physique sur situations mensuelles']); // 43
  rows.push(['La TVA est ajustable selon le taux en vigueur au moment de la facturation']); // 44
  rows.push(['Conditions de paiement : 20 jours à réception des factures']); // 45
  rows.push(['Durée de validité de notre offre : 2 mois']); // 46
  for (let i = 0; i < 5; i++) rows.push([]); // 47-51
  rows.push(['  En cas d\'accord, veuillez nous retourner ce présent devis avec la mention "BON POUR ACCORD", daté et signé.', '', '', '[ NOM CLIENT ]']); // 52
  rows.push([]); // 53
  rows.push(['date :']); // 54
  for (let i = 0; i < 6; i++) rows.push([]); // 55-60
  rows.push(['Assurance professionnelle : EIRL VITRY ASSURANCES - MMA 30 rue Casimir Perrier BP31 77302 FONTAINEBLEAU']); // 61
  rows.push([]); // 62

  // -- En-têtes tableau (lignes 63-70)
  rows.push(['N° Étude', '[ NUMÉRO DEVIS ]']); // 63
  rows.push(['[ NOM CLIENT ]']); // 64
  rows.push([]); // 65
  rows.push([]); // 66
  rows.push(['', '', '', '', 'EUROS', '', '', 'Heures', 'Achat mat. HT']); // 67
  rows.push(['Ref', 'DESCRIPTIF', 'Quantité', 'Unité', 'Prix/unit HT €', 'Prix HT €', 'Sous-total', 'H', '€']); // 68
  rows.push(['', '', '', '', '', '', '€ HT', '', '']); // 69
  rows.push([]); // 70  ← séparateur avant les ouvrages

  // -- Lignes ouvrages (lignes 71 → 71+NB_LIGNES-1)
  for (let i = 0; i < NB_LIGNES; i++) {
    const r = FIRST_DATA_ROW + i;
    rows.push([
      `L${i + 1}`,                                                                           // A : Ref
      '',                                                                                     // B : Désignation (liste déroulante)
      '',                                                                                     // C : Quantité (saisie)
      { f: `IF(B${r}="","",IFERROR(VLOOKUP(B${r},${baseRange},2,0),""))` },                 // D : Unité auto
      { f: `IF(B${r}="","",IFERROR(VLOOKUP(B${r},${baseRange},5,0),""))` },                 // E : Prix unit HT calculé
      { f: `IF(OR(C${r}="",E${r}=""),"",ROUND(C${r}*E${r},2))` },                          // F : Prix HT = Qté × PU
      '',                                                                                     // G : Sous-total (rempli manuellement par lot)
      { f: `IF(OR(C${r}="",B${r}=""),"",IFERROR(ROUND(C${r}*VLOOKUP(B${r},${baseRange},3,0),2),""))` }, // H : Total MO heures
      { f: `IF(OR(C${r}="",B${r}=""),"",IFERROR(ROUND(C${r}*VLOOKUP(B${r},${baseRange},4,0),2),""))` }, // I : Total achat mat.
    ]);
  }

  // -- Totaux
  const lastDataRow = FIRST_DATA_ROW + NB_LIGNES - 1;
  const totalRow = lastDataRow + 1;
  const tvaRow = totalRow + 1;
  const ttcRow = tvaRow + 1;

  rows.push(['', 'TOTAL € HT', '', '', '', { f: `SUM(F${FIRST_DATA_ROW}:F${lastDataRow})` }, '', { f: `SUM(H${FIRST_DATA_ROW}:H${lastDataRow})` }, { f: `SUM(I${FIRST_DATA_ROW}:I${lastDataRow})` }]);
  rows.push(['', 'TVA 10%', '', '', 0.10, { f: `ROUND(F${totalRow}*E${tvaRow},2)` }]);
  rows.push(['', 'TOTAL € TTC', '', '', '', { f: `F${totalRow}+F${tvaRow}` }]);

  const wsDevis = XLSX.utils.aoa_to_sheet(rows);

  // Largeurs colonnes
  wsDevis['!cols'] = [
    { wch: 6 },  // A Ref
    { wch: 55 }, // B Désignation
    { wch: 10 }, // C Quantité
    { wch: 8 },  // D Unité
    { wch: 16 }, // E Prix unit HT
    { wch: 14 }, // F Prix HT
    { wch: 12 }, // G Sous-total
    { wch: 12 }, // H Heures MO
    { wch: 14 }, // I Achat mat
  ];

  // ── Validation (liste déroulante) sur colonne B pour les lignes ouvrages ──
  // Utilise la plage Base!$A$2:$A$N
  if (!wsDevis['!dataValidation']) wsDevis['!dataValidation'] = [];
  wsDevis['!dataValidation'].push({
    type: 'list',
    allowBlank: true,
    showDropDown: false,
    sqref: `B${FIRST_DATA_ROW}:B${lastDataRow}`,
    formula1: desigRange,
  });

  XLSX.utils.book_append_sheet(wb, wsDevis, 'Devis');

  // ── Génération fichier ────────────────────────────────────────────────────
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="template-devis-${date}.xlsx"`);
  res.send(buf);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🏗️  OuvragesDB running on http://localhost:${PORT}`);
});
