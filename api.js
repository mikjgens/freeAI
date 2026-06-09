// API Layer — network streaming, SSE parsing, failover

const ApiLayer = (() => {
    function parseSSE(buffer) {
        const lines = buffer.split('\n');
        const rest = lines.pop() || '';
        const events = [];
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data && data !== '[DONE]') { try { events.push(JSON.parse(data)); } catch (e) { } }
            }
        }
        return { rest, events };
    }
    function extractOpenAIChunk(parsed) {
        const delta = parsed?.choices?.[0]?.delta || parsed?.choices?.[0] || {};
        return { text: delta.content || delta.text || '', toolCalls: delta.tool_calls || null };
    }
    const FETCH_TIMEOUT = 30000;
    const MAX_RETRIES = 3;

    function parseRetryAfter(body, headers) {
        try {
            const json = JSON.parse(body);
            if (json?.metadata?.retry_after_seconds) return json.metadata.retry_after_seconds * 1000;
            const msg = json?.error?.message || '';
            const m = msg.match(/try again in (\d+\.?\d*)s/);
            if (m) return parseFloat(m[1]) * 1000;
        } catch (e) {}
        const h = headers.get('Retry-After');
        if (h && /^\d+$/.test(h)) return parseInt(h) * 1000;
        return null;
    }

    async function streamOpenAI(endpoint, apiKey, modelId, messages, callbacks, signal, tools) {
        const { onToken, onDone, onError } = callbacks;
        let watchdog = null;
        let attempt = 0;
        async function tryRequest() {
            attempt++;
            try {
                const body = { model: modelId, messages, stream: true };
                if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
                const fetchPromise = fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body), signal,
                });
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after ' + (FETCH_TIMEOUT / 1000) + 's')), FETCH_TIMEOUT));
                const res = await Promise.race([fetchPromise, timeoutPromise]);
                if (!res.ok) {
                    const b = await res.text();
                    console.error('[API] ' + endpoint + ' returned ' + res.status + ': ' + b.slice(0, 500));
                    if ((res.status === 429 || res.status === 413) && attempt < MAX_RETRIES) {
                        const delay = parseRetryAfter(b, res.headers) || (Math.pow(2, attempt) * 1000);
                        console.warn('[API] Rate limited — retrying in ' + Math.round(delay / 1000) + 's (attempt ' + attempt + '/' + MAX_RETRIES + ')');
                        if (callbacks.onFallbackNotice) callbacks.onFallbackNotice('Rate limited — retrying in ' + Math.round(delay / 1000) + 's...');
                        await new Promise(r => { const t = setTimeout(() => { clearTimeout(t); r(); }, Math.min(delay, 30000)); });
                        return tryRequest();
                    }
                    onError(parseApiError(res.status, b));
                    return;
                }
                let lastChunkTime = Date.now();
                watchdog = setInterval(() => {
                    if (Date.now() - lastChunkTime > 15000) onError('Stream timed out after 15s of no data');
                }, 2000);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = '', buf = '', toolAccum = [], isToolStream = false;
                while (true) {
                    const readPromise = reader.read();
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Chunk timeout')), 15000));
                    const { done, value } = await Promise.race([readPromise, timeoutPromise]);
                    if (done) break;
                    lastChunkTime = Date.now();
                    buf += decoder.decode(value, { stream: true });
                    const { rest, events } = parseSSE(buf);
                    buf = rest;
                    for (const ev of events) {
                        const { text, toolCalls } = extractOpenAIChunk(ev);
                        if (toolCalls) {
                            if (!isToolStream) { isToolStream = true; if (callbacks.onToolStart) callbacks.onToolStart(); }
                            for (const tc of toolCalls) {
                                const idx = tc.index;
                                if (!toolAccum[idx]) toolAccum[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                                if (tc.id) toolAccum[idx].id = tc.id;
                                if (tc.function?.name) toolAccum[idx].function.name = tc.function.name;
                                if (tc.function?.arguments) toolAccum[idx].function.arguments += tc.function.arguments;
                            }
                        }
                        if (text && !isToolStream) { full += text; onToken(text); }
                    }
                }
                const finalToolCalls = toolAccum.filter(Boolean).map(tc => ({ id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: tc.function.arguments } }));
                onDone(full, finalToolCalls.length ? finalToolCalls : null);
            } catch (err) {
                if (err.name === 'AbortError') { onDone('', { _aborted: true }); return; }
                console.error('[API] Fetch error: ' + (err.message || 'unknown'));
                onError(err.message || 'Network error');
            } finally {
                if (watchdog) clearInterval(watchdog);
            }
        }
        tryRequest();
    }

    function callProvider(messages, model, callbacks, signal) {
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const allModels = [...models, ...StateManager.get('customModels')];
        const attempted = [];
        let _fallbackInProgress = false;
        const cleanMessages = messages.map(m => {
            const { _id, ...rest } = m;
            return rest;
        });
        const attempt = (currentModel) => {
            const apiKey = keys[currentModel.provider] || '';
            const attemptKey = currentModel.provider + ':' + currentModel.modelId;
            if (attempted.includes(attemptKey)) { callbacks.onError('Circular fallback detected for ' + currentModel.provider); return; }
            attempted.push(attemptKey);
            if (!apiKey) { tryNext(currentModel); return; }
            const tokensReceived = { value: false };
            const resetFlag = () => { _fallbackInProgress = false; };
            const wrappedCallbacks = {
                onToken: (token) => { tokensReceived.value = true; callbacks.onToken(token); },
                onDone: (text, extra) => { resetFlag(); callbacks.onDone(text, extra); },
                onError: (errMsg) => {
                    if (!tokensReceived.value && attempted.length < FALLBACK_CHAIN.length) { resetFlag(); if (callbacks.onFallbackNotice) callbacks.onFallbackNotice('[' + currentModel.provider + '] ' + errMsg); tryNext(currentModel); }
                    else { resetFlag(); callbacks.onError('[' + currentModel.provider + '] ' + errMsg); }
                },
                onToolStart: callbacks.onToolStart,
            };
            const tools = (currentModel.tools === 'Function Calling' && HARDCODED_TOOLS.length) ? HARDCODED_TOOLS : undefined;
            const endpoint = PROVIDER_ENDPOINTS[currentModel.provider];
            if (endpoint) streamOpenAI(endpoint, apiKey, currentModel.modelId, cleanMessages, wrappedCallbacks, signal, tools);
            else wrappedCallbacks.onError('Unknown provider: ' + currentModel.provider);
        };
        attempt(model);

        function tryNext(failedModel) {
            if (_fallbackInProgress) return;
            _fallbackInProgress = true;
            const keysNow = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
            const hasAnyKey = Object.values(keysNow).some(k => k && k.trim());
            if (!hasAnyKey) { _fallbackInProgress = false; callbacks.onError('No API keys configured. Open API Keys & Vault to add your keys.'); return; }
            const currentIdx = FALLBACK_CHAIN.findIndex(f => f.provider === failedModel.provider && f.modelId === failedModel.modelId);
            for (let i = Math.max(0, currentIdx + 1); i < FALLBACK_CHAIN.length; i++) {
                const fb = FALLBACK_CHAIN[i];
                const attemptKey = fb.provider + ':' + fb.modelId;
                if (attempted.includes(attemptKey)) continue;
                if (!keysNow[fb.provider]) continue;
                const fbModel = allModels.find(m => m.provider === fb.provider && m.modelId === fb.modelId);
                if (!fbModel || fbModel.type !== 'chat') continue;
                StateManager.set('selectedModel', fbModel);
                if (callbacks.onFallback) callbacks.onFallback(fbModel, failedModel);
                attempt(fbModel);
                return;
            }
            _fallbackInProgress = false;
            callbacks.onError('All providers exhausted');
        }
    }

    return { callProvider, parseSSE, extractOpenAIChunk, streamOpenAI };
})();
