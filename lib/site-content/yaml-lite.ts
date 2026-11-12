// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// Tiny YAML subset for Keystatic frontmatter: nested maps, lists of scalars / maps, plain / quoted scalars.
// dump() follows js-yaml's style (what Keystatic writes) closely enough that untouched values round-trip byte for byte.
const isPlainSafe = s => s !== '' && !/^[\s]|[\s]$/.test(s) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) && !/: |\s#/.test(s) && !/[:]$/.test(s)
  && !/^(true|false|yes|no|on|off|null|~|y|n)$/i.test(s) && !/^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|\.inf|\.nan|0x[0-9a-f]+|0o[0-7]+)$/i.test(s)
  && !/^\d{4}-\d\d-\d\d/.test(s) && !/[\n\t\u0000-\u001f]/.test(s) && !/^---/.test(s);
const q = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
const scalar = v => v === null || v === undefined ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : isPlainSafe(String(v)) ? String(v) : q(String(v));
export function dump(obj, ind = 0) {
  const pad = ' '.repeat(ind); let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) { out += `${pad}${k}: []\n`; continue; }
      out += `${pad}${k}:\n`;
      for (const it of v) {
        if (it && typeof it === 'object' && !Array.isArray(it)) { const inner = dump(it, ind + 4).split('\n').filter(Boolean); out += `${pad}  - ${inner[0].trimStart()}\n` + inner.slice(1).map(l => l.replace(/^ {2}/, '') ).map(l => `${l}\n`).join(''); }
        else out += `${pad}  - ${scalar(it)}\n`;
      }
    } else if (v && typeof v === 'object') { const inner = dump(v, ind + 2); out += inner ? `${pad}${k}:\n${inner}` : `${pad}${k}: {}\n`; }
    else out += `${pad}${k}: ${scalar(v)}\n`;
  }
  return out;
}
function parseScalar(t) {
  t = t.trim();
  if (t === '' || t === '~' || t === 'null') return t === '' ? null : null;
  if (t[0] === '"') return JSON.parse(t.replace(/\\'/g, "'"));
  if (t[0] === "'") return t.slice(1, -1).replace(/''/g, "'");
  if (t === 'true') return true; if (t === 'false') return false;
  if (t === '[]') return []; if (t === '{}') return {};
  if (/^[-+]?\d+$/.test(t)) return Number(t);
  if (/^[-+]?\d*\.\d+$/.test(t)) return Number(t);
  return t.replace(/\s+#.*$/, '');
}
export function parse(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() && !/^\s*#/.test(l));
  let i = 0;
  const indentOf = l => l.match(/^ */)[0].length;
  function block(ind) {
    if (i < lines.length && lines[i].slice(ind).startsWith('- ') || (i < lines.length && lines[i].trim() === '-')) return list(ind);
    const obj = {};
    while (i < lines.length && indentOf(lines[i]) === ind && !lines[i].slice(ind).startsWith('-')) {
      const m = lines[i].slice(ind).match(/^("[^"]*"|[^:]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`YAML: cannot read line ${i + 1}: ${lines[i]}`);
      const key = m[1][0] === '"' ? JSON.parse(m[1]) : m[1].trim(); i++;
      if (m[2] !== undefined && m[2] !== '') {
        if (/^[|>][-+]?$/.test(m[2])) { // block scalar
          const parts = []; const bi = i < lines.length ? indentOf(lines[i]) : ind + 2;
          while (i < lines.length && indentOf(lines[i]) >= bi && indentOf(lines[i]) > ind) parts.push(lines[i++].slice(bi));
          obj[key] = m[2][0] === '|' ? parts.join('\n') : parts.join(' ');
        } else obj[key] = parseScalar(m[2]);
      } else if (i < lines.length && (indentOf(lines[i]) > ind || (indentOf(lines[i]) === ind && lines[i].slice(ind).startsWith('- ')))) obj[key] = block(indentOf(lines[i]));
      else obj[key] = null;
    }
    return obj;
  }
  function list(ind) {
    const arr = [];
    while (i < lines.length && indentOf(lines[i]) === ind && lines[i].slice(ind).startsWith('-')) {
      const rest = lines[i].slice(ind + 1).trimStart();
      if (/^("[^"]*"|[^\s"'][^:]*):(\s|$)/.test(rest) && !/^["']/.test(rest)) { // map item
        lines[i] = ' '.repeat(ind + 2) + rest; arr.push(block(ind + 2));
      } else { arr.push(parseScalar(rest)); i++; }
    }
    return arr;
  }
  return lines.length ? block(indentOf(lines[0])) : {};
}
