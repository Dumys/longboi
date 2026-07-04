#!/usr/bin/env node
/* Builds assets from the real pixel renderer: demo.svg (animated), cover.html,
 * preview.html. The dog is drawn as SVG rects — crisp true pixels, no font
 * dependency; chips are colored text. */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { C256, esc } = require('./ansi2html.js');

const HERE = __dirname;
const L = path.join(HERE, '..', 'dog', 'longboi.js');
const STATE = path.join(HERE, 'tmp-assets');
const PUP = path.join(HERE, 'tmp-pup');
const ASSETS = path.join(HERE, '..', 'assets');
fs.rmSync(STATE, { recursive: true, force: true });
fs.rmSync(PUP, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(PUP, { recursive: true });

// a grown dog with history; the puppy gets an empty state
fs.mkdirSync(STATE, { recursive: true });
const days = {}; for (let d = 1; d <= 26; d++) days['2026-06-' + String(d).padStart(2, '0')] = 1;
fs.writeFileSync(path.join(STATE, 'state.json'), JSON.stringify({
  name: 'Longboi', born: Date.now() - 26 * 864e5, commits: 58, tests: 40, tools: 2400,
  bones: 7, days, lastActivity: Date.now(), lastGood: Date.now(), lastCommit: Date.now(),
  lastFed: 0, lastFail: 0, lastBone: 0,
}));

// isolated Token HUD state so chips show a live-looking budget
const THUD = path.join(HERE, 'tmp-thud');
fs.rmSync(THUD, { recursive: true, force: true });
const today = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
fs.mkdirSync(path.join(THUD, 'days', today), { recursive: true });
fs.writeFileSync(path.join(THUD, 'config.json'), JSON.stringify({ dailyBudget: 10, currency: 'EUR', autoRate: false, usdRate: 0.86 }));
fs.writeFileSync(path.join(THUD, 'days', today, 's.json'), JSON.stringify({
  base: { cost: 0 }, abs: { cost: 4.57 }, hours: {}, t: Date.now(),
}));

function gj(mood, f, bodyPx, dir) {
  const env = {
    ...process.env, LONGBOI_DIR: dir || STATE, LONGBOI_TOKEN_HUD_DIR: THUD,
    LONGBOI_DEMO: JSON.stringify({ mood, frame: f, bodyPx }),
  };
  return JSON.parse(execSync(`node "${L}" --grid-json`, { env, encoding: 'utf8' }));
}

// ---- pixel grid → svg rects (horizontal runs merged) ----
function gridRects(grid, cell, ox, oy) {
  let out = '';
  for (let y = 0; y < grid.length; y++) {
    let x = 0;
    while (x < grid[y].length) {
      const c = grid[y][x];
      if (c == null) { x++; continue; }
      let x2 = x;
      while (x2 + 1 < grid[y].length && grid[y][x2 + 1] === c) x2++;
      out += `<rect x="${ox + x * cell}" y="${oy + y * cell}" width="${(x2 - x + 1) * cell}" height="${cell}" fill="${C256[c]}"/>`;
      x = x2 + 1;
    }
  }
  return out;
}

// ---- ANSI chip → svg tspans / html spans ----
function chipSvg(chip, x, y, size) {
  let out = `<text x="${x}" y="${y}" style="font:600 ${size}px ui-monospace,Menlo,monospace" xml:space="preserve">`;
  let color = '#8a8a8a';
  for (const part of chip.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      const c = m[1].split(';').map(Number);
      for (let i = 0; i < c.length; i++) {
        if (c[i] === 0) color = '#8a8a8a';
        else if (c[i] === 38 && c[i + 1] === 5) { color = C256[c[i + 2]] || '#8a8a8a'; i += 2; }
      }
    } else if (part) out += `<tspan fill="${color}">${esc(part)}</tspan>`;
  }
  return out + '</text>';
}
function chipHtml(chip) {
  const { ansiToHtml } = require('./ansi2html.js');
  return ansiToHtml(chip);
}

// ---- standalone dog scene svg (dog + chip on the ground row) ----
function dogSvg(g, cell, opts) {
  const o = opts || {};
  const w = g.grid[0].length * cell + (o.chip === false ? 0 : 460);
  const h = g.grid.length * cell;
  const chipPart = o.chip === false ? '' : chipSvg(g.chip, g.grid[0].length * cell + 24, h - cell * 1.2, o.chipSize || 15);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${gridRects(g.grid, cell, 0, 0)}${chipPart}</svg>`;
}

// ================= demo.svg: animated life loop =================
const seq = [];
for (const [mood, n] of [['working', 4], ['happy', 2], ['excited', 2], ['eating', 4], ['sleeping', 4]]) {
  for (let f = 0; f < n; f++) seq.push(gj(mood, f, 16));
}
const CELL = 9, FR = 0.5, T = seq.length * FR;
const gw = seq[0].grid[0].length;
const W = 780, H = 20 + seq[0].grid.length * CELL + 16;
let css = `@keyframes fr{0%{opacity:1}${(100 / seq.length).toFixed(3)}%{opacity:1}${(100 / seq.length + 0.001).toFixed(3)}%{opacity:0}100%{opacity:0}}`;
let groups = '';
seq.forEach((g, i) => {
  css += `.f${i}{opacity:0;animation:fr ${T}s step-end infinite;animation-delay:${(i * FR - T).toFixed(2)}s}`;
  groups += `<g class="f${i}">${gridRects(g.grid, CELL, 22, 24)}${chipSvg(g.chip, 22 + gw * CELL + 26, 24 + 7 * CELL, 14)}</g>\n`;
});
fs.writeFileSync(path.join(ASSETS, 'demo.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>${css}</style>
<rect width="${W}" height="${H}" rx="12" fill="#16130e"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#2e2a20"/>
<circle cx="20" cy="14" r="4.5" fill="#af5f00" opacity=".9"/><circle cx="34" cy="14" r="4.5" fill="#2e2a20"/><circle cx="48" cy="14" r="4.5" fill="#2e2a20"/>
${groups}</svg>`);

// ================= preview.html =================
function windowHtml(title, inner) {
  return `<section class="term"><header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><em>${esc(title)}</em></header><div class="scene">${inner}</div></section>`;
}
function scene(g, cell) {
  return `<div class="dogrow">${dogSvg(g, cell, { chip: false })}<span class="chip">${chipHtml(g.chip)}</span></div>`;
}
const puppy = gj('happy', 0, 10, PUP);
const grown = gj('working', 0, 16);
const asleep = gj('sleeping', 0, 14);
const giant = gj('happy', 1, 44);
const excited = gj('excited', 1, 16);

const preview = `<!doctype html><html><head><meta charset="utf-8"><title>Longboi — preview</title><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { min-height:100vh; background: radial-gradient(1100px 700px at 75% -10%, #2a2116 0%, #171310 45%, #0e0c0a 100%);
  font-family:-apple-system,"Segoe UI",sans-serif; display:flex; flex-direction:column; align-items:center; padding:56px 24px 72px; }
h1 { color:#f0ede8; font-size:40px; letter-spacing:-.02em; font-weight:700; } h1 .p { color:#af5f00; }
p.tag { color:#a89c8e; margin:10px 0 44px; font-size:17px; }
.stack { display:flex; flex-direction:column; gap:26px; width:min(900px,100%); }
.term { background:#17140f; border:1px solid #2e2a20; border-radius:14px; box-shadow:0 24px 60px rgba(0,0,0,.55); overflow:hidden; }
.term header { display:flex; align-items:center; gap:7px; padding:11px 14px; background:#1d1913; border-bottom:1px solid #2e2a20; }
.term header em { color:#857a68; font-style:normal; font-size:12.5px; margin-left:8px; }
.dot { width:11px; height:11px; border-radius:50%; } .dot.r{background:#ff5f57} .dot.y{background:#febc2e} .dot.g{background:#28c840}
.scene { padding:20px 22px; overflow-x:auto; }
.dogrow { display:flex; align-items:flex-end; gap:26px; }
.chip { font:600 14.5px/1.4 "JetBrains Mono",Menlo,monospace; white-space:nowrap; padding-bottom:2px; }
.foot { color:#6f6657; font-size:13.5px; margin-top:46px; } .foot code { color:#c0b393; font-family:"JetBrains Mono",Menlo,monospace; }
</style></head><body>
<h1><span class="p">▄</span> Longboi</h1>
<p class="tag">A pixel dachshund in your Claude Code status line. The more you code, the longer he gets.</p>
<div class="stack">
${windowHtml('day 1 — a puppy arrives', scene(puppy, 7))}
${windowHtml('day 26 — supervising the agent · budget on the collar tag via Token HUD', scene(grown, 7))}
${windowHtml('an achievement unlocks — he knew before you did', scene(excited, 7))}
${windowHtml('2am — do not disturb', scene(asleep, 7))}
${windowHtml('day 120 — consequences of your streak', scene(giant, 5))}
</div>
<p class="foot">zero dependencies · all local · <code>/plugin install longboi</code></p>
</body></html>`;
fs.writeFileSync(path.join(ASSETS, 'preview.html'), preview);

// ================= cover.html =================
const coverDog = gj('working', 0, 26);
const cover = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet"><style>
* { margin:0; padding:0; box-sizing:border-box; } html,body { background:#0e0c0a; overflow:hidden; }
#cover { position:relative; width:1280px; height:640px; overflow:hidden;
  background: radial-gradient(900px 520px at 84% 116%, rgba(175,95,0,.16), transparent 60%),
    radial-gradient(700px 400px at -8% -20%, rgba(215,175,95,.08), transparent 55%),
    linear-gradient(160deg,#191510 0%,#110e0b 55%,#0e0c0a 100%);
  font-family:'Fraunces',Georgia,serif; }
#cover::before { content:''; position:absolute; inset:0;
  background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:64px 64px; mask-image:radial-gradient(800px 500px at 30% 20%,#000 30%,transparent 75%); }
.wordmark { position:absolute; top:96px; left:96px; }
h1 { display:inline; color:#f3ede6; font-size:96px; font-weight:600; letter-spacing:-.015em; font-variation-settings:'opsz' 80; }
h1 .boi { font-family:'JetBrains Mono',Menlo,monospace; font-weight:700; color:#c9701a; font-size:82px; margin-left:6px; }
.tag { position:absolute; top:232px; left:100px; width:960px; color:#a89c8e; font-size:25px; line-height:1.4; font-weight:500; }
.tag b { color:#e8ddd2; font-weight:600; }
.paw { position:absolute; right:96px; top:112px; font-family:'JetBrains Mono',monospace; color:#6f6657; font-size:15px; line-height:2.1; text-align:right; }
.paw b { color:#cbbfb2; font-weight:500; }
.term { position:absolute; left:96px; right:96px; bottom:80px; background:#16130e; border:1px solid #2e2a20; border-radius:16px;
  box-shadow:0 40px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(201,112,26,.08); }
.term header { display:flex; align-items:center; gap:8px; padding:13px 18px; border-bottom:1px solid #26221a; }
.dot { width:12px; height:12px; border-radius:50%; background:#2e2a20; } .dot:first-child { background:#c9701a; opacity:.9; }
.term header em { color:#6f6657; font-style:normal; font-family:'JetBrains Mono',monospace; font-size:13px; margin-left:10px; }
.scene { padding:26px 30px; display:flex; align-items:flex-end; gap:30px; }
.chip { font:600 17px/1.4 'JetBrains Mono',Menlo,monospace; white-space:nowrap; padding-bottom:4px; }
</style></head><body>
<div id="cover">
<div class="wordmark"><h1>Long<span class="boi">BOI</span></h1></div>
<p class="tag">A pixel dachshund in your <b>Claude Code</b> status line. The more you code, the longer he gets.</p>
<div class="paw"><b>eats</b> commits · <b>naps</b> at 2am<br><b>digs up</b> bones while agents run<br><b>celebrates</b> your achievements</div>
<section class="term"><header><span class="dot"></span><span class="dot"></span><span class="dot"></span><em>~/my-app · claude</em></header>
<div class="scene">${dogSvg(coverDog, 11, { chip: false })}<span class="chip">${chipHtml(coverDog.chip)}</span></div></section>
</div></body></html>`;
fs.writeFileSync(path.join(ASSETS, 'cover.html'), cover);
console.log('assets written:', fs.readdirSync(ASSETS).filter(f => !f.endsWith('.png')).join(', '));
