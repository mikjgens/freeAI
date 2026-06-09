// Utility Functions

function $(id) { return document.getElementById(id); }

function parseCtx(ctxStr) {
    if (!ctxStr || ctxStr === 'N/A') return Infinity;
    const num = parseInt(ctxStr);
    if (ctxStr.includes('M')) return num * 1024 * 1024;
    if (ctxStr.includes('K')) return num * 1024;
    return num;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTimestamp(date) {
    const now = new Date();
    const diff = now - date;
    const day = 86400000;
    if (diff < day && now.getDate() === date.getDate()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear()) return 'Yesterday ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (diff < 7 * day) return date.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function estimateTokens(history) {
    let total = 0;
    for (const msg of history) {
        if (typeof msg.content === 'string') total += msg.content.length / 3.5;
        else if (Array.isArray(msg.content)) for (const part of msg.content) { if (part.type === 'text') total += part.text.length / 3.5; if (part.type === 'image_url') total += 1000; }
    }
    return Math.ceil(total);
}

function hasImageContent(history) {
    return history.some(msg => Array.isArray(msg.content) && msg.content.some(p => p.type === 'image_url'));
}

function parseApiError(status, body) {
    try { const json = JSON.parse(body); if (json?.error?.message) return json.error.message; } catch (e) { }
    const known = {
        400: 'Bad request — check the model ID and request format.',
        401: 'Unauthorized — your API key is invalid or missing.',
        402: 'Payment required — the model is not free or your account has no credits.',
        403: 'Forbidden — your API key lacks access to this model.',
        404: 'Not found — the model endpoint does not exist.',
        429: 'Rate limited — you are sending too many requests.',
        500: 'Server error — the provider had an internal issue.',
        503: 'Service unavailable — the provider is down for maintenance.',
    };
    return known[status] || 'HTTP ' + status + ': ' + (body || '').slice(0, 200);
}

function safeEval(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch === ' ') { i++; continue; }
        if ('+-*/.()%'.includes(ch)) { tokens.push(ch); i++; continue; }
        if (ch >= '0' && ch <= '9') {
            let num = '';
            while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) { num += expr[i]; i++; }
            tokens.push(parseFloat(num));
            continue;
        }
        throw new Error('Unexpected character: ' + ch);
    }
    let pos = 0;
    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function consume() { return tokens[pos++]; }
    function parseAddSub() {
        let left = parseMulDiv();
        while (peek() === '+' || peek() === '-') {
            const op = consume();
            const right = parseMulDiv();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }
    function parseMulDiv() {
        let left = parseUnary();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            const op = consume();
            const right = parseUnary();
            if (op === '*') left = left * right;
            else if (op === '/') { if (right === 0) throw new Error('Division by zero'); left = left / right; }
            else left = left % right;
        }
        return left;
    }
    function parseUnary() {
        if (peek() === '-') { consume(); return -parseAtom(); }
        if (peek() === '+') { consume(); return parseAtom(); }
        return parseAtom();
    }
    function parseAtom() {
        if (peek() === '(') { consume(); const val = parseAddSub(); if (peek() !== ')') throw new Error('Missing closing parenthesis'); consume(); return val; }
        if (typeof peek() === 'number') return consume();
        throw new Error('Expected number or (');
    }
    const result = parseAddSub();
    if (pos < tokens.length) throw new Error('Unexpected token after expression');
    if (typeof result !== 'number' || !isFinite(result)) throw new Error('Result is not finite');
    return result;
}

function findModelItem(modelId, provider) {
    const items = document.querySelectorAll('.model-item');
    for (const item of items) {
        if (item.dataset.modelId === modelId && item.dataset.provider === provider) return item;
    }
    return null;
}

function debounce(fn, ms) {
    let t, lastArgs = [];
    const debounced = (...args) => { lastArgs = args; clearTimeout(t); t = setTimeout(() => fn(...lastArgs), ms); };
    debounced.flush = () => { clearTimeout(t); fn(...lastArgs); };
    return debounced;
}
