// State Manager — centralized store with lightweight pub/sub

const StateManager = (() => {
    const _state = {
        selectedModel: null, conversationHistory: [], streamingCount: 0,
        abortController: null, pendingAttachment: null, validatedModels: {},
        customModels: [], currentFilter: 'all', capabilityFilters: [], userPrompt: null, refDoc: null,
        userScrolledAway: false, toolLoopIteration: 0, lastToolCallSig: null, lastToolCallRepeat: 0,
        audioMuted: JSON.parse(localStorage.getItem('war_chest_audio_muted') || 'false'),
        ragEnabled: JSON.parse(localStorage.getItem('war_chest_rag_enabled') || 'true'),
        ttsEnabled: JSON.parse(localStorage.getItem('war_chest_tts_enabled') || 'false'),
        voiceProfile: localStorage.getItem('war_chest_voice_profile') || 'default',
        ragChunks: [],
        modelFilterString: localStorage.getItem('war_chest_model_filter') || '',
        watcherMessageCount: 0,
        knowledgeGraph: { entities: [], relationships: [] },
        sessionHistory: [],
        sessionSummaries: [],
        currentSessionStart: Date.now(),
        sessionsLoaded: false,
        lastFallbackFrom: null,
        subCallAbort: null,
    };
    const _listeners = {};
    let _tokenCache = { count: 0, historyLength: -1 };

    function get(key) { return _state[key]; }
    function set(key, val) { const prev = _state[key]; _state[key] = val; (_listeners[key] || []).forEach(fn => fn(val, prev)); }
    function subscribe(key, fn) {
        if (!_listeners[key]) _listeners[key] = [];
        _listeners[key].push(fn);
        return () => { const idx = _listeners[key].indexOf(fn); if (idx > -1) _listeners[key].splice(idx, 1); };
    }
    function getState() { return { ..._state }; }

    function incrementStreaming() {
        _state.streamingCount++;
        (_listeners['isStreaming'] || []).forEach(fn => fn(true));
    }
    function decrementStreaming() {
        _state.streamingCount = Math.max(0, _state.streamingCount - 1);
        if (_state.streamingCount === 0)
            (_listeners['isStreaming'] || []).forEach(fn => fn(false));
    }
    function isStreaming() { return _state.streamingCount > 0; }

    function pushMessage(msg) {
        if (!msg._id) msg._id = crypto.randomUUID();
        _state.conversationHistory.push(msg);
        _tokenCache.historyLength = -1;
        (_listeners['conversationHistory'] || []).forEach(fn => fn(_state.conversationHistory));
    }

    const _saveConversation = debounce(function _doSave() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
            let sessionData;
            try { sessionData = raw ? JSON.parse(raw) : null; } catch (e) { sessionData = null; }
            if (!sessionData || !sessionData.version || sessionData.version < 2) {
                sessionData = { version: 2, sessions: [], currentSessionId: crypto.randomUUID() };
            }
            let current = sessionData.sessions.find(s => s.id === sessionData.currentSessionId);
            if (!current) {
                current = { id: sessionData.currentSessionId || crypto.randomUUID(), started: _state.currentSessionStart, ended: null, summary: null, topics: [], messages: [] };
                sessionData.sessions.push(current);
                sessionData.currentSessionId = current.id;
            }
            current.messages = _state.conversationHistory.slice(-MAX_HISTORY);
            current.ended = Date.now();
            localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(sessionData));
        } catch (e) {
            try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify({ version: 2, sessions: [{ id: 'recovery', started: Date.now(), messages: _state.conversationHistory.slice(-30) }], currentSessionId: 'recovery' })); } catch (_) {}
        }
    }, 800);

    function saveConversation() { _saveConversation(); }
    function saveConversationNow() { _saveConversation.flush(); }

    function loadSessionData() {
        if (_state.sessionsLoaded) return;
        _state.sessionsLoaded = true;
        try {
            const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
            if (!raw) {
                _state.conversationHistory = _state.conversationHistory || [{ role: 'system', content: '' }];
                _state.currentSessionStart = Date.now();
                return;
            }
            const parsed = JSON.parse(raw);
            if (!parsed.version || parsed.version < 2) {
                const messages = Array.isArray(parsed) ? parsed : (parsed.messages || []);
                _state.conversationHistory = messages.length ? messages : [{ role: 'system', content: '' }];
                _state.sessionHistory = [{ id: crypto.randomUUID(), started: Date.now() - 86400000, ended: Date.now(), summary: null, topics: [], messages: _state.conversationHistory }];
            } else {
                _state.sessionHistory = parsed.sessions || [];
                _state.currentSessionId = parsed.currentSessionId;
                const current = parsed.sessions.find(s => s.id === parsed.currentSessionId);
                if (current) {
                    _state.conversationHistory = current.messages && current.messages.length ? current.messages : [{ role: 'system', content: '' }];
                    _state.currentSessionStart = current.started || Date.now();
                } else {
                    _state.conversationHistory = _state.conversationHistory || [{ role: 'system', content: '' }];
                    _state.currentSessionStart = Date.now();
                }
            }
        } catch (e) {
            _state.conversationHistory = _state.conversationHistory || [{ role: 'system', content: '' }];
            _state.currentSessionStart = Date.now();
        }
    }

    function endSession() {
        const sessionData = {
            id: _state.currentSessionId || crypto.randomUUID(),
            started: _state.currentSessionStart,
            ended: Date.now(),
            summary: null,
            topics: [],
            messages: _state.conversationHistory.slice(-MAX_HISTORY),
        };
        _state.sessionHistory.push(sessionData);
        if (_state.sessionHistory.length > 20) _state.sessionHistory = _state.sessionHistory.slice(-20);
        _state.currentSessionId = crypto.randomUUID();
        _state.currentSessionStart = Date.now();
        _state.conversationHistory = [{ role: 'system', content: compiledPrompt() }];
        saveConversationNow();
    }

    function estimateTokensCached() {
        const h = _state.conversationHistory;
        if (h.length !== _tokenCache.historyLength) {
            _tokenCache.count = estimateTokens(h);
            _tokenCache.historyLength = h.length;
        }
        return _tokenCache.count;
    }

    function wipeAll() {
        localStorage.removeItem('war_chest_keys');
        localStorage.removeItem('war_chest_custom_models');
        localStorage.removeItem('war_chest_validated');
        localStorage.removeItem(STORAGE_KEY_HISTORY);
        localStorage.removeItem(STORAGE_KEY_PROMPT);
        localStorage.removeItem(STORAGE_KEY_REFDOC);
        localStorage.removeItem(STORAGE_KEY_ACTIVE_MODEL);
        localStorage.removeItem('war_chest_audio_muted');
        try { sessionStorage.removeItem(STORAGE_KEY_DRAFT); } catch (e) { }
        Object.assign(_state, {
            selectedModel: null, conversationHistory: [{ role: 'system', content: '' }], streamingCount: 0,
            abortController: null, pendingAttachment: null, validatedModels: {}, customModels: [],
            currentFilter: 'all', userPrompt: null, refDoc: null, userScrolledAway: false,
            audioMuted: false, ragEnabled: true, ttsEnabled: false, ragChunks: [],
            modelFilterString: '', watcherMessageCount: 0,
            voiceProfile: 'default',
            knowledgeGraph: { entities: [], relationships: [] },
            sessionHistory: [], sessionSummaries: [],
            currentSessionStart: Date.now(), sessionsLoaded: true,
            lastFallbackFrom: null, subCallAbort: null,
        });
        (_listeners['*'] || []).forEach(fn => fn(_state));
    }

    function trimHistoryForModel(modelCtxStr, reserveTokens) {
        reserveTokens = reserveTokens || 2048;
        const maxCtx = parseCtx(modelCtxStr);
        if (maxCtx === Infinity) return 0;
        const history = _state.conversationHistory;
        const usedTokens = estimateTokens(history);
        if (usedTokens + reserveTokens <= maxCtx) return 0;
        const systemMsg = history[0];
        const rest = history.slice(1);
        const trimmed = [];
        let runningTokens = estimateTokens([systemMsg]) + reserveTokens;
        for (let i = rest.length - 1; i >= 0; i--) {
            const msgTokens = estimateTokens([rest[i]]);
            if (runningTokens + msgTokens <= maxCtx) { trimmed.unshift(rest[i]); runningTokens += msgTokens; } else break;
        }
        const dropped = rest.length - trimmed.length;
        _state.conversationHistory = [systemMsg, ...trimmed];
        return dropped;
    }

    function compiledPrompt() {
        const base = (_state.userPrompt && _state.userPrompt.trim()) ? _state.userPrompt : SYSTEM_PROMPT;
        let prompt = base;
        if (_state.refDoc && _state.refDoc.content) prompt += '\n\n---\nReference Document (' + _state.refDoc.name + '):\n' + _state.refDoc.content;
        const sessions = _state.sessionHistory || [];
        if (sessions.length > 0) {
            const recent = sessions.filter(s => s.summary).slice(-3);
            if (recent.length) {
                prompt += '\n\n---\n## User Session Context\n';
                for (const s of recent) {
                    prompt += '- ' + new Date(s.started).toLocaleDateString() + ': ' + s.summary + '\n';
                }
            }
        }
        if (_state.knowledgeGraph && _state.knowledgeGraph.entities && _state.knowledgeGraph.entities.length) {
            const pinned = _state.knowledgeGraph.entities.filter(e => e.pinned);
            if (pinned.length) {
                prompt += '\n\n---\n## Pinned Knowledge\n';
                for (const e of pinned) prompt += '- ' + e.name + ' (' + e.type + ')\n';
            }
        }
        return prompt;
    }

    function recompileSystemMessage() {
        const history = _state.conversationHistory;
        if (history.length > 0 && history[0].role === 'system') history[0].content = compiledPrompt();
        else history.unshift({ role: 'system', content: compiledPrompt() });
    }

    function setValidated(modelKey, valid) {
        const validated = _state.validatedModels;
        const [modelId, provider] = modelKey.split(':');
        if (!validated[provider]) validated[provider] = [];
        if (valid && !validated[provider].includes(modelId)) validated[provider].push(modelId);
        else if (!valid) validated[provider] = validated[provider].filter(id => id !== modelId);
    }

    return {
        get, set, subscribe, getState, pushMessage, saveConversation, saveConversationNow,
        wipeAll, trimHistoryForModel, compiledPrompt, recompileSystemMessage, setValidated,
        incrementStreaming, decrementStreaming, isStreaming, estimateTokensCached,
        loadSessionData, endSession,
    };
})();
