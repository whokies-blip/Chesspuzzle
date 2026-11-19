import { Chess } from './chess.js';
import { PUZZLES } from './puzzles.js';

const LEVELS = [
  { id: 'tf', name: 'Très facile', emoji: '🐣', sub: 'Mat en 1 coup', cls: 'lv-vf', color: 'var(--vf)' },
  { id: 'f',  name: 'Facile',      emoji: '🐰', sub: 'Mat en 1 coup', cls: 'lv-f',  color: 'var(--f)' },
  { id: 'm',  name: 'Moyen',       emoji: '🦊', sub: 'Mat en 2 coups', cls: 'lv-m', color: 'var(--m)' },
  { id: 'd',  name: 'Difficile',   emoji: '🦁', sub: 'Mat en 2 coups', cls: 'lv-d', color: 'var(--d)' },
];
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const FILES = 'abcdefgh';
const $ = (s) => document.querySelector(s);

/* ---------------- Sauvegarde ---------------- */
function loadSolved() {
  try { return JSON.parse(localStorage.getItem('cp-solved') || '{}'); } catch { return {}; }
}
function saveSolved() {
  try { localStorage.setItem('cp-solved', JSON.stringify(solved)); } catch { /* ignore */ }
}
const solved = loadSolved();
const isSolved = (lv, i) => (solved[lv] || []).includes(i);
function markSolved(lv, i) {
  solved[lv] = solved[lv] || [];
  if (!solved[lv].includes(i)) solved[lv].push(i);
  saveSolved();
}

/* ---------------- Sons ---------------- */
let actx = null;
function tone(freq, start, dur, type = 'sine', vol = 0.18) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + start;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur);
  } catch { /* pas de son */ }
}
const sndMove = () => { tone(220, 0, 0.08, 'triangle', 0.25); };
const sndBad = () => { tone(200, 0, 0.25, 'sawtooth', 0.08); tone(150, 0.15, 0.3, 'sawtooth', 0.08); };
const sndWin = () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, 'triangle', 0.2)); };

/* ---------------- Plein écran ---------------- */
function toggleFullscreen() {
  const d = document, el = d.documentElement;
  const isFs = d.fullscreenElement || d.webkitFullscreenElement;
  if (!isFs) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  else (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
}
document.querySelectorAll('[data-fs]').forEach((b) => b.addEventListener('click', toggleFullscreen));

/* ---------------- Accueil ---------------- */
function renderHome() {
  const box = $('#levels');
  box.innerHTML = '';
  for (const lv of LEVELS) {
    const total = PUZZLES[lv.id].length;
    const done = (solved[lv.id] || []).length;
    const b = document.createElement('button');
    b.className = 'level-btn ' + lv.cls;
    b.innerHTML = `<span class="emoji">${lv.emoji}</span>${lv.name}<span class="sub">${lv.sub}</span><span class="prog">⭐ ${done} / ${total}</span>`;
    b.onclick = () => startLevel(lv.id);
    box.appendChild(b);
  }
}
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

/* ---------------- Plateau ---------------- */
const boardEl = $('#board');
const squares = {};
for (let r = 7; r >= 0; r--) {
  for (let f = 0; f < 8; f++) {
    const name = FILES[f] + (r + 1);
    const d = document.createElement('div');
    d.className = 'sq ' + ((f + r) % 2 ? 'l' : 'd');
    if (r === 0) d.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[f]}</span>`);
    if (f === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${r + 1}</span>`);
    d.dataset.sq = name;
    squares[name] = d;
    boardEl.appendChild(d);
  }
}
const sqXY = (s) => [FILES.indexOf(s[0]), 8 - Number(s[1])];
const placeTransform = (s) => { const [x, y] = sqXY(s); return `translate(${x * 100}%, ${y * 100}%)`; };

let pieceEls = {}; // square -> element
function renderPieces() {
  boardEl.querySelectorAll('.pc').forEach((p) => p.remove());
  pieceEls = {};
  for (const row of game.board()) {
    for (const p of row) {
      if (!p) continue;
      const el = document.createElement('div');
      el.className = `pc ${p.color === 'w' ? 'white' : 'black'}-${NAMES[p.type]}`;
      el.style.left = '0'; el.style.top = '0';
      el.style.transition = 'none';
      el.style.transform = placeTransform(p.square);
      boardEl.appendChild(el);
      pieceEls[p.square] = el;
      requestAnimationFrame(() => { el.style.transition = ''; });
    }
  }
}
function clearMarks(...cls) {
  for (const s of Object.values(squares)) s.classList.remove(...cls);
}
function clearDots() { boardEl.querySelectorAll('.dot').forEach((d) => d.remove()); }
function markCheck() {
  clearMarks('check');
  if (game.isCheck()) {
    for (const row of game.board()) for (const p of row) {
      if (p && p.type === 'k' && p.color === game.turn()) squares[p.square].classList.add('check');
    }
  }
}
function markLast(from, to) {
  clearMarks('last');
  if (from) { squares[from].classList.add('last'); squares[to].classList.add('last'); }
}

/* Animation d'un coup : déplace l'élément puis re-dessine */
function animateMove(m) {
  return new Promise((res) => {
    const el = pieceEls[m.from];
    if (el) {
      el.classList.remove('dragging');
      el.style.transition = '';
      el.style.zIndex = 5;
      el.style.transform = placeTransform(m.to);
    }
    pieceEls[m.to] && pieceEls[m.to] !== el && (pieceEls[m.to].style.opacity = '0.0');
    setTimeout(() => { renderPieces(); markLast(m.from, m.to); markCheck(); res(); }, 260);
  });
}

/* ---------------- Logique des problèmes ---------------- */
let level = null, index = 0, puzzle = null, game = null, movesLeft = 0, locked = false, hintLevel = 0, selected = null;

function hasMate1(c) {
  for (const m of c.moves({ verbose: true })) {
    c.move(m); const k = c.isCheckmate(); c.undo();
    if (k) return true;
  }
  return false;
}
// Le coup m (des Blancs) mène-t-il à un mat en `n` ?
function moveWins(c, m, n) {
  c.move(m);
  let ok;
  if (c.isCheckmate()) ok = true;
  else if (n === 1 || c.isGameOver()) ok = false;
  else {
    ok = true;
    for (const r of c.moves({ verbose: true })) {
      c.move(r);
      const good = hasMate1(c);
      c.undo();
      if (!good) { ok = false; break; }
    }
  }
  c.undo();
  return ok;
}
function solutionMove() {
  return game.moves({ verbose: true }).find((m) => moveWins(game, m, movesLeft));
}

function startLevel(id) {
  level = id;
  const list = PUZZLES[id];
  index = list.findIndex((_, i) => !isSolved(id, i));
  if (index < 0) index = 0;
  const lv = LEVELS.find((l) => l.id === id);
  const tag = $('#level-tag');
  tag.textContent = `${lv.emoji} ${lv.name}`;
  tag.style.background = lv.color;
  show('game');
  loadPuzzle();
}

function setMessage(text, cls = 'info') {
  const m = $('#message');
  m.className = 'message ' + cls;
  m.innerHTML = text;
}

function loadPuzzle() {
  puzzle = PUZZLES[level][index];
  game = new Chess(puzzle.fen);
  movesLeft = puzzle.n;
  locked = false; hintLevel = 0; selected = null;
  $('#celebrate').classList.add('hidden');
  clearMarks('sel', 'last', 'hint-from', 'hint-to', 'check');
  clearDots();
  renderPieces();
  markCheck();
  const n = puzzle.n;
  $('#goal').innerHTML = `Fais échec et mat<br>en ${n} coup${n > 1 ? 's' : ''}&nbsp;!
    <div class="turn"><span class="mini pc white-king" style="position:static"></span> Tu joues les Blancs</div>`;
  $('#counter').textContent = `Problème ${index + 1} / ${PUZZLES[level].length}`;
  setMessage(n === 1 ? 'Trouve le coup qui gagne&nbsp;! 🔍' : 'Réfléchis bien… 🤔');
  $('#btn-prev').disabled = index === 0;
  renderStars();
}

function renderStars() {
  const box = $('#stars');
  box.innerHTML = '';
  PUZZLES[level].forEach((_, i) => {
    const s = document.createElement('span');
    s.textContent = '⭐';
    if (isSolved(level, i)) s.classList.add('done');
    if (i === index) s.classList.add('cur');
    s.onclick = () => { index = i; loadPuzzle(); };
    box.appendChild(s);
  });
}

function select(sq) {
  selected = sq;
  clearMarks('sel'); clearDots();
  if (!sq) return;
  squares[sq].classList.add('sel');
  for (const m of game.moves({ square: sq, verbose: true })) {
    const d = document.createElement('div');
    d.className = 'dot' + (m.captured ? ' cap' : '');
    const [x, y] = sqXY(m.to);
    d.style.cssText = `width:12.5%;height:12.5%;left:${x * 12.5}%;top:${y * 12.5}%`;
    boardEl.appendChild(d);
  }
}

async function tryMove(from, to) {
  const cands = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!cands.length) { select(null); renderPieces(); return; }
  locked = true;
  select(null);
  clearMarks('hint-from', 'hint-to');
  // Pour une promotion, on choisit la bonne pièce si elle existe (sinon la dame)
  let move = cands.find((m) => moveWins(game, m, movesLeft));
  const good = !!move;
  if (!move) move = cands.find((m) => m.promotion === 'q') || cands[0];

  game.move(move);
  sndMove();
  await animateMove(move);

  if (!good) {
    sndBad();
    boardEl.classList.remove('wrong'); void boardEl.offsetWidth; boardEl.classList.add('wrong');
    setMessage(game.isCheck() ? 'Échec… mais pas mat&nbsp;! 😮<br>Essaie encore' : 'Oups&nbsp;! Pas celui-là 🙈<br>Essaie encore', 'bad');
    await wait(1100);
    game.undo();
    renderPieces(); markLast(null); markCheck();
    locked = false;
    return;
  }

  if (game.isCheckmate()) { return win(); }

  // Mat en 2 : bon premier coup, l'adversaire répond
  movesLeft -= 1;
  setMessage('Super coup&nbsp;! 👍<br>Les Noirs réfléchissent…', 'good');
  await wait(900);
  const replies = game.moves({ verbose: true });
  const reply = replies[Math.floor(Math.random() * replies.length)];
  game.move(reply);
  sndMove();
  await animateMove(reply);
  setMessage('À toi&nbsp;! Fais échec et mat&nbsp;! ⚔️', 'info');
  hintLevel = 0;
  locked = false;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function win() {
  sndWin();
  markSolved(level, index);
  renderStars();
  const praise = ['Bravo&nbsp;!', 'Génial&nbsp;!', 'Super&nbsp;!', 'Champion&nbsp;!', 'Trop fort&nbsp;!', 'Magnifique&nbsp;!'];
  setMessage('Échec et mat&nbsp;! 🎉', 'good');
  $('#bravo-text').innerHTML = praise[Math.floor(Math.random() * praise.length)];
  setTimeout(() => { $('#celebrate').classList.remove('hidden'); confetti(); }, 500);
}

function next() {
  index = (index + 1) % PUZZLES[level].length;
  loadPuzzle();
}

function hint() {
  if (locked) return;
  const m = solutionMove();
  if (!m) return;
  hintLevel = Math.min(hintLevel + 1, 2);
  squares[m.from].classList.add('hint-from');
  if (hintLevel === 2) {
    squares[m.to].classList.add('hint-to');
    setMessage('Joue la pièce qui brille<br>sur la case qui brille ✨', 'info');
  } else {
    setMessage('Cette pièce peut gagner&nbsp;! ✨<br>(appuie encore pour un autre indice)', 'info');
  }
}

/* ---------------- Interaction (toucher + glisser) ---------------- */
function squareAt(e) {
  const r = boardEl.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
  const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  return FILES[x] + (8 - y);
}
let drag = null;
boardEl.addEventListener('pointerdown', (e) => {
  if (locked) return;
  const sq = squareAt(e);
  if (!sq) return;
  const p = game.get(sq);
  if (selected && sq !== selected && !(p && p.color === game.turn())) {
    tryMove(selected, sq);
    return;
  }
  if (p && p.color === game.turn()) {
    if (selected === sq) { drag = { from: sq, el: pieceEls[sq], start: [e.clientX, e.clientY], moved: false, wasSel: true }; }
    else { select(sq); drag = { from: sq, el: pieceEls[sq], start: [e.clientX, e.clientY], moved: false }; }
    boardEl.setPointerCapture(e.pointerId);
  } else {
    select(null);
  }
});
boardEl.addEventListener('pointermove', (e) => {
  if (!drag || !drag.el) return;
  const r = boardEl.getBoundingClientRect();
  const dx = e.clientX - drag.start[0], dy = e.clientY - drag.start[1];
  if (!drag.moved && Math.hypot(dx, dy) < r.width / 40) return;
  drag.moved = true;
  const cell = r.width / 8;
  const x = (e.clientX - r.left) / cell - 0.5, y = (e.clientY - r.top) / cell - 0.5;
  drag.el.classList.add('dragging');
  drag.el.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(1.15)`;
});
boardEl.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  const sq = squareAt(e);
  if (d.moved) {
    if (sq && sq !== d.from) tryMove(d.from, sq);
    else { d.el.classList.remove('dragging'); d.el.style.transform = placeTransform(d.from); }
  } else if (d.wasSel) {
    select(null);
  }
});
boardEl.addEventListener('pointercancel', () => {
  if (drag && drag.el) { drag.el.classList.remove('dragging'); drag.el.style.transform = placeTransform(drag.from); }
  drag = null;
});

/* ---------------- Boutons ---------------- */
$('#btn-home').onclick = () => { renderHome(); show('home'); };
$('#btn-hint').onclick = hint;
$('#btn-retry').onclick = () => loadPuzzle();
$('#btn-next').onclick = next;
$('#btn-next2').onclick = next;
$('#btn-prev').onclick = () => { if (index > 0) { index--; loadPuzzle(); } };

/* ---------------- Confettis ---------------- */
function confetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#ffc93c', '#ff6b6b', '#4d96ff', '#6bcb77', '#c77dff', '#ff9f45'];
  const parts = Array.from({ length: 160 }, () => ({
    x: cv.width / 2 + (Math.random() - 0.5) * 200, y: cv.height / 2,
    vx: (Math.random() - 0.5) * 22, vy: -Math.random() * 22 - 6,
    s: 6 + Math.random() * 8, c: colors[Math.floor(Math.random() * colors.length)],
    r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
  }));
  let frames = 0;
  (function step() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.vy += 0.6; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (++frames < 150) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

renderHome();
