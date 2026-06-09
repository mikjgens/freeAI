// DOM Layer — all rendering, no business logic

const DomLayer = (() => {
    let _statusTimeoutId = null;
    const _modelItemMap = new Map();

    function updateTerminalStatus(state, detail) {
        const el = document.getElementById('terminal-status');
        if (!el) return;
        const pulse = el.previousElementSibling;
        if (_statusTimeoutId) { clearTimeout(_statusTimeoutId); _statusTimeoutId = null; }
        switch (state) {
            case 'standby':
                el.textContent = '\u25BC ' + (StateManager.get('selectedModel') ? StateManager.get('selectedModel').name : 'AWAITING INPUT');
                if (pulse) pulse.className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse';
                break;
            case 'streaming':
                el.innerHTML = '\u25BC Receiving<span class="blink text-green-500 ml-1">\u2588</span>';
                if (pulse) pulse.className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse';
                break;
            case 'info':
                el.textContent = '\u25B8 ' + detail;
                if (pulse) pulse.className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse';
                _statusTimeoutId = setTimeout(() => { if (document.getElementById('terminal-status') === el) updateTerminalStatus('standby'); _statusTimeoutId = null; }, 4000);
                break;
            case 'error':
                el.textContent = '\u26A0 ' + detail;
                if (pulse) { pulse.style.background = 'var(--amber)'; pulse.className = 'w-2 h-2 rounded-full'; }
                break;
        }
    }
    function showInfoInStatus(message) { updateTerminalStatus('info', message); }
    function updateSendStopButtons(streaming) {
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        if (!sendBtn || !stopBtn) return;
        if (streaming) { sendBtn.classList.add('hidden'); stopBtn.classList.remove('hidden'); }
        else { sendBtn.classList.remove('hidden'); stopBtn.classList.add('hidden'); }
    }

    function updateContextMeter() {
        const model = StateManager.get('selectedModel');
        const history = StateManager.get('conversationHistory');
        const label = document.getElementById('context-meter-label');
        const bar = document.getElementById('context-meter-bar');
        const pct = document.getElementById('context-meter-pct');
        if (!label || !bar || !pct || !model) return;
        const maxCtx = parseCtx(model.ctx);
        if (maxCtx === Infinity) { label.textContent = model.name; bar.style.width = '0%'; pct.textContent = '\u2014'; pct.style.color = ''; return; }
        const used = StateManager.estimateTokensCached();
        const pctVal = Math.min(100, Math.round((used / maxCtx) * 100));
        label.textContent = model.name;
        bar.style.width = pctVal + '%';
        bar.style.background = pctVal < 60 ? '#00ff41' : pctVal < 80 ? '#ffb347' : '#ff4444';
        pct.textContent = pctVal + '%';
        pct.style.color = pctVal < 60 ? 'var(--text-tertiary)' : pctVal < 80 ? 'var(--amber)' : '#ff4444';
    }

    function updateActiveModelBar(model) {
        const bar = document.getElementById('active-model-bar');
        const nameEl = document.getElementById('active-model-name');
        const extraEl = document.getElementById('active-model-extra');
        const indicator = document.getElementById('active-model-indicator');
        const indicatorName = document.getElementById('active-model-indicator-name');
        if (!bar || !nameEl || !extraEl || !indicator || !indicatorName) return;
        if (!model) { bar.classList.add('hidden'); indicator.classList.add('hidden'); return; }
        bar.classList.remove('hidden');
        nameEl.textContent = model.name;
        const toolIcon = model.tools === 'Function Calling' ? icon('wrench', 'w-3 h-3 align-middle') : model.tools === 'Built-in Tools' ? icon('cpu', 'w-3 h-3 align-middle') : '';
        extraEl.innerHTML = '\u00B7 ' + escapeHtml(model.provider) + ' \u00B7 ' + escapeHtml(model.ctx || '?') + ' ' + toolIcon;
        indicator.classList.remove('hidden');
        indicatorName.textContent = model.name;
    }

    function showToast(type, message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        const iconMap = { success: 'check', error: 'xCircle', warning: 'warning', info: 'info' };
        const ico = iconMap[type] || 'info';
        toast.innerHTML = '<span class="font-bold mr-1.5 align-middle">' + icon(ico, 'w-3.5 h-3.5') + '</span>' + message;
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
    }

    function renderModelList() {
        const list = document.getElementById('model-list');
        if (!list) return;
        list.innerHTML = '';
        _modelItemMap.clear();
        const customModels = StateManager.get('customModels');
        const validatedModels = StateManager.get('validatedModels');
        const selectedModel = StateManager.get('selectedModel');
        const currentFilter = StateManager.get('currentFilter');
        const capFilters = StateManager.get('capabilityFilters') || [];
        const modelFilterString = (StateManager.get('modelFilterString') || '').toLowerCase(); // Get filter string

        const all = [...models, ...customModels];
        let filtered = currentFilter === 'all' ? all : all.filter(m => m.provider === currentFilter);

        // Apply text filter
        if (modelFilterString) {
            filtered = filtered.filter(m => 
                m.name.toLowerCase().includes(modelFilterString) || 
                m.provider.toLowerCase().includes(modelFilterString) ||
                m.desc.toLowerCase().includes(modelFilterString) ||
                (m.tags && m.tags.some(tag => tag.toLowerCase().includes(modelFilterString)))
            );
        }

        if (capFilters.length) {
            filtered = filtered.filter(m => {
                return capFilters.every(cf => {
                    if (cf === 'vision') return m.vision === true;
                    if (cf === 'tools') return m.tools && m.tools !== 'None';
                    if (cf === 'fast') return m.tags && m.tags.some(t => ['fast', 'fastest', 'fast-inference', 'speed', 'high-throughput'].includes(t));
                    return true;
                });
            });
        }
        filtered.forEach(model => {
            const isCustom = model.custom;
            const isVerified = validatedModels[model.provider]?.includes(model.modelId);
            const isSelected = selectedModel && selectedModel.modelId === model.modelId && selectedModel.provider === model.provider;
            const div = document.createElement('div');
            div.className = 'model-item p-2.5 rounded cursor-pointer flex items-start gap-3 text-xs';
            div.dataset.modelId = model.modelId;
            div.dataset.provider = model.provider;
            div.dataset.customDelete = isCustom ? '1' : '';
            div.setAttribute('role', 'option');
            div.setAttribute('tabindex', '0');
            div.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            if (!isVerified && Object.keys(validatedModels).length > 0) div.classList.add('opacity-50');
            if (isSelected) div.classList.add('active');
            _modelItemMap.set(model.provider + ':' + model.modelId, div);
            const toolIcon = model.tools === 'Function Calling' ? icon('wrench', 'w-3 h-3 align-text-top') : model.tools === 'Built-in Tools' ? icon('cpu', 'w-3 h-3 align-text-top') : '';
            const tagsHtml = model.tags ? model.tags.slice(0, 3).map(t => '<span class="inline-block text-[7px] px-1 py-0.5 rounded bg-gray-800/60 border border-gray-700/50 text-gray-500 leading-none">' + escapeHtml(t) + '</span>').join('') : '';
            const dotColors = { groq: 'var(--green-0)', openrouter: 'var(--amber)' };
            const dotColor = dotColors[model.provider] || 'var(--text-tertiary)';
            div.innerHTML = '<span class="mt-0.5 inline-flex"><span class="w-2 h-2 rounded-full" style="background:' + dotColor + '"></span></span><div class="flex-1 min-w-0"><div class="font-bold ' + (isCustom ? 'text-blue-300' : 'text-gray-200') + ' truncate flex items-center gap-2">' + escapeHtml(model.name) + ' ' + toolIcon + (!isVerified && Object.keys(validatedModels).length > 0 ? '<span class="text-[8px] px-1 rounded" style="color:var(--amber);border:1px solid rgba(255,180,71,0.3)">UNVERIFIED</span>' : '') + (isCustom ? '<span class="text-[8px] text-blue-400 border border-blue-400/30 px-1 rounded">CUSTOM</span>' : '') + '</div><div class="text-gray-500 text-[10px] truncate">' + escapeHtml(model.desc) + '</div>' + (tagsHtml ? '<div class="flex flex-wrap gap-1 mt-1">' + tagsHtml + '</div>' : '') + '</div>' + (isCustom ? '<button class="custom-delete-btn text-red-400 hover:text-red-300 text-xs px-1">&times;</button>' : '');
            div.onclick = (e) => { if (e.target.closest('.custom-delete-btn')) return; App.selectModel(model); };
            list.appendChild(div);
        });
    }

    function updateModelProfile(model) {
        const profile = document.getElementById('model-profile');
        if (!profile) return;
        if (!model) { profile.innerHTML = 'Select a model below to view telemetry and capabilities.'; return; }
        const tagsHtml = model.tags && model.tags.length ? model.tags.map(t => '<span class="tag-pill inline-block text-[9px] px-1.5 py-0.5 rounded bg-green-900/20 border border-green-500/20 text-green-400 leading-none mr-1 mb-1">' + escapeHtml(t) + '</span>').join('') : '';
        const weaknessHtml = model.weakness ? '<div class="mt-2 p-2 rounded border text-[10px]" style="background:rgba(255,180,71,0.06);border-color:rgba(255,180,71,0.15);color:var(--amber-dim)">' + icon('warning', 'w-3 h-3 align-text-top') + ' ' + escapeHtml(model.weakness) + '</div>' : '';
        if (model.type !== 'chat') {
            profile.innerHTML = '<div class="space-y-1 animate-[fadeIn_0.2s_ease-in-out]"><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Provider</span><span class="text-white font-bold uppercase">' + escapeHtml(model.provider) + '</span></div><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Type</span><span class="text-yellow-400 font-bold uppercase">' + escapeHtml(model.type) + '</span></div><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Context</span><span class="text-white font-bold">' + escapeHtml(model.ctx) + '</span></div>' + (tagsHtml ? '<div class="flex flex-wrap gap-1 mt-1">' + tagsHtml + '</div>' : '') + weaknessHtml + '<div class="mt-2 p-2 rounded border text-[10px]" style="background:rgba(255,180,71,0.06);border-color:rgba(255,180,71,0.2);color:var(--amber-dim)">' + icon('warning', 'w-3 h-3 align-text-top') + ' This is a ' + model.type.toUpperCase() + '-only model. Select a chat model for conversation.</div></div>';
            return;
        }
        const toolLabel = model.tools === 'Function Calling' ? 'Function Calling' : model.tools === 'Built-in Tools' ? 'Built-in Tools' : model.tools || 'None';
        const toolColor = model.tools === 'Function Calling' || model.tools === 'Built-in Tools' ? 'text-green-400' : '';
        let builtInHtml = '';
        if (model.builtInTools && model.builtInTools.length) builtInHtml = '<div class="mt-1 flex flex-wrap gap-1">' + model.builtInTools.map(t => '<span class="text-[8px] px-1 py-0.5 rounded border" style="background:var(--green-6);border-color:var(--green-4);color:var(--green-1)">' + icon('cpu', 'w-2.5 h-2.5 align-text-top') + ' ' + escapeHtml(t) + '</span>').join('') + '</div>';
        let localToolsHtml = '';
        if (model.tools === 'Function Calling' && HARDCODED_TOOLS.length) localToolsHtml = '<div class="mt-1 text-[9px]" style="color:var(--text-tertiary)">' + icon('wrench', 'w-2.5 h-2.5 align-text-top') + ' Local: ' + HARDCODED_TOOLS.map(t => '<span style="color:var(--text-secondary)">' + escapeHtml(t.function.name) + '</span>').join(', ') + '</div>';
        profile.innerHTML = '<div class="space-y-1 animate-[fadeIn_0.2s_ease-in-out]"><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Provider</span><span class="text-white font-bold uppercase">' + escapeHtml(model.provider) + '</span></div><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Model ID</span><span class="text-green-400 font-mono text-[10px]">' + escapeHtml(model.modelId) + '</span></div><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Context</span><span class="text-white font-bold">' + escapeHtml(model.ctx) + '</span></div><div class="flex justify-between border-b border-gray-800 pb-0.5"><span class="text-gray-500">Tools</span><span class="' + toolColor + ' font-bold">' + toolLabel + '</span></div>' + builtInHtml + localToolsHtml + (tagsHtml ? '<div class="flex flex-wrap gap-1 mt-1 border-t border-gray-800 pt-1"><span class="text-[9px] text-gray-500 uppercase tracking-wider w-full">Excels at</span>' + tagsHtml + '</div>' : '') + weaknessHtml + '<div class="mt-1 p-2 rounded border italic text-[10px]" style="background:rgba(0,0,0,0.15);border-color:rgba(255,255,255,0.05);color:var(--text-tertiary)">"' + escapeHtml(model.desc) + '"</div></div>';
    }
    function _buildUserMessageElement(text, attachment, onDelete) {
        const wrapper = document.createElement('div');
        wrapper.className = 'msg-container relative group';
        const div = document.createElement('div');
        div.className = 'text-white font-mono text-sm border-l-2 border-transparent pl-2 hover:border-gray-700 transition-colors mb-1 pr-8';
        const attachHtml = attachment ? ' <span class="text-blue-400">[\uD83D\uDCF7 ' + escapeHtml(attachment.name || 'image') + ']</span>' : '';
        div.innerHTML = '<span class="text-gray-500">USER:</span> ' + escapeHtml(text) + attachHtml;
        wrapper.appendChild(div);
        const ts = document.createElement('div');
        ts.className = 'msg-timestamp text-gray-600';
        ts.textContent = formatTimestamp(new Date());
        div.appendChild(ts);
        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action absolute top-0 right-6 text-gray-600 hover:text-green-400 px-1 py-0.5 rounded';
        copyBtn.innerHTML = icon('clipboard', 'w-3 h-3');
        copyBtn.title = 'Copy';
        copyBtn.onclick = () => { const t = div.cloneNode(true).textContent.replace(ts.textContent, '').trim(); navigator.clipboard.writeText(t).catch(() => {}); copyBtn.innerHTML = icon('check', 'w-3 h-3'); setTimeout(() => { copyBtn.innerHTML = icon('clipboard', 'w-3 h-3'); }, 1000); };
        wrapper.appendChild(copyBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'msg-action absolute top-0 right-0 text-[10px] text-gray-600 hover:text-red-400 px-1 py-0.5 rounded';
        delBtn.textContent = '\u00D7';
        delBtn.title = 'Delete';
        delBtn.onclick = onDelete || (() => wrapper.remove());
        wrapper.appendChild(delBtn);
        return wrapper;
    }

    function _buildResponseActionButtons(element) {
        const speakerBtn = document.createElement('button');
        speakerBtn.className = 'speaker-btn msg-action absolute top-0 right-[5.5rem] px-1 py-0.5';
        speakerBtn.style.cssText = 'color:var(--text-tertiary)';
        speakerBtn.innerHTML = icon('speaker', 'w-3 h-3');
        speakerBtn.title = 'Hear it spoken';
        speakerBtn.onclick = () => {
            const t = element.querySelector('.markdown-body').textContent;
            if (t) DomLayer.speakResponse(t);
        };
        element.appendChild(speakerBtn);
        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action absolute top-0 right-[4.25rem] px-1 py-0.5 rounded';
        copyBtn.style.cssText = 'color:var(--text-tertiary)';
        copyBtn.innerHTML = icon('clipboard', 'w-3 h-3');
        copyBtn.title = 'Copy response';
        copyBtn.onclick = () => { const t = element.querySelector('.markdown-body').textContent; navigator.clipboard.writeText(t).catch(() => {}); copyBtn.innerHTML = icon('check', 'w-3 h-3'); copyBtn.style.color = 'var(--green-0)'; setTimeout(() => { copyBtn.innerHTML = icon('clipboard', 'w-3 h-3'); copyBtn.style.color = ''; }, 1500); };
        element.appendChild(copyBtn);
        const regenBtn = document.createElement('button');
        regenBtn.className = 'msg-action absolute top-0 right-[2.75rem] px-1 py-0.5 rounded';
        regenBtn.style.cssText = 'color:var(--text-tertiary)';
        regenBtn.innerHTML = icon('arrowPath', 'w-3 h-3');
        regenBtn.title = 'Regenerate response';
        regenBtn.onclick = () => { if (!StateManager.isStreaming()) App.regenerateResponse(element); };
        element.appendChild(regenBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'msg-action absolute top-0 right-0 px-1 py-0.5 rounded';
        delBtn.style.cssText = 'color:var(--text-tertiary)';
        delBtn.innerHTML = icon('xMark', 'w-3 h-3');
        delBtn.title = 'Delete response';
        delBtn.onclick = () => {
            const containers = document.querySelectorAll('#terminal-output .msg-container');
            let idx = -1;
            containers.forEach((c, i) => { if (c === element) idx = i; });
            const respIdx = (idx >= 0) ? idx * 2 + 1 : -1;
            if (respIdx > 0 && respIdx < StateManager.get('conversationHistory').length) {
                const h = StateManager.get('conversationHistory');
                h.splice(respIdx - 1, 2);
            }
            const prev = element.previousElementSibling;
            if (prev && prev.classList.contains('msg-container')) prev.remove();
            element.remove();
            StateManager.saveConversation();
        };
        element.appendChild(delBtn);
    }

    function addUserMessage(text, attachment, msgId) {
        const wrapper = _buildUserMessageElement(text, attachment);
        if (msgId) wrapper.dataset.msgId = msgId;
        document.getElementById('terminal-output').appendChild(wrapper);
        document.getElementById('terminal-output').scrollTop = document.getElementById('terminal-output').scrollHeight;
    }

    function createResponseContainer(msgId) {
        const terminal = document.getElementById('terminal-output');
        const div = document.createElement('div');
        div.className = 'msg-container relative group font-mono text-sm border-l-2 border-transparent pl-2 hover:border-gray-700 transition-colors mb-3 pr-8';
        if (msgId) div.dataset.msgId = msgId;
        const model = StateManager.get('selectedModel');
        const modelName = model ? ' ' + model.name : '';
        div.innerHTML = '<span class="text-green-500">AI' + escapeHtml(modelName) + ':</span> <div class="text-green-400 markdown-body"></div><div class="image-gallery flex flex-wrap gap-2 mt-2"></div>';
        const ts = document.createElement('div');
        ts.className = 'msg-timestamp text-gray-600';
        ts.textContent = formatTimestamp(new Date());
        div.appendChild(ts);
        _buildResponseActionButtons(div);
        const textContainer = div.querySelector('.markdown-body');
        const gallery = div.querySelector('.image-gallery');
        terminal.appendChild(div);
        terminal.scrollTop = terminal.scrollHeight;
        return { textContainer, gallery, element: div };
    }

    function updateStreamText(container, text) {
        if (!container) return;
        container.innerHTML = escapeHtml(text) + '<span class="stream-cursor blink text-green-500 ml-px">\u2588</span>';
    }

    function finalizeResponseDOM(container, markdownText) {
        if (!container) return;
        const cursorSpan = container.querySelector('.stream-cursor');
        if (cursorSpan) {
            cursorSpan.style.opacity = '0';
            setTimeout(() => cursorSpan.remove(), 150);
        }
        if (markdownText && typeof marked !== 'undefined') {
            const raw = marked.parse(markdownText);
            container.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
        }
    }

    function updateTimestamp(element, latency, aborted) {
        if (!element) return;
        const tsEl = element.querySelector('.msg-timestamp');
        if (tsEl && !aborted) tsEl.textContent = formatTimestamp(new Date()) + ' \u00B7 ' + latency + 'ms';
    }

    function updateLatency(latency) {
        const el = document.getElementById('last-latency');
        if (el) el.innerText = latency + 'ms';
    }

    function showError(msg, showRetry) {
        playSound('error');
        updateTerminalStatus('error', msg);
        const terminal = document.getElementById('terminal-output');
        const wrapper = document.createElement('div');
        wrapper.className = 'msg-container relative group';
        const div = document.createElement('div');
        div.className = 'font-mono text-sm border-l-2 pl-2 mb-1';
        div.style.cssText = 'color:var(--amber);border-color:rgba(255,180,71,0.3)';
        div.innerHTML = '<span class="inline-flex items-center gap-1 align-middle" style="color:var(--amber)">' + icon('warning', 'w-3.5 h-3.5') + 'ERROR:</span> ' + escapeHtml(msg);
        wrapper.appendChild(div);
        if (showRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'retry-btn text-[10px] rounded px-2 py-0.5 ml-2 mb-2 transition-all inline-flex items-center gap-1';
            retryBtn.style.cssText = 'color:var(--text-tertiary);border:1px solid rgba(255,255,255,0.1)';
            retryBtn.innerHTML = icon('arrowPath', 'w-3 h-3') + ' Retry';
            retryBtn.onclick = () => { if (StateManager.isStreaming()) return; wrapper.remove(); App.sendMessage(); };
            wrapper.appendChild(retryBtn);
        }
        terminal.appendChild(wrapper);
        terminal.scrollTop = terminal.scrollHeight;
    }

    function renderToolCallCard(toolCalls, results) {
        const terminal = document.getElementById('terminal-output');
        const card = document.createElement('div');
        card.className = 'msg-container font-mono text-xs border rounded-lg p-3 mb-3';
        card.style.cssText = 'border-color:var(--green-4);background:rgba(0,0,0,0.2)';
        let html = '<div class="font-bold mb-2 flex items-center gap-2" style="color:var(--green-1)">' + icon('wrench', 'w-3.5 h-3.5') + ' Tool Execution</div>';
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i], r = results[i], name = tc.function?.name || 'unknown';
            let argsDisp, resDisp;
            try { argsDisp = JSON.stringify(JSON.parse(tc.function?.arguments || '{}'), null, 2); } catch (e) { argsDisp = tc.function?.arguments || '{}'; }
            try { resDisp = typeof r.content === 'string' ? r.content : JSON.stringify(JSON.parse(r.content), null, 2); } catch (e) { resDisp = String(r.content); }
            const isErr = resDisp.includes('"error"');
            html += '<div class="mb-2 p-2 bg-black/30 rounded border border-gray-800"><div class="text-cyan-400 font-bold mb-1">\u25B8 ' + escapeHtml(name) + '</div><details class="text-gray-400"><summary class="cursor-pointer text-gray-500 hover:text-gray-300 text-[10px]">Arguments</summary><pre class="mt-1 text-[10px] text-gray-500 overflow-x-auto">' + escapeHtml(argsDisp) + '</pre></details><div class="mt-1 text-gray-300 text-[10px]"><span class="text-gray-500">Result:</span> <span class="' + (isErr ? 'text-red-400' : 'text-green-400') + ' whitespace-pre-wrap">' + escapeHtml(resDisp) + '</span></div></div>';
        }
        card.innerHTML = html;
        terminal.appendChild(card);
        terminal.scrollTop = terminal.scrollHeight;
        playSound('deploy');
    }

    function archiveMessages(activeCount) {
        const containers = document.querySelectorAll('#terminal-output .msg-container');
        let count = 0;
        containers.forEach(el => { if (count < activeCount) count++; else el.classList.add('msg-archived'); });
    }

    function addHorizonBanner() {
        const terminal = document.getElementById('terminal-output');
        const horizon = document.createElement('div');
        horizon.className = 'context-horizon';
        horizon.textContent = '--- [ CONTEXT HORIZON: OLDER MESSAGES ARCHIVED ] ---';
        const firstActive = terminal.querySelector('.msg-container:not(.msg-archived)');
        if (firstActive) terminal.insertBefore(horizon, firstActive);
        else terminal.appendChild(horizon);
    }

    function displayImages(container, images) {
        if (!container) return;
        container.innerHTML = '';
        for (const img of images) {
            const src = img.data.startsWith('data:') || img.data.startsWith('http')
                ? img.data
                : 'data:' + (img.mime || 'image/png') + ';base64,' + img.data;
            const wrapper = document.createElement('div');
            wrapper.className = 'relative group inline-block cursor-pointer';
            const thumb = document.createElement('img');
            thumb.className = 'w-32 h-32 object-cover rounded border border-gray-700 hover:border-green-500/50 transition-all';
            thumb.src = src;
            thumb.onclick = () => showImageLightbox(src);
            wrapper.appendChild(thumb);
            const dl = document.createElement('button');
            dl.className = 'absolute top-1 right-1 rounded opacity-0 group-hover:opacity-100 transition-opacity';
            dl.style.cssText = 'background:rgba(0,0,0,0.7);padding:2px 4px;line-height:1';
            dl.innerHTML = icon('download', 'w-3 h-3');
            dl.onclick = (e) => { e.stopPropagation(); downloadImage(src, img.mime); };
            wrapper.appendChild(dl);
            container.appendChild(wrapper);
        }
        if (images.length > 0) {
            const badge = document.createElement('div');
            badge.className = 'text-[10px] text-gray-500 mt-1';
            badge.textContent = images.length + ' image' + (images.length > 1 ? 's' : '') + ' generated';
            container.appendChild(badge);
        }
    }

    function showImageLightbox(src) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 cursor-pointer';
        overlay.onclick = () => overlay.remove();
        const img = document.createElement('img');
        img.className = 'max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl';
        img.src = src;
        overlay.appendChild(img);
        document.body.appendChild(overlay);
    }

    function downloadImage(src, mime) {
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime] || 'png';
        const a = document.createElement('a'); a.href = src; a.download = 'ai-image-' + Date.now() + '.' + ext;
        document.body.appendChild(a); a.click(); a.remove();
    }

    function renderConversation() {
        const terminal = document.getElementById('terminal-output');
        if (!terminal) return;
        const defaultMsg = terminal.querySelector('.text-gray-400');
        if (defaultMsg) defaultMsg.remove();
        const history = StateManager.get('conversationHistory');
        for (let i = 0; i < history.length; i++) {
            const msg = history[i];
            if (msg.role === 'system') continue;
            if (msg.role === 'user') {
                let text = '', attachment = null;
                if (typeof msg.content === 'string') text = msg.content;
                else if (Array.isArray(msg.content)) for (const part of msg.content) { if (part.type === 'text') text = part.text; else if (part.type === 'image_url') attachment = { name: 'image' }; }
                terminal.appendChild(_buildUserMessageElement(text, attachment));
            } else if (msg.role === 'assistant') {
                const wrapper = document.createElement('div');
                wrapper.className = 'msg-container relative group font-mono text-sm border-l-2 border-transparent pl-2 hover:border-gray-700 transition-colors mb-3 pr-8';
                wrapper.innerHTML = '<span class="text-green-500">AI:</span> <div class="text-green-400 markdown-body"></div><div class="image-gallery flex flex-wrap gap-2 mt-2"></div>';
                const ts = document.createElement('div');
                ts.className = 'msg-timestamp text-gray-600';
                ts.textContent = formatTimestamp(new Date());
                wrapper.appendChild(ts);
                _buildResponseActionButtons(wrapper);
                const tc = wrapper.querySelector('.markdown-body');
                if (typeof msg.content === 'string' && msg.content) {
                    if (typeof marked !== 'undefined') {
                        const raw = marked.parse(msg.content);
                        tc.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
                    } else tc.textContent = msg.content;
                }
                terminal.appendChild(wrapper);
            }
        }
        terminal.scrollTop = terminal.scrollHeight;
    }

    function showAttachmentPreview(fileName, dataUrl, fileSize, dimensions) {
        const preview = document.getElementById('attachment-preview');
        const thumb = document.getElementById('attach-thumb');
        const name = document.getElementById('attach-name');
        const sizeEl = document.getElementById('attach-size');
        const dimsEl = document.getElementById('attach-dims');
        if (!preview || !thumb || !name) return;
        thumb.src = dataUrl;
        name.textContent = fileName;
        if (sizeEl && fileSize) sizeEl.textContent = (fileSize / 1024).toFixed(0) + 'KB';
        if (dimsEl && dimensions) dimsEl.textContent = dimensions.w + 'x' + dimensions.h;
        preview.classList.remove('hidden');
    }

    function removeAttachmentPreview() {
        const preview = document.getElementById('attachment-preview');
        if (preview) preview.classList.add('hidden');
    }

    function showVisionSuggestion(visionModel) {
        const bar = document.getElementById('vision-suggestion');
        const name = document.getElementById('vision-suggestion-model');
        const btn = document.getElementById('switch-vision-btn');
        if (!bar || !name || !btn) return;
        name.textContent = visionModel.name;
        btn.dataset.switchProvider = visionModel.provider;
        btn.dataset.switchModelId = visionModel.modelId;
        bar.classList.remove('hidden');
    }

    function hideVisionSuggestion() {
        const bar = document.getElementById('vision-suggestion');
        if (bar) bar.classList.add('hidden');
    }

    function getModelItem(modelId, provider) {
        return _modelItemMap.get(provider + ':' + modelId) || null;
    }

    function syncFleetSelection(model) {
        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('active'));
        const match = getModelItem(model.modelId, model.provider);
        if (match) match.classList.add('active');
        updateModelProfile(model);
    }

    function updatePromptCharCount() {
        const editor = document.getElementById('prompt-editor');
        const chars = document.getElementById('prompt-chars');
        if (editor && chars) chars.textContent = editor.value.length + 'c';
    }

    function updateDocUI() {
        const refDoc = StateManager.get('refDoc');
        const emptyState = document.getElementById('doc-empty-state');
        const loadedState = document.getElementById('doc-loaded-state');
        const ragControls = document.getElementById('rag-controls');
        if (!emptyState || !loadedState) return;
        if (refDoc) {
            emptyState.classList.add('hidden');
            loadedState.classList.toggle('loaded', true);
            document.getElementById('doc-filename').textContent = refDoc.name;
            document.getElementById('doc-filesize').textContent = (refDoc.size / 1024).toFixed(0) + 'KB';
            const chunks = chunkDocument(refDoc.content);
            StateManager.set('ragChunks', chunks);
            const idx = buildRagIndex(chunks);
            StateManager._ragIndex = idx;
            const chunkEl = document.getElementById('doc-chunks');
            if (chunkEl) chunkEl.textContent = chunks.length + ' chunks';
            if (ragControls) {
                ragControls.classList.remove('hidden');
                const cb = document.getElementById('rag-toggle');
                if (cb) cb.checked = StateManager.get('ragEnabled');
                const cc = document.getElementById('rag-chunk-count');
                if (cc) cc.textContent = chunks.length + ' chunks indexed';
            }
            updateRagIndicator(false);
        } else {
            emptyState.classList.remove('hidden');
            loadedState.classList.toggle('loaded', false);
            StateManager.set('ragChunks', []);
            StateManager._ragIndex = null;
            if (ragControls) ragControls.classList.add('hidden');
            updateRagIndicator(false);
        }
    }

    function updateSessionStats() {
        const history = StateManager.get('conversationHistory');
        const countEl = document.getElementById('msg-count');
        if (countEl) countEl.innerText = history.filter(m => m.role !== 'system').length;
    }

    function scrollToBottom() {
        const el = document.getElementById('terminal-output');
        if (el) el.scrollTop = el.scrollHeight;
        StateManager.set('userScrolledAway', false);
    }

    function toggleVault() {
        const modal = document.getElementById('vault-modal');
        if (modal) modal.classList.toggle('hidden');
        playSound('toggle');
    }

    function updateTokenFlow(tokensPerSec, totalTokens, elapsed) {
        const el = document.getElementById('token-flow');
        if (!el) return;
        if (tokensPerSec == null) {
            el.style.opacity = '0';
            setTimeout(() => { el.innerHTML = ''; }, 250);
            return;
        }
        el.style.opacity = '1';
        el.innerHTML = '<span class="text-[10px] font-mono font-bold tracking-wider" style="color:var(--green-1)">\u25B8 '
            + tokensPerSec.toFixed(0) + ' t/s  \u00B7 ' + (totalTokens || 0).toLocaleString() + ' tok  \u00B7 '
            + elapsed.toFixed(1) + 's</span>';
    }

    function exportHistoryJSON() {
        const data = {
            conversationHistory: StateManager.get('conversationHistory'),
            ragEnabled:          StateManager.get('ragEnabled'),
            ragChunks:           StateManager.get('ragChunks'),
            refDoc:              StateManager.get('refDoc'),
        };

        const hasHistory = data.conversationHistory && data.conversationHistory.length > 0;
        if (!hasHistory && !data.refDoc) {
            showToast('warning', 'Nothing to export yet. (No chat history or reference document)');
            return;
        }

        try {
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `freeai_history_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('success', 'Chat history exported successfully as JSON.');
        } catch (e) {
            showToast('error', 'Export failed: ' + e.message);
        }
    }

    function importHistoryJSON(file) {
        if (!file) {
            showToast('warning', 'No file selected for import.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.conversationHistory && Array.isArray(parsed.conversationHistory)) {
                    StateManager.set('conversationHistory', parsed.conversationHistory);
                    StateManager.set('ragEnabled', parsed.ragEnabled === true);
                    StateManager.set('ragChunks', parsed.ragChunks || []);
                    StateManager.set('refDoc', parsed.refDoc || null);
                    DomLayer.renderConversation(); // Re-render chat
                    DomLayer.updateDocUI(); // Update RAG doc UI
                    DomLayer.showToast('success', 'Chat history imported successfully.');
                } else {
                    throw new Error('Invalid JSON structure. Missing conversationHistory array.');
                }
            } catch (e) {
                DomLayer.showToast('error', 'Import failed: ' + e.message);
            }
        };
        reader.readAsText(file);
    }

    function exportChat() {
        const history = StateManager.get('conversationHistory');
        if (history.length <= 1) { showToast('warning', 'Nothing to export yet.'); return; }
        let md = '# War Chest Command Center — Conversation Export\n\n';
        for (const msg of history) {
            if (msg.role === 'system') continue;
            if (typeof msg.content === 'string') {
                const role = msg.role === 'user' ? '**You**' : '**AI**';
                md += `### ${role}\n${msg.content}\n\n`;
            } else if (Array.isArray(msg.content)) {
                md += '### **You**\n';
                for (const p of msg.content) {
                    if (p.type === 'text') md += `${p.text}\n`;
                    if (p.type === 'image_url') md += `_[Image attached]_\n`;
                }
                md += '\n';
            }
        }
        try {
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `war-chest-${new Date().toISOString().slice(0, 10)}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('success', 'Conversation exported as .md');
        } catch (e) {
            showToast('error', 'Export failed: ' + e.message);
        }
    }

    function updateRagIndicator(active) {
        const el = document.getElementById('rag-indicator');
        if (!el) return;
        const hasDoc = StateManager.get('refDoc');
        if (!hasDoc) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.classList.toggle('active', active);
    }

    const VOICE_PROFILES = {
        'default': { name: 'System Default', rate: 1.0, pitch: 1.0, volume: 0.8, hint: null },
        'narrator': { name: 'The Narrator', rate: 0.85, pitch: 0.85, volume: 0.9, hint: 'Daniel' },
        'speedrunner': { name: 'Speedrunner', rate: 1.8, pitch: 1.1, volume: 0.8, hint: null },
        'demon': { name: 'Possessed', rate: 0.7, pitch: 0.3, volume: 0.85, hint: null },
        'chipmunk': { name: 'Chipmunk', rate: 1.6, pitch: 2.0, volume: 0.7, hint: null },
        'robot': { name: 'The Machine', rate: 0.9, pitch: 0.75, volume: 0.8, hint: 'Zarvox' },
        'whisper': { name: 'Whisper', rate: 0.7, pitch: 1.0, volume: 0.25, hint: null },
        'theatre': { name: 'Theatre Kid', rate: 0.95, pitch: 1.2, volume: 0.9, hint: 'Samantha' },
    };

    function _resolveVoice(hint) {
        if (!hint || !window.speechSynthesis) return null;
        const voices = speechSynthesis.getVoices();
        const match = voices.find(v => v.name.toLowerCase().includes(hint.toLowerCase()));
        if (match) return match;
        for (const v of voices) {
            if (v.lang.startsWith('en') && v.localService === true && v.name.toLowerCase().includes(hint.toLowerCase())) return v;
        }
        return null;
    }

    function speakResponse(text, onEnd) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const profileId = StateManager.get('voiceProfile') || 'default';
        const profile = VOICE_PROFILES[profileId] || VOICE_PROFILES['default'];
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = profile.rate;
        utterance.pitch = profile.pitch;
        utterance.volume = profile.volume;
        if (profile.hint) {
            const voice = _resolveVoice(profile.hint);
            if (voice) utterance.voice = voice;
        }
        utterance.onstart = () => {
            AvatarEngine.startSpeaking();
            const btn = document.getElementById('stop-speak-btn');
            if (btn) btn.classList.remove('hidden');
        };
        utterance.onend = () => { AvatarEngine.stopSpeaking(); hideStopSpeak(); if (onEnd) onEnd(); };
        utterance.onerror = () => { AvatarEngine.stopSpeaking(); hideStopSpeak(); if (onEnd) onEnd(); };
        speechSynthesis.speak(utterance);
    }

    function hideStopSpeak() {
        const btn = document.getElementById('stop-speak-btn');
        if (btn) btn.classList.add('hidden');
    }

    function getVoiceProfiles() { return VOICE_PROFILES; }

    function renderSystemCard(analysis) {
        const terminal = document.getElementById('terminal-output');
        const card = document.createElement('div');
        card.style.cssText = 'border-top:1px solid rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.04);padding:6px 0;margin:8px 0;font-size:10px;color:var(--text-tertiary);font-family:var(--font-mono);opacity:0.85;white-space:normal;';
        if (analysis.recommendation) {
            card.innerHTML = '<span style="color:var(--text-secondary)">// ' + escapeHtml(analysis.recommendation) + '</span>';
        }
        if (analysis.unresolved_questions && analysis.unresolved_questions.length) {
            card.innerHTML += '<div style="margin-top:3px">Unresolved: ' + analysis.unresolved_questions.slice(0, 2).map(q =>
                '<span class="unresolved-q" style="color:var(--amber-dim);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px" data-q="' + escapeHtml(q) + '">' + escapeHtml(q) + '</span>'
            ).join(' &middot; ') + '</div>';
            setTimeout(() => {
                card.querySelectorAll('.unresolved-q').forEach(el => {
                    el.onclick = () => {
                        const input = document.getElementById('terminal-input');
                        if (input) { input.value = el.dataset.q; input.focus(); }
                    };
                });
            }, 0);
        }
        terminal.appendChild(card);
        terminal.scrollTop = terminal.scrollHeight;
    }

    function annotateResponse(container, assessments) {
        const mdEl = container.element.querySelector('.markdown-body');
        if (!mdEl || !assessments.length) return;

        const text = mdEl.textContent;
        const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
        if (sentences.length === 0) return;

        let annotated = '<div class="annotated-response">';
        for (let i = 0; i < sentences.length; i++) {
            const a = assessments.find(x => x.sentence_index === i);
            const trimmed = sentences[i].trim();
            if (!trimmed) continue;
            if (a && a.confidence === 'low') {
                annotated += '<span class="shadow-low" title="' + escapeHtml(a.concern || '') + '">' + trimmed + '</span> ';
            } else if (a && a.confidence === 'medium') {
                annotated += '<span class="shadow-medium" title="' + escapeHtml(a.concern || '') + '">' + trimmed + '</span> ';
            } else if (a && a.confidence === 'high') {
                annotated += '<span class="shadow-high" title="Verified">' + trimmed + '</span> ';
            } else {
                annotated += trimmed + ' ';
            }
        }
        annotated += '</div>';
        mdEl.innerHTML = annotated;
    }

    function renderDeltaComparison(responses, errors, question) {
        const terminal = document.getElementById('terminal-output');
        const container = document.createElement('div');
        container.className = 'delta-comparison';
        container.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin:12px 0;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'grid-column:1/-1;padding:4px 8px;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;';
        const total = responses.length + (errors || []).length;
        hdr.innerHTML = '<span class="text-green-500 text-xs font-bold">DELTA MODE</span><span class="text-[10px]" style="color:var(--text-tertiary)">' + responses.length + '/' + total + ' · system prompt only · no history</span>';
        container.appendChild(hdr);

        for (const r of responses) {
            const panel = document.createElement('div');
            panel.className = 'glass-panel rounded p-3';
            panel.style.cssText = 'background:rgba(10,10,10,0.8);border:1px solid var(--border-subtle);';
            const mdContent = typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined'
                ? DOMPurify.sanitize(marked.parse(r.text || ''))
                : '<pre style="white-space:pre-wrap;font-size:11px">' + escapeHtml(r.text || '') + '</pre>';
            panel.innerHTML = '<div class="flex justify-between items-center mb-1"><span class="text-xs font-bold" style="color:var(--green-1)">' + escapeHtml(r.model) + '</span><span class="text-[10px]" style="color:var(--text-tertiary)">' + r.time + 'ms</span></div>' +
                '<div class="text-xs markdown-body" style="color:var(--text-secondary);max-height:300px;overflow-y:auto;">' + mdContent + '</div>';
            container.appendChild(panel);
        }

        if (errors && errors.length) {
            for (const e of errors) {
                const panel = document.createElement('div');
                panel.className = 'glass-panel rounded p-3';
                panel.style.cssText = 'background:rgba(10,10,10,0.8);border:1px solid rgba(255,180,71,0.2);';
                panel.innerHTML = '<div class="flex justify-between items-center mb-1"><span class="text-xs font-bold" style="color:var(--amber)">' + escapeHtml(e.model) + '</span><span class="text-[10px]" style="color:var(--amber-dim)">' + escapeHtml(e.provider) + '</span></div>' +
                    '<div class="text-[10px]" style="color:var(--amber-dim);max-height:120px;overflow-y:auto;">' + escapeHtml(e.error || 'Unknown error') + '</div>';
                container.appendChild(panel);
            }
        }

        terminal.appendChild(container);
        terminal.scrollTop = terminal.scrollHeight;
    }

    let _graphSim = null;

    function renderKnowledgeGraph(graph) {
        const wrapper = document.getElementById('kg-rail-wrapper');
        if (wrapper) {
            wrapper.classList.toggle('kg-hidden', !graph || !graph.entities.length);
        }

        const rail = document.getElementById('knowledge-graph-canvas');
        const countEl = document.getElementById('kg-rail-count');
        if (!rail) return;

        rail.innerHTML = '';

        if (!graph || !graph.entities.length) {
            rail.innerHTML = '<span style="font-size:9px;color:var(--text-tertiary);font-family:var(--font-mono);opacity:0.5">Entities appear as you chat...</span>';
            if (countEl) countEl.textContent = '';
            return;
        }

        const typeColors = {
            concept:  '#00ff41',
            person:   '#ffb347',
            decision: '#4ade80',
            question: '#ff4444'
        };

        if (countEl) countEl.textContent = `${graph.entities.length} entity${graph.entities.length !== 1 ? 'ies' : 'y'}`;

        const sorted = [...graph.entities].sort((a, b) => (b.count || 1) - (a.count || 1));

        sorted.forEach(entity => {
            const color = typeColors[entity.type] || '#888888';

            const chip = document.createElement('div');
            chip.title = `${entity.type} · mentioned ${entity.count || 1}×`;

            chip.style.cssText = `
                flex-shrink: 0;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 20px;
                padding: 3px 10px 3px 7px;
                font-size: 10px;
                font-family: var(--font-mono);
                color: var(--text-secondary);
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
                user-select: none;
            `;

            chip.innerHTML = `
                <span style="
                    width:6px;height:6px;border-radius:50%;
                    background:${color};
                    flex-shrink:0;
                    box-shadow:0 0 4px ${color}66;
                "></span>
                ${entity.name}
                <span style="
                    font-size:8px;
                    color:var(--text-tertiary);
                    background:rgba(0,0,0,0.3);
                    border-radius:8px;
                    padding:1px 4px;
                    margin-left:1px;
                ">${entity.count || 1}</span>
            `;

            chip.addEventListener('mouseenter', () => {
                chip.style.borderColor = color + '55';
                chip.style.background = color + '0D';
                chip.style.color = color;
            });
            chip.addEventListener('mouseleave', () => {
                if (!chip.classList.contains('kg-selected')) {
                    chip.style.borderColor = 'rgba(255,255,255,0.08)';
                    chip.style.background = 'rgba(255,255,255,0.04)';
                    chip.style.color = 'var(--text-secondary)';
                }
            });

            chip.addEventListener('click', () => {
                const wasSelected = chip.classList.contains('kg-selected');
                rail.querySelectorAll('.kg-selected').forEach(c => {
                    c.classList.remove('kg-selected');
                    c.style.borderColor = 'rgba(255,255,255,0.08)';
                    c.style.background = 'rgba(255,255,255,0.04)';
                    c.style.color = 'var(--text-secondary)';
                });
                if (!wasSelected) {
                    chip.classList.add('kg-selected');
                    chip.style.borderColor = color + '88';
                    chip.style.background = color + '14';
                    chip.style.color = color;
                    _showEntityRelationships(entity, graph, color);
                } else {
                    _hideEntityRelationships();
                }
            });

            rail.appendChild(chip);
        });

        if (_graphSim) { cancelAnimationFrame(_graphSim); _graphSim = null; }
    }

    function _showEntityRelationships(entity, graph, color) {
        _hideEntityRelationships();

        const rels = (graph.relationships || []).filter(
            r => r.from === entity.name || r.to === entity.name
        );
        if (!rels.length) return;

        const wrapper = document.getElementById('kg-rail-wrapper');
        if (!wrapper) return;

        const tooltip = document.createElement('div');
        tooltip.id = 'kg-rel-tooltip';
        tooltip.style.cssText = `
            margin-top: 6px;
            padding: 6px 10px;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 6px;
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        `;

        rels.forEach(r => {
            const chip = document.createElement('span');
            chip.style.cssText = `
                font-size: 9px;
                font-family: var(--font-mono);
                color: var(--text-tertiary);
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 20px;
                padding: 2px 8px;
                white-space: nowrap;
            `;
            const fromColor = r.from === entity.name ? color : 'var(--amber)';
            const toColor   = r.to   === entity.name ? color : 'var(--amber)';
            chip.innerHTML = `<span style="color:${fromColor}">${r.from}</span> <span style="opacity:0.4">→</span> <span style="opacity:0.5;font-size:8px">${r.label||''}</span> <span style="opacity:0.4">→</span> <span style="color:${toColor}">${r.to}</span>`;
            tooltip.appendChild(chip);
        });

        wrapper.appendChild(tooltip);
    }

    function _hideEntityRelationships() {
        const old = document.getElementById('kg-rel-tooltip');
        if (old) old.remove();
    }

    function renderSessionTimeline() {
        const sessions = StateManager.get('sessionHistory') || [];
        const el = document.getElementById('session-timeline');
        if (!el) return;
        if (!sessions.length) { el.innerHTML = '<div class="text-[10px]" style="color:var(--text-tertiary)">No past sessions</div>'; return; }
        let html = '';
        const recent = sessions.slice(-10).reverse();
        for (const s of recent) {
            const date = new Date(s.started).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const summary = s.summary || (s.messages && s.messages.length ? s.messages.length + ' messages' : 'empty');
            html += '<div class="session-timeline-item" style="border-left:2px solid var(--green-4);padding-left:8px;margin-bottom:6px;font-size:10px">' +
                '<span style="color:var(--green-1)">' + date + '</span> ' +
                '<span style="color:var(--text-tertiary)">' + escapeHtml(summary.slice(0, 60)) + '</span>' +
                '</div>';
        }
        el.innerHTML = html;
    }

    function stopSpeaking() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        AvatarEngine.stopSpeaking();
        hideStopSpeak();
    }

    return {
        updateTerminalStatus, showInfoInStatus, updateSendStopButtons, updateContextMeter,
        updateActiveModelBar, showToast, renderModelList, updateModelProfile, getModelItem,
        addUserMessage, createResponseContainer, updateStreamText, finalizeResponse: finalizeResponseDOM,
        updateTimestamp, updateLatency, showError, renderToolCallCard,
        archiveMessages, addHorizonBanner, displayImages, showImageLightbox, downloadImage,
        updatePromptCharCount, updateDocUI, updateSessionStats, scrollToBottom, toggleVault,
        renderConversation, showAttachmentPreview, removeAttachmentPreview, showVisionSuggestion, hideVisionSuggestion, syncFleetSelection,
        updateTokenFlow, exportChat, exportHistoryJSON, importHistoryJSON, updateRagIndicator, speakResponse, stopSpeaking,
        renderSystemCard, annotateResponse, renderDeltaComparison, renderKnowledgeGraph, renderSessionTimeline, getVoiceProfiles,
    };
})();
