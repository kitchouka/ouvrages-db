// ─── State ───────────────────────────────────────────────────────────────────
let ouvrages = [];
let currentTab = 'bibliotheque';
let parametres = { taux_horaire: 45, coef_fg: 1.36, marge_mat: 0.30 };

function prixCalcule(o) {
  return (o.ratio_mo * parametres.taux_horaire * parametres.coef_fg)
       + (o.cout_mat_unit * (1 + parametres.marge_mat));
}

// ─── Famille colors ───────────────────────────────────────────────────────────
const FAMILLE_COLORS = {
  'Maçonnerie':         'bg-amber-900/40 text-amber-300',
  'Terrassement':       'bg-yellow-900/40 text-yellow-300',
  'Plomberie':          'bg-blue-900/40 text-blue-300',
  'Charpente/Couverture': 'bg-orange-900/40 text-orange-300',
  'Menuiserie':         'bg-lime-900/40 text-lime-300',
  'Électricité':        'bg-purple-900/40 text-purple-300',
  'Isolation':          'bg-cyan-900/40 text-cyan-300',
  'Carrelage':          'bg-rose-900/40 text-rose-300',
  'Peinture':           'bg-pink-900/40 text-pink-300',
  'Divers':             'bg-gray-700/60 text-gray-300',
};

function getFamilleClass(famille) {
  return FAMILLE_COLORS[famille] || 'bg-gray-700/60 text-gray-300';
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');

  if (tab === 'bibliotheque') loadOuvrages();
  if (tab === 'import') loadImportHistory();
  if (tab === 'stats') loadStats();
  if (tab === 'parametres') loadParametres();
}

// ─── Bibliothèque ─────────────────────────────────────────────────────────────
let debounceTimer;

document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadOuvrages, 300);
});

document.getElementById('famille-filter').addEventListener('change', loadOuvrages);
document.getElementById('sort-select').addEventListener('change', loadOuvrages);

async function loadOuvrages() {
  const search = document.getElementById('search-input').value;
  const famille = document.getElementById('famille-filter').value;
  const sort = document.getElementById('sort-select').value;

  const params = new URLSearchParams({ famille, sort });
  if (search) params.set('search', search);

  const res = await fetch(`/api/ouvrages?${params}`);
  ouvrages = await res.json();

  renderOuvrages(ouvrages);
}

function renderOuvrages(data) {
  document.getElementById('ouvrage-count').textContent = data.length;
  const tbody = document.getElementById('ouvrages-tbody');

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-8 text-center text-gray-500">Aucun ouvrage trouvé</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(o => {
    const familleClass = getFamilleClass(o.famille);
    const occBadge = occurrenceBadge(o.nb_occurrences);

    return `<tr class="hover:bg-gray-800/50 cursor-pointer transition-colors" onclick="openDrawer(${o.id})">
      <td class="px-4 py-3">
        <div class="text-gray-100 font-medium max-w-xs truncate" title="${escHtml(o.designation)}">${escHtml(o.designation)}</div>
        ${o.code ? `<div class="text-xs text-gray-500">${escHtml(o.code)}</div>` : ''}
      </td>
      <td class="px-4 py-3">
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${familleClass}">${escHtml(o.famille)}</span>
      </td>
      <td class="px-4 py-3 text-center text-gray-300">${escHtml(o.unite || '—')}</td>
      <td class="px-4 py-3 text-right text-gray-300">${fmtNum(o.ratio_mo)}</td>
      <td class="px-4 py-3 text-right text-gray-300">${fmtEur(o.cout_mat_unit)}</td>
      <td class="px-4 py-3 text-right text-gray-400 line-through text-xs">${fmtEur(o.prix_vente_unit)}</td>
      <td class="px-4 py-3 text-right font-semibold text-green-400">${fmtEur(prixCalcule(o))}</td>
      <td class="px-4 py-3 text-center">${occBadge}</td>
      <td class="px-4 py-3 text-center" onclick="event.stopPropagation()">
        <div class="flex items-center justify-center gap-2">
          <button onclick="editOuvrage(${o.id})" class="text-gray-400 hover:text-blue-400 transition-colors text-base" title="Modifier">✏️</button>
          <button onclick="deleteOuvrage(${o.id})" class="text-gray-400 hover:text-red-400 transition-colors text-base" title="Supprimer">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function occurrenceBadge(n) {
  if (n >= 4) return `<span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-900/60 text-green-300 text-xs font-bold">${n}</span>`;
  if (n >= 2) return `<span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-900/60 text-blue-300 text-xs font-bold">${n}</span>`;
  return `<span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-700 text-gray-400 text-xs font-bold">${n}</span>`;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────
function openDrawer(id) {
  const o = ouvrages.find(x => x.id === id);
  if (!o) return;

  let sources = [];
  try { sources = JSON.parse(o.source_devis || '[]'); } catch {}

  document.getElementById('drawer-content').innerHTML = `
    <div class="space-y-4">
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Désignation</p>
        <p class="text-white font-medium">${escHtml(o.designation)}</p>
        ${o.code ? `<p class="text-xs text-gray-500 mt-1">Réf: ${escHtml(o.code)}</p>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Famille</p>
          <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getFamilleClass(o.famille)}">${escHtml(o.famille)}</span>
        </div>
        <div>
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Unité</p>
          <p class="text-white">${escHtml(o.unite || '—')}</p>
        </div>
      </div>
      <div class="bg-gray-800/50 rounded-xl p-4 grid grid-cols-3 gap-4">
        <div class="text-center">
          <p class="text-xl font-bold text-blue-300">${fmtNum(o.ratio_mo)}</p>
          <p class="text-xs text-gray-500 mt-1">h MO / unité</p>
        </div>
        <div class="text-center">
          <p class="text-xl font-bold text-yellow-300">${fmtEur(o.cout_mat_unit)}</p>
          <p class="text-xs text-gray-500 mt-1">€ mat. / unité</p>
        </div>
        <div class="text-center">
          <p class="text-xl font-bold text-green-300">${fmtEur(o.prix_vente_unit)}</p>
          <p class="text-xs text-gray-500 mt-1">€ PV / unité</p>
        </div>
      </div>
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Occurrences</p>
        <div class="flex items-center gap-2">
          ${occurrenceBadge(o.nb_occurrences)}
          <span class="text-sm text-gray-300">${o.nb_occurrences} fois dans les devis</span>
        </div>
      </div>
      ${sources.length ? `
        <div>
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-2">Sources devis</p>
          <div class="flex flex-wrap gap-2">
            ${sources.map(s => `<span class="px-2 py-1 rounded bg-gray-800 text-xs text-gray-300">${escHtml(s)}</span>`).join('')}
          </div>
        </div>` : ''}
      ${o.notes ? `
        <div>
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
          <p class="text-sm text-gray-300 whitespace-pre-wrap">${escHtml(o.notes)}</p>
        </div>` : ''}
      <div class="text-xs text-gray-600 pt-2 border-t border-gray-800">
        Créé le ${fmtDate(o.created_at)} · Mis à jour le ${fmtDate(o.updated_at)}
      </div>
      <div class="flex gap-2 pt-2">
        <button onclick="editOuvrage(${o.id}); closeDrawer()" class="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors">
          ✏️ Modifier
        </button>
        <button onclick="deleteOuvrage(${o.id}); closeDrawer()" class="px-4 py-2 rounded-lg bg-red-900/50 hover:bg-red-900 text-sm transition-colors text-red-300">
          🗑️ Supprimer
        </button>
      </div>
    </div>
  `;

  document.getElementById('drawer-overlay').classList.remove('hidden');
  document.getElementById('drawer').classList.remove('translate-x-full');
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.add('hidden');
  document.getElementById('drawer').classList.add('translate-x-full');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('modal-title').textContent = '➕ Nouvel ouvrage';
  document.getElementById('edit-id').value = '';
  document.getElementById('add-form').reset();
  document.getElementById('f-ratio-mo').value = '0';
  document.getElementById('f-cout-mat').value = '0';
  document.getElementById('f-prix-vente').value = '0';
  document.getElementById('modal-add').classList.remove('hidden');
}

function closeAddModal() {
  document.getElementById('modal-add').classList.add('hidden');
}

function editOuvrage(id) {
  const o = ouvrages.find(x => x.id === id);
  if (!o) return;

  document.getElementById('modal-title').textContent = '✏️ Modifier l\'ouvrage';
  document.getElementById('edit-id').value = id;
  document.getElementById('f-designation').value = o.designation;
  document.getElementById('f-famille').value = o.famille;
  document.getElementById('f-unite').value = o.unite || '';
  document.getElementById('f-ratio-mo').value = o.ratio_mo;
  document.getElementById('f-cout-mat').value = o.cout_mat_unit;
  document.getElementById('f-prix-vente').value = o.prix_vente_unit;
  document.getElementById('f-notes').value = o.notes || '';
  document.getElementById('modal-add').classList.remove('hidden');
}

document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const body = {
    designation: document.getElementById('f-designation').value,
    famille: document.getElementById('f-famille').value,
    unite: document.getElementById('f-unite').value,
    ratio_mo: parseFloat(document.getElementById('f-ratio-mo').value) || 0,
    cout_mat_unit: parseFloat(document.getElementById('f-cout-mat').value) || 0,
    prix_vente_unit: parseFloat(document.getElementById('f-prix-vente').value) || 0,
    notes: document.getElementById('f-notes').value
  };

  const url = id ? `/api/ouvrages/${id}` : '/api/ouvrages';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    closeAddModal();
    loadOuvrages();
  } else {
    const err = await res.json();
    alert('Erreur: ' + (err.error || 'Inconnue'));
  }
});

async function deleteOuvrage(id) {
  if (!confirm('Supprimer cet ouvrage ?')) return;
  const res = await fetch(`/api/ouvrages/${id}`, { method: 'DELETE' });
  if (res.ok) loadOuvrages();
}

// ─── Import ───────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('border-blue-400', 'bg-blue-500/10');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-blue-400', 'bg-blue-500/10');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('border-blue-400', 'bg-blue-500/10');
  const file = e.dataTransfer.files[0];
  if (file) importFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) importFile(fileInput.files[0]);
});

function openImportModal() {
  switchTab('import');
}

function closeImportModal() {
  document.getElementById('modal-import').classList.add('hidden');
}

async function importFile(file) {
  document.getElementById('modal-import').classList.remove('hidden');
  document.getElementById('import-modal-icon').textContent = '⏳';
  document.getElementById('import-modal-title').textContent = 'Import en cours…';
  document.getElementById('import-modal-msg').textContent = file.name;
  document.getElementById('import-modal-close').classList.add('hidden');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Erreur serveur');

    document.getElementById('import-modal-icon').textContent = '✅';
    document.getElementById('import-modal-title').textContent = 'Import terminé !';
    document.getElementById('import-modal-msg').textContent = `${data.nb_nouveaux} nouveaux · ${data.nb_fusionnes} fusionnés`;
    document.getElementById('import-modal-close').classList.remove('hidden');

    // Show result
    document.getElementById('res-total').textContent = data.nb_ouvrages;
    document.getElementById('res-nouveaux').textContent = data.nb_nouveaux;
    document.getElementById('res-fusionnes').textContent = data.nb_fusionnes;
    document.getElementById('import-result').classList.remove('hidden');

    renderImportPreview(data.ouvrages);
    loadImportHistory();

    // Reset file input
    fileInput.value = '';

  } catch (err) {
    document.getElementById('import-modal-icon').textContent = '❌';
    document.getElementById('import-modal-title').textContent = 'Erreur d\'import';
    document.getElementById('import-modal-msg').textContent = err.message;
    document.getElementById('import-modal-close').classList.remove('hidden');
  }
}

function renderImportPreview(data) {
  const tbody = document.getElementById('import-preview-tbody');
  tbody.innerHTML = data.map(o => {
    const actionBadge = o.action === 'nouveau'
      ? '<span class="px-2 py-0.5 rounded-full bg-green-900/60 text-green-300 text-xs">Nouveau</span>'
      : '<span class="px-2 py-0.5 rounded-full bg-yellow-900/60 text-yellow-300 text-xs">Fusionné</span>';

    return `<tr class="border-t border-gray-800">
      <td class="px-4 py-2 text-gray-200 text-sm max-w-xs truncate">${escHtml(o.designation)}</td>
      <td class="px-4 py-2"><span class="text-xs px-2 py-0.5 rounded-full ${getFamilleClass(o.famille)}">${escHtml(o.famille)}</span></td>
      <td class="px-4 py-2 text-right text-gray-300 text-sm">${fmtNum(o.ratio_mo)}</td>
      <td class="px-4 py-2 text-right text-gray-300 text-sm">${fmtEur(o.cout_mat_unit)}</td>
      <td class="px-4 py-2 text-right text-gray-300 text-sm">${fmtEur(o.prix_vente_unit)}</td>
      <td class="px-4 py-2 text-center">${actionBadge}</td>
    </tr>`;
  }).join('');
}

async function loadImportHistory() {
  const res = await fetch('/api/imports');
  const data = await res.json();
  const tbody = document.getElementById('imports-history-tbody');

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-gray-500">Aucun import</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(imp => `
    <tr class="border-t border-gray-800">
      <td class="px-4 py-3 text-gray-400 text-sm">${fmtDate(imp.imported_at)}</td>
      <td class="px-4 py-3 text-gray-200 text-sm">${escHtml(imp.filename)}</td>
      <td class="px-4 py-3 text-center text-gray-300">${imp.nb_ouvrages}</td>
      <td class="px-4 py-3 text-center text-green-400">${imp.nb_nouveaux}</td>
      <td class="px-4 py-3 text-center text-yellow-400">${imp.nb_fusionnes}</td>
    </tr>
  `).join('');
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();

  document.getElementById('stat-total').textContent = data.total_ouvrages;
  document.getElementById('stat-familles').textContent = data.nb_familles;

  renderBarChart(data.top_familles);
  renderTop10();
}

function renderBarChart(familles) {
  const max = familles.length ? familles[0].count : 1;
  const container = document.getElementById('bar-chart');

  container.innerHTML = familles.map(f => {
    const pct = Math.round((f.count / max) * 100);
    const familleClass = getFamilleClass(f.famille);
    const barColor = familleClass.includes('amber') ? 'bg-amber-500'
      : familleClass.includes('yellow') ? 'bg-yellow-500'
      : familleClass.includes('blue') ? 'bg-blue-500'
      : familleClass.includes('orange') ? 'bg-orange-500'
      : familleClass.includes('lime') ? 'bg-lime-500'
      : familleClass.includes('purple') ? 'bg-purple-500'
      : familleClass.includes('cyan') ? 'bg-cyan-500'
      : familleClass.includes('rose') ? 'bg-rose-500'
      : familleClass.includes('pink') ? 'bg-pink-500'
      : 'bg-gray-500';

    return `<div class="flex items-center gap-3">
      <div class="w-36 text-sm text-gray-300 truncate">${escHtml(f.famille)}</div>
      <div class="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
        <div class="${barColor} h-5 rounded-full transition-all duration-500" style="width:${pct}%"></div>
      </div>
      <div class="w-8 text-right text-sm text-gray-400">${f.count}</div>
    </div>`;
  }).join('');
}

async function renderTop10() {
  const res = await fetch('/api/ouvrages?sort=nb_occurrences');
  const data = await res.json();
  const top10 = data.sort((a, b) => b.nb_occurrences - a.nb_occurrences).slice(0, 10);

  const container = document.getElementById('top10-list');
  container.innerHTML = top10.map((o, i) => `
    <div class="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors cursor-pointer" onclick="switchTab('bibliotheque')">
      <div class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">${i + 1}</div>
      <div class="flex-1 min-w-0">
        <p class="text-sm text-gray-200 truncate">${escHtml(o.designation)}</p>
        <p class="text-xs text-gray-500">${escHtml(o.famille)} · ${escHtml(o.unite || '—')}</p>
      </div>
      ${occurrenceBadge(o.nb_occurrences)}
    </div>
  `).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n) {
  if (!n && n !== 0) return '—';
  return parseFloat(n).toFixed(2);
}

function fmtEur(n) {
  if (!n && n !== 0) return '—';
  return parseFloat(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
}

function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Paramètres ───────────────────────────────────────────────────────────────
async function loadParametres() {
  const res = await fetch('/api/parametres');
  parametres = await res.json();
  document.getElementById('param-taux-horaire').value = parametres.taux_horaire;
  document.getElementById('param-coef-fg').value = parametres.coef_fg;
  document.getElementById('param-marge-mat').value = parametres.marge_mat;
  updateParamPreview();
}

function updateParamPreview() {
  const th = parseFloat(document.getElementById('param-taux-horaire').value) || 0;
  const fg = parseFloat(document.getElementById('param-coef-fg').value) || 1;
  const mm = parseFloat(document.getElementById('param-marge-mat').value) || 0;
  // Exemple : 2h MO, 50€ matériaux
  const exMO = 2 * th * fg;
  const exMat = 50 * (1 + mm);
  const total = exMO + exMat;
  document.getElementById('param-preview').innerHTML = `
    <p>Exemple : <strong>2h MO</strong> + <strong>50€ matériaux</strong></p>
    <p class="mt-1">→ MO : 2 × ${th}€ × ${fg} = <span class="text-blue-400">${exMO.toFixed(2)}€</span></p>
    <p>→ Mat : 50€ × (1 + ${mm}) = <span class="text-yellow-400">${exMat.toFixed(2)}€</span></p>
    <p class="mt-1 font-semibold text-green-400">→ Prix de vente : ${total.toFixed(2)}€ HT</p>
  `;
}

['param-taux-horaire', 'param-coef-fg', 'param-marge-mat'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updateParamPreview);
});

async function saveParametres() {
  const taux_horaire = parseFloat(document.getElementById('param-taux-horaire').value);
  const coef_fg = parseFloat(document.getElementById('param-coef-fg').value);
  const marge_mat = parseFloat(document.getElementById('param-marge-mat').value);

  const res = await fetch('/api/parametres', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taux_horaire, coef_fg, marge_mat })
  });
  parametres = await res.json();

  const msg = document.getElementById('param-success');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);

  // Rafraîchir le tableau si on est sur bibliothèque
  if (currentTab === 'bibliotheque') loadOuvrages();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadParametres();
  loadOuvrages();
}
init();
