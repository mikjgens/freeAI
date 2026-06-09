// Tool Executor — local tool functions + agentic loop

const ToolExecutor = (() => {
    function getSystemTime() {
        const now = new Date();
        return { iso: now.toISOString(), local: now.toLocaleString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, unix_ms: now.getTime() };
    }
    function evaluateMath(argsStr) {
        let args;
        try { args = JSON.parse(argsStr); } catch (e) { return { error: 'Invalid JSON in arguments' }; }
        const expr = (args.expression || '').trim();
        if (!expr) return { error: 'No expression provided' };
        try { return { expression: expr, result: safeEval(expr) }; }
        catch (e) { return { error: 'Evaluation error: ' + e.message }; }
    }
    function getUiState() {
        const model = StateManager.get('selectedModel');
        const history = StateManager.get('conversationHistory');
        const tokens = estimateTokens(history);
        const ctx = model ? parseCtx(model.ctx) : null;
        return {
            activeModel: model ? { name: model.name, provider: model.provider } : null,
            tokenUsage: tokens,
            contextWindow: ctx,
            contextPercent: ctx ? Math.min(100, Math.round((tokens / ctx) * 100)) : 0,
            messageCount: history.filter(m => m.role !== 'system').length,
            toolSupport: model?.tools || 'None'
        };
    }
    async function webSearch(argsStr) {
        let args;
        try { args = JSON.parse(argsStr); } catch (e) { return { error: 'Invalid JSON in arguments' }; }
        const query = (args.query || '').trim();
        if (!query) return { error: 'No search query provided' };
        try {
            const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1';
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 10000);
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(timer);
            if (!res.ok) return { error: 'Search failed: HTTP ' + res.status };
            const data = await res.json();
            const result = { query, source: 'DuckDuckGo' };
            if (data.AbstractText) result.abstract = data.AbstractText;
            if (data.AbstractSource) result.source = data.AbstractSource;
            if (data.AbstractURL) result.url = data.AbstractURL;
            if (data.RelatedTopics && data.RelatedTopics.length) {
                result.related = data.RelatedTopics.slice(0, 5).map(t => {
                    if (t.Text) return t.Text;
                    if (t.Topics) return t.Topics.slice(0, 3).map(st => st.Text).join('; ');
                    return '';
                }).filter(Boolean);
            }
            if (data.Results && data.Results.length) {
                result.results = data.Results.slice(0, 5).map(r => ({ title: r.Text, url: r.FirstURL }));
            }
            if (!result.abstract && !result.related && !result.results) {
                result.note = 'No instant answer found for this query. Try a different search term.';
            }
            return result;
        } catch (err) {
            return { error: 'Search error: ' + err.message };
        }
    }
    async function execute(toolCalls, history) {
        const results = [];
        let abortLoop = false;
        for (const tc of toolCalls) {
            const name = tc.function?.name || '';
            const argsStr = tc.function?.arguments || '{}';
            const sig = name + ':' + argsStr;
            const lastSig = StateManager.get('lastToolCallSig');
            let repeat = StateManager.get('lastToolCallRepeat');
            if (sig === lastSig) {
                repeat++;
                StateManager.set('lastToolCallRepeat', repeat);
                if (repeat >= 2) {
                    results.push({ tool_call_id: tc.id, name, content: JSON.stringify({ error: 'Tool [' + name + '] failed identically twice. Aborting tool loop.' }) });
                    abortLoop = true; break;
                }
            } else { StateManager.set('lastToolCallSig', sig); StateManager.set('lastToolCallRepeat', 1); }
            let result;
            switch (name) {
                case 'get_system_time': result = getSystemTime(); break;
                case 'evaluate_math': result = evaluateMath(argsStr); break;
                case 'get_ui_state': result = getUiState(); break;
                case 'web_search': result = await webSearch(argsStr); break;
                default: result = { error: 'Unknown tool "' + escapeHtml(name) + '". Available tools: get_system_time, evaluate_math, get_ui_state, web_search' };
            }
            results.push({ tool_call_id: tc.id, name, content: JSON.stringify(result) });
        }
        return { results, abortLoop };
    }
    return { execute };
})();
