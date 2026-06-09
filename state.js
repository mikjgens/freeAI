// State Manager — centralized store with lightweight pub/sub

const StateManager = (() => {
    const _state = {
        selectedModel: null, conversationHistory: [], isStreaming: false,
        abortController: null, pendingAttachment: null, validatedModels: {},
        customModels: [], currentFilter: 'all', capabilityFilters: [], userPrompt: null, refDoc: null,
        userScrolledAway: false, toolLoopIteration: 0, lastToolCallSig: null, lastToolCallRepeat: 0,
        audioMuted: JSON.parse(localStorage.getItem('war_chest_audio_muted') || 'false'),
        ragEnabled: JSON.parse(localStorage.getItem('war_chest_rag_enabled') || 'true'),
        ttsEnabled: JSON.parse(localStorage.getItem('war_chest_tts_enabled') || 'false'),
        ragChunks: [],
        modelFilterString: localStorage.getItem('war_chest_model_filter') || '',
    };
    const _listeners = {};

    function get(key) { return _state[key]; }
    function set(key, val) { const prev = _state[key]; _state[key] = val; (_listeners[key] || []).forEach(fn => fn(val, prev)); }
    function subscribe(key, fn) {
        if (!_listeners[key]) _listeners[key] = [];
        _listeners[key].push(fn);
        return () => { const idx = _listeners[key].indexOf(fn); if (idx > -1) _listeners[key].splice(idx, 1); };
    }
    function getState() { return { ..._state }; }

    function pushMessage(msg) { _state.conversationHistory.push(msg); }
    function saveConversation() {
        try {
            const trimmed = _state.conversationHistory.slice(-MAX_HISTORY);
            localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(trimmed));
        } catch (e) {
            try { const trimmed = _state.conversationHistory.slice(-50); localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(trimmed)); } catch (_) { }
        }
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
            selectedModel: null, conversationHistory: [{ role: 'system', content: '' }], isStreaming: false,
            abortController: null, pendingAttachment: null, validatedModels: {}, customModels: [],
            currentFilter: 'all', userPrompt: null, refDoc: null, userScrolledAway: false,
            audioMuted: false, ragEnabled: true, ttsEnabled: false, ragChunks: [],
            modelFilterString: '',
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
        if (_state.refDoc && _state.refDoc.content) return base + '\n\n---\nReference Document (' + _state.refDoc.name + '):\n' + _state.refDoc.content;
        return base;
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

    return { get, set, subscribe, getState, pushMessage, saveConversation, wipeAll, trimHistoryForModel, compiledPrompt, recompileSystemMessage, setValidated };
})();
