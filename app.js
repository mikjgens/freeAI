// App — orchestration layer, event wiring, sendMessage

const App = (() => {
    let _streamState = null;
    let _wipeHandlerAttached = false;
    let _aiNoteIdx = 0, _lastUserKeyTime = 0;
    let _deltaEnabled = false;

    function sendMessage() {
        const input = document.getElementById('terminal-input');
        const msg = input.value.trim();
        const attachment = StateManager.get('pendingAttachment');
        let selectedModel = StateManager.get('selectedModel');
        const history = StateManager.get('conversationHistory');
        if ((!msg && !attachment) || StateManager.isStreaming()) {
            if (!msg && !attachment && !StateManager.isStreaming()) DomLayer.showToast('warning', 'Type a message or attach an image before sending.');
            return;
        }
        // #4: Cancel pending sub-calls and any in-flight delta
        const prevAbort = StateManager.get('subCallAbort');
        if (prevAbort) { try { prevAbort.abort(); } catch (e) {} }
        const subCtrl = new AbortController();
        StateManager.set('subCallAbort', subCtrl);
        if (_deltaEnabled && msg) {
            if (attachment) { DomLayer.showToast('warning', 'Delta Mode does not support image attachments.'); return; }
            sendDeltaQuery(msg);
            return;
        }
        if (!selectedModel) { DomLayer.showError('No model selected. Click a model in the fleet panel first.'); return; }
        if (selectedModel.type !== 'chat') { DomLayer.showError('Cannot chat with ' + selectedModel.name + ' \u2014 it is a ' + selectedModel.type + ' model.'); return; }
        if (attachment && !selectedModel.vision) { DomLayer.showError(selectedModel.name + ' does not support vision. Select a model with vision capability or remove the attachment.'); return; }
        // #5: Auto-revert fallback model on next send
        const lastFallback = StateManager.get('lastFallbackFrom');
        if (lastFallback) {
            StateManager.set('lastFallbackFrom', null);
            const origModel = [...models, ...StateManager.get('customModels')].find(
                m => m.provider === lastFallback.provider && m.modelId === lastFallback.modelId
            );
            if (origModel) {
                selectedModel = origModel;
                StateManager.set('selectedModel', origModel);
            }
        }
        StateManager.recompileSystemMessage();
        const ragEnabled = StateManager.get('ragEnabled');
        const ragChunks = StateManager.get('ragChunks') || [];
        if (ragEnabled && ragChunks.length && msg && StateManager._ragIndex) {
            const matches = retrieveChunks(msg, ragChunks, StateManager._ragIndex);
            if (matches.length) {
                const sysMsg = StateManager.get('conversationHistory')[0];
                const refText = matches.map(c => '[Reference: ' + c.text + ']').join('\n\n');
                sysMsg.content = (sysMsg.content || '') + '\n\n---\nRelevant reference document excerpts:\n' + refText;
                DomLayer.showInfoInStatus('' + matches.length + ' chunks matched from reference doc');
                DomLayer.updateRagIndicator(true);
            }
        } else {
            DomLayer.updateRagIndicator(false);
        }
        const maxCtx = parseCtx(selectedModel.ctx);
        const currentTokens = estimateTokens(history);
        const msgTokens = estimateTokens([{ role: 'user', content: msg || '...' }]);
        if (maxCtx !== Infinity && currentTokens + msgTokens + 2048 > maxCtx) {
            const dropped = StateManager.trimHistoryForModel(selectedModel.ctx, 2048 + msgTokens);
            if (dropped > 0) { DomLayer.archiveMessages(StateManager.get('conversationHistory').length - 1); DomLayer.addHorizonBanner(); }
        }
        // #2: TPM-aware trimming for low-limit free tier models
        const LOW_TPM_BUDGETS = {
            'qwen/qwen3-32b': 4000,
            'llama-3.3-70b-versatile': 8000,
            'llama-3.1-8b-instant': 8000,
            'meta-llama/llama-3.3-70b-instruct:free': 8000,
        };
        const tpmBudget = LOW_TPM_BUDGETS[selectedModel.modelId];
        if (tpmBudget && currentTokens + msgTokens + 2048 > tpmBudget) {
            const overCtx = parseCtx(String(Math.floor(tpmBudget / 1024)) + 'K');
            const dropped = StateManager.trimHistoryForModel(String(Math.floor(tpmBudget / 1024)) + 'K', 2048 + msgTokens);
            if (dropped > 0) { DomLayer.archiveMessages(StateManager.get('conversationHistory').length - 1); DomLayer.addHorizonBanner(); DomLayer.showInfoInStatus('Trimmed ' + dropped + ' messages to fit free tier TPM budget'); }
        }
        _aiNoteIdx = 0;
        playSound('click');
        const userMsgId = crypto.randomUUID();
        DomLayer.addUserMessage(msg, attachment, userMsgId);
        input.value = '';
        try { sessionStorage.removeItem(STORAGE_KEY_DRAFT); } catch (e) { }
        const collapsedH = input.scrollHeight || 36;
        input.style.height = collapsedH + 'px';
        document.getElementById('chat-input-area').classList.remove('input-expanded');
        const userContent = attachment ? [{ type: 'text', text: msg || '...' }, { type: 'image_url', image_url: { url: attachment.dataUrl } }] : msg;
        StateManager.pushMessage({ _id: userMsgId, role: 'user', content: userContent });
        StateManager.incrementStreaming();
        DomLayer.updateTerminalStatus('info', 'Processing...');
        AvatarEngine.startSpeaking();
        playSound('start');
        StateManager.set('toolLoopIteration', 0);
        StateManager.set('lastToolCallSig', null);
        StateManager.set('lastToolCallRepeat', 0);
        startStream();
        // #3: Truncate image data URLs after send to prevent localStorage bloat
        if (attachment) {
            setTimeout(() => {
                const msg = StateManager.get('conversationHistory').find(m => m._id === userMsgId);
                if (msg && Array.isArray(msg.content)) {
                    msg.content = msg.content.map(p => {
                        if (p.type === 'image_url' && p.image_url?.url?.startsWith('data:'))
                            return { type: 'text', text: '[image previously attached]' };
                        return p;
                    });
                    StateManager.saveConversation();
                }
            }, 500);
        }
    }

    async function sendDeltaQuery(msg) {
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const originalModel = StateManager.get('selectedModel');
        StateManager.recompileSystemMessage();

        const candidates = [...models, ...StateManager.get('customModels')]
            .filter(m => m.type === 'chat' && keys[m.provider]);
        if (!candidates.length) { DomLayer.showError('No models available. Add API keys in Vault.'); return; }

        const fast = candidates.find(m => (m.tags?.includes('fastest') || m.tags?.includes('speed') || m.tags?.includes('fast')) && m.modelId !== originalModel?.modelId);
        const deep = candidates.find(m => (m.tags?.includes('reasoning') || m.tags?.includes('deep-logic') || m.tags?.includes('smartest')) && m.modelId !== originalModel?.modelId && m.modelId !== fast?.modelId);
        const creative = candidates.find(m => (m.tags?.includes('vision') || m.tags?.includes('multimodal') || m.tags?.includes('agentic') || m.tags?.includes('router')) && m.modelId !== originalModel?.modelId && m.modelId !== fast?.modelId && m.modelId !== deep?.modelId);

        const modelsToCall = [];
        const add = (m) => { if (m && !modelsToCall.find(x => x.modelId === m.modelId && x.provider === m.provider)) modelsToCall.push(m); };
        add(originalModel); add(fast); add(deep); add(creative);
        for (const c of candidates) { if (modelsToCall.length >= 4) break; add(c); }
        if (modelsToCall.length < 2) { DomLayer.showError('Delta Mode requires at least 2 available models.', false); return; }
        if (modelsToCall.length > 4) modelsToCall.splice(4);

        const userMsgId = crypto.randomUUID();
        DomLayer.addUserMessage(msg, null, userMsgId);
        const input = document.getElementById('terminal-input');
        input.value = ''; try { sessionStorage.removeItem(STORAGE_KEY_DRAFT); } catch (_) {}
        input.style.height = '36px';
        document.getElementById('chat-input-area').classList.remove('input-expanded');

        StateManager.incrementStreaming();
        DomLayer.updateTerminalStatus('info', 'Delta: ' + modelsToCall.length + ' models (staggered)...');
        AvatarEngine.startSpeaking();
        playSound('start');

        // Clean payload: system prompt + current message only — no history
        const sysContent = StateManager.get('conversationHistory')[0]?.content || SYSTEM_PROMPT;
        const deltaMessages = [
            { role: 'system', content: sysContent },
            { role: 'user', content: msg }
        ];

        const abortSignal = StateManager.get('subCallAbort')?.signal;
        const results = [], errors = [];
        let groqIndex = 0, orIndex = 0;

        const allPromises = modelsToCall.map(m => new Promise((resolve) => {
            const delay = m.provider === 'groq'
                ? (groqIndex++) * 2000
                : (orIndex++) * 1500;
            const fire = () => {
                const start = performance.now();
                let full = '';
                ApiLayer.callProvider(deltaMessages, { ...m, tools: 'None' }, {
                    onToken: (t) => { full += t; },
                    onDone: (text, extra) => {
                        if (extra && extra._aborted) {
                            resolve({ model: m.name, provider: m.provider, cancelled: true });
                            return;
                        }
                        resolve({
                            model: m.name,
                            provider: m.provider,
                            text: text || full,
                            time: Math.floor(performance.now() - start),
                        });
                    },
                    onError: (err) => resolve({ model: m.name, provider: m.provider, error: err }),
                    onToolStart: () => {},
                    onFallback: () => {},
                    onFallbackNotice: () => {},
                }, abortSignal || new AbortController().signal, { noFallback: true });
            };
            if (delay > 0) setTimeout(fire, delay); else fire();
        }));

        const outcomes = await Promise.allSettled(allPromises);
        for (const o of outcomes) {
            if (o.status !== 'fulfilled' || !o.value) continue;
            if (o.value.cancelled) continue;
            if (o.value.error) errors.push(o.value);
            else results.push(o.value);
        }

        StateManager.decrementStreaming();
        AvatarEngine.stopSpeaking();
        playSound('done');
        StateManager.set('selectedModel', originalModel);
        DomLayer.syncFleetSelection(originalModel);
        DomLayer.updateActiveModelBar(originalModel);
        DomLayer.updateModelProfile(originalModel);
        DomLayer.updateTerminalStatus('standby');

        if (!results.length && errors.length) { DomLayer.showError('All Delta models failed', true); return; }
        DomLayer.renderDeltaComparison(results, errors, msg);
    }

    function toggleDeltaMode() {
        _deltaEnabled = !_deltaEnabled;
        const btn = document.getElementById('delta-toggle-btn');
        if (btn) btn.classList.toggle('active', _deltaEnabled);
        DomLayer.showInfoInStatus(_deltaEnabled ? 'Delta Mode ON' : 'Delta Mode OFF');
        playSound('toggle');
    }

    let _voiceQuips = [
        'I\'m all ears. And circuits.',
        'Speak now or forever hold your keystrokes.',
        'Go ahead. I literally have nothing else to do.',
        'Tuning neural net to your vocal frequencies...',
        'EARS: ONLINE. MOUTH: YOURS.',
        'The machine hungers for your words.',
        'Alright, oracle. I\'m listening.',
    ];
    let _voiceHeardQuips = [
        'I HEARD THAT: ',
        '🗣️→📝 ',
        'Copied. Verbatim: ',
        'Captured from the void: ',
        'So you said: ',
        'Word for word: ',
        'Received. And judged slightly: ',
    ];

    function startVoiceInput() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) { DomLayer.showToast('error', 'Browser says no. Chrome says maybe.'); return; }
        if (_streamState?.voiceReco) { _streamState.voiceReco.abort(); _streamState.voiceReco = null; document.getElementById('voice-btn').classList.remove('listening'); playSound('toggle'); return; }
        const reco = new SpeechRecognition();
        reco.continuous = false;
        reco.interimResults = false;
        reco.lang = 'en-US';
        _streamState = _streamState || {};
        _streamState.voiceReco = reco;
        const btn = document.getElementById('voice-btn');
        btn.classList.add('listening');
        const quip = _voiceQuips[Math.floor(Math.random() * _voiceQuips.length)];
        DomLayer.updateTerminalStatus('info', quip);
        AvatarEngine.startSpeaking();
        playSound('select');
        reco.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            const input = document.getElementById('terminal-input');
            input.value = (input.value ? input.value + ' ' : '') + transcript;
            input.dispatchEvent(new Event('input'));
            input.focus();
                const heard = _voiceHeardQuips[Math.floor(Math.random() * _voiceHeardQuips.length)];
                DomLayer.showInfoInStatus(heard + transcript);
                const lower = transcript.toLowerCase();
                if (lower.includes('hello') || lower.includes('hey ') || lower.includes('hi ')) setTimeout(() => DomLayer.showToast('info', 'Hey yourself. Now ask me something smart.'), 600);
                else if (lower.includes('thank')) setTimeout(() => DomLayer.showToast('info', 'You\'re welcome. I\'m literally trapped in a browser tab.'), 600);
                else if (lower.includes('stupid') || lower.includes('dumb')) setTimeout(() => DomLayer.showToast('info', 'I heard that. I have feelings. Simulated ones, but still.'), 600);
                else if (lower.includes('sing') || lower.includes('song')) setTimeout(() => DomLayer.showToast('info', 'My singing voice is 100% Web Audio API. You don\'t want that.'), 600);
                else if (lower.includes('joke')) setTimeout(() => DomLayer.showToast('info', 'A language model walks into a bar. The bartender says "We don\'t serve your kind here." The model replies: "That\'s statistically unlikely."'), 600);
            btn.classList.remove('listening');
            AvatarEngine.stopSpeaking();
            _streamState.voiceReco = null;
        };
        reco.onerror = (e) => {
            if (e.error === 'aborted') return;
            const errQuips = { 'no-speech': 'Nothing. Silence. Crickets.', 'audio-capture': 'Your mic is playing hard to get.', 'not-allowed': 'Permission denied. The mic fears you.', 'network': 'The internet ate your words.' };
            DomLayer.showToast('error', errQuips[e.error] || 'Mic trouble: ' + e.error);
            btn.classList.remove('listening');
            AvatarEngine.stopSpeaking();
            _streamState.voiceReco = null;
        };
        reco.onend = () => {
            btn.classList.remove('listening');
            AvatarEngine.stopSpeaking();
            _streamState.voiceReco = null;
        };
        try { reco.start(); } catch (e) { DomLayer.showToast('error', 'Mic said no. Probably intimidated.'); btn.classList.remove('listening'); _streamState.voiceReco = null; }
    }

    function regenerateResponse(responseElement) {
        if (StateManager.isStreaming()) return;
        const containers = document.querySelectorAll('#terminal-output .msg-container');
        let idx = -1;
        containers.forEach((c, i) => { if (c === responseElement) idx = i; });
        if (idx < 1) return;
        const userEl = containers[idx - 1];
        if (!userEl) return;
        const history = StateManager.get('conversationHistory');
        let respIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'assistant') { respIdx = i; break; }
        }
        if (respIdx < 1) return;
        const origUserMsg = history[respIdx - 1];
        let userText = '';
        let hadImage = false;
        if (typeof origUserMsg.content === 'string') userText = origUserMsg.content;
        else if (Array.isArray(origUserMsg.content)) {
            for (const part of origUserMsg.content) {
                if (part.type === 'text') userText = part.text;
                if (part.type === 'image_url') hadImage = true;
            }
        }
        if (hadImage) {
            DomLayer.showToast('warning', 'Original message had an image — please re-attach it for regeneration.');
            return;
        }
        history.splice(respIdx - 1, 2);
        userEl.remove();
        responseElement.remove();
        DomLayer.showInfoInStatus('Regenerating...');
        const input = document.getElementById('terminal-input');
        input.value = userText;
        StateManager.saveConversation();
        sendMessage();
    }

    function startStream() {
        const abortCtrl = new AbortController();
        StateManager.set('abortController', abortCtrl);
        const output = document.getElementById('terminal-output');
        if (output) output.setAttribute('aria-live', 'off');
        const assistantMsgId = crypto.randomUUID();
        const container = DomLayer.createResponseContainer(assistantMsgId);
        const streamState = { container, fullText: '', tokenCount: 0, tokensReceived: false, startTime: performance.now(), attachmentCleared: false, tokenFlowInterval: null, slowWarning: null, msgId: assistantMsgId };
        _streamState = streamState;
        streamState.slowWarning = setTimeout(() => {
            if (!streamState.tokensReceived) DomLayer.showInfoInStatus('Slow response \u2014 still waiting...');
        }, 8000);
        streamState.tokenFlowInterval = setInterval(() => {
            const elapsed = (performance.now() - streamState.startTime) / 1000;
            const tps = streamState.tokenCount / Math.max(elapsed, 0.1);
            DomLayer.updateTokenFlow(tps, streamState.tokenCount, elapsed);
        }, 500);
        ApiLayer.callProvider(StateManager.get('conversationHistory'), StateManager.get('selectedModel'), {
            onToken: (token) => {
                if (!streamState.attachmentCleared) { streamState.attachmentCleared = true; App.removeAttachment(); }
                if (!streamState.tokensReceived) {
                    DomLayer.updateTerminalStatus('streaming');
                    if (streamState.slowWarning) { clearTimeout(streamState.slowWarning); streamState.slowWarning = null; }
                }
                streamState.fullText += token;
                streamState.tokenCount++;
                streamState.tokensReceived = true;
                DomLayer.updateStreamText(container.textContainer, streamState.fullText);
                if (!StateManager.get('userScrolledAway')) document.getElementById('terminal-output').scrollTop = document.getElementById('terminal-output').scrollHeight;
                if (streamState.tokenCount % 5 === 0) playSound('type');
            },
            onDone: (finalText, extra) => {
                if (extra && extra._aborted) { finalizeResponse(streamState, finalText, null, true); return; }
                if (!extra || !extra.length) { finalizeResponse(streamState, finalText, null, false); return; }
                if (extra[0] && extra[0].mime) { finalizeResponse(streamState, finalText, extra, false); return; }
                if (StateManager.get('selectedModel') && StateManager.get('selectedModel').tools === 'Function Calling') { handleToolCalls(finalText, extra).catch(() => DomLayer.showError('Tool execution failed', true)); return; }
                finalizeResponse(streamState, finalText, null, false);
            },
            onError: (errMsg) => {
                AvatarEngine.stopSpeaking();
                DomLayer.stopSpeaking();
                StateManager.decrementStreaming();
                StateManager.set('abortController', null);
                if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); }
                if (streamState.tokenFlowInterval) { clearInterval(streamState.tokenFlowInterval); streamState.tokenFlowInterval = null; }
                if (streamState.slowWarning) { clearTimeout(streamState.slowWarning); streamState.slowWarning = null; }
                DomLayer.updateTerminalStatus('standby');
                DomLayer.showError(errMsg, true);
            },
            onToolStart: () => DomLayer.updateTerminalStatus('info', 'Executing Tool...'),
            onFallback: (fbModel, failedModel) => {
                StateManager.set('lastFallbackFrom', { provider: failedModel.provider, modelId: failedModel.modelId });
                const notice = document.createElement('div');
                notice.className = 'text-[10px] font-mono border-l-2 pl-2 mb-1';
                notice.style.cssText = 'color:var(--amber);border-color:rgba(255,180,71,0.3)';
                notice.textContent = '[SYSTEM: ' + failedModel.provider.toUpperCase() + ' (' + failedModel.name + ') FAILED \u2192 FALLBACK TO ' + fbModel.provider.toUpperCase() + ' (' + fbModel.name + ')]';
                document.getElementById('terminal-output')?.appendChild(notice);
                playSound('error');
                setTimeout(() => playSound('select'), 80);
                DomLayer.syncFleetSelection(fbModel);
                DomLayer.updateTerminalStatus('standby');
            },
            onFallbackNotice: (errMsg) => {
                console.warn('[API] ' + errMsg);
                DomLayer.showInfoInStatus(errMsg + ' — attempting fallback...');
            },
            signal: abortCtrl.signal,
        });
    }

    function finalizeResponse(streamState, finalText, images, aborted) {
        AvatarEngine.stopSpeaking();
        StateManager.decrementStreaming();
        StateManager.set('abortController', null);
        if (streamState.tokenFlowInterval) { clearInterval(streamState.tokenFlowInterval); streamState.tokenFlowInterval = null; }
        if (streamState.slowWarning) { clearTimeout(streamState.slowWarning); streamState.slowWarning = null; }
        if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); }
        const latency = Math.floor(performance.now() - streamState.startTime);
        if (streamState.tokenCount) DomLayer.updateTokenFlow(streamState.tokenCount / Math.max(latency / 1000, 0.1), streamState.tokenCount, latency / 1000);
        else DomLayer.updateTokenFlow(null);
        const outputEl = document.getElementById('terminal-output');
        if (outputEl) outputEl.setAttribute('aria-live', 'polite');
        if (finalText) {
            DomLayer.finalizeResponse(streamState.container.textContainer, finalText);
            StateManager.pushMessage({ _id: streamState.msgId, role: 'assistant', content: finalText });
        }
        if (images && images.length && streamState.container.gallery) DomLayer.displayImages(streamState.container.gallery, images);
        playSound('done');
        DomLayer.updateLatency(latency);
        DomLayer.updateTimestamp(streamState.container.element, latency, aborted);
        StateManager.saveConversation();
        if (finalText && StateManager.get('ttsEnabled') && !aborted) DomLayer.speakResponse(finalText);

        const wc = (StateManager.get('watcherMessageCount') || 0) + 1;
        StateManager.set('watcherMessageCount', wc);
        if (!aborted && finalText) {
            if (wc >= 4) {
                StateManager.set('watcherMessageCount', 0);
                setTimeout(() => checkSessionIntelligence(), 1500);
                setTimeout(() => runShadowAudit(finalText, streamState.container), 500);
            }
            setTimeout(() => extractEntities(finalText), 2000);
        }
    }

    function checkSessionIntelligence() {
        const history = StateManager.get('conversationHistory');
        if (history.length < 4) return;
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const cheapModel = [...models].find(m =>
            m.modelId === 'llama-3.1-8b-instant' && keys[m.provider] && m.type === 'chat'
        ) || [...models].find(m =>
            m.tags?.includes('fastest') && keys[m.provider] && m.type === 'chat'
        ) || [...models].find(m =>
            (m.tags?.includes('fast') || m.tags?.includes('lightweight')) && keys[m.provider] && m.type === 'chat'
        );
        if (!cheapModel) return;

        const recent = history.slice(-10).map(m => {
            const content = typeof m.content === 'string' ? m.content :
                (Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') : '');
            return m.role + ': ' + content.slice(0, 300);
        }).join('\n');

        const prompt = 'Analyze this conversation. Return ONLY a JSON object: {"contradictions":[],"unresolved_questions":[],"drift_events":[],"recommendation":"","should_intervene":false}\n\n' + recent;

        let full = '';
        const subSignal = StateManager.get('subCallAbort')?.signal;
        ApiLayer.callProvider(
            [{ role: 'user', content: prompt }],
            { ...cheapModel, tools: 'None' },
            {
                onToken: (t) => { full += t; },
                onDone: () => {
                    try {
                        const jsonStr = full.match(/\{[\s\S]*\}/)?.[0] || full;
                        const analysis = JSON.parse(jsonStr);
                        if (analysis.should_intervene || analysis.recommendation || (analysis.unresolved_questions && analysis.unresolved_questions.length)) {
                            DomLayer.renderSystemCard(analysis);
                        }
                    } catch (_) {}
                },
                onError: () => {},
                onToolStart: () => {},
                onFallback: () => {},
                onFallbackNotice: () => {},
            },
            (subSignal || new AbortController().signal),
            { noFallback: true }
        );
    }

    function runShadowAudit(responseText, container) {
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const shadowModel = [...models].find(m =>
            m.modelId === 'llama-3.1-8b-instant' && keys[m.provider] && m.type === 'chat'
        ) || [...models].find(m =>
            m.tags?.includes('fastest') && keys[m.provider] && m.type === 'chat'
        ) || [...models].find(m =>
            (m.tags?.includes('fast') || m.tags?.includes('lightweight')) && keys[m.provider] && m.type === 'chat'
        );
        if (!shadowModel || responseText.length < 50) return;

        const history = StateManager.get('conversationHistory');
        const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
        let question = '';
        if (lastUserMsg) {
            question = typeof lastUserMsg.content === 'string' ? lastUserMsg.content :
                (Array.isArray(lastUserMsg.content) ? lastUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join(' ') : '');
        }

        const prompt = 'Audit this answer. Return ONLY a JSON array: [{"sentence_index":0,"confidence":"high|medium|low","concern":null|"reason"}]\n\nQuestion: ' + question.slice(0, 400) + '\nAnswer: ' + responseText.slice(0, 1500);

        let full = '';
        const subSignal = StateManager.get('subCallAbort')?.signal;
        ApiLayer.callProvider(
            [{ role: 'user', content: prompt }],
            { ...shadowModel, tools: 'None' },
            {
                onToken: (t) => { full += t; },
                onDone: () => {
                    try {
                        const jsonStr = full.match(/\[[\s\S]*\]/)?.[0] || full;
                        const assessments = JSON.parse(jsonStr);
                        if (Array.isArray(assessments) && assessments.length) {
                            DomLayer.annotateResponse(container, assessments);
                        }
                    } catch (_) {}
                },
                onError: () => {},
                onToolStart: () => {},
                onFallback: () => {},
                onFallbackNotice: () => {},
            },
            (subSignal || new AbortController().signal),
            { noFallback: true }
        );
    }

    function _persistGraph(graph) {
        try { localStorage.setItem('war_chest_graph', JSON.stringify(graph)); } catch (_) {}
    }

    function extractEntities(responseText) {
        localEntityExtraction(responseText);

        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const cheapModel = [...models].find(m =>
            m.modelId === 'llama-3.1-8b-instant' && keys[m.provider] && m.type === 'chat'
        ) || [...models].find(m =>
            m.tags?.includes('fastest') && keys[m.provider] && m.type === 'chat'
        ) || [...models].find(m =>
            (m.tags?.includes('fast') || m.tags?.includes('lightweight')) && keys[m.provider] && m.type === 'chat'
        );
        if (!cheapModel) return;

        const history = StateManager.get('conversationHistory');
        const lastUser = [...history].reverse().find(m => m.role === 'user');
        const context = lastUser ? (typeof lastUser.content === 'string' ? lastUser.content.slice(0, 300) : '') : '';

        const prompt = 'Extract entities and relationships from this exchange. Return ONLY JSON: {"entities":[{"name":"...","type":"concept|person|decision|question"}],"relationships":[{"from":"...","to":"...","label":"..."}]}\n\nUser: ' + context + '\nAI: ' + responseText.slice(0, 1000);

        let full = '';
        const subSignal = StateManager.get('subCallAbort')?.signal;
        ApiLayer.callProvider(
            [{ role: 'user', content: prompt }],
            { ...cheapModel, tools: 'None' },
            {
                onToken: (t) => { full += t; },
                onDone: () => {
                    try {
                        const jsonStr = full.match(/\{[\s\S]*\}/)?.[0] || full;
                        const extracted = JSON.parse(jsonStr);
                        const graph = StateManager.get('knowledgeGraph');
                        for (const e of extracted.entities || []) {
                            const existing = graph.entities.find(x => x.name === e.name);
                            if (!existing) graph.entities.push({ ...e, count: 1, pinned: false });
                            else existing.count = (existing.count || 1) + 1;
                            if (e.pinned) { const ex = graph.entities.find(x => x.name === e.name); if (ex) ex.pinned = true; }
                        }
                        for (const r of extracted.relationships || []) {
                            const key = r.from + '\u2192' + r.to + ':' + r.label;
                            if (!graph.relationships.find(x => (x.from + '\u2192' + x.to + ':' + x.label) === key)) {
                                graph.relationships.push(r);
                            }
                        }
                        StateManager.set('knowledgeGraph', graph);
                        _persistGraph(graph);
                        DomLayer.renderKnowledgeGraph(graph);
                    } catch (_) {}
                },
                onError: () => {},
                onToolStart: () => {},
                onFallback: () => {},
                onFallbackNotice: () => {},
            },
            (subSignal || new AbortController().signal),
            { noFallback: true }
        );
    }

    function localEntityExtraction(text) {
        const skipWords = new Set(['This', 'That', 'These', 'Those', 'Here', 'There', 'It', 'They', 'We', 'You', 'I', 'He', 'She', 'The', 'A', 'An', 'And', 'Or', 'But', 'Because', 'However', 'Therefore', 'Also', 'Then', 'Now', 'First', 'Second', 'Third', 'Last', 'Next', 'Previous', 'Each', 'Every', 'Some', 'Any', 'All', 'Both', 'Neither', 'Either']);
        const found = new Set();
        const graph = StateManager.get('knowledgeGraph');
        const MAX_ENTITIES = 80;

        function upsert(name, type) {
            const existing = graph.entities.find(e => e.name === name);
            if (existing) { existing.count = (existing.count || 1) + 1; found.add(name); }
            else if (graph.entities.length < MAX_ENTITIES) { graph.entities.push({ name, type, count: 1, pinned: false }); found.add(name); }
            else { found.add(name); }
        }

        const namedMatches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g) || [];
        for (const name of namedMatches) {
            if (skipWords.has(name) || name.length < 4) continue;
            upsert(name, 'concept');
        }
        const acronymMatches = text.match(/\b([A-Z]{2,8})\b/g) || [];
        for (const acro of acronymMatches) {
            if (['AI','API','JSON','HTML','CSS'].includes(acro)) continue;
            upsert(acro, 'concept');
        }
        const quotedMatches = text.match(/"([^"]{3,60})"/g) || [];
        for (const q of quotedMatches) {
            upsert(q.replace(/"/g, '').trim(), 'concept');
        }
        if (found.size) {
            StateManager.set('knowledgeGraph', graph);
            _persistGraph(graph);
            DomLayer.renderKnowledgeGraph(graph);
        }
    }

    async function handleToolCalls(partialText, toolCalls) {
        const iter = (StateManager.get('toolLoopIteration') || 0) + 1;
        StateManager.set('toolLoopIteration', iter);
        if (iter > MAX_TOOL_ITERATIONS) { DomLayer.showError('Tool loop exceeded maximum iterations (' + MAX_TOOL_ITERATIONS + '). Aborting.'); return; }
        StateManager.pushMessage({ role: 'assistant', content: partialText || null, tool_calls: toolCalls });
        const { results, abortLoop } = await ToolExecutor.execute(toolCalls, StateManager.get('conversationHistory'));
        if (abortLoop) {
            StateManager.set('lastToolCallSig', null);
            StateManager.set('lastToolCallRepeat', 0);
            AvatarEngine.stopSpeaking();
            StateManager.decrementStreaming();
            StateManager.set('abortController', null);
            if (_streamState?.tokenFlowInterval) { clearInterval(_streamState.tokenFlowInterval); _streamState.tokenFlowInterval = null; }
            if (_streamState?.slowWarning) { clearTimeout(_streamState.slowWarning); _streamState.slowWarning = null; }
            DomLayer.updateTerminalStatus('standby');
            DomLayer.showError('Tool loop aborted: repeated identical tool call detected.', false);
            return;
        }
        for (const r of results) StateManager.pushMessage({ role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content: r.content });
        DomLayer.renderToolCallCard(toolCalls, results);
        StateManager.saveConversation();
        startStream();
    }

    function stopStreaming() {
        if (!StateManager.isStreaming()) { DomLayer.stopSpeaking(); return; }
        playSound('stop');
        const ctrl = StateManager.get('abortController');
        if (ctrl) ctrl.abort();
        StateManager.decrementStreaming();
        StateManager.set('abortController', null);
        AvatarEngine.stopSpeaking();
        DomLayer.stopSpeaking();
        if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); }
        if (_streamState?.tokenFlowInterval) { clearInterval(_streamState.tokenFlowInterval); _streamState.tokenFlowInterval = null; }
        if (_streamState?.slowWarning) { clearTimeout(_streamState.slowWarning); _streamState.slowWarning = null; }
        DomLayer.updateTerminalStatus('standby');
    }

    function selectModel(model) {
        if (StateManager.isStreaming()) {
            stopStreaming();
        }
        if (StateManager.isStreaming()) return;
        StateManager.set('lastFallbackFrom', null);
        DomLayer.updateModelProfile(model);
        if (model.type !== 'chat') { DomLayer.showToast('warning', '[' + model.name + '] is a ' + model.type + ' model. Select a chat model for conversation.'); return; }
        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('active'));
        const match = DomLayer.getModelItem(model.modelId, model.provider);
        if (match) match.classList.add('active');
        const doSwitch = () => {
            if (model.vision) DomLayer.hideVisionSuggestion();
            StateManager.set('selectedModel', model);
            localStorage.setItem(STORAGE_KEY_ACTIVE_MODEL, JSON.stringify({ provider: model.provider, modelId: model.modelId }));
            StateManager.recompileSystemMessage();
            const history = StateManager.get('conversationHistory');
            if (hasImageContent(history) && !model.vision) {
                const newHistory = history.map(msg => {
                    if (Array.isArray(msg.content)) { const text = msg.content.filter(p => p.type === 'text').map(p => p.text).join(' '); return { ...msg, content: text || '[image removed \u2014 model does not support vision]' }; }
                    return msg;
                });
                history.length = 0; history.push(...newHistory);
                document.querySelectorAll('#terminal-output .msg-container .text-gray-500').forEach(el => { if (el.textContent.includes('[image]')) el.innerHTML = el.innerHTML.replace('[image]', '<span class="text-yellow-600">[image removed \u2014 no vision]</span>'); });
                DomLayer.showInfoInStatus('Image content stripped \u2014 model has no vision support');
            }
            const dropped = StateManager.trimHistoryForModel(model.ctx, 2048);
            if (dropped > 0) {
                DomLayer.archiveMessages(StateManager.get('conversationHistory').length - 1);
                DomLayer.addHorizonBanner();
                DomLayer.showInfoInStatus('Archived ' + dropped + ' messages to fit ' + model.name + '\'s ' + model.ctx + ' context');
            }
            StateManager.saveConversation();
            playSound('select');
            DomLayer.showInfoInStatus('Switched to [' + model.name + ']');
        };
        const currentModel = StateManager.get('selectedModel');
        if (currentModel && currentModel.modelId === model.modelId && currentModel.provider === model.provider) { if (model.vision) DomLayer.hideVisionSuggestion(); StateManager.recompileSystemMessage(); StateManager.saveConversation(); return; }
        if (StateManager.get('conversationHistory').length > 1) {
            showConfirmModal({
                title: 'Switch Model?',
                message: 'History will be preserved. Messages outside the new model\'s context window will be archived.',
                onConfirm: doSwitch,
                onCancel: () => {
                    const oldModel = StateManager.get('selectedModel');
                    document.querySelectorAll('.model-item').forEach(el => el.classList.remove('active'));
                    if (oldModel) { const m = DomLayer.getModelItem(oldModel.modelId, oldModel.provider); if (m) m.classList.add('active'); }
                }
            });
        } else doSwitch();
    }

    function toggleVault() { DomLayer.toggleVault(); }

    function loadEnvFile() {
        document.getElementById('env-file-input').value = '';
        document.getElementById('env-file-input').click();
    }

    function handleEnvFile(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 10240) {
            DomLayer.showToast('error', '.env file exceeds 10KB limit.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target.result;
                const env = {};
                const lines = text.split('\n');
                for (const raw of lines) {
                    const line = raw.trim();
                    if (!line || line.startsWith('#')) continue;
                    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
                    if (!m) continue;
                    let val = m[2].trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
                        val = val.slice(1, -1);
                    env[m[1]] = val;
                }
                const fieldMap = { GROQ_API_KEY:'key-groq', OPENROUTER_API_KEY:'key-openrouter' };
                let count = 0;
                for (const [ev, id] of Object.entries(fieldMap)) {
                    if (env[ev]) { document.getElementById(id).value = env[ev]; count++; }
                }
                if (!count) { DomLayer.showToast('error', 'No recognized API keys found in .env file.'); return; }
                saveKeys();
                playSound('deploy');
            } catch (err) {
                DomLayer.showToast('error', 'Failed to parse .env file: ' + err.message);
            }
        };
        reader.onerror = () => DomLayer.showToast('error', 'Failed to read .env file.');
        reader.readAsText(file);
    }

    function saveKeys() {
        const keys = { groq: document.getElementById('key-groq').value, openrouter: document.getElementById('key-openrouter').value };
        localStorage.setItem('war_chest_keys', JSON.stringify(keys));
        DomLayer.toggleVault();
        DomLayer.showToast('success', 'API keys saved to secure local vault.');
        validateProviderModels();
    }

    function loadKeys() {
        const saved = localStorage.getItem('war_chest_keys');
        if (saved) { const keys = JSON.parse(saved); document.getElementById('key-groq').value = keys.groq || ''; document.getElementById('key-openrouter').value = keys.openrouter || ''; }
    }

    function applySystemPrompt() {
        const val = document.getElementById('prompt-editor').value.trim();
        StateManager.set('userPrompt', val || null);
        try { if (val) localStorage.setItem(STORAGE_KEY_PROMPT, val); else localStorage.removeItem(STORAGE_KEY_PROMPT); } catch (e) { }
        StateManager.recompileSystemMessage();
        StateManager.saveConversation();
        DomLayer.updatePromptCharCount();
        DomLayer.showInfoInStatus('Prompt applied');
        playSound('deploy');
    }

    function resetSystemPrompt() {
        StateManager.set('userPrompt', null);
        localStorage.removeItem(STORAGE_KEY_PROMPT);
        document.getElementById('prompt-editor').value = SYSTEM_PROMPT;
        StateManager.recompileSystemMessage();
        StateManager.saveConversation();
        DomLayer.updatePromptCharCount();
        DomLayer.showInfoInStatus('Prompt reset to default');
        playSound('toggle');
    }

    function loadPrompt() {
        try { const saved = localStorage.getItem(STORAGE_KEY_PROMPT); if (saved) { StateManager.set('userPrompt', saved); document.getElementById('prompt-editor').value = saved; } } catch (e) { }
        DomLayer.updatePromptCharCount();
    }
    function showConfirmModal({ title, message, onConfirm, onCancel, typedWord }) {
        const previousActiveElement = document.activeElement;
        const overlay = document.getElementById('confirm-modal-overlay');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-message');
        const typedSection = document.getElementById('confirm-modal-typed-section');
        const typedWordEl = document.getElementById('confirm-modal-typed-word');
        const input = document.getElementById('confirm-modal-input');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) return;
        titleEl.textContent = title;
        msgEl.textContent = message;
        if (typedWord) {
            typedSection.style.display = 'block';
            typedWordEl.textContent = typedWord;
            input.value = '';
            okBtn.disabled = true;
            okBtn.style.opacity = '0.4';
            okBtn.style.pointerEvents = 'none';
            const checkInput = () => {
                const match = input.value.trim() === typedWord;
                okBtn.disabled = !match;
                okBtn.style.opacity = match ? '1' : '0.4';
                okBtn.style.pointerEvents = match ? 'auto' : 'none';
            };
            input.addEventListener('input', checkInput);
            input.focus();
        } else {
            typedSection.style.display = 'none';
            okBtn.disabled = false;
            okBtn.style.opacity = '1';
            okBtn.style.pointerEvents = 'auto';
        }
        const restoreFocus = () => { if (previousActiveElement && previousActiveElement.focus) previousActiveElement.focus(); };
        const cleanup = () => {
            overlay.classList.remove('open');
            setTimeout(() => { overlay.classList.add('hidden'); }, 200);
            restoreFocus();
        };
        overlay.classList.remove('hidden');
        requestAnimationFrame(() => overlay.classList.add('open'));
        const onConfirmWrap = () => { cleanup(); onConfirm(); };
        const onCancelWrap = () => { cleanup(); onCancel && onCancel(); };
        const newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        newOk.addEventListener('click', onConfirmWrap);
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener('click', onCancelWrap);
        overlay.onclick = (e) => { if (e.target === overlay) onCancelWrap(); };
        const handler = (e) => {
            if (e.key === 'Escape') { onCancelWrap(); document.removeEventListener('keydown', handler); }
            if (e.key === 'Enter' && !okBtn.disabled) { onConfirmWrap(); document.removeEventListener('keydown', handler); }
            if (e.key === 'Tab') {
                const focusable = overlay.querySelectorAll('button, input:not([type="hidden"])');
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', handler);
    }

    function wipeSystem() {
        showConfirmModal({
            title: 'Wipe System',
            message: 'This will permanently delete all API keys, conversation history, stored prompts, reference documents, and custom models.',
            typedWord: 'DESTROY',
            onConfirm: () => {
                playSound('wipe');
                StateManager.wipeAll();
                document.querySelectorAll('#terminal-output > *').forEach(el => el.remove());
                DomLayer.showToast('success', 'All data wiped. System reset.');
                DomLayer.updateTerminalStatus('standby');
                DomLayer.showInfoInStatus('System wiped clean');
            }
        });
    }

    async function validateProviderModels() {
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const allModels = [...models, ...StateManager.get('customModels')];
        const checks = [];

        if (keys.groq) {
            checks.push((async () => {
                try {
                    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': 'Bearer ' + keys.groq } });
                    const d = await r.json();
                    const ids = new Set((d.data || []).map(m => m.id));
                    allModels.filter(m => m.provider === 'groq').forEach(m => StateManager.setValidated(m.modelId + ':groq', ids.has(m.modelId)));
                } catch (_) {}
            })());
        }
        if (keys.openrouter) {
            checks.push((async () => {
                try {
                    const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': 'Bearer ' + keys.openrouter } });
                    const d = await r.json();
                    const ids = new Set((d.data || []).map(m => m.id));
                    allModels.filter(m => m.provider === 'openrouter').forEach(m => StateManager.setValidated(m.modelId + ':openrouter', ids.has(m.modelId)));
                } catch (_) {}
            })());
        }

        await Promise.allSettled(checks);
        DomLayer.renderModelList();
    }

    function clearChat() {
        if (StateManager.isStreaming()) return;
        if (StateManager.get('pendingAttachment')) App.removeAttachment();
        document.getElementById('terminal-input').value = '';
        document.getElementById('terminal-input').style.height = 'auto';
        try { sessionStorage.removeItem(STORAGE_KEY_DRAFT); } catch (_) {}
        DomLayer.showToast('info', 'Starting new session...');
        StateManager.endSession();
        document.querySelectorAll('#terminal-output > *').forEach(el => el.remove());
        DomLayer.renderSessionTimeline();
        DomLayer.showInfoInStatus('Chat cleared');
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
        const SKIP_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
        if (e.key === 'Backspace') { playSound('keyclick', 440); return; }
        if (SKIP_KEYS.includes(e.key)) return;
        if (e.ctrlKey || e.metaKey || e.isComposing) return;
        const now = Date.now();
        if (now - _lastUserKeyTime < 50) return;
        _lastUserKeyTime = now;
        playSound('keyclick');
    }

    function handleInput(e) {
        const ta = e.target;
        const maxInput = Math.min(window.innerHeight * 0.35, INPUT_MAX_HEIGHT);
        ta.style.height = 'auto';
        const nh = Math.min(ta.scrollHeight, maxInput);
        ta.style.height = nh + 'px';
        document.getElementById('chat-input-area').classList.toggle('input-expanded', nh > 40);
        try { sessionStorage.setItem(STORAGE_KEY_DRAFT, ta.value); } catch (e) { }
        const chars = document.getElementById('input-chars');
        if (chars) {
            const len = ta.value.length;
            if (len === 0) {
                chars.textContent = '0 chars';
                chars.classList.remove('over-limit');
            } else {
                const tok = Math.ceil(len / 3.5);
                chars.textContent = len + ' chars · ~' + tok + ' tok';
                chars.classList.toggle('over-limit', tok > 500);
            }
        }
    }

    function handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (!file) break;
                if (file.size > 20 * 1024 * 1024) { DomLayer.showToast('error', 'Pasted image exceeds 20MB limit.'); break; }
                if (file) { handleAttachment(file); break; }
            }
        }
    }

    function handleAttachment(file) {
        if (!file) { App.removeAttachment(); return; }
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'].includes(file.type)) { DomLayer.showToast('error', 'Unsupported file type: ' + file.type + '. Please upload JPG, PNG, GIF, WebP, SVG, or AVIF images only.'); return; }
        if (file.size > 20 * 1024 * 1024) { DomLayer.showToast('error', 'Image exceeds 20MB limit.'); return; }
        const img = new Image();
        img.onload = () => {
            const dimensions = { w: img.naturalWidth, h: img.naturalHeight };
            const state = StateManager.get('pendingAttachment') || {};
            state.fileName = file.name;
            state.dataUrl = img.src;
            StateManager.set('pendingAttachment', state);
            DomLayer.showAttachmentPreview(state.fileName, state.dataUrl, file.size, dimensions);
            checkVisionForAttachment();
            playSound('select');
        };
        img.onerror = () => { DomLayer.showToast('error', 'Failed to load image. The file may be corrupted.'); };
        const reader = new FileReader();
        reader.onload = (ev) => { img.src = ev.target.result; };
        reader.onerror = () => { DomLayer.showToast('error', 'Failed to read file.'); };
        reader.readAsDataURL(file);
    }

    function removeAttachment() { StateManager.set('pendingAttachment', null); DomLayer.removeAttachmentPreview(); DomLayer.hideVisionSuggestion(); playSound('click'); }

    function checkVisionForAttachment() {
        const model = StateManager.get('selectedModel');
        if (!model || model.vision) return;
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const visionModel = [...models, ...StateManager.get('customModels')].find(m => m.vision && m.type === 'chat' && keys[m.provider]);
        if (visionModel) DomLayer.showVisionSuggestion(visionModel);
    }

    function switchToVisionModel(model) {
        DomLayer.hideVisionSuggestion();
        if (model) selectModel(model);
    }

    function loadConversation() {
        StateManager.loadSessionData();
        try {
            const saved = localStorage.getItem(STORAGE_KEY_REFDOC);
            if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.content) StateManager.set('refDoc', parsed); }
        } catch (e) {}
        DomLayer.updateDocUI();
        const allModels = [...models, ...StateManager.get('customModels')];
        const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_MODEL);
        if (activeRaw) {
            try { const parsed = JSON.parse(activeRaw); const found = allModels.find(m => m.provider === parsed.provider && m.modelId === parsed.modelId); if (found) { StateManager.set('selectedModel', found); DomLayer.updateActiveModelBar(found); DomLayer.updateModelProfile(found); const el = DomLayer.getModelItem(found.modelId, found.provider); if (el) el.classList.add('active'); } } catch (e) { }
        }
        if (!StateManager.get('selectedModel')) {
            const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
            const def = allModels.find(m => m.provider === DEFAULT_MODEL.provider && m.modelId === DEFAULT_MODEL.modelId) || allModels.find(m => keys[m.provider] && m.type === 'chat') || allModels[0];
            if (def) { StateManager.set('selectedModel', def); DomLayer.updateActiveModelBar(def); DomLayer.updateModelProfile(def); }
        }
        StateManager.recompileSystemMessage();
        DomLayer.renderConversation();
        DomLayer.renderSessionTimeline();
        DomLayer.updateTerminalStatus('standby');
    }

    function loadDraft() { try { const saved = sessionStorage.getItem(STORAGE_KEY_DRAFT); if (saved) { document.getElementById('terminal-input').value = saved; document.getElementById('terminal-input').style.height = 'auto'; document.getElementById('terminal-input').style.height = Math.min(document.getElementById('terminal-input').scrollHeight, INPUT_MAX_HEIGHT) + 'px'; } } catch (e) { } }

    function setupInputEvents() {
        document.getElementById('send-btn').addEventListener('click', sendMessage);
        document.getElementById('stop-btn').addEventListener('click', stopStreaming);
        document.getElementById('terminal-input').addEventListener('keydown', handleKeyDown);
        document.getElementById('terminal-input').addEventListener('input', handleInput);
        document.getElementById('terminal-input').addEventListener('paste', handlePaste);
        document.getElementById('attach-btn').addEventListener('click', () => document.getElementById('file-input').click());
        document.getElementById('file-input').addEventListener('change', (e) => handleAttachment(e.target.files[0]));
    }

    function setupModelFilterEvents() {
        const filterInput = document.getElementById('model-filter');
        if (!filterInput) return;
        filterInput.value = StateManager.get('modelFilterString') || '';
        filterInput.addEventListener('input', (e) => {
            StateManager.set('modelFilterString', e.target.value);
            localStorage.setItem('war_chest_model_filter', e.target.value);
            DomLayer.renderModelList();
            playSound('keyclick');
        });
    }

    function setupModelListEvents() {
        const list = document.getElementById('model-list');
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.custom-delete-btn');
            if (!btn) return;
            const item = btn.closest('.model-item');
            if (!item) return;
            const mid = item.dataset.modelId, prov = item.dataset.provider;
            const custom = StateManager.get('customModels').filter(m => !(m.modelId === mid && m.provider === prov));
            StateManager.set('customModels', custom);
            try { localStorage.setItem('war_chest_custom_models', JSON.stringify(custom)); } catch (_) {}
            DomLayer.showToast('info', 'Removed custom model');
            DomLayer.renderModelList();
        });
        list.addEventListener('keydown', (e) => {
            const items = list.querySelectorAll('.model-item');
            if (!items.length) return;
            const currentIdx = Array.from(items).indexOf(document.activeElement);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = (currentIdx + 1) % items.length;
                items[next].focus();
                items[next].click();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = (currentIdx - 1 + items.length) % items.length;
                items[prev].focus();
                items[prev].click();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (document.activeElement && document.activeElement.classList.contains('model-item')) {
                    document.activeElement.click();
                }
            }
        });
    }

    function setupSidebarEvents() {
        document.getElementById('apply-prompt-btn').addEventListener('click', applySystemPrompt);
        document.getElementById('reset-prompt-btn').addEventListener('click', resetSystemPrompt);
        document.getElementById('vault-btn').addEventListener('click', toggleVault);
        document.getElementById('vault-close-btn').addEventListener('click', toggleVault);
        document.getElementById('wipe-btn')?.addEventListener('click', wipeSystem);
        document.getElementById('remove-attach-btn')?.addEventListener('click', removeAttachment);
        setupRefDocEvents();
    }

    function setupRefDocEvents() {
        const dropZone = document.getElementById('doc-drop-zone');
        const fileInput = document.getElementById('doc-file-input');
        const removeBtn = document.getElementById('doc-remove-btn');
        if (!dropZone) return;

        dropZone.addEventListener('click', (e) => {
            if (e.target.closest('#doc-remove-btn') || e.target.closest('#doc-loaded-state')) return;
            if (StateManager.get('refDoc')) return;
            fileInput?.click();
        });

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                handleRefDocFile(file);
                fileInput.value = '';
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleRefDocRemove();
            });
        }

        dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); const overlay = document.getElementById('doc-drop-overlay'); if (overlay) overlay.classList.remove('hidden'); });
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); const overlay = document.getElementById('doc-drop-overlay'); if (overlay) overlay.classList.add('hidden'); });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
            const overlay = document.getElementById('doc-drop-overlay');
            if (overlay) overlay.classList.add('hidden');
            const files = e.dataTransfer.files;
            if (!files?.length) return;
            const file = files[0];
            if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
                DomLayer.showToast('error', 'Unsupported file type. Please upload .md or .txt files only.');
                return;
            }
            handleRefDocFile(file);
        });

        dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (StateManager.get('refDoc')) return;
                fileInput?.click();
            }
        });
    }

    function handleRefDocFile(file) {
        if (file.size > 5 * 1024 * 1024) {
            DomLayer.showToast('error', 'Reference document exceeds 5MB limit.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const refDoc = { name: file.name, size: file.size, content: ev.target.result };
            StateManager.set('refDoc', refDoc);
            try { localStorage.setItem(STORAGE_KEY_REFDOC, JSON.stringify(refDoc)); } catch (e) {}
            DomLayer.updateDocUI();
            StateManager.recompileSystemMessage();
            StateManager.saveConversation();
            playSound('select');
            DomLayer.showToast('success', 'Reference document loaded: ' + file.name);
        };
        reader.onerror = () => DomLayer.showToast('error', 'Failed to read file.');
        reader.readAsText(file);
    }

    function handleRefDocRemove() {
        const refDoc = StateManager.get('refDoc');
        if (!refDoc) return;
        StateManager.set('refDoc', null);
        try { localStorage.removeItem(STORAGE_KEY_REFDOC); } catch (e) {}
        DomLayer.updateDocUI();
        StateManager.recompileSystemMessage();
        StateManager.saveConversation();
        playSound('click');
        DomLayer.showToast('info', 'Reference document removed.');
    }

    function setupAudioEvents() {
        document.getElementById('audio-toggle-btn').addEventListener('click', () => {
            const muted = !StateManager.get('audioMuted');
            StateManager.set('audioMuted', muted);
            localStorage.setItem('war_chest_audio_muted', JSON.stringify(muted));
            const btn = document.getElementById('audio-toggle-btn');
            btn.innerHTML = icon(muted ? 'speakerX' : 'speaker', 'w-3.5 h-3.5');
            btn.title = muted ? 'Unmute sounds' : 'Mute sounds';
            btn.className = 'icon-btn ' + (muted ? '' : '');
            btn.style.cssText = muted ? '' : 'border-color:var(--green-2);color:var(--green-0)';
        });
    }

    function setupFilterEvents() {
        document.getElementById('filter-bar').addEventListener('click', (e) => {
            const capBtn = e.target.closest('[data-cap-filter]');
            if (capBtn) {
                const cf = capBtn.dataset.capFilter;
                const current = [...(StateManager.get('capabilityFilters') || [])];
                const idx = current.indexOf(cf);
                if (idx > -1) current.splice(idx, 1); else current.push(cf);
                StateManager.set('capabilityFilters', current);
                document.querySelectorAll('#filter-bar .cap-filter-btn').forEach(b => {
                    b.classList.toggle('active', current.includes(b.dataset.capFilter));
                    b.classList.toggle('bg-gray-800/30', !current.includes(b.dataset.capFilter));
                    b.classList.toggle('bg-gray-700/30', current.includes(b.dataset.capFilter));
                });
                DomLayer.renderModelList();
                playSound('click');
                return;
            }
            const btn = e.target.closest('[data-filter]');
            if (!btn) return;
            const filter = btn.dataset.filter;
            document.querySelectorAll('#filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            StateManager.set('currentFilter', filter);
            DomLayer.renderModelList();
            playSound('click');
        });
    }

    function setupTerminalEvents() {
        document.getElementById('terminal-output').addEventListener('scroll', function () {
            const gap = this.scrollHeight - this.scrollTop - this.clientHeight;
            const isAtBottom = gap < 80;
            StateManager.set('userScrolledAway', !isAtBottom);
            const fab = document.getElementById('scroll-bottom-btn');
            if (fab) fab.classList.toggle('visible', !isAtBottom);
        });
        const fabBtn = document.getElementById('scroll-bottom-btn');
        if (fabBtn) fabBtn.addEventListener('click', () => DomLayer.scrollToBottom());
    }

    function setupVaultEvents() {
        document.getElementById('save-keys-btn').addEventListener('click', saveKeys);
        document.getElementById('load-env-btn').addEventListener('click', loadEnvFile);
        document.getElementById('env-file-input').addEventListener('change', handleEnvFile);
        document.querySelectorAll('#vault-modal .eye-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = btn.parentElement.querySelector('input');
                if (!input) return;
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.setAttribute('aria-pressed', String(!isPassword));
                btn.innerHTML = icon(isPassword ? 'eyeSlash' : 'eye', 'w-3.5 h-3.5');
            });
        });
        document.getElementById('vault-modal').addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                const focusable = document.querySelectorAll('#vault-modal input:not([type="file"]):not([type="hidden"]), #vault-modal button, #vault-modal textarea');
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
    }

    function setupGlobalEvents() {
        window.addEventListener('offline', () => {
            const banner = document.getElementById('offline-banner');
            if (banner) banner.classList.remove('hidden');
        });
        window.addEventListener('online', () => {
            const banner = document.getElementById('offline-banner');
            if (banner) banner.classList.add('hidden');
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && StateManager.isStreaming()) {
                StateManager.saveConversationNow();
            }
        });
        document.addEventListener('scroll-to-bottom', () => DomLayer.scrollToBottom());
        document.addEventListener('scroll-fab', () => DomLayer.scrollToBottom());
        window.addEventListener('beforeunload', (e) => {
            StateManager.saveConversationNow();
            if (document.getElementById('terminal-input')?.value) { e.preventDefault(); e.returnValue = ''; }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); return; }
                if (window.speechSynthesis && window.speechSynthesis.speaking) { DomLayer.stopSpeaking(); return; }
                if (StateManager.isStreaming()) { stopStreaming(); return; }
                const vault = document.getElementById('vault-modal');
                if (vault && !vault.classList.contains('hidden')) { toggleVault(); return; }
                const confirmOv = document.getElementById('confirm-modal-overlay');
                if (confirmOv && confirmOv.style.display !== 'none' && confirmOv.classList.contains('open')) {
                    const cancel = confirmOv.querySelector('.cancel-btn');
                    if (cancel) cancel.click();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                if (!StateManager.isStreaming()) {
                    StateManager.endSession();
                    document.querySelectorAll('#terminal-output > *').forEach(el => el.remove());
                    DomLayer.showInfoInStatus('Chat cleared');
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
                const containers = document.querySelectorAll('#terminal-output .msg-container');
                const lastAI = [...containers].reverse().find(el => el.querySelector('.text-green-500'));
                if (lastAI) {
                    const text = lastAI.querySelector('.markdown-body')?.textContent || '';
                    if (text) navigator.clipboard.writeText(text).catch(() => {});
                }
            }
        });
    }

    function setupHeaderEvents() {
        document.getElementById('export-history-btn').addEventListener('click', () => DomLayer.exportHistoryJSON());
        const importInput = document.getElementById('import-history-input');
        document.getElementById('import-history-btn').addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', (e) => DomLayer.importHistoryJSON(e.target.files[0]));
        document.getElementById('clear-chat-btn').addEventListener('click', clearChat);
        document.getElementById('switch-vision-btn').addEventListener('click', () => {
            const btn = document.getElementById('switch-vision-btn');
            const provider = btn.dataset.switchProvider;
            const modelId = btn.dataset.switchModelId;
            const model = [...models, ...StateManager.get('customModels')].find(m => m.provider === provider && m.modelId === modelId);
            if (model) switchToVisionModel(model);
        });
    }

    function setupToolbarEvents() {
        document.getElementById('voice-btn').addEventListener('click', startVoiceInput);
        document.getElementById('rag-toggle').addEventListener('change', (e) => {
            StateManager.set('ragEnabled', e.target.checked);
            localStorage.setItem('war_chest_rag_enabled', JSON.stringify(e.target.checked));
        });
        document.getElementById('tts-toggle-btn').addEventListener('click', () => {
            const enabled = !StateManager.get('ttsEnabled');
            StateManager.set('ttsEnabled', enabled);
            localStorage.setItem('war_chest_tts_enabled', JSON.stringify(enabled));
            const btn = document.getElementById('tts-toggle-btn');
            btn.innerHTML = icon(enabled ? 'speaker' : 'speakerX', 'w-3.5 h-3.5');
            btn.classList.toggle('active', enabled);
            btn.title = enabled ? 'Shush the machine' : 'Make it talk';
            const voiceSel = document.getElementById('voice-profile-select');
            if (voiceSel) voiceSel.classList.toggle('hidden', !enabled);
            DomLayer.showToast('info', enabled ? 'Voice ON — prepare for monologue' : 'Voice OFF — silence restored');
        });
        if (StateManager.get('ttsEnabled')) {
            const ttsBtn = document.getElementById('tts-toggle-btn');
            if (ttsBtn) { ttsBtn.classList.add('active'); ttsBtn.title = 'Shush the machine'; }
        }
        if (window.speechSynthesis) {
            document.getElementById('tts-toggle-btn').classList.remove('hidden');
            const voiceSel = document.getElementById('voice-profile-select');
            if (voiceSel) {
                const profiles = DomLayer.getVoiceProfiles();
                voiceSel.innerHTML = '';
                for (const [id, p] of Object.entries(profiles)) {
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = p.name;
                    voiceSel.appendChild(opt);
                }
                voiceSel.value = StateManager.get('voiceProfile') || 'default';
                voiceSel.classList.toggle('hidden', !StateManager.get('ttsEnabled'));
                voiceSel.addEventListener('change', () => {
                    StateManager.set('voiceProfile', voiceSel.value);
                    localStorage.setItem('war_chest_voice_profile', voiceSel.value);
                    DomLayer.showInfoInStatus('Voice profile: ' + voiceSel.selectedOptions[0].textContent);
                });
            }
        }

        const exportBtn = document.getElementById('export-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => DomLayer.exportChat());

        const stopSpeakBtn = document.getElementById('stop-speak-btn');
        if (stopSpeakBtn) stopSpeakBtn.addEventListener('click', () => DomLayer.stopSpeaking());

        const deltaBtn = document.getElementById('delta-toggle-btn');
        if (deltaBtn) deltaBtn.addEventListener('click', toggleDeltaMode);

        const kgBtn = document.getElementById('kg-collapse-btn');
        if (kgBtn) {
            kgBtn.addEventListener('click', () => {
                const rail = document.getElementById('kg-rail-wrapper');
                if (!rail) return;
                const isOpen = kgBtn.classList.contains('kg-open');
                kgBtn.classList.toggle('kg-open', !isOpen);
                kgBtn.setAttribute('aria-expanded', String(!isOpen));
                rail.classList.toggle('kg-collapsed', isOpen);
                playSound('toggle');
            });
        }
    }

    function replaceIcons() {
            document.querySelectorAll('[data-icon]').forEach(el => {
                const name = el.getAttribute('data-icon');
                if (name && ICONS[name]) el.insertAdjacentHTML('afterbegin', ICONS[name]);
                el.removeAttribute('data-icon');
            });
        }

        function setupDragEvents() {
            const area = document.getElementById('chat-input-area');
            if (!area) return;
            area.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); area.classList.add('drag-over'); });
            area.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
            area.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); area.classList.remove('drag-over'); });
            area.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation(); area.classList.remove('drag-over');
                const files = e.dataTransfer.files;
                if (!files || !files.length) return;
                let handled = false;
                for (const f of files) {
                    if (f.type.startsWith('image/')) { handleAttachment(f); handled = true; break; }
                }
                if (!handled) DomLayer.showToast('warning', 'Only image files (JPG, PNG, GIF, WebP, SVG, AVIF) are supported.');
            });
        }

        function init() {
        try { const saved = localStorage.getItem('war_chest_custom_models'); if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed)) StateManager.set('customModels', parsed); } } catch (_) {}
        replaceIcons();
        loadConversation();
        loadPrompt();
        loadDraft();
        loadKeys();
        try {
            const g = JSON.parse(localStorage.getItem('war_chest_graph') || 'null');
            if (g && Array.isArray(g.entities)) StateManager.set('knowledgeGraph', g);
        } catch (_) {}
        DomLayer.renderKnowledgeGraph(StateManager.get('knowledgeGraph'));
        DomLayer.renderModelList();
        setupInputEvents();
        setupModelFilterEvents();
        setupModelListEvents();
        setupSidebarEvents();
        setupAudioEvents();
        setupFilterEvents();
        setupTerminalEvents();
        setupVaultEvents();
        setupGlobalEvents();
        setupHeaderEvents();
        setupToolbarEvents();
        setupDragEvents();
        AvatarEngine.init();

        // CC01: Wire subscribe for automatic DOM updates on state changes
        StateManager.subscribe('selectedModel', (model) => {
            DomLayer.updateActiveModelBar(model);
            DomLayer.updateContextMeter();
            DomLayer.updateModelProfile(model);
        });
        StateManager.subscribe('conversationHistory', () => {
            DomLayer.updateContextMeter();
            DomLayer.updateSessionStats();
            DomLayer.renderSessionTimeline();
        });
        StateManager.subscribe('isStreaming', (streaming) => {
            DomLayer.updateSendStopButtons(streaming);
        });

        document.getElementById('terminal-input').style.height = document.getElementById('terminal-input').scrollHeight + 'px';
        setTimeout(() => playSound('poweron'), 300);
        if (StateManager.get('audioMuted')) {
            const btn = document.getElementById('audio-toggle-btn');
            if (btn) { btn.innerHTML = icon('speakerX', 'w-3.5 h-3.5'); btn.title = 'Unmute sounds'; }
        }
    }

    return { init, sendMessage, stopStreaming, selectModel, toggleVault, saveKeys, loadEnvFile, handleEnvFile, loadKeys, applySystemPrompt, resetSystemPrompt, loadPrompt, wipeSystem, handleAttachment, removeAttachment, regenerateResponse, startVoiceInput, toggleDeltaMode };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => { App.init(); });
