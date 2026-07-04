'use strict';
/* ANSI (SGR) → HTML converter with fg + bg support, for preview/cover assets. */

const C256 = {
  16: '#000000', 52: '#5f0000', 58: '#5f5f00', 94: '#875f00', 95: '#875f5f',
  101: '#87875f', 109: '#87afaf', 114: '#87d787', 117: '#87d7ff', 130: '#af5f00',
  137: '#af875f', 160: '#d70000', 167: '#d75f5f', 173: '#d7875f', 174: '#d78787',
  179: '#d7af5f', 180: '#d7af87', 205: '#ff5faf', 211: '#ff87af', 237: '#3a3a3a',
  238: '#4e4e4e', 245: '#8a8a8a', 251: '#c6c6c6', 252: '#d0d0d0', 255: '#eeeeee',
};

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function ansiToHtml(text) {
  let html = '', fg = null, bg = null, bold = false;
  const open = t => {
    const st = (fg ? `color:${fg};` : '') + (bg ? `background:${bg};` : '') + (bold ? 'font-weight:600;' : '');
    return `<span style="${st}">${esc(t)}</span>`;
  };
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) { if (part) html += open(part); continue; }
    const c = m[1].split(';').map(Number);
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 0) { fg = bg = null; bold = false; }
      else if (c[i] === 1) bold = true;
      else if (c[i] === 38 && c[i + 1] === 5) { fg = C256[c[i + 2]] || '#d0d0d0'; i += 2; }
      else if (c[i] === 48 && c[i + 1] === 5) { bg = C256[c[i + 2]] || null; i += 2; }
      else if (c[i] === 49) bg = null;
    }
  }
  return html;
}

module.exports = { ansiToHtml, esc, C256 };
