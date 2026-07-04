#!/usr/bin/env node
/*
 * Longboi — a dachshund that lives in your Claude Code status line.
 * The more you code, the longer he gets.
 *
 * The renderer is stateless: hooks write small facts (commits, tests,
 * activity timestamps), and every frame is derived from facts + clock.
 * Animation comes from the status line's refreshInterval re-running this
 * script every 2 seconds. Zero dependencies. Node >= 16.
 *
 * Modes:
 *   (default)        statusline render (JSON on stdin, 2 rows of dog)
 *   --hook <Event>   (internal) consume a hook event
 *   --status         full dog card: portrait, stats, bones
 *   --name <name>    rename your dog
 *   --feed           give a treat (boosts mood for a while)
 *   --install        adopt: wire statusline + note about hooks
 *   --uninstall      remove statusline (the dog is kept)
 *   --json           raw facts
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.LONGBOI_DIR || path.join(os.homedir(), '.claude', 'longboi');
const STATE = path.join(DIR, 'state.json');
const TOKEN_HUD = process.env.LONGBOI_TOKEN_HUD_DIR || path.join(os.homedir(), '.claude', 'token-hud');
const TROPHY_UNLOCKED = path.join(os.homedir(), '.claude', 'trophy-case', 'unlocked.json');

// force states for demos/tests: LONGBOI_DEMO='{"mood":"happy","frame":1,"segments":9}'
const DEMO = (() => { try { return JSON.parse(process.env.LONGBOI_DEMO || '{}'); } catch { return {}; } })();

function readJSON(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function writeJSON(f, o) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o));
  fs.renameSync(tmp, f);
}
function localDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ----------------------------------------------------------------- color ---
const C = { body: 137, dark: 95, tan: 180, collar: 167, text: 252, dim: 245, faint: 238, gold: 179, ok: 114, danger: 174, sky: 117 };
function paint(name, s, bold) {
  return `\x1b[38;5;${C[name] || 252}m` + (bold ? '\x1b[1m' : '') + s + '\x1b[0m';
}
function plainWidth(s) { return s.replace(/\x1b\[[0-9;]*m/g, '').length; }

// ----------------------------------------------------------------- state ---
function loadFacts() {
  const s = readJSON(STATE, {});
  s.name = s.name || 'Longboi';
  s.born = s.born || Date.now();
  s.commits = s.commits || 0; s.tests = s.tests || 0; s.tools = s.tools || 0;
  s.bones = s.bones || 0;
  s.days = s.days || {};
  s.lastActivity = s.lastActivity || 0; s.lastCommit = s.lastCommit || 0;
  s.lastGood = s.lastGood || 0; s.lastFail = s.lastFail || 0; s.lastFed = s.lastFed || 0;
  s.lastBone = s.lastBone || 0;
  return s;
}

function xpLevel(s) {
  const activeDays = Object.keys(s.days).length;
  const xp = activeDays * 3 + s.commits + Math.floor(s.tests / 5) + Math.floor(s.tools / 200);
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 2)));
  return { xp, level, activeDays };
}

// ------------------------------------------------------------------ hooks --
function runHook(event) {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* count anyway */ }
  const s = loadFacts();
  const now = Date.now();
  s.lastActivity = now;
  s.days[localDate()] = 1;
  if (event === 'PostToolUse') {
    s.tools += 1;
    const cmd = String((input.tool_input && input.tool_input.command) || '');
    if (input.tool_name === 'Bash' && /\bgit\b[^&|;]*\bcommit\b/.test(cmd)) {
      s.commits += 1; s.lastCommit = now; s.lastGood = now;
    }
    if (input.tool_name === 'Bash' && /\b(pytest|jest|vitest|go test|cargo test|npm (run )?test|bun test|mix test)\b/.test(cmd)) {
      s.tests += 1; s.lastGood = now;
    }
    // sometimes, while working, he digs something up
    if (Math.random() < 0.004 && now - s.lastBone > 3600e3) { s.bones += 1; s.lastBone = now; }
  }
  if (event === 'PostToolUseFailure') s.lastFail = now;
  if (event === 'SessionStart') s.lastGreet = now;
  // UserPromptSubmit: activity timestamp already updated above
  const keys = Object.keys(s.days).sort();
  while (keys.length > 400) delete s.days[keys.shift()];
  try { writeJSON(STATE, s); } catch { /* read-only fs — dog forgives */ }
}

// ------------------------------------------------------------------ mood ---
function trophyRecentUnlock() {
  try {
    const st = fs.statSync(TROPHY_UNLOCKED);
    if (Date.now() - st.mtimeMs > 3 * 60e3) return null;
    const u = readJSON(TROPHY_UNLOCKED, {});
    const latest = Object.entries(u).sort((a, b) => b[1].t - a[1].t)[0];
    return latest ? latest[0] : null;
  } catch { return null; }
}

function overBudget() {
  try {
    const cfg = readJSON(path.join(TOKEN_HUD, 'config.json'), {});
    if (!(cfg.dailyBudget > 0)) return false;
    const fx = readJSON(path.join(TOKEN_HUD, 'fx.json'), {});
    const rate = (fx.currency === cfg.currency && fx.rate) || cfg.usdRate || 1;
    let cost = 0;
    const dir = path.join(TOKEN_HUD, 'days', localDate());
    for (const f of fs.readdirSync(dir)) {
      const j = readJSON(path.join(dir, f), null);
      if (j && j.abs) cost += Math.max(0, (j.abs.cost || 0) - ((j.base && j.base.cost) || 0));
    }
    return cost * rate > cfg.dailyBudget;
  } catch { return false; }
}

function decideMood(s, now) {
  if (DEMO.mood) return DEMO.mood;
  const idleMin = (now - s.lastActivity) / 60e3;
  const hour = new Date().getHours();
  if (now - s.lastFed < 45e3) return 'eating';
  const unlock = trophyRecentUnlock();
  if (unlock) return 'excited';
  if ((hour >= 0 && hour < 7) && idleMin > 10) return 'sleeping';
  if (idleMin > 30) return 'sleeping';
  if (now - s.lastFail < 4 * 60e3 && s.lastFail > s.lastGood) return 'sad';
  if (overBudget()) return 'guilty';
  if (now - s.lastGood < 4 * 60e3) return 'happy';
  if (idleMin < 1) return 'working';
  if (hour >= 12 && now - s.lastCommit > 20 * 3600e3) return 'hungry';
  return 'idle';
}

// ------------------------------------------------------- pixel dachshund ---
/*
 * A real sprite: an 8-row pixel grid composed programmatically (so the body
 * stretches with level), rendered to the terminal as half-blocks — each text
 * cell is two vertical pixels via '▀' with fg = upper px, bg = lower px.
 * 8 pixel rows → 4 text rows.
 */
const PX = { B: 130, T: 180, D: 94, N: 16, E: 16, R: 160, P: 211, W: 251, G: 101 };
// B body red-brown · T tan belly · D dark ear/tail/paws · N nose · E eye
// R collar · P tongue · W bone · G dirt

function blankGrid(w, h) { return Array.from({ length: h }, () => new Array(w).fill(null)); }

function buildDog(bodyPx, mood, f) {
  // width: tail(4) + body(bodyPx) + head(9) + snout/extras(4)
  const w = 4 + bodyPx + 13, h = 8;
  const g = blankGrid(w, h);
  const f2 = f % 2;
  const hx = 4 + bodyPx;            // head start column
  const put = (x, y, c) => { if (x >= 0 && x < w && y >= 0 && y < h) g[y][x] = c; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c); };

  const sleeping = mood === 'sleeping';
  const down = mood === 'sad' || mood === 'guilty';         // tail & ears droop
  const wag = ['happy', 'excited', 'eating', 'working', 'idle'].includes(mood);

  if (sleeping) {
    // curled loaf: low body, head resting, closed eye
    rect(3, 5, hx + 6, 5, PX.B);
    rect(3, 6, hx + 6, 6, PX.B);
    rect(4, 7, hx + 5, 7, PX.T);
    rect(hx + 3, 4, hx + 7, 4, PX.B);          // head resting on body
    put(hx + 8, 5, PX.N);
    rect(hx + 7, 5, hx + 7, 5, PX.B);
    put(hx + 5, 4, PX.D);                      // closed eye
    rect(hx + 4, 3, hx + 6, 3, PX.D);          // ear over head
    put(2, 5, PX.D); put(1, 6, PX.D);          // tail tucked
    // z Z z
    if (f2) { put(hx + 9, 2, PX.W); put(hx + 11, 1, PX.W); } else { put(hx + 10, 2, PX.W); }
    return g;
  }

  // ---- body ----
  rect(4, 3, hx - 1, 5, PX.B);
  rect(5, 6, hx - 2, 6, PX.T);
  // ---- head (right) ----
  rect(hx, 2, hx + 6, 2, PX.B);                 // crown
  rect(hx - 1, 3, hx + 7, 5, PX.B);             // skull + cheeks
  rect(hx - 1, 6, hx + 2, 6, PX.B);             // deep dachshund chest
  rect(hx + 3, 6, hx + 6, 6, PX.B);             // jaw
  rect(hx + 7, 4, hx + 9, 4, PX.B);             // long snout
  put(hx + 10, 4, PX.N);                        // nose
  put(hx + 5, 3, PX.E);                         // eye
  // ear: floppy, hangs on the near side
  const earY = down ? 1 : 0;
  rect(hx + 1, 1 + earY, hx + 3, 1 + earY, PX.D);
  rect(hx, 2 + earY, hx + 1, 4, PX.D);
  // collar
  put(hx - 1, 5, PX.R); put(hx, 6, PX.R);
  // ---- tail (left) ----
  if (down) { put(3, 5, PX.D); put(2, 6, PX.D); }
  else if (wag) {
    put(3, 3, PX.D);
    if (f2) { put(2, 2, PX.D); put(1, 1, PX.D); } else { put(2, 3, PX.D); put(1, 2, PX.D); }
  } else { put(3, 3, PX.D); put(2, 3, PX.D); }
  // ---- legs ----
  const step = (mood === 'working' || mood === 'happy') ? f2 : 0;
  rect(5 + step, 7, 6 + step, 7, PX.D);          // back pair
  rect(hx - 3 - step, 7, hx - 2 - step, 7, PX.D); // front pair
  // ---- mood extras ----
  if (mood === 'happy' || mood === 'excited') put(hx + 8, 5, PX.P);        // tongue
  if (mood === 'eating') {
    const stage = f % 4;
    if (stage < 3) rect(hx + 8, 6, hx + 10 - stage, 6, PX.W);              // shrinking bone
    else put(hx + 9, 6, PX.P);
  }
  if (mood === 'working') { put(hx + 9, 7 - (f2 ? 0 : 1), PX.G); put(hx + 11, 7, PX.G); } // dirt
  if (mood === 'hungry' && f2) { put(hx + 2, 0, PX.W); put(hx + 3, 0, PX.W); put(hx + 4, 0, PX.W); } // bone dream
  if (mood === 'excited' && f2) g.push(g.shift()); // tiny jump: lift everything 1px
  return g;
}

function gridToHalfBlocks(g) {
  const h = g.length, w = g[0].length, rows = [];
  for (let ty = 0; ty < h / 2; ty++) {
    let line = '', run = null; // run: {top,bot,text}
    const flush = () => {
      if (!run) return;
      if (run.top == null && run.bot == null) line += run.text;
      else if (run.bot == null) line += `\x1b[38;5;${run.top}m` + '▀'.repeat(run.text.length) + '\x1b[0m';
      else if (run.top == null) line += `\x1b[38;5;${run.bot}m` + '▄'.repeat(run.text.length) + '\x1b[0m';
      else line += `\x1b[38;5;${run.top};48;5;${run.bot}m` + '▀'.repeat(run.text.length) + '\x1b[0m';
      run = null;
    };
    for (let x = 0; x < w; x++) {
      const top = g[2 * ty][x], bot = g[2 * ty + 1][x];
      if (run && run.top === top && run.bot === bot) { run.text += ' '; continue; }
      flush();
      run = { top, bot, text: ' ' };
    }
    flush();
    rows.push(line.replace(/\s+$/, ''));
  }
  return rows;
}

// -------------------------------------------------- legacy text dachshund --
/*
 * The original one-liner dog, kept as `--style text` for fonts/terminals
 * that dislike half-blocks.
 */
const FACE = {
  idle: ['˘ᴥ˘', '˘ᴥ˘'], working: ['˘ᴥ˘', '˘ᴥ˙'], happy: ['ᵔᴥᵔ', 'ᵔᴥᵔ'],
  excited: ['ᵔᴥᵔ', '>ᴥ<'], sad: ['˙ᴥ˙', '˙ᴥ˙'], sleeping: ['˗ᴥ˗', '˗ᴥ˗'],
  eating: ['˘ᴥ˘', 'ᵔᴥᵔ'], hungry: ['˙ᴥ˘', '˙ᴥ˘'], guilty: ['˘ᴥ˙', '˙ᴥ˘'],
};
const TAIL = {
  idle: ['ʃ', 'ʅ'], working: ['ʅ', 'ʃ'], happy: ['ʃ', 'ʅ'], excited: ['ʅ', 'ʃ'],
  sad: ['ι', 'ι'], sleeping: ['~', '~'], eating: ['ʃ', 'ʅ'], hungry: ['ʃ', 'ʃ'], guilty: ['ι', 'ι'],
};

function dogRows(s, mood, frame, segments) {
  const f2 = frame % 2;
  const face = FACE[mood][f2];
  const tail = TAIL[mood][f2];
  const body = '▄'.repeat(segments);
  const head = paint('tan', '(' + face + ')') + paint('collar', '·');
  let above = '', after = '';
  if (mood === 'sleeping') after = ' ' + paint('faint', f2 ? 'ᶻ ᶻ' : ' ᶻᶻ');
  if (mood === 'excited') above = paint('gold', '!');
  if (mood === 'eating') after = ' ' + paint('tan', ['c==Ɔ', 'c=Ɔ', 'cƆ', '♥'][frame % 4]);
  if (mood === 'working') after = ' ' + paint('faint', f2 ? '∵' : '∴');
  if (mood === 'hungry') after = ' ' + paint('faint', f2 ? '…c==Ɔ?' : '…');
  if (mood === 'sad' || mood === 'guilty') after = ' ' + paint('faint', f2 ? '·' : ' ');

  const walk = (mood === 'working' || mood === 'happy') ? [0, 1, 2, 1][frame % 4] : 0;
  const pad = ' '.repeat(1 + walk);

  const row1 = pad + paint('dark', tail) + paint('body', body) + head + after +
    (above ? ' ' + above : '');
  // legs: pairs under the tail end and under the head end
  const gap = Math.max(0, segments - 4);
  const legs = mood === 'sleeping'
    ? paint('dark', '▂'.repeat(Math.min(3, segments)))
    : paint('dark', f2 ? 'ıı' : 'ıI') + ' '.repeat(gap) + paint('dark', f2 ? 'Iı' : 'ıı');
  const row2 = pad + ' ' + legs;
  return [row1, row2];
}

// token chip: today's spend vs budget, if Token HUD lives here too
function tokenChip() {
  try {
    const cfg = readJSON(path.join(TOKEN_HUD, 'config.json'), null);
    if (!cfg) return '';
    const fx = readJSON(path.join(TOKEN_HUD, 'fx.json'), {});
    const rate = (fx.currency === cfg.currency && fx.rate) || cfg.usdRate || 1;
    const sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[cfg.currency] || cfg.currency;
    let cost = 0;
    const dir = path.join(TOKEN_HUD, 'days', localDate());
    for (const f of fs.readdirSync(dir)) {
      const j = readJSON(path.join(dir, f), null);
      if (j && j.abs) cost += Math.max(0, (j.abs.cost || 0) - ((j.base && j.base.cost) || 0));
    }
    const v = cost * rate;
    const money = sym + (v >= 10 ? v.toFixed(1) : v.toFixed(2));
    if (cfg.dailyBudget > 0) {
      const frac = v / cfg.dailyBudget;
      const color = frac >= 1 ? 'danger' : frac >= 0.7 ? 'gold' : 'ok';
      return paint(color, money) + paint('faint', '/' + sym + cfg.dailyBudget);
    }
    return paint('dim', money);
  } catch { return ''; }
}

const MOOD_LABEL = {
  idle: 'chillin’', working: 'supervising the agent', happy: 'good boy mode',
  excited: 'ACHIEVEMENT!!', sad: 'that error hurt', sleeping: 'sleeping',
  eating: 'nom nom', hungry: 'no commits, no kibble', guilty: 'over budget… sorry',
};

function buildChip(s, mood, level) {
  const parts = [];
  parts.push(paint('tan', s.name, true) + paint('faint', ' lv' + level));
  if (s.bones > 0) parts.push(paint('dim', 'c==Ɔ ') + paint('text', String(s.bones)));
  const tk = tokenChip();
  if (tk) parts.push(tk);
  const unlock = mood === 'excited' ? trophyRecentUnlock() : null;
  parts.push(paint('faint', unlock ? 'unlocked: ' + unlock : MOOD_LABEL[mood]));
  return parts.join(paint('faint', ' · '));
}

function render(input) {
  const s = loadFacts();
  const now = Date.now();
  const { level } = xpLevel(s);
  const width = Math.max(50, Math.min(300, parseInt(process.env.COLUMNS, 10) || 100)) - 2;
  const mood = decideMood(s, now);
  const frame = DEMO.frame != null ? DEMO.frame : Math.floor(now / 1600);

  const chip = buildChip(s, mood, level);

  if ((DEMO.style || s.style || 'pixel') === 'text') {
    // legacy one-liner dog
    const reserved = plainWidth(chip) + 6;
    const maxSeg = Math.max(3, width - reserved - 12);
    const segments = Math.min(DEMO.segments || (3 + level), maxSeg);
    const [row1, row2] = dogRows(s, mood, frame, segments);
    const padTo = Math.max(plainWidth(row1), plainWidth(row2)) + 2;
    return row1 + '\n' + row2 + ' '.repeat(Math.max(1, padTo - plainWidth(row2))) + chip;
  }

  // pixel sprite: body stretches with level, chip rides on the ground row
  const reserved = plainWidth(chip) + 4;
  const maxBody = Math.max(10, width - reserved - 17);
  const bodyPx = Math.max(10, Math.min(DEMO.bodyPx || (8 + level * 2), maxBody));
  const rows = gridToHalfBlocks(buildDog(bodyPx, mood, frame)).map(r => ' ' + r);
  const padTo = Math.max(...rows.map(plainWidth)) + 3;
  rows[rows.length - 1] += ' '.repeat(Math.max(1, padTo - plainWidth(rows[rows.length - 1]))) + chip;
  return rows.join('\n');
}

// ------------------------------------------------------------------ card ---
function statusCard() {
  const s = loadFacts();
  const { xp, level, activeDays } = xpLevel(s);
  const ageDays = Math.max(1, Math.round((Date.now() - s.born) / 864e5));
  const mood = decideMood(s, Date.now());
  const rule = paint('faint', '─'.repeat(46));
  const label = t => paint('dim', t.padEnd(10));
  const seg = Math.min(8 + level * 2, 30);
  const out = [''];
  out.push(' ' + paint('body', '▄', true) + ' ' + paint('tan', s.name, true) +
    paint('dim', `  ·  a dachshund, ${ageDays} day${ageDays === 1 ? '' : 's'} old`));
  out.push(' ' + rule);
  for (const r of gridToHalfBlocks(buildDog(seg, mood, 0))) out.push('  ' + r);
  out.push(' ' + rule);
  out.push(' ' + label('level') + paint('text', `${level}  `) + paint('faint', `(${xp} xp — longer every level)`));
  out.push(' ' + label('length') + paint('text', `${seg + 6} chars `) + paint('faint', 'and growing'));
  out.push(' ' + label('mood') + paint('text', MOOD_LABEL[mood]));
  out.push(' ' + label('bones') + paint('text', String(s.bones)) + paint('faint', '  dug up while supervising you'));
  const n = (v, w) => `${v} ${w}${v === 1 ? '' : 's'}`;
  out.push(' ' + label('kibble') + paint('text', `${n(s.commits, 'commit')}, ${n(s.tests, 'test run')}`) + paint('faint', ` over ${n(activeDays, 'active day')}`));
  out.push(' ' + rule);
  out.push(' ' + paint('faint', ' feed: just commit · rename: /longboi name <name> · github.com/Dumys/longboi'));
  out.push('');
  return out.join('\n');
}

// --------------------------------------------------------------- install ---
function settingsPath() { return path.join(os.homedir(), '.claude', 'settings.json'); }

function install() {
  const sp = settingsPath();
  const settings = readJSON(sp, {});
  const self = fs.realpathSync(__filename);
  const command = `node "${self}"`;
  if (settings.statusLine && settings.statusLine.command !== command) {
    fs.writeFileSync(sp + '.longboi-backup', JSON.stringify(settings, null, 2));
  }
  settings.statusLine = { type: 'command', command, padding: 0, refreshInterval: 2 };
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
  const s = loadFacts(); writeJSON(STATE, s);
  const line = paint('faint', '  ────────────────────────────────────────');
  console.log('');
  console.log(paint('gold', '  ┌─────────── ADOPTION CERTIFICATE ───────────┐', true));
  console.log('');
  for (const r of gridToHalfBlocks(buildDog(10, 'happy', 0))) console.log('     ' + r);
  console.log('');
  console.log('   ' + paint('text', `This certifies that a dachshund named `) + paint('tan', s.name, true));
  console.log('   ' + paint('text', 'now lives in your Claude Code status line.'));
  console.log('   ' + paint('dim', 'He grows longer as you code. Feed him commits.'));
  console.log('');
  console.log(paint('gold', '  └────────────────────────────────────────────┘', true));
  console.log('');
  console.log(paint('dim', '  visible on your next message · rename: node "' + self + '" --name Rex'));
  if (JSON.stringify(readJSON(sp, {})).includes('token-hud')) { /* replaced token-hud */ }
  if (fs.existsSync(TOKEN_HUD)) console.log(paint('dim', '  Token HUD detected — his collar tag shows your daily budget.'));
}

function uninstall() {
  const sp = settingsPath();
  const settings = readJSON(sp, {});
  if (settings.statusLine && /longboi/.test(settings.statusLine.command || '')) {
    delete settings.statusLine;
    fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
    console.log('✓ Status line removed. ' + loadFacts().name + ' waits in ' + DIR + ' in case you come back.');
  } else {
    console.log('Longboi is not the current status line — nothing changed.');
  }
}

// ------------------------------------------------------------------ main ---
function main() {
  const [, , mode, a] = process.argv;
  if (mode === '--hook') { try { runHook(a); } catch { /* never break the session */ } return; }
  if (mode === '--status') return console.log(statusCard());
  if (mode === '--json') return console.log(JSON.stringify(loadFacts(), null, 2));
  if (mode === '--grid-json') {
    // dev/asset tooling: raw pixel grid + chip for the LONGBOI_DEMO state
    const s = loadFacts();
    const { level } = xpLevel(s);
    const mood = DEMO.mood || 'idle';
    const bodyPx = DEMO.bodyPx || (8 + level * 2);
    return console.log(JSON.stringify({
      grid: buildDog(bodyPx, mood, DEMO.frame || 0),
      chip: buildChip(s, mood, level),
    }));
  }
  if (mode === '--style') {
    if (!['pixel', 'text'].includes(a)) return console.log('usage: longboi.js --style pixel|text');
    const s = loadFacts(); s.style = a; writeJSON(STATE, s);
    return console.log(`✓ style = ${a}`);
  }
  if (mode === '--name') {
    if (!a) return console.log('usage: longboi.js --name <name>');
    const s = loadFacts(); s.name = a.slice(0, 20); writeJSON(STATE, s);
    return console.log(`✓ He wags. His name is ${s.name} now.`);
  }
  if (mode === '--feed') {
    const s = loadFacts();
    if (Date.now() - s.lastFed < 4 * 3600e3) return console.log(s.name + ' looks at the treat, then at you. He is full. (One treat per 4h.)');
    s.lastFed = Date.now(); writeJSON(STATE, s);
    return console.log('✓ ' + s.name + ' inhales the treat. nom.');
  }
  if (mode === '--install') return install();
  if (mode === '--uninstall') return uninstall();
  if (mode === '--help' || mode === '-h') {
    return console.log('Longboi — a dachshund for your Claude Code status line\n' +
      'usage: longboi.js [--status | --name <name> | --feed | --install | --uninstall | --json]');
  }
  // statusline mode
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* fine */ }
  try {
    process.stdout.write(render(input) + '\n');
  } catch (err) {
    process.stdout.write(' ˘ᴥ˘  (longboi had a hiccup)\n');
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'last-error.txt'), String(err && err.stack || err)); } catch {}
  }
}

main();
