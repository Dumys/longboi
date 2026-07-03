#!/usr/bin/env node
/* Builds assets: demo.svg (animated, README hero), cover.html, preview.html. */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const L = path.join(HERE, '..', 'dog', 'longboi.js');
const STATE = path.join(HERE, 'tmp-assets');
const ASSETS = path.join(HERE, '..', 'assets');
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// a grown dog with some history
fs.mkdirSync(STATE, { recursive: true });
const days = {}; for (let d = 1; d <= 26; d++) days['2026-06-' + String(d).padStart(2, '0')] = 1;
fs.writeFileSync(path.join(STATE, 'state.json'), JSON.stringify({
  name: 'Longboi', born: Date.now() - 26 * 864e5, commits: 58, tests: 40, tools: 2400,
  bones: 7, days, lastActivity: Date.now(), lastGood: Date.now(), lastCommit: Date.now(),
  lastFed: 0, lastFail: 0, lastBone: 0,
}));

const C256 = { 137: '#af875f', 95: '#875f5f', 180: '#d7af87', 167: '#d75f5f', 252: '#d0d0d0', 245: '#8a8a8a', 238: '#4e4e4e', 179: '#d7af5f', 114: '#87d787', 174: '#d78787', 117: '#87d7ff' };
function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function frame(mood, f, segments) {
  const env = { ...process.env, LONGBOI_DIR: STATE, COLUMNS: '100', LONGBOI_DEMO: JSON.stringify({ mood, frame: f, segments }) };
  return execSync(`node "${L}"`, { input: '{}', env, encoding: 'utf8' }).trimEnd();
}

// ANSI → SVG tspans
function toSvgRows(ansi, x, y0, lh) {
  let out = '';
  ansi.split('\n').forEach((line, i) => {
    let row = `<text x="${x}" y="${y0 + i * lh}" xml:space="preserve">`;
    let color = '#d0d0d0';
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
      const m = part.match(/^\x1b\[([0-9;]*)m$/);
      if (m) {
        const codes = m[1].split(';').map(Number);
        for (let j = 0; j < codes.length; j++) {
          if (codes[j] === 0) color = '#d0d0d0';
          else if (codes[j] === 38 && codes[j + 1] === 5) { color = C256[codes[j + 2]] || '#d0d0d0'; j += 2; }
        }
      } else if (part) {
        row += `<tspan fill="${color}">${esc(part)}</tspan>`;
      }
    }
    out += row + '</text>\n';
  });
  return out;
}

// ---- demo.svg: a loop of dog life: works → happy → eats → sleeps ----
const seq = [];
for (const [mood, n] of [['working', 4], ['happy', 2], ['excited', 2], ['eating', 4], ['sleeping', 4]]) {
  for (let f = 0; f < n; f++) seq.push(frame(mood, f, 12));
}
const FR = 0.5, T = seq.length * FR;
const W = 830, H = 92;
let groups = '', css = `@keyframes fr{0%{opacity:1}${(100 / seq.length).toFixed(3)}%{opacity:1}${(100 / seq.length + 0.001).toFixed(3)}%{opacity:0}100%{opacity:0}}`;
seq.forEach((fr_, i) => {
  css += `.f${i}{opacity:0;animation:fr ${T}s step-end infinite;animation-delay:${(i * FR - T).toFixed(2)}s}`;
  groups += `<g class="f${i}">${toSvgRows(fr_, 20, 40, 25)}</g>\n`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>text{font:600 14.5px ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace}${css}</style>
<rect width="${W}" height="${H}" rx="12" fill="#16130e"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#2e2a20"/>
<circle cx="20" cy="18" r="5" fill="#af875f" opacity=".9"/>
<circle cx="36" cy="18" r="5" fill="#2e2a20"/>
<circle cx="52" cy="18" r="5" fill="#2e2a20"/>
${groups}
</svg>`;
fs.writeFileSync(path.join(ASSETS, 'demo.svg'), svg);

// ---- cover + preview HTML ----
const grownIdle = frame('working', 0, 16);
// the puppy gets a fresh, empty state so his chip reads lv1 with no bones
const PUP = path.join(HERE, 'tmp-pup');
fs.rmSync(PUP, { recursive: true, force: true }); fs.mkdirSync(PUP, { recursive: true });
const puppy = execSync(`node "${L}"`, {
  input: '{}', encoding: 'utf8',
  env: { ...process.env, LONGBOI_DIR: PUP, COLUMNS: '100', LONGBOI_DEMO: JSON.stringify({ mood: 'happy', frame: 0, segments: 3 }) },
}).trimEnd();
const giant = frame('happy', 1, 34);
const sleeping = frame('sleeping', 0, 12);
const status = execSync(`node "${L}" --status`, { env: { ...process.env, LONGBOI_DIR: STATE, COLUMNS: '90' }, encoding: 'utf8' });

const { ansiToHtml } = require(path.join(HERE, 'ansi2html.js'));
function windowHtml(title, body, size) {
  return `<section class="term"><header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><em>${esc(title)}</em></header><pre${size ? ' style="font-size:' + size + 'px"' : ''}>${body}</pre></section>`;
}

const preview = `<!doctype html><html><head><meta charset="utf-8"><title>Longboi — preview</title><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { min-height:100vh; background: radial-gradient(1100px 700px at 75% -10%, #2a2116 0%, #171310 45%, #0e0c0a 100%);
  font-family:-apple-system,"Segoe UI",sans-serif; display:flex; flex-direction:column; align-items:center; padding:56px 24px 72px; }
h1 { color:#f0ede8; font-size:40px; letter-spacing:-.02em; font-weight:700; } h1 .p { color:#af875f; }
p.tag { color:#a89c8e; margin:10px 0 44px; font-size:17px; }
.stack { display:flex; flex-direction:column; gap:26px; width:min(880px,100%); }
.term { background:#17140f; border:1px solid #2e2a20; border-radius:14px; box-shadow:0 24px 60px rgba(0,0,0,.55); overflow:hidden; }
.term header { display:flex; align-items:center; gap:7px; padding:11px 14px; background:#1d1913; border-bottom:1px solid #2e2a20; }
.term header em { color:#857a68; font-style:normal; font-size:12.5px; margin-left:8px; }
.dot { width:11px; height:11px; border-radius:50%; } .dot.r{background:#ff5f57} .dot.y{background:#febc2e} .dot.g{background:#28c840}
.term pre { padding:18px 20px; font:600 15px/1.5 "JetBrains Mono",Menlo,Consolas,monospace; color:#d0d0d0; overflow-x:auto; }
.foot { color:#6f6657; font-size:13.5px; margin-top:46px; } .foot code { color:#c0b393; font-family:"JetBrains Mono",Menlo,monospace; }
</style></head><body>
<h1><span class="p">▄</span> Longboi</h1>
<p class="tag">A dachshund in your Claude Code status line. The more you code, the longer he gets.</p>
<div class="stack">
${windowHtml('day 1 — a puppy arrives', ansiToHtml(puppy))}
${windowHtml('day 26 — supervising the agent (budget on the collar tag via Token HUD)', ansiToHtml(grownIdle))}
${windowHtml('2am — do not disturb', ansiToHtml(sleeping))}
${windowHtml('day 120 — consequences of your streak', ansiToHtml(giant), 12.5)}
${windowHtml('/longboi', ansiToHtml(status.trimEnd()))}
</div>
<p class="foot">zero dependencies · all local · <code>/plugin install longboi</code></p>
</body></html>`;
fs.writeFileSync(path.join(ASSETS, 'preview.html'), preview);

const cover = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet"><style>
* { margin:0; padding:0; box-sizing:border-box; } html,body { background:#0e0c0a; overflow:hidden; }
#cover { position:relative; width:1280px; height:640px; overflow:hidden;
  background: radial-gradient(900px 520px at 84% 116%, rgba(175,135,95,.20), transparent 60%),
    radial-gradient(700px 400px at -8% -20%, rgba(215,175,95,.08), transparent 55%),
    linear-gradient(160deg,#191510 0%,#110e0b 55%,#0e0c0a 100%);
  font-family:'Fraunces',Georgia,serif; }
#cover::before { content:''; position:absolute; inset:0;
  background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:64px 64px; mask-image:radial-gradient(800px 500px at 30% 20%,#000 30%,transparent 75%); }
.wordmark { position:absolute; top:96px; left:96px; }
h1 { display:inline; color:#f3ede6; font-size:96px; font-weight:600; letter-spacing:-.015em; font-variation-settings:'opsz' 80; }
h1 .boi { font-family:'JetBrains Mono',Menlo,monospace; font-weight:700; color:#af875f; font-size:82px; margin-left:6px; }
.tag { position:absolute; top:232px; left:100px; width:900px; color:#a89c8e; font-size:25px; line-height:1.4; font-weight:500; }
.tag b { color:#e8ddd2; font-weight:600; }
.term { position:absolute; left:96px; right:96px; bottom:84px; background:#16130e; border:1px solid #2e2a20; border-radius:16px;
  box-shadow:0 40px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(175,135,95,.07); }
.term header { display:flex; align-items:center; gap:8px; padding:13px 18px; border-bottom:1px solid #26221a; }
.dot { width:12px; height:12px; border-radius:50%; background:#2e2a20; } .dot:first-child { background:#af875f; opacity:.9; }
.term header em { color:#6f6657; font-style:normal; font-family:'JetBrains Mono',monospace; font-size:13px; margin-left:10px; }
.term pre { padding:24px 28px 26px; font:600 17.5px/1.6 'JetBrains Mono',Menlo,monospace; }
.paw { position:absolute; right:96px; top:118px; font-family:'JetBrains Mono',monospace; color:#6f6657; font-size:15px; line-height:2.1; text-align:right; }
.paw b { color:#cbbfb2; font-weight:500; }
</style></head><body>
<div id="cover">
<div class="wordmark"><h1>Long<span class="boi">BOI</span></h1></div>
<p class="tag">A dachshund in your <b>Claude Code</b> status line. The more you code, the longer he gets.</p>
<div class="paw"><b>eats</b> commits · <b>naps</b> at 2am<br><b>digs up</b> bones while agents run<br><b>celebrates</b> your achievements</div>
<section class="term"><header><span class="dot"></span><span class="dot"></span><span class="dot"></span><em>~/my-app · claude</em></header>
<pre>${ansiToHtml(grownIdle)}</pre></section>
</div></body></html>`;
fs.writeFileSync(path.join(ASSETS, 'cover.html'), cover);
console.log('assets written:', fs.readdirSync(ASSETS).join(', '));
