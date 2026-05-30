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
  getFiszki:       ()            => api._fetch('GET',    '/api/fiszki'),
  getCapabilities: ()            => api._fetch('GET',    '/api/capabilities'),
  getDecks:        ()            => api._fetch('GET',    '/api/decks'),
  getPrompts:      ()            => api._fetch('GET',    '/api/prompts'),
  savePrompts:     (p)           => api._fetch('PUT',    '/api/prompts', p),
  resetPrompts:    ()            => api._fetch('DELETE', '/api/prompts'),
  addFiszka:       (p, t, talia) => api._fetch('POST',   '/api/fiszki',       { przod: p, tyl: t, talia }),
  updateFiszka:    (id, p, t, talia) => api._fetch('PUT', `/api/fiszki/${id}`, { przod: p, tyl: t, talia }),
  deleteFiszka:    (id)          => api._fetch('DELETE', `/api/fiszki/${id}`),
  explain:         (przod, tyl)  => api._fetch('POST',   '/api/explain',      { przod, tyl }),
  async upload(file) {
    const fd = new FormData();
    fd.append('plik', file);
    return api._fetch('POST', '/api/upload', fd);
  },
};

// ─── State ─────────────────────────────────────────────────────────────────

const state = {
  fiszki:      [],
  filtered:    [],
  knownDecks:  [],    // talie stworzone ręcznie (localStorage), mogą być puste
  idx:         0,
  flipped:     false,
  answered:    {},
  mode:        'study',
  query:       '',
  deck:        'all',
};

// Persystencja talii w localStorage
function saveKnownDecks() {
  localStorage.setItem('fiszki_decks', JSON.stringify(state.knownDecks));
}
function loadKnownDecks() {
  try { return JSON.parse(localStorage.getItem('fiszki_decks') || '[]'); } catch { return []; }
}

// ─── Progress stats (persistent per card) ──────────────────────────────────
// Przechowuje ostatnią odpowiedź per cardId: { id: 'correct' | 'incorrect' }
const PROGRESS_KEY = 'fiszki_progress';

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}
function saveProgress(data) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data)); }

function updateProgress(cardId, result) {
  const p = loadProgress();
  p[cardId] = result;
  saveProgress(p);
}

function getDeckStats(deckName) {
  const cards = deckName === 'all'
    ? state.fiszki
    : state.fiszki.filter(f => getDeck(f) === deckName);
  const progress = loadProgress();
  let correct = 0, incorrect = 0;
  cards.forEach(f => {
    if (progress[f.id] === 'correct')   correct++;
    if (progress[f.id] === 'incorrect') incorrect++;
  });
  return { total: cards.length, correct, incorrect, answered: correct + incorrect };
}

// talia fiszki — fallback do zrodlo dla starych kart
const getDeck = f => f.talia || f.zrodlo || 'Ogólne';

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
const deckSelect      = $('form-deck');
const deckNewInput    = $('form-deck-new');
const uploadDeckSel   = $('upload-deck');
const uploadDeckNew   = $('upload-deck-new');
const newDeckWrap     = $('new-deck-wrap');
const newDeckInput    = $('new-deck-input');

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

// ─── Decks helper ──────────────────────────────────────────────────────────

function getAllDecks() {
  const fromCards = state.fiszki.map(getDeck);
  return [...new Set([...state.knownDecks, ...fromCards])].sort();
}

function populateUploadDeckSelect() {
  const decks = getAllDecks();
  uploadDeckSel.innerHTML = decks.map(d =>
    `<option value="${esc(d)}" ${d === state.deck && state.deck !== 'all' ? 'selected' : ''}>${esc(d)}</option>`
  ).join('') + `<option value="__new__">+ Nowa talia...</option>`;
  uploadDeckSel.addEventListener('change', () => {
    uploadDeckNew.style.display = uploadDeckSel.value === '__new__' ? '' : 'none';
  });
}

function getUploadDeck() {
  if (uploadDeckSel.value === '__new__') return uploadDeckNew.value.trim() || 'Ogólne';
  return uploadDeckSel.value || 'Ogólne';
}

function populateDeckSelect(currentDeck = '') {
  const decks = getAllDecks();
  deckSelect.innerHTML = decks.map(d =>
    `<option value="${esc(d)}" ${d === currentDeck ? 'selected' : ''}>${esc(d)}</option>`
  ).join('') + `<option value="__new__">+ Nowa talia...</option>`;

  if (currentDeck && !decks.includes(currentDeck)) {
    deckSelect.value = '__new__';
    deckNewInput.value = currentDeck;
    deckNewInput.style.display = '';
  } else {
    deckNewInput.style.display = 'none';
    deckNewInput.value = '';
  }
}

deckSelect.addEventListener('change', () => {
  deckNewInput.style.display = deckSelect.value === '__new__' ? '' : 'none';
  if (deckSelect.value === '__new__') deckNewInput.focus();
});

function getSelectedDeck() {
  if (deckSelect.value === '__new__') {
    return deckNewInput.value.trim() || 'Ogólne';
  }
  return deckSelect.value || 'Ogólne';
}

// ─── Filtered list ─────────────────────────────────────────────────────────

function applyFilters() {
  state.filtered = state.fiszki.filter(f => {
    const byDeck  = state.deck === 'all' || getDeck(f) === state.deck;
    const q       = state.query.toLowerCase();
    const byQuery = !q || f.przod.toLowerCase().includes(q) || f.tyl.toLowerCase().includes(q);
    return byDeck && byQuery;
  });
}

// ─── Score — per aktywna talia (tylko karty w state.filtered) ──────────────

function getScore() {
  const filteredIds = new Set(state.filtered.map(f => f.id));
  const entries = Object.entries(state.answered).filter(([id]) => filteredIds.has(id));
  return {
    correct:   entries.filter(([, v]) => v === 'correct').length,
    incorrect: entries.filter(([, v]) => v === 'incorrect').length,
    answered:  entries.length,
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

  state.idx = Math.max(0, Math.min(idx, filtered.length - 1));
  const card = filtered[state.idx];

  const pct = ((state.idx + 1) / filtered.length) * 100;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${state.idx + 1} / ${filtered.length}`;

  studyFront.textContent   = card.przod;
  studyBack.textContent    = card.tyl;
  const deck = getDeck(card);
  studySrc.textContent     = deck;
  studySrcBack.textContent = deck;

  state.flipped = false;
  studyCard.classList.remove('flipped');

  studyCard.classList.remove('answered-correct', 'answered-incorrect');
  const ans = answered[card.id];
  if (ans === 'correct')   studyCard.classList.add('answered-correct');
  if (ans === 'incorrect') studyCard.classList.add('answered-incorrect');

  showView('study');
}

function navigate(delta) {
  const newIdx = state.idx + delta;
  if (newIdx >= state.filtered.length) { showSummary(); return; }
  if (newIdx < 0) return;
  state.idx = newIdx;
  renderStudyCard();
}

function recordAnswer(result) {
  if (state.filtered.length === 0) return;
  const card = state.filtered[state.idx];
  state.answered[card.id] = result;
  updateProgress(card.id, result);
  renderScore();
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

  cardsGrid.innerHTML = cards.map(f => {
    const deck = getDeck(f);
    return `
    <div class="card-wrapper grid-card-wrapper" data-id="${f.id}">
      <div class="card-inner">
        <div class="card-face card-front">
          <div class="card-label">Pytanie</div>
          <div class="card-text">${esc(f.przod)}</div>
          <div class="card-footer">
            <span class="deck-badge" title="${esc(deck)}">${esc(deck)}</span>
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
            <span class="deck-badge">${esc(deck)}</span>
            <div class="card-actions">
              <button class="action-btn edit"   data-id="${f.id}" title="Edytuj">✏️</button>
              <button class="action-btn delete" data-id="${f.id}" title="Usuń">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

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

// ─── Decks sidebar ─────────────────────────────────────────────────────────

function renderDecks() {
  const map = {};
  state.fiszki.forEach(f => { map[getDeck(f)] = (map[getDeck(f)] || 0) + 1; });
  // Dołącz puste talie z localStorage
  state.knownDecks.forEach(d => { if (!(d in map)) map[d] = 0; });

  const allItem = `
    <div class="source-item ${state.deck === 'all' ? 'active' : ''}" data-deck="all">
      <span class="source-label">📚 Wszystkie</span>
      <span class="source-count">${state.fiszki.length}</span>
    </div>`;

  const deckItems = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => `
    <div class="source-item ${state.deck === d ? 'active' : ''}" data-deck="${esc(d)}">
      <span class="source-label" title="${esc(d)}">🗂 ${esc(d)}</span>
      <span class="source-count">${n}</span>
      ${state.deck === d ? `<button class="deck-delete-btn" data-deck="${esc(d)}" title="Usuń talię">✕</button>` : ''}
    </div>`).join('');

  sourcesList.innerHTML = allItem + deckItems;

  sourcesList.querySelectorAll('.source-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.deck-delete-btn')) return;
      const newDeck = el.dataset.deck;
      if (newDeck !== state.deck) {
        state.deck = newDeck;
        state.idx = 0;
        state.answered = {};
        renderScore();
      }
      renderAll();
    });
  });

  sourcesList.querySelectorAll('.deck-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openDeleteDeck(btn.dataset.deck);
    });
  });
}

// ─── renderAll ─────────────────────────────────────────────────────────────

function renderAll() {
  applyFilters();
  totalCount.textContent = plural(state.filtered.length);
  renderDecks();
  updateModeButton();

  if (state.filtered.length === 0) {
    const label = $('empty-deck-label');
    const hint  = $('empty-hint');
    if (state.deck !== 'all') {
      label.textContent = `📂 ${state.deck}`;
      label.style.display = '';
      hint.textContent = 'Ta talia jest pusta. Wgraj plik lub dodaj fiszkę ręcznie.';
    } else {
      label.style.display = 'none';
      hint.textContent = 'Wgraj plik .txt lub dodaj fiszkę ręcznie';
    }
    showView('empty');
    return;
  }

  if (state.mode === 'study') {
    renderStudyCard();
  } else {
    renderBrowse();
    showView('browse');
  }
}

// ─── Modal: dodaj / edytuj fiszkę ──────────────────────────────────────────

function openModal(title, przod = '', tyl = '', id = null, currentDeck = '') {
  editingId = id;
  modalTitle.textContent = title;
  frontInput.value = przod;
  backInput.value  = tyl;
  populateDeckSelect(currentDeck || (state.deck !== 'all' ? state.deck : ''));
  modalOverlay.classList.add('open');
  frontInput.focus();
}

const openAdd  = () => openModal('Dodaj fiszkę');
const openEdit = id => {
  const f = state.fiszki.find(f => f.id === id);
  if (f) openModal('Edytuj fiszkę', f.przod, f.tyl, id, getDeck(f));
};
const closeModal = () => { modalOverlay.classList.remove('open'); editingId = null; };

modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
$('modal-cancel').addEventListener('click', closeModal);

modalForm.addEventListener('submit', async e => {
  e.preventDefault();
  const przod  = frontInput.value.trim();
  const tyl    = backInput.value.trim();
  const talia  = getSelectedDeck();
  if (!przod || !tyl) return;

  try {
    if (editingId) {
      const updated = await api.updateFiszka(editingId, przod, tyl, talia);
      const i = state.fiszki.findIndex(f => f.id === editingId);
      if (i !== -1) state.fiszki[i] = updated;
      toast('Fiszka zaktualizowana');
    } else {
      const nowa = await api.addFiszka(przod, tyl, talia);
      // Socket może już dodać kartę przed odpowiedzią HTTP — sprawdź
      if (!state.fiszki.find(f => f.id === nowa.id)) state.fiszki.push(nowa);
      toast('Fiszka dodana');
    }
    closeModal();
    renderAll();
  } catch (err) { toast(err.message, 'error'); }
});

// ─── Delete ────────────────────────────────────────────────────────────────

async function deleteCard(id) {
  try {
    await api.deleteFiszka(id);
    state.fiszki = state.fiszki.filter(f => f.id !== id);
    delete state.answered[id];
    renderAll();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Delete deck ────────────────────────────────────────────────────────────

let deleteDeckTarget = null;
const deleteDeckOverlay = $('delete-deck-overlay');

function openDeleteDeck(deckName) {
  deleteDeckTarget = deckName;
  $('delete-deck-name').textContent = deckName;
  deleteDeckOverlay.classList.add('open');
}

function closeDeleteDeck() {
  deleteDeckOverlay.classList.remove('open');
  deleteDeckTarget = null;
}

$('delete-deck-cancel').addEventListener('click', closeDeleteDeck);
deleteDeckOverlay.addEventListener('click', e => { if (e.target === deleteDeckOverlay) closeDeleteDeck(); });

$('delete-deck-confirm').addEventListener('click', async () => {
  if (!deleteDeckTarget) return;
  try {
    await api._fetch('DELETE', '/api/fiszki', { talia: deleteDeckTarget });
    state.knownDecks = state.knownDecks.filter(d => d !== deleteDeckTarget);
    saveKnownDecks();
    state.fiszki = state.fiszki.filter(f => getDeck(f) !== deleteDeckTarget);
    state.deck = 'all';
    state.answered = {};
    renderScore();
    closeDeleteDeck();
    renderAll();
  } catch (err) { toast(err.message, 'error'); }
});

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
    const talia = getUploadDeck();
    const fd = new FormData();
    fd.append('plik', file);
    fd.append('talia', talia);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);

    state.fiszki.push(...result.fiszki);
    state.deck     = talia;
    state.idx      = 0;
    state.answered = {};
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

// ─── Modal: edytor promptów ────────────────────────────────────────────────

const promptsOverlay = $('prompts-overlay');
const promptEtap1    = $('prompt-etap1');
const promptEtap2    = $('prompt-etap2');
let defaultPrompts   = null;

async function openPromptsModal() {
  try {
    const data = await api.getPrompts();
    defaultPrompts = data.defaults;
    promptEtap1.value = data.etap1;
    promptEtap2.value = data.etap2;
    promptsOverlay.classList.add('open');
  } catch (err) { toast(err.message, 'error'); }
}

function closePromptsModal() { promptsOverlay.classList.remove('open'); }

promptsOverlay.addEventListener('click', e => { if (e.target === promptsOverlay) closePromptsModal(); });
$('prompts-cancel').addEventListener('click', closePromptsModal);

$('prompts-reset').addEventListener('click', () => {
  if (!defaultPrompts) return;
  promptEtap1.value = defaultPrompts.etap1;
  promptEtap2.value = defaultPrompts.etap2;
  toast('Przywrócono domyślne prompty (niezapisane)');
});

$('prompts-save').addEventListener('click', async () => {
  try {
    await api.savePrompts({ etap1: promptEtap1.value, etap2: promptEtap2.value });
    toast('Prompty zapisane');
    closePromptsModal();
  } catch (err) { toast(err.message, 'error'); }
});

$('btn-prompts').addEventListener('click', openPromptsModal);

// ─── Controls ──────────────────────────────────────────────────────────────

studyCard.addEventListener('click', () => {
  state.flipped = !state.flipped;
  studyCard.classList.toggle('flipped', state.flipped);
});

$('btn-prev').addEventListener('click', () => navigate(-1));
$('btn-next').addEventListener('click', () => navigate(1));
$('btn-correct').addEventListener('click',   () => recordAnswer('correct'));
$('btn-incorrect').addEventListener('click', () => recordAnswer('incorrect'));

$('btn-mode').addEventListener('click', () => {
  state.mode = state.mode === 'study' ? 'browse' : 'study';
  if (state.mode === 'study') state.idx = 0;
  renderAll();
});

$('btn-shuffle').addEventListener('click', () => {
  state.filtered.sort(() => Math.random() - 0.5);
  state.idx = 0;
  state.answered = {};
  renderScore();
  if (state.mode === 'study') renderStudyCard();
  else renderBrowse();
  toast('Kolejność wymieszana');
});

$('btn-restart').addEventListener('click', resetSession);
$('btn-to-browse').addEventListener('click', () => { state.mode = 'browse'; renderAll(); });
$('btn-add').addEventListener('click', openAdd);

// Nowa talia (sidebar)
$('btn-new-deck').addEventListener('click', () => {
  const visible = newDeckWrap.style.display !== 'none';
  newDeckWrap.style.display = visible ? 'none' : '';
  if (!visible) { newDeckInput.value = ''; newDeckInput.focus(); }
});

newDeckInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const name = newDeckInput.value.trim();
    if (name && !state.knownDecks.includes(name)) {
      state.knownDecks.push(name);
      saveKnownDecks();
    }
    if (name) { state.deck = name; state.answered = {}; renderScore(); }
    newDeckWrap.style.display = 'none';
    renderAll();
  }
  if (e.key === 'Escape') { newDeckWrap.style.display = 'none'; }
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  state.idx   = 0;
  renderAll();
});

document.addEventListener('keydown', e => {
  if (promptsOverlay.classList.contains('open') || modalOverlay.classList.contains('open')) {
    if (e.key === 'Escape') { closeModal(); closePromptsModal(); }
    return;
  }
  if (state.mode !== 'study' || state.filtered.length === 0) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(1);
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigate(-1);
  if (e.key === ' ') { e.preventDefault(); studyCard.click(); }
  if (e.key === 'z' || e.key === 'Z') recordAnswer('correct');
  if (e.key === 'x' || e.key === 'X') recordAnswer('incorrect');
});

// ─── Real-time (Socket.io) ─────────────────────────────────────────────────

try {
  const socket = io();
  socket.on('new_flashcard_received', card => {
    if (!state.fiszki.find(f => f.id === card.id)) {
      state.fiszki.push(card);
      renderAll();
    }
  });
} catch { /* socket.io opcjonalne */ }

// ─── Init ──────────────────────────────────────────────────────────────────

async function init() {
  state.knownDecks = loadKnownDecks();
  try {
    const [fiszki, caps] = await Promise.all([api.getFiszki(), api.getCapabilities()]);
    state.fiszki = fiszki;

    const hint = $('upload-hint');
    if (hint) hint.textContent = `Obsługiwane: ${caps.activeFormats.join(', ')}`;
    fileInput.accept = caps.activeFormats.join(',');
    populateUploadDeckSelect();

    renderScore();
    renderAll();
  } catch {
    toast('Brak połączenia z serwerem', 'error');
  }
}

// ─── Stats ─────────────────────────────────────────────────────────────────

const statsOverlay  = $('stats-overlay');
const statsContent  = $('stats-content');

function renderStats() {
  const decks = [...new Set([...state.knownDecks, ...state.fiszki.map(getDeck)])].sort();
  if (decks.length === 0) {
    statsContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem">Brak fiszek</p>';
    return;
  }

  let totalCorrect = 0, totalCards = 0;

  statsContent.innerHTML = decks.map(deck => {
    const s = getDeckStats(deck);
    totalCorrect += s.correct;
    totalCards   += s.total;
    const pct  = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
    const fill = pct;
    const fillColor = pct >= 75 ? 'var(--success)' : pct >= 40 ? '#e3b341' : 'var(--danger)';
    return `
      <div class="stat-deck">
        <div class="stat-deck-header">
          <span class="stat-deck-name">🗂 ${esc(deck)}</span>
          <span class="stat-deck-pct">${s.correct}/${s.total} (${pct}%)</span>
        </div>
        <div class="stat-progress-bar">
          <div class="stat-progress-fill" style="width:${fill}%; background:${fillColor}"></div>
        </div>
        <div class="stat-counts">
          <span class="ok">✓ ${s.correct} poprawnych</span>
          <span class="fail">✗ ${s.incorrect} błędnych</span>
          <span>${s.total - s.answered} bez odpowiedzi</span>
        </div>
      </div>`;
  }).join('');

  const totalPct = totalCards > 0 ? Math.round((totalCorrect / totalCards) * 100) : 0;
  statsContent.innerHTML += `<div class="stats-total">Łącznie: ${totalCorrect}/${totalCards} fiszek (${totalPct}%)</div>`;
}

function openStats()  { renderStats(); statsOverlay.classList.add('open'); }
function closeStats() { statsOverlay.classList.remove('open'); }

statsOverlay.addEventListener('click', e => { if (e.target === statsOverlay) closeStats(); });
$('stats-close').addEventListener('click', closeStats);
$('btn-stats').addEventListener('click', openStats);

$('stats-reset').addEventListener('click', () => {
  if (!confirm('Zresetować wszystkie statystyki postępu?')) return;
  saveProgress({});
  renderStats();
  toast('Statystyki zresetowane');
});

// ─── Explain panel (💡) ────────────────────────────────────────────────────

const explainPanel    = $('explain-panel');
const explainBackdrop = $('explain-backdrop');
const explainConcept  = $('explain-concept');
const explainText     = $('explain-text');
const explainLoading  = $('explain-loading');
const explainCache    = new Map(); // cardId → text

function openExplainPanel() { explainPanel.classList.add('open'); explainBackdrop.classList.add('active'); }
function closeExplainPanel() { explainPanel.classList.remove('open'); explainBackdrop.classList.remove('active'); }

$('explain-close').addEventListener('click', closeExplainPanel);
explainBackdrop.addEventListener('click', closeExplainPanel);

$('btn-explain').addEventListener('click', async () => {
  if (state.filtered.length === 0) return;
  const card = state.filtered[state.idx];

  explainConcept.textContent = card.przod;
  explainText.textContent    = '';
  openExplainPanel();

  if (explainCache.has(card.id)) {
    explainText.textContent = explainCache.get(card.id);
    return;
  }

  explainLoading.style.display = 'flex';
  try {
    const { explanation } = await api.explain(card.przod, card.tyl);
    explainText.textContent = explanation;
    explainCache.set(card.id, explanation);
  } catch (err) {
    explainText.textContent = `Błąd: ${err.message}`;
  } finally {
    explainLoading.style.display = 'none';
  }
});

init();
