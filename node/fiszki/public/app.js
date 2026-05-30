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
  async upload(file) {
    const fd = new FormData();
    fd.append('plik', file);
    return api._fetch('POST', '/api/upload', fd);
  },
};

// ─── State ─────────────────────────────────────────────────────────────────

const state = {
  fiszki:   [],
  filtered: [],
  decks:    [],       // lista talii
  idx:      0,
  flipped:  false,
  answered: {},       // per-session, resetowane przy zmianie talii
  mode:     'study',
  query:    '',
  deck:     'all',    // aktywna talia
};

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
const deckSelect   = $('form-deck');
const deckNewInput = $('form-deck-new');

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

function getUniqueDecksSorted() {
  return [...new Set(state.fiszki.map(getDeck))].sort();
}

function populateDeckSelect(currentDeck = '') {
  const decks = getUniqueDecksSorted();
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
  state.fiszki.forEach(f => {
    const d = getDeck(f);
    map[d] = (map[d] || 0) + 1;
  });

  const allItem = `
    <div class="source-item ${state.deck === 'all' ? 'active' : ''}" data-deck="all">
      <span class="source-label">📚 Wszystkie</span>
      <span class="source-count">${state.fiszki.length}</span>
    </div>`;

  const deckItems = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => `
    <div class="source-item ${state.deck === d ? 'active' : ''}" data-deck="${esc(d)}">
      <span class="source-label" title="${esc(d)}">🗂 ${esc(d)}</span>
      <span class="source-count">${n}</span>
    </div>`).join('');

  sourcesList.innerHTML = allItem + deckItems;

  sourcesList.querySelectorAll('.source-item').forEach(el => {
    el.addEventListener('click', () => {
      const newDeck = el.dataset.deck;
      if (newDeck !== state.deck) {
        state.deck = newDeck;
        state.idx = 0;
        state.answered = {};  // reset score przy zmianie talii
        renderScore();
      }
      renderAll();
    });
  });
}

// ─── renderAll ─────────────────────────────────────────────────────────────

function renderAll() {
  applyFilters();
  totalCount.textContent = plural(state.filtered.length);
  renderDecks();
  updateModeButton();

  if (state.filtered.length === 0) { showView('empty'); return; }

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
    const newDeck = getDeck(result.fiszki[0]);
    state.deck = newDeck;
    state.idx  = 0;
    state.answered = {};
    const { meta } = result;
    const metaStr = meta?.chunks > 1
      ? ` (${meta.chunks} chunki, ~${(meta.totalTokens / 1000).toFixed(1)}K tokenów)`
      : meta?.totalTokens ? ` (~${(meta.totalTokens / 1000).toFixed(1)}K tokenów)` : '';
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
  try {
    const [fiszki, caps] = await Promise.all([api.getFiszki(), api.getCapabilities()]);
    state.fiszki = fiszki;

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
