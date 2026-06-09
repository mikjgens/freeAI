// App — orchestration layer, event wiring, sendMessage

const App = (() => {
    let _streamState = null;
    let _wipeHandlerAttached = false;
    let _aiNoteIdx = 0, _lastUserKeyTime = 0;

    function sendMessage() {
        const input = document.getElementById('terminal-input');
        const msg = input.value.trim();
        const attachment = StateManager.get('pendingAttachment');
        const selectedModel = StateManager.get('selectedModel');
        const history = StateManager.get('conversationHistory');
        if ((!msg && !attachment) || StateManager.get('isStreaming')) {
            if (!msg && !attachment && !StateManager.get('isStreaming')) DomLayer.showToast('warning', 'Type a message or attach an image before sending.');
            return;
        }
        if (!selectedModel) { DomLayer.showError('No model selected. Click a model in the fleet panel first.'); return; }
        if (selectedModel.type !== 'chat') { DomLayer.showError('Cannot chat with ' + selectedModel.name + ' \u2014 it is a ' + selectedModel.type + ' model.'); return; }
        if (attachment && !selectedModel.vision) { DomLayer.showError(selectedModel.name + ' does not support vision. Select a model with vision capability or remove the attachment.'); return; }
        StateManager.recompileSystemMessage();
        const ragEnabled = StateManager.get('ragEnabled');
        const ragChunks = StateManager.get('ragChunks') || [];
        if (ragEnabled && ragChunks.length && msg && StateManager._ragIndex) {
            const matches = retrieveChunks(msg, ragChunks, StateManager._ragIndex);
            if (matches.length) {
                const sysMsg = StateManager.get('conversationHistory')[0];
                const refText = matches.map(c => '[Reference: ' + c.text + ']').join('\n\n');
                sysMsg.content = (sysMsg.content || '') + '\n\n---\nRelevant reference document excerpts:\n' + refText;
                DomLayer.showInfoInStatus('📄 ' + matches.length + ' chunks matched from reference doc');
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
        _aiNoteIdx = 0;
        playSound('click');
        DomLayer.addUserMessage(msg, attachment);
        input.value = '';
        try { sessionStorage.removeItem(STORAGE_KEY_DRAFT); } catch (e) { }
        const collapsedH = input.scrollHeight || 36;
        input.style.height = collapsedH + 'px';
        document.getElementById('chat-input-area').classList.remove('input-expanded');
        const userContent = attachment ? [{ type: 'text', text: msg || '...' }, { type: 'image_url', image_url: { url: attachment.dataUrl } }] : msg;
        StateManager.pushMessage({ role: 'user', content: userContent });
        StateManager.set('isStreaming', true);
        DomLayer.updateSendStopButtons(true);
        DomLayer.updateTerminalStatus('info', 'Processing...');
        AvatarEngine.startSpeaking();
        playSound('start');
        StateManager.set('toolLoopIteration', 0);
        StateManager.set('lastToolCallSig', null);
        StateManager.set('lastToolCallRepeat', 0);
        startStream();
    }

    function startVoiceInput() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) { DomLayer.showToast('error', 'Voice input is not supported in this browser. Try Chrome or Edge.'); return; }
        if (_streamState?.voiceReco) { _streamState.voiceReco.abort(); _streamState.voiceReco = null; document.getElementById('voice-btn').classList.remove('listening'); playSound('toggle'); return; }
        const reco = new SpeechRecognition();
        reco.continuous = false;
        reco.interimResults = false;
        reco.lang = 'en-US';
        _streamState = _streamState || {};
        _streamState.voiceReco = reco;
        const btn = document.getElementById('voice-btn');
        btn.classList.add('listening');
        DomLayer.updateTerminalStatus('info', '🎤 Listening...');
        AvatarEngine.startSpeaking();
        playSound('select');
        reco.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            const input = document.getElementById('terminal-input');
            input.value = (input.value ? input.value + ' ' : '') + transcript;
            input.dispatchEvent(new Event('input'));
            input.focus();
            DomLayer.showInfoInStatus('🎤 Transcribed: ' + transcript);
            btn.classList.remove('listening');
            AvatarEngine.stopSpeaking();
            _streamState.voiceReco = null;
        };
        reco.onerror = (e) => {
            if (e.error === 'aborted') return;
            DomLayer.showToast('error', 'Voice input error: ' + e.error);
            btn.classList.remove('listening');
            AvatarEngine.stopSpeaking();
            _streamState.voiceReco = null;
        };
        reco.onend = () => {
            btn.classList.remove('listening');
            AvatarEngine.stopSpeaking();
            _streamState.voiceReco = null;
        };
        try { reco.start(); } catch (e) { DomLayer.showToast('error', 'Voice input failed to start.'); btn.classList.remove('listening'); _streamState.voiceReco = null; }
    }

    function regenerateResponse(responseElement) {
        if (StateManager.get('isStreaming')) return;
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
        const container = DomLayer.createResponseContainer();
        const streamState = { container, fullText: '', tokenCount: 0, tokensReceived: false, startTime: performance.now(), attachmentCleared: false, tokenFlowInterval: null, slowWarning: null };
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
                StateManager.set('isStreaming', false);
                StateManager.set('abortController', null);
                if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); }
                if (streamState.tokenFlowInterval) { clearInterval(streamState.tokenFlowInterval); streamState.tokenFlowInterval = null; }
                if (streamState.slowWarning) { clearTimeout(streamState.slowWarning); streamState.slowWarning = null; }
                DomLayer.updateSendStopButtons(false);
                DomLayer.updateTerminalStatus('standby');
                DomLayer.showError(errMsg, true);
            },
            onToolStart: () => DomLayer.updateTerminalStatus('info', 'Executing Tool...'),
            onFallback: (fbModel, failedModel) => {
                const notice = document.createElement('div');
                notice.className = 'text-[10px] text-yellow-500/80 font-mono border-l-2 border-yellow-500/30 pl-2 mb-1';
                notice.textContent = '[SYSTEM: ' + failedModel.provider.toUpperCase() + ' FAILED \u2192 FALLBACK TO ' + fbModel.provider.toUpperCase() + ' (' + fbModel.name + ')]';
                document.getElementById('terminal-output')?.appendChild(notice);
                playSound('error');
                setTimeout(() => playSound('select'), 80);
                DomLayer.syncFleetSelection(fbModel);
                DomLayer.updateActiveModelBar(fbModel);
                DomLayer.updateTerminalStatus('standby');
            },
            onFallbackNotice: (errMsg) => DomLayer.showInfoInStatus(errMsg + ' — attempting fallback...'),
            signal: abortCtrl.signal,
        });
    }

    function finalizeResponse(streamState, finalText, images, aborted) {
        AvatarEngine.stopSpeaking();
        StateManager.set('isStreaming', false);
        StateManager.set('abortController', null);
        if (streamState.tokenFlowInterval) { clearInterval(streamState.tokenFlowInterval); streamState.tokenFlowInterval = null; }
        if (streamState.slowWarning) { clearTimeout(streamState.slowWarning); streamState.slowWarning = null; }
        if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); }
        const latency = Math.floor(performance.now() - streamState.startTime);
        if (streamState.tokenCount) DomLayer.updateTokenFlow(streamState.tokenCount / Math.max(latency / 1000, 0.1), streamState.tokenCount, latency / 1000);
        else DomLayer.updateTokenFlow(null);
        DomLayer.updateSendStopButtons(false);
        DomLayer.updateTerminalStatus('standby');
        if (finalText) {
            DomLayer.finalizeResponse(streamState.container.textContainer, finalText);
            StateManager.pushMessage({ role: 'assistant', content: finalText });
        }
        if (images && images.length && streamState.container.gallery) DomLayer.displayImages(streamState.container.gallery, images);
        playSound('done');
        DomLayer.updateLatency(latency);
        DomLayer.updateTimestamp(streamState.container.element, latency, aborted);
        StateManager.saveConversation();
        if (finalText && StateManager.get('ttsEnabled') && !aborted) DomLayer.speakResponse(finalText);
        DomLayer.updateContextMeter();
        DomLayer.updateSessionStats();
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
            StateManager.set('isStreaming', false);
            StateManager.set('abortController', null);
            if (_streamState?.tokenFlowInterval) { clearInterval(_streamState.tokenFlowInterval); _streamState.tokenFlowInterval = null; }
            if (_streamState?.slowWarning) { clearTimeout(_streamState.slowWarning); _streamState.slowWarning = null; }
            DomLayer.updateSendStopButtons(false);
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
        if (!StateManager.get('isStreaming')) { DomLayer.stopSpeaking(); return; }
        playSound('stop');
        const ctrl = StateManager.get('abortController');
        if (ctrl) ctrl.abort();
        StateManager.set('isStreaming', false);
        StateManager.set('abortController', null);
        AvatarEngine.stopSpeaking();
        DomLayer.stopSpeaking();
        if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); }
        if (_streamState?.tokenFlowInterval) { clearInterval(_streamState.tokenFlowInterval); _streamState.tokenFlowInterval = null; }
        if (_streamState?.slowWarning) { clearTimeout(_streamState.slowWarning); _streamState.slowWarning = null; }
        DomLayer.updateSendStopButtons(false);
        DomLayer.updateTerminalStatus('standby');
    }
    function selectModel(model) {
        if (StateManager.get('isStreaming')) {
            stopStreaming();
        }
        if (StateManager.get('isStreaming')) return;
        DomLayer.updateModelProfile(model);
        if (model.type !== 'chat') { DomLayer.showToast('warning', '[' + model.name + '] is a ' + model.type + ' model. Select a chat model for conversation.'); return; }
        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('active'));
        const match = findModelItem(model.modelId, model.provider);
        if (match) match.classList.add('active');
        const doSwitch = () => {
            StateManager.set('selectedModel', model);
            DomLayer.updateActiveModelBar(model);
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
            DomLayer.updateTerminalStatus('standby');
            DomLayer.showInfoInStatus('Switched to [' + model.name + ']');
            DomLayer.updateContextMeter();
        };
        const currentModel = StateManager.get('selectedModel');
        if (currentModel && currentModel.modelId === model.modelId && currentModel.provider === model.provider) { StateManager.recompileSystemMessage(); StateManager.saveConversation(); return; }
        if (StateManager.get('conversationHistory').length > 1) {
            showConfirmModal({
                title: 'Switch Model?',
                message: 'History will be preserved. Messages outside the new model\'s context window will be archived.',
                onConfirm: doSwitch,
                onCancel: () => {
                    const oldModel = StateManager.get('selectedModel');
                    document.querySelectorAll('.model-item').forEach(el => el.classList.remove('active'));
                    if (oldModel) { const m = findModelItem(oldModel.modelId, oldModel.provider); if (m) m.classList.add('active'); }
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
                const fieldMap = { GROQ_API_KEY:'key-groq', OPENROUTER_API_KEY:'key-openrouter', GOOGLE_API_KEY:'key-google', GEMINI_API_KEY:'key-google', NVIDIA_API_KEY:'key-nvidia' };
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
        const keys = { groq: document.getElementById('key-groq').value, openrouter: document.getElementById('key-openrouter').value, google: document.getElementById('key-google').value, nvidia: document.getElementById('key-nvidia').value };
        localStorage.setItem('war_chest_keys', JSON.stringify(keys));
        DomLayer.toggleVault();
        DomLayer.showToast('success', 'API keys saved to secure local vault.');
        validateProviderModels();
    }

    function loadKeys() {
        const saved = localStorage.getItem('war_chest_keys');
        if (saved) { const keys = JSON.parse(saved); document.getElementById('key-groq').value = keys.groq || ''; document.getElementById('key-openrouter').value = keys.openrouter || ''; document.getElementById('key-google').value = keys.google || ''; document.getElementById('key-nvidia').value = keys.nvidia || ''; }
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
    function showConfirmModal({ title, message, onConfirm, onCancel }) {
        const previousActiveElement = document.activeElement; // Save focus
        let overlay = document.getElementById('confirm-modal-overlay');
        if (overlay) { overlay.remove(); overlay = null; }
        overlay = document.createElement('div');
        overlay.id = 'confirm-modal-overlay';
        overlay.className = 'fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center';
        overlay.innerHTML = '<div class="bg-[#0c0c1a] border border-green-500/20 rounded-sm p-6 max-w-md w-full shadow-[0_0_30px_rgba(0,255,0,0.08)]"><h2 class="text-green-400 font-bold text-lg mb-3 tracking-wider">' + escapeHtml(title) + '</h2><p class="text-green-300/70 text-sm mb-6 font-mono leading-relaxed">' + escapeHtml(message) + '</p><div class="flex gap-3 justify-end"><button class="px-4 py-2 text-xs text-green-500/60 hover:text-green-400 border border-green-500/20 hover:border-green-500/40 rounded-sm transition-colors font-mono tracking-wider uppercase cancel-btn">Cancel</button><button class="px-4 py-2 text-xs text-black bg-gradient-to-r from-green-400 to-emerald-500 rounded-sm font-bold font-mono tracking-wider hover:from-green-300 hover:to-emerald-400 transition-all ok-btn">Confirm</button></div></div>';
        document.body.appendChild(overlay);
        const okBtn = overlay.querySelector('.ok-btn');
        const cancelBtn = overlay.querySelector('.cancel-btn');
        okBtn.focus();
        const restoreFocus = () => {
            if (previousActiveElement && previousActiveElement.focus) previousActiveElement.focus();
        };
        okBtn.addEventListener('click', () => { overlay.remove(); restoreFocus(); onConfirm(); });
        cancelBtn.addEventListener('click', () => { overlay.remove(); restoreFocus(); onCancel && onCancel(); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); restoreFocus(); onCancel && onCancel(); } });
        const focusable = overlay.querySelectorAll('button');
        const first = focusable[0], last = focusable[focusable.length - 1];
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { overlay.remove(); restoreFocus(); onCancel && onCancel(); }
            if (e.key === 'Tab') { if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
        });
    }

    function wipeSystem() {
        showConfirmModal({
            title: 'Wipe System',
            message: 'Type DESTROY in the input field.\n\nThis will permanently delete all:\n\u2022 API Keys\n\u2022 Conversation History\n\u2022 Stored Prompts\n\u2022 Reference Documents\n\u2022 Custom Models\n\u2022 Model Validation Cache\n\nType DESTROY to confirm.',
            onConfirm: () => {
                const input = document.getElementById('terminal-input');
                input.placeholder = 'type DESTROY to confirm...';
                input.value = '';
                input.focus();
                const handler = () => {
                    if (input.value.trim() === 'DESTROY') {
                        playSound('wipe');
                        StateManager.wipeAll();
                        document.querySelectorAll('#terminal-output > *').forEach(el => el.remove());
                        DomLayer.showToast('success', 'All data wiped. System reset.');
                        input.value = '';
                        DomLayer.updateTerminalStatus('standby');
                        DomLayer.updateContextMeter();
                        DomLayer.updateSessionStats();
                        DomLayer.showInfoInStatus('System wiped clean');
                        input.removeEventListener('keydown', handler);
                        _wipeHandlerAttached = false;
                    }
                };
                if (!_wipeHandlerAttached) {
                    input.addEventListener('keydown', handler);
                    _wipeHandlerAttached = true;
                }
            }
        });
    }

    function validateProviderModels() {
        const allModels = [...models, ...StateManager.get('customModels')];
        const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
        const ENDPOINTS = {
            groq: { url: 'https://api.groq.com/openai/v1/models', keyParam: 'header' },
            openrouter: { url: 'https://openrouter.ai/api/v1/models', keyParam: 'header' },
            nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', keyParam: 'header' },
            google: { url: null, keyParam: 'query' },
        };
        fetchAndValidate(0);
        function fetchAndValidate(idx) {
            if (idx >= allModels.length) return;
            const model = allModels[idx];
            if (StateManager.get('validatedModels')[model.modelId + ':' + model.provider]) { fetchAndValidate(idx + 1); return; }
            const apiKey = keys[model.provider];
            if (!apiKey) { fetchAndValidate(idx + 1); return; }
            const cfg = ENDPOINTS[model.provider];
            if (!cfg) { fetchAndValidate(idx + 1); return; }
            const id = model.modelId;
            if (model.provider === 'google') {
                fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey)
                    .then(r => r.json().then(d => {
                        const valid = d.models?.some(m => m.name === 'models/' + id);
                        StateManager.setValidated(id + ':' + model.provider, valid);
                        if (!valid) { const el = findModelItem(id, model.provider); if (el) el.classList.add('opacity-30', 'pointer-events-none'); }
                    }).catch(() => { })).catch(() => { }).finally(() => fetchAndValidate(idx + 1));
            } else {
                fetch(cfg.url, { headers: { 'Authorization': 'Bearer ' + apiKey } })
                    .then(r => r.json().then(d => {
                        const modelList = d.data || d.models || [];
                        const valid = modelList.some(m => (m.id === id) || (m.name === id));
                        StateManager.setValidated(id + ':' + model.provider, valid);
                        if (!valid) { const el = findModelItem(id, model.provider); if (el) el.classList.add('opacity-30', 'pointer-events-none'); }
                    }).catch(() => { })).catch(() => { }).finally(() => fetchAndValidate(idx + 1));
            }
        }
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
    }

    function handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) { handleAttachment(file); break; }
            }
        }
    }

    function handleAttachment(file) {
        if (!file) { App.removeAttachment(); return; }
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) { DomLayer.showToast('error', 'Unsupported file type: ' + file.type + '. Please upload JPG, PNG, GIF, or WebP images only.'); return; }
        if (file.size > 5 * 1024 * 1024) { DomLayer.showToast('error', 'Image exceeds 5MB limit.'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const state = StateManager.get('pendingAttachment') || {};
            state.fileName = file.name;
            state.dataUrl = ev.target.result;
            StateManager.set('pendingAttachment', state);
            DomLayer.showAttachmentPreview(state.fileName, state.dataUrl);
            playSound('select');
        };
        reader.readAsDataURL(file);
    }

    function removeAttachment() { StateManager.set('pendingAttachment', null); DomLayer.removeAttachmentPreview(); playSound('click'); }

    function loadConversation() {
        const allModels = [...models, ...StateManager.get('customModels')];
        const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_MODEL);
        if (activeRaw) {
            try { const parsed = JSON.parse(activeRaw); const found = allModels.find(m => m.provider === parsed.provider && m.modelId === parsed.modelId); if (found) { StateManager.set('selectedModel', found); DomLayer.updateActiveModelBar(found); DomLayer.updateModelProfile(found); const el = findModelItem(found.modelId, found.provider); if (el) el.classList.add('active'); } } catch (e) { }
        }
        if (!StateManager.get('selectedModel')) {
            const keys = JSON.parse(localStorage.getItem('war_chest_keys') || '{}');
            const def = allModels.find(m => m.provider === DEFAULT_MODEL.provider && m.modelId === DEFAULT_MODEL.modelId) || allModels.find(m => keys[m.provider] && m.type === 'chat') || allModels[0];
            if (def) { StateManager.set('selectedModel', def); DomLayer.updateActiveModelBar(def); DomLayer.updateModelProfile(def); }
        }
        StateManager.recompileSystemMessage();
        DomLayer.renderConversation();
        DomLayer.updateContextMeter();
        DomLayer.updateSessionStats();
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
        filterInput.value = StateManager.get('modelFilterString') || ''; // Restore persisted filter
        filterInput.addEventListener('input', (e) => {
            StateManager.set('modelFilterString', e.target.value);
            localStorage.setItem('war_chest_model_filter', e.target.value);
            DomLayer.renderModelList();
            playSound('keyclick');
        });
    }

    function setupModelListEvents() {
        document.getElementById('model-list').addEventListener('click', (e) => {
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
    }

    function setupSidebarEvents() {
        document.getElementById('apply-prompt-btn').addEventListener('click', applySystemPrompt);
        document.getElementById('reset-prompt-btn').addEventListener('click', resetSystemPrompt);
        document.getElementById('vault-btn').addEventListener('click', toggleVault);
        document.getElementById('vault-close-btn').addEventListener('click', toggleVault);
        document.getElementById('wipe-btn')?.addEventListener('click', wipeSystem);
        document.getElementById('remove-attach-btn')?.addEventListener('click', removeAttachment);
    }

    function setupAudioEvents() {
        document.getElementById('audio-toggle-btn').addEventListener('click', () => {
            const muted = !StateManager.get('audioMuted');
            StateManager.set('audioMuted', muted);
            localStorage.setItem('war_chest_audio_muted', JSON.stringify(muted));
            const btn = document.getElementById('audio-toggle-btn');
            btn.textContent = muted ? '🔇' : '🔊';
            btn.title = muted ? 'Unmute sounds' : 'Mute sounds';
            btn.className = 'px-3 py-2 text-xs font-bold bg-gray-800/50 hover:bg-gray-700/50 border rounded transition-all ' + (muted ? 'border-red-500/50 hover:border-red-400' : 'border-green-500/50 hover:border-green-400');
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
    }

    function setupVaultEvents() {
        document.getElementById('save-keys-btn').addEventListener('click', saveKeys);
        document.getElementById('load-env-btn').addEventListener('click', loadEnvFile);
        document.getElementById('env-file-input').addEventListener('change', handleEnvFile);
    }

    function setupGlobalEvents() {
        document.addEventListener('scroll-to-bottom', () => DomLayer.scrollToBottom());
        document.addEventListener('scroll-fab', () => DomLayer.scrollToBottom());
        window.addEventListener('beforeunload', (e) => { if (document.getElementById('terminal-input')?.value) { e.preventDefault(); e.returnValue = ''; } });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (_streamState?.voiceReco) { try { _streamState.voiceReco.abort(); } catch (e) {} _streamState.voiceReco = null; document.getElementById('voice-btn')?.classList.remove('listening'); return; }
                if (StateManager.get('isStreaming')) { stopStreaming(); return; }
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
                if (!StateManager.get('isStreaming')) {
                    StateManager.set('conversationHistory', [{ role: 'system', content: StateManager.compiledPrompt() }]);
                    document.querySelectorAll('#terminal-output > *').forEach(el => el.remove());
                    StateManager.saveConversation();
                    DomLayer.updateContextMeter();
                    DomLayer.updateSessionStats();
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
            btn.classList.toggle('active', enabled);
            btn.title = enabled ? 'Disable auto-speak' : 'Auto-speak responses';
            DomLayer.showToast('info', enabled ? 'Auto-speak ON' : 'Auto-speak OFF');
        });
        if (StateManager.get('ttsEnabled')) {
            const ttsBtn = document.getElementById('tts-toggle-btn');
            if (ttsBtn) { ttsBtn.classList.add('active'); ttsBtn.title = 'Disable auto-speak'; }
        }
        if (window.speechSynthesis) document.getElementById('tts-toggle-btn').classList.remove('hidden');
    }

    function init() {
        try { const saved = localStorage.getItem('war_chest_custom_models'); if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed)) StateManager.set('customModels', parsed); } } catch (_) {}
        loadConversation();
        loadPrompt();
        loadDraft();
        loadKeys();
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
        AvatarEngine.init();
        document.getElementById('terminal-input').style.height = document.getElementById('terminal-input').scrollHeight + 'px';
        setTimeout(() => playSound('poweron'), 300);
        if (StateManager.get('audioMuted')) {
            const btn = document.getElementById('audio-toggle-btn');
            if (btn) { btn.textContent = '🔇'; btn.title = 'Unmute sounds'; btn.className = 'px-3 py-2 text-xs font-bold bg-gray-800/50 hover:bg-gray-700/50 border border-red-500/50 rounded transition-all hover:border-red-400'; }
        }
    }

    return { init, sendMessage, stopStreaming, selectModel, toggleVault, saveKeys, loadEnvFile, handleEnvFile, loadKeys, applySystemPrompt, resetSystemPrompt, loadPrompt, wipeSystem, handleAttachment, removeAttachment, regenerateResponse, startVoiceInput };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => { App.init(); });
