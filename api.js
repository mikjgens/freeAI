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
    function toGoogleParts(content) {
        if (typeof content === 'string') return [{ text: content }];
        return content.map(part => {
            if (part.type === 'text') return { text: part.text };
            if (part.type === 'image_url') {
                const data = part.image_url.url;
                const mime = data.split(';')[0].split(':')[1] || 'image/png';
                return { inline_data: { mime_type: mime, data: data.split(',')[1] } };
            }
            return { text: '' };
        });
    }
    const FETCH_TIMEOUT = 30000;
    async function streamOpenAI(endpoint, apiKey, modelId, messages, callbacks, signal, tools) {
        const { onToken, onDone, onError } = callbacks;
        let watchdog = null;
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
            if (!res.ok) { const b = await res.text(); onError(parseApiError(res.status, b)); return; }
            let lastChunkTime = Date.now();
            watchdog = setInterval(() => {
                if (Date.now() - lastChunkTime > 15000) {
                    onError('Stream timed out after 15s of no data');
                }
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
            onError(err.message || 'Network error');
        } finally {
            if (watchdog) clearInterval(watchdog);
        }
    }

    async function streamGoogle(messages, modelId, apiKey, callbacks, signal, tools) {
        const { onToken, onDone, onError } = callbacks;
        let watchdog = null;
        try {
            const sysMsg = messages.find(m => m.role === 'system');
            const contents = messages.filter(m => m.role !== 'system').map(m => {
                if (m.role === 'tool') {
                    let response;
                    try { response = JSON.parse(m.content); } catch (e) { response = { result: m.content }; }
                    return { role: 'function', parts: [{ functionResponse: { name: m.name, response } }] };
                }
                if (m.role === 'assistant' && m.tool_calls) {
                    const parts = m.content ? [{ text: m.content }] : [];
                    for (const tc of m.tool_calls) {
                        let args;
                        try { args = JSON.parse(tc.function.arguments); } catch (e) { args = {}; }
                        parts.push({ functionCall: { name: tc.function.name, args } });
                    }
                    return { role: 'model', parts };
                }
                return { role: m.role === 'assistant' ? 'model' : 'user', parts: toGoogleParts(m.content) };
            });
            const body = { contents };
            if (sysMsg) body.system_instruction = { parts: [{ text: sysMsg.content }] };
            if (tools && tools.length) {
                body.tools = [{
                    functionDeclarations: tools.map(t => ({
                        name: t.function.name,
                        description: t.function.description,
                        parameters: t.function.parameters
                    }))
                }];
            }
            const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':streamGenerateContent?alt=sse&key=' + apiKey;
            const fetchPromise = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after ' + (FETCH_TIMEOUT / 1000) + 's')), FETCH_TIMEOUT));
            const res = await Promise.race([fetchPromise, timeoutPromise]);
            if (!res.ok) { const b = await res.text(); onError(parseApiError(res.status, b)); return; }
            let lastChunkTime = Date.now();
            watchdog = setInterval(() => {
                if (Date.now() - lastChunkTime > 15000) {
                    onError('Stream timed out after 15s of no data');
                }
            }, 2000);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let full = '', buf = '', images = [], toolAccum = [];
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
                    const parts = ev?.candidates?.[0]?.content?.parts || [];
                    for (const part of parts) {
                        if (part.text) { full += part.text; onToken(part.text); }
                        if (part.inline_data) images.push({ mime: part.inline_data.mime_type, data: part.inline_data.data });
                        if (part.functionCall) {
                            const tc = part.functionCall;
                            toolAccum.push({
                                id: 'call_google_' + toolAccum.length,
                                type: 'function',
                                function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
                            });
                        }
                    }
                }
            }
            const finalToolCalls = toolAccum.length ? toolAccum : null;
            onDone(full, finalToolCalls || (images.length ? images : null));
        } catch (err) {
            if (err.name === 'AbortError') { onDone('', { _aborted: true }); return; }
            onError(err.message || 'Network error');
        } finally {
            if (watchdog) clearInterval(watchdog);
        }
    }

    function callProvider(messages, model, callbacks, signal) {
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const allModels = [...models, ...StateManager.get('customModels')];
        const attempted = [];
        let _fallbackInProgress = false;
        (function attempt(currentModel) {
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
                    if (!tokensReceived.value && attempted.length < FALLBACK_CHAIN.length) { resetFlag(); if (callbacks.onFallbackNotice) callbacks.onFallbackNotice(errMsg); tryNext(currentModel); }
                    else { resetFlag(); callbacks.onError(errMsg); }
                },
                onToolStart: callbacks.onToolStart,
            };
            const tools = (currentModel.tools === 'Function Calling' && HARDCODED_TOOLS.length) ? HARDCODED_TOOLS : undefined;
            const endpoint = PROVIDER_ENDPOINTS[currentModel.provider];
            if (endpoint) streamOpenAI(endpoint, apiKey, currentModel.modelId, messages, wrappedCallbacks, signal, tools);
            else if (currentModel.provider === 'google') streamGoogle(messages, currentModel.modelId, apiKey, wrappedCallbacks, signal, tools);
            else wrappedCallbacks.onError('Unknown provider: ' + currentModel.provider);
        })(model);

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

    return { callProvider, parseSSE, extractOpenAIChunk, streamOpenAI, streamGoogle };
})();
