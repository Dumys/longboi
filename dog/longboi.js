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
const TOKEN_HUD = path.join(os.homedir(), '.claude', 'token-hud');
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

// -------------------------------------------------------------- the dog ----
/*
 * Two rows. Faces right; tail on the left.
 *   row1:  tail + body(segments × '▄') + head
 *   row2:  legs under both ends, then the info chip
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

function render(input) {
  const s = loadFacts();
  const now = Date.now();
  const { level } = xpLevel(s);
  const width = Math.max(50, Math.min(300, parseInt(process.env.COLUMNS, 10) || 100)) - 2;
  const mood = decideMood(s, now);
  const frame = DEMO.frame != null ? DEMO.frame : Math.floor(now / 1600);

  const chipParts = [];
  chipParts.push(paint('tan', s.name, true) + paint('faint', ' lv' + level));
  if (s.bones > 0) chipParts.push(paint('dim', 'c==Ɔ ') + paint('text', String(s.bones)));
  const tk = tokenChip();
  if (tk) chipParts.push(tk);
  const unlock = mood === 'excited' ? trophyRecentUnlock() : null;
  chipParts.push(paint('faint', unlock ? 'unlocked: ' + unlock : MOOD_LABEL[mood]));
  const chip = chipParts.join(paint('faint', ' · '));

  // fit the dog to the space left of the chip
  const reserved = plainWidth(chip) + 6;
  const maxSeg = Math.max(3, width - reserved - 12);
  const segments = Math.min(DEMO.segments || (3 + level), maxSeg);

  const [row1, row2] = dogRows(s, mood, frame, segments);
  const padTo = Math.max(plainWidth(row1), plainWidth(row2)) + 2;
  const row2padded = row2 + ' '.repeat(Math.max(1, padTo - plainWidth(row2))) + chip;
  return row1 + '\n' + row2padded;
}

// ------------------------------------------------------------------ card ---
function statusCard() {
  const s = loadFacts();
  const { xp, level, activeDays } = xpLevel(s);
  const ageDays = Math.max(1, Math.round((Date.now() - s.born) / 864e5));
  const mood = decideMood(s, Date.now());
  const rule = paint('faint', '─'.repeat(46));
  const label = t => paint('dim', t.padEnd(10));
  const seg = Math.min(3 + level, 24);
  const out = [''];
  out.push(' ' + paint('body', '▄', true) + ' ' + paint('tan', s.name, true) +
    paint('dim', `  ·  a dachshund, ${ageDays} day${ageDays === 1 ? '' : 's'} old`));
  out.push(' ' + rule);
  const [r1, r2] = dogRows(s, mood, 0, seg);
  out.push('  ' + r1); out.push('  ' + r2);
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
  console.log('     ' + dogRows(s, 'happy', 0, 6)[0]);
  console.log('     ' + dogRows(s, 'happy', 0, 6)[1]);
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
