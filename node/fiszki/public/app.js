// ─── API ───────────────────────────────────────────────────────────────────

const api = {
  async _fetch(method, url, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Błąd serwera');
    return data;
  },
  getFiszki:       ()       => api._fetch('GET',    '/api/fiszki'),
  getCapabilities: ()       => api._fetch('GET',    '/api/capabilities'),
  addFiszka:       (p, t)   => api._fetch('POST',   '/api/fiszki',       { przod: p, tyl: t }),
  updateFiszka:    (id,p,t) => api._fetch('PUT',    `/api/fiszki/${id}`, { przod: p, tyl: t }),
  deleteFiszka:    (id)     => api._fetch('DELETE', `/api/fiszki/${id}`),
  async upload(file) {
    const fd = new FormData();
    fd.append('plik', file);
    return api._fetch('POST', '/api/upload', fd);
  },
};

// ─── State ─────────────────────────────────────────────────────────────────

const state = {
  fiszki:   [],          // wszystkie fiszki
  filtered: [],          // po filtrach (źródło + szukaj)
  idx:      0,           // aktualny indeks w trybie nauki
  flipped:  false,       // czy karta odwrócona
  answered: {},          // { id: 'correct' | 'incorrect' }
  mode:     'study',     // 'study' | 'browse'
  query:    '',
  source:   'all',
};

// ─── DOM ───────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const viewStudy    = $('view-study');
const viewBrowse   = $('view-browse');
const viewSummary  = $('view-summary');
const viewEmpty    = $('view-empty');

const studyCard    = $('study-card');
const studyFront   = $('study-front');
const studyBack    = $('study-back');
const studySrc     = $('study-source');
const studySrcBack = $('study-source-back');

const progressFill = $('progress-fill');
const progressText = $('progress-text');

const hdrCorrect   = $('hdr-correct');
const hdrIncorrect = $('hdr-incorrect');
const totalCount   = $('total-count');

const cardsGrid    = $('cards-grid');
const sourcesList  = $('sources-list');
const searchInput  = $('search');
const loadingEl    = $('loading');
const loadingText  = $('loading-text');
const loadingHint  = $('loading-hint');
const toastEl      = $('toasts');
const fileInput    = $('file-input');
const dropzone     = $('dropzone');
const modalOverlay = $('modal-overlay');
const modalTitle   = $('modal-title');
const frontInput   = $('form-front');
const backInput    = $('form-back');
const modalForm    = $('modal-form');

let editingId = null;

// ─── Helpers ───────────────────────────────────────────────────────────────

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastEl.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function setLoading(on, text = 'Bielik analizuje notatki...', hint = 'To może potrwać chwilę') {
  loadingEl.classList.toggle('active', on);
  if (on) { loadingText.textContent = text; loadingHint.textContent = hint; }
}

function plural(n) {
  if (n === 1) return '1 fiszka';
  if (n >= 2 && n <= 4) return `${n} fiszki`;
  return `${n} fiszek`;
}

// ─── Filtered list ─────────────────────────────────────────────────────────

function applyFilters() {
  state.filtered = state.fiszki.filter(f => {
    const bySource = state.source === 'all' || f.zrodlo === state.source;
    const q = state.query.toLowerCase();
    const byQuery = !q || f.przod.toLowerCase().includes(q) || f.tyl.toLowerCase().includes(q);
    return bySource && byQuery;
  });
}

// ─── Score ─────────────────────────────────────────────────────────────────

function getScore() {
  const vals = Object.values(state.answered);
  return {
    correct:   vals.filter(v => v === 'correct').length,
    incorrect: vals.filter(v => v === 'incorrect').length,
    answered:  vals.length,
    total:     state.filtered.length,
  };
}

function renderScore() {
  const s = getScore();
  hdrCorrect.textContent   = `✓ ${s.correct}`;
  hdrIncorrect.textContent = `✗ ${s.incorrect}`;
}

// ─── View switching ────────────────────────────────────────────────────────

function showView(name) {
  viewStudy.style.display   = name === 'study'   ? 'flex' : 'none';
  viewBrowse.style.display  = name === 'browse'  ? 'flex' : 'none';
  viewSummary.style.display = name === 'summary' ? 'flex' : 'none';
  viewEmpty.style.display   = name === 'empty'   ? 'flex' : 'none';
}

function updateModeButton() {
  const btn = $('btn-mode');
  if (state.mode === 'study') {
    btn.textContent = '⊞ Przeglądaj';
    btn.classList.remove('active');
  } else {
    btn.textContent = '▶ Ucz się';
    btn.classList.add('active');
  }
}

// ─── Study mode ────────────────────────────────────────────────────────────

function renderStudyCard() {
  const { filtered, idx, answered } = state;

  if (filtered.length === 0) { showView('empty'); return; }

  // Clamp index
  state.idx = Math.max(0, Math.min(idx, filtered.length - 1));
  const card = filtered[state.idx];

  // Progress
  const pct = filtered.length > 0 ? ((state.idx + 1) / filtered.length) * 100 : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${state.idx + 1} / ${filtered.length}`;

  // Card content
  studyFront.textContent   = card.przod;
  studyBack.textContent    = card.tyl;
  studySrc.textContent     = card.zrodlo;
  studySrcBack.textContent = card.zrodlo;

  // Flip reset
  state.flipped = false;
  studyCard.classList.remove('flipped');

  // Answered state border tint
  studyCard.classList.remove('answered-correct', 'answered-incorrect');
  const ans = answered[card.id];
  if (ans === 'correct')   studyCard.classList.add('answered-correct');
  if (ans === 'incorrect') studyCard.classList.add('answered-incorrect');

  showView('study');
}

function navigate(delta) {
  const newIdx = state.idx + delta;
  if (newIdx >= state.filtered.length) {
    showSummary();
    return;
  }
  if (newIdx < 0) return;
  state.idx = newIdx;
  renderStudyCard();
}

function recordAnswer(result) {
  if (state.filtered.length === 0) return;
  const card = state.filtered[state.idx];
  state.answered[card.id] = result;
  renderScore();
  // If card visible on back, show tint then advance
  studyCard.classList.remove('answered-correct', 'answered-incorrect');
  studyCard.classList.add(result === 'correct' ? 'answered-correct' : 'answered-incorrect');
  setTimeout(() => navigate(1), 400);
}

function showSummary() {
  const s = getScore();
  $('sum-correct').textContent   = s.correct;
  $('sum-incorrect').textContent = s.incorrect;
  $('sum-total').textContent     = s.total;
  const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
  $('sum-pct').textContent = `${pct}% poprawnych odpowiedzi`;
  showView('summary');
}

function resetSession() {
  state.answered = {};
  state.idx = 0;
  renderScore();
  renderStudyCard();
}

// ─── Browse mode ───────────────────────────────────────────────────────────

function renderBrowse() {
  const cards = state.filtered;

  if (cards.length === 0) {
    cardsGrid.innerHTML = `
      <div class="grid-empty">
        <div style="font-size:2rem">🃏</div>
        <div>${state.query ? 'Brak wyników dla "' + esc(state.query) + '"' : 'Brak fiszek'}</div>
      </div>`;
    return;
  }

  cardsGrid.innerHTML = cards.map(f => `
    <div class="card-wrapper grid-card-wrapper" data-id="${f.id}">
      <div class="card-inner">
        <div class="card-face card-front">
          <div class="card-label">Pytanie</div>
          <div class="card-text">${esc(f.przod)}</div>
          <div class="card-footer">
            <span class="card-source" title="${esc(f.zrodlo)}">${esc(f.zrodlo)}</span>
            <div class="card-actions">
              <button class="action-btn edit"   data-id="${f.id}" title="Edytuj">✏️</button>
              <button class="action-btn delete" data-id="${f.id}" title="Usuń">🗑️</button>
            </div>
          </div>
        </div>
        <div class="card-face card-back">
          <div class="card-label">Odpowiedź</div>
          <div class="card-text">${esc(f.tyl)}</div>
          <div class="card-footer">
            <span class="card-source">${esc(f.zrodlo)}</span>
            <div class="card-actions">
              <button class="action-btn edit"   data-id="${f.id}" title="Edytuj">✏️</button>
              <button class="action-btn delete" data-id="${f.id}" title="Usuń">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    </div>`).join('');

  cardsGrid.querySelectorAll('.card-wrapper').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.action-btn')) return;
      el.classList.toggle('flipped');
    });
  });

  cardsGrid.querySelectorAll('.action-btn.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEdit(btn.dataset.id); });
  });

  cardsGrid.querySelectorAll('.action-btn.delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteCard(btn.dataset.id); });
  });
}

// ─── Sources sidebar ───────────────────────────────────────────────────────

function renderSources() {
  const map = {};
  state.fiszki.forEach(f => { map[f.zrodlo] = (map[f.zrodlo] || 0) + 1; });

  const allItem = `
    <div class="source-item ${state.source === 'all' ? 'active' : ''}" data-source="all">
      <span class="source-label">📚 Wszystkie</span>
      <span class="source-count">${state.fiszki.length}</span>
    </div>`;

  const srcItems = Object.entries(map).map(([src, n]) => `
    <div class="source-item ${state.source === src ? 'active' : ''}" data-source="${esc(src)}">
      <span class="source-label" title="${esc(src)}">📄 ${esc(src)}</span>
      <span class="source-count">${n}</span>
    </div>`).join('');

  sourcesList.innerHTML = allItem + srcItems;

  sourcesList.querySelectorAll('.source-item').forEach(el => {
    el.addEventListener('click', () => {
      state.source = el.dataset.source;
      state.idx = 0;
      renderAll();
    });
  });
}

// ─── renderAll ─────────────────────────────────────────────────────────────

function renderAll() {
  applyFilters();
  totalCount.textContent = plural(state.filtered.length);
  renderSources();
  updateModeButton();

  if (state.filtered.length === 0) { showView('empty'); return; }

  if (state.mode === 'study') {
    renderStudyCard();
  } else {
    renderBrowse();
    showView('browse');
  }
}

// ─── Modal ─────────────────────────────────────────────────────────────────

function openModal(title, przod = '', tyl = '', id = null) {
  editingId = id;
  modalTitle.textContent = title;
  frontInput.value = przod;
  backInput.value  = tyl;
  modalOverlay.classList.add('open');
  frontInput.focus();
}

const openAdd  = ()  => openModal('Dodaj fiszkę');
const openEdit = id  => {
  const f = state.fiszki.find(f => f.id === id);
  if (f) openModal('Edytuj fiszkę', f.przod, f.tyl, id);
};
const closeModal = () => { modalOverlay.classList.remove('open'); editingId = null; };

modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
$('modal-cancel').addEventListener('click', closeModal);

modalForm.addEventListener('submit', async e => {
  e.preventDefault();
  const przod = frontInput.value.trim();
  const tyl   = backInput.value.trim();
  if (!przod || !tyl) return;

  try {
    if (editingId) {
      const updated = await api.updateFiszka(editingId, przod, tyl);
      const i = state.fiszki.findIndex(f => f.id === editingId);
      if (i !== -1) state.fiszki[i] = updated;
      toast('Fiszka zaktualizowana');
    } else {
      const nowa = await api.addFiszka(przod, tyl);
      state.fiszki.push(nowa);
      toast('Fiszka dodana');
    }
    closeModal();
    renderAll();
  } catch (err) { toast(err.message, 'error'); }
});

// ─── Delete ────────────────────────────────────────────────────────────────

async function deleteCard(id) {
  if (!confirm('Usunąć tę fiszkę?')) return;
  try {
    await api.deleteFiszka(id);
    state.fiszki = state.fiszki.filter(f => f.id !== id);
    delete state.answered[id];
    toast('Fiszka usunięta');
    renderAll();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Upload ────────────────────────────────────────────────────────────────

async function handleFile(file) {
  if (!file) return;
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  setLoading(
    true,
    isPdf ? 'Docling przetwarza PDF...' : 'Bielik analizuje notatki...',
    isPdf ? 'PDF może wymagać 1–3 minut (modele AI)' : 'To może potrwać chwilę'
  );
  try {
    const result = await api.upload(file);
    state.fiszki.push(...result.fiszki);
    state.source = file.name;
    state.idx = 0;
    const { meta } = result;
    const metaStr = meta.chunks > 1
      ? ` (${meta.chunks} chunki, ~${(meta.totalTokens / 1000).toFixed(1)}K tokenów)`
      : meta.totalTokens ? ` (~${(meta.totalTokens / 1000).toFixed(1)}K tokenów)` : '';
    toast(`Wygenerowano ${result.count} fiszek z „${file.name}"${metaStr}`);
    renderAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(false);
    fileInput.value = '';
  }
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

// ─── Controls ──────────────────────────────────────────────────────────────

// Study navigation
studyCard.addEventListener('click', () => {
  state.flipped = !state.flipped;
  studyCard.classList.toggle('flipped', state.flipped);
});

$('btn-prev').addEventListener('click', () => navigate(-1));
$('btn-next').addEventListener('click', () => navigate(1));
$('btn-correct').addEventListener('click',   () => recordAnswer('correct'));
$('btn-incorrect').addEventListener('click', () => recordAnswer('incorrect'));

// Mode toggle
$('btn-mode').addEventListener('click', () => {
  state.mode = state.mode === 'study' ? 'browse' : 'study';
  if (state.mode === 'study') state.idx = 0;
  renderAll();
});

// Shuffle
$('btn-shuffle').addEventListener('click', () => {
  state.filtered.sort(() => Math.random() - 0.5);
  state.idx = 0;
  state.answered = {};
  renderScore();
  if (state.mode === 'study') renderStudyCard();
  else renderBrowse();
  toast('Kolejność wymieszana');
});

// Summary buttons
$('btn-restart').addEventListener('click', resetSession);
$('btn-to-browse').addEventListener('click', () => {
  state.mode = 'browse';
  renderAll();
});

// Add button
$('btn-add').addEventListener('click', openAdd);

// Search
searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  state.idx = 0;
  renderAll();
});

// Keyboard
document.addEventListener('keydown', e => {
  if (modalOverlay.classList.contains('open')) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (state.mode !== 'study' || state.filtered.length === 0) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(1);
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigate(-1);
  if (e.key === ' ') { e.preventDefault(); studyCard.click(); }
  if (e.key === 'z' || e.key === 'Z') recordAnswer('correct');
  if (e.key === 'x' || e.key === 'X') recordAnswer('incorrect');
});

// ─── Init ──────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [fiszki, caps] = await Promise.all([api.getFiszki(), api.getCapabilities()]);
    state.fiszki = fiszki;

    // Aktualizuj hint i file input na podstawie faktycznych możliwości serwera
    const hint = $('upload-hint');
    if (hint) hint.textContent = `Obsługiwane: ${caps.activeFormats.join(', ')}`;
    fileInput.accept = caps.activeFormats.join(',');

    if (!caps.docling) {
      toast('PDF wyłączony — zainstaluj docling (pip install docling)', 'error');
    }

    renderScore();
    renderAll();
  } catch {
    toast('Brak połączenia z serwerem', 'error');
  }
}

init();
