const fs = require('fs');
const src = fs.readFileSync('src/App.tsx', 'utf8');
let i = 0;
const stack = [];
let state = 'code';
let templateBraceDepth = 0;

function push(ch) { stack.push({ ch, i }); }
function pop(ch) {
  const last = stack[stack.length - 1];
  if (!last) {
    console.log('Unexpected closing', ch, 'at index', i);
    process.exit(1);
  }
  const map = { '{': '}', '(': ')', '[': ']' };
  if (map[last.ch] === ch) {
    stack.pop();
    return true;
  }
  console.log('Mismatch', { expected: map[last.ch], saw: ch, last: last.ch, at: last.i, current: i });
  process.exit(1);
}

while (i < src.length) {
  const ch = src[i];
  const next = src[i + 1];

  if (state === 'single') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === "'") state = 'code';
    i++; continue;
  }
  if (state === 'double') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') state = 'code';
    i++; continue;
  }
  if (state === 'template') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') { state = 'code'; i++; continue; }
    if (ch === '$' && next === '{') {
      push('{');
      state = 'template_expr';
      i += 2;
      continue;
    }
    i++; continue;
  }
  if (state === 'template_expr') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === "'") { state = 'single'; i++; continue; }
    if (ch === '"') { state = 'double'; i++; continue; }
    if (ch === '`') { state = 'template'; i++; continue; }
    if (ch === '{') { push('{'); i++; continue; }
    if (ch === '}') { pop('}'); if (stack.length && stack[stack.length - 1].ch === '{' && src[stack[stack.length - 1].i] === '$') { /* ignore */ } i++; continue; }
    if (ch === '(' || ch === '[') { push(ch); i++; continue; }
    if (ch === ')' || ch === ']') { pop(ch); i++; continue; }
    if (ch === '/' && next === '*') { state = 'block_comment'; i += 2; continue; }
    if (ch === '/' && next === '/') { state = 'line_comment'; i += 2; continue; }
    i++; continue;
  }
  if (state === 'line_comment') {
    if (ch === '\n') state = 'code';
    i++; continue;
  }
  if (state === 'block_comment') {
    if (ch === '*' && next === '/') { state = 'code'; i += 2; continue; }
    i++; continue;
  }

  if (ch === '/' && next === '*') { state = 'block_comment'; i += 2; continue; }
  if (ch === '/' && next === '/') { state = 'line_comment'; i += 2; continue; }
  if (ch === "'") { state = 'single'; i++; continue; }
  if (ch === '"') { state = 'double'; i++; continue; }
  if (ch === '`') { state = 'template'; i++; continue; }

  if (ch === '{' || ch === '(' || ch === '[') { push(ch); }
  if (ch === '}' || ch === ')' || ch === ']') { pop(ch); }

  i++;
}

console.log('Remaining stack length:', stack.length);
console.log('Tail:', stack.slice(-20));
