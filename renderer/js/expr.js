// CSP-safe arithmetic/logic expression evaluator (no eval / Function).
// Supports: numbers, identifiers, + - * / %, unary -, comparisons (>= <= > < == !=),
// && || !, ternary ?: , parentheses, and a few functions: min,max,floor,ceil,round,abs.
// Used for system derived-stat formulas like "6 + brawn" or "3 + (wits>=12?1:0)".

const FUNCS = {
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, abs: Math.abs, sign: Math.sign,
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const re = {
    ws: /\s/,
    num: /[0-9.]/,
    idStart: /[a-zA-Z_]/,
    id: /[a-zA-Z0-9_]/,
  };
  while (i < src.length) {
    const c = src[i];
    if (re.ws.test(c)) { i++; continue; }
    if (re.num.test(c)) {
      let j = i + 1;
      while (j < src.length && re.num.test(src[j])) j++;
      const slice = src.slice(i, j);
      const val = parseFloat(slice);
      // Reject malformed literals (e.g. "1.2.3", lone ".") instead of silently mis-parsing.
      if (!isFinite(val) || (slice.split('.').length - 1) > 1) throw new Error('Invalid number literal: ' + slice);
      tokens.push({ t: 'num', v: val });
      i = j; continue;
    }
    if (re.idStart.test(c)) {
      let j = i + 1;
      while (j < src.length && re.id.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j; continue;
    }
    // multi-char operators
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%()<>?:!,'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('Unexpected character in formula: ' + c);
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

export function compile(src) {
  const tokens = tokenize(String(src));
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const eat = (v) => { const tk = next(); if (tk.v !== v) throw new Error(`Expected ${v}`); };

  function parseExpr() { return parseTernary(); }

  function parseTernary() {
    let cond = parseOr();
    if (peek().v === '?') {
      next();
      const a = parseExpr();
      eat(':');
      const b = parseExpr();
      return (ctx) => (cond(ctx) ? a(ctx) : b(ctx));
    }
    return cond;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek().v === '||') { next(); const r = parseAnd(); const l = left; left = (ctx) => (l(ctx) || r(ctx)) ? 1 : 0; }
    return left;
  }
  function parseAnd() {
    let left = parseCmp();
    while (peek().v === '&&') { next(); const r = parseCmp(); const l = left; left = (ctx) => (l(ctx) && r(ctx)) ? 1 : 0; }
    return left;
  }
  function parseCmp() {
    let left = parseAdd();
    while (['>', '<', '>=', '<=', '==', '!='].includes(peek().v)) {
      const op = next().v; const r = parseAdd(); const l = left;
      left = (ctx) => {
        const a = l(ctx), b = r(ctx);
        switch (op) { case '>': return a > b ? 1 : 0; case '<': return a < b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0; case '<=': return a <= b ? 1 : 0;
          case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0; }
      };
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (['+', '-'].includes(peek().v)) { const op = next().v; const r = parseMul(); const l = left; left = (ctx) => op === '+' ? l(ctx) + r(ctx) : l(ctx) - r(ctx); }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    while (['*', '/', '%'].includes(peek().v)) {
      const op = next().v; const r = parseUnary(); const l = left;
      left = (ctx) => { const a = l(ctx), b = r(ctx); return op === '*' ? a * b : op === '/' ? (b === 0 ? 0 : a / b) : a % b; };
    }
    return left;
  }
  function parseUnary() {
    if (peek().v === '-') { next(); const r = parseUnary(); return (ctx) => -r(ctx); }
    if (peek().v === '!') { next(); const r = parseUnary(); return (ctx) => r(ctx) ? 0 : 1; }
    if (peek().v === '+') { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (tk.t === 'num') { next(); return () => tk.v; }
    if (tk.v === '(') { next(); const e = parseExpr(); eat(')'); return e; }
    if (tk.t === 'id') {
      next();
      if (peek().v === '(') {
        next();
        const args = [];
        if (peek().v !== ')') {
          args.push(parseExpr());
          while (peek().v === ',') { next(); args.push(parseExpr()); }
        }
        eat(')');
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error('Unknown function: ' + tk.v);
        return (ctx) => fn(...args.map((a) => a(ctx)));
      }
      const name = tk.v;
      if (name === 'true') return () => 1;
      if (name === 'false') return () => 0;
      return (ctx) => Number(ctx[name] || 0);
    }
    throw new Error('Unexpected token in formula');
  }

  const fn = parseExpr();
  if (peek().t !== 'eof') throw new Error('Unexpected trailing tokens in formula');
  return fn;
}

const cache = new Map();
export function evalFormula(src, ctx) {
  if (src == null) return 0;
  if (typeof src === 'number') return src;
  let fn = cache.get(src);
  if (!fn) {
    try { fn = compile(src); } catch (e) { console.warn('formula error', src, e.message); fn = () => 0; }
    cache.set(src, fn);
  }
  try { return fn(ctx || {}); } catch { return 0; }
}
