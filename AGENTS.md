# freeAI — War Chest Command Center

Single-file HTML chat interface for multiple LLM providers. No build step, no dependencies.

## Open to use

Open `index.html` in any browser. Requires internet (CDN deps: Tailwind CSS, JetBrains Mono, marked.js).

A model autoloads on startup (default: Groq Llama 3.3 70B, with fallback chain Groq→OpenRouter→Google→NVIDIA). The currently active model persists across page refreshes.

## Providers (each needs an API key)

| Provider   | Endpoint                                                    |
|------------|-------------------------------------------------------------|
| Groq       | `api.groq.com/openai/v1/chat/completions`                   |
| OpenRouter | `openrouter.ai/api/v1/chat/completions`                     |
| Google     | `generativelanguage.googleapis.com/v1beta/models/…`         |
| NVIDIA NIM | `integrate.api.nvidia.com/v1/chat/completions`              |

Keys are set via the **API Keys** (🔑) button and stored in `localStorage` under `war_chest_keys`.

## Data persistence

All state lives in browser `localStorage` with the `war_chest_*` prefix:
- `war_chest_keys` — API keys
- `war_chest_history` — conversation history (capped at 100 messages)
- `war_chest_prompt` — custom system prompt
- `war_chest_ref_doc` — uploaded reference document
- `war_chest_custom_models` — user-defined models
- `war_chest_validated` — model validation cache
- `war_chest_active_model` — currently selected model (survives page refresh)

Session-only state (survives refresh, not tab close):
- `war_chest_draft` — unsent input text

**Wipe System** (🗑️) requires typing "DESTROY" to confirm and clears all of the above. No server-side storage.

## Architecture

~1,740 lines in one file: `<style>`, HTML, and `<script>`. Five IIFE modules in dependency order:

| Module | Purpose |
|--------|---------|
| **StateManager** | Centralized store with `get`/`set`/`subscribe`/`pushMessage`/`trimHistoryForModel`/`recompileSystemMessage`/`setValidated`. All persistent state flows through this module. |
| **DomLayer** | All DOM creation and manipulation — `renderModelList`, `addUserMessage`, `createResponseContainer`, `updateStreamText`, `finalizeResponseDOM`, `archiveMessages`, `showError`, `renderToolCallCard`, `updateTerminalStatus`, `updateContextMeter`, `toggleVault`, `renderConversation`, `showAttachmentPreview`, `removeAttachmentPreview`, etc. Owns `marked.parse()`. |
| **ToolExecutor** | Local tool functions (`get_system_time`, `evaluate_math`, `get_ui_state`) with a blind-retry guard (aborts after 2 identical consecutive calls). |
| **ApiLayer** | Network layer — `streamOpenAI` (SSE parsing for OpenAI-compatible endpoints), `streamGoogle` (Google's `streamGenerateContent`), `callProvider` (dispatch entrypoint with automatic pre-stream failover through `FALLBACK_CHAIN`). |
| **App** | Orchestrator — `sendMessage`, `selectModel`, `stopStreaming`, `wipeSystem`, `saveKeys`, all event wiring, `init()`. |

Groq / OpenRouter / NVIDIA use the OpenAI-compatible streaming API (`streamOpenAI`). Google uses its own `streamGenerateContent` endpoint (`streamGoogle`). Model routing is provider-keyed via `PROVIDER_ENDPOINTS`.

## Key Behaviors

### Model Switching (history-preserving)
Switching models no longer resets the conversation. The system prompt is recompiled in-place. If the new model has a smaller context window, older messages are truncated from the `conversationHistory` array but kept in the DOM with a `msg-archived` CSS class (dimmed + grayscale). A `context-horizon` banner is inserted: `--- [ CONTEXT HORIZON: OLDER MESSAGES ARCHIVED ] ---`. If the new model lacks vision support, image content in history is automatically stripped to text.

### Context Guard on Send
Before sending a message, `sendMessage` checks if the total estimated tokens exceed the model's context window. If so, oldest non-system messages are dropped from the array and dimmed in the DOM.

### Automatic Provider Failover
If a provider call fails before the first token is streamed (e.g., 429 rate limit, 503 down), `callProvider` automatically walks the `FALLBACK_CHAIN` to find the next available provider with a configured API key. A notice is appended to the terminal: `[SYSTEM: GROQ FAILED → FALLBACK TO OPENROUTER]`. Failures mid-stream (after tokens received) show a manual retry button as before. If no API keys are configured at all, the fallback returns a clear message: `No API keys configured. Open API Keys & Vault to add your keys.`

### Streaming Typewriter Cursor
During streaming, AI output is rendered with HTML-escaped text + a blinking cursor `<span class="stream-cursor blink text-green-500">█</span>`. On completion, the cursor is removed and the text is rendered as markdown via `marked.parse()`.

Each 5th token triggers a pentatonic arpeggio note (C5→D5→E5→G5→A5→C6) instead of random noise — creating a subtle ascending melodic scale during streaming. The scale resets per response.

### Ambient Terminal Status Bar
The terminal header bar shows:
- **Idle**: `▼ [Model Name]` with a green pulsing dot
- **Streaming**: `▼ Receiving█` with a blinking cursor
- **Info events**: `▸ [message]` (auto-reverts after 4s, timer cancels on new state changes)
- **Errors**: `⚠ [message]` with a red pulsing dot

The old `TERMINAL_STANDBY` / `TERMINAL_STREAMING` text and the three animated dots have been removed. The "⚡ SYSTEM INITIALIZED" text is a permanent element in the terminal header.

### Info vs Toast Routing
- **Status bar**: system-level events (model switched, prompt applied, history trimmed, fallback activated, model validation)
- **Toasts**: user-facing actions and critical warnings (keys saved, file loaded, model removed, non-chat model warning, context guard warnings, wipe confirmation)

### Retro Pixel-Art Avatar Engine

The terminal header features a 32×32 pixel-art avatar rendered via `AvatarEngine` — an IIFE closure with dirty-state rendering. At init, a 4-frame sprite strip (idle, speaking mouth-open, blink, speaking+blink) is pre-rendered to an offscreen canvas and blitted in a single `ctx.drawImage()` call per frame. The engine:

- **Dirty-state loop** — only repaints when `needsRedraw` flips (speaking state, blink timer, mouth toggle), dropping idle CPU to near-zero
- **`ctx.imageSmoothingEnabled = false`** — guarantees crisp nearest-neighbor scaling from the 16×16 sprite strip to the 32×32 canvas
- **Honors `prefers-reduced-motion`** — renders a static idle frame once with no rAF loop
- **Clean API** — `AvatarEngine.init()`, `.startSpeaking()`, `.stopSpeaking()` — the chat logic calls these without knowing how the face renders

### Context Window Usage Meter
The terminal header bar includes a live context meter (right side, hidden on very small screens): model name + progress bar + percentage. Updated on model switch, response completion, conversation load, and page load. Color-coded: green <60%, yellow 60–80%, red >80%.

## UX/UI features

- **Model switching** — history preserved, context-horizon banner, vision guard, same-model check
- **Automatic provider failover** — pre-stream failures roll through fallback chain silently
- **Persistent active model** — survives page refresh
- **Default model autoload** — selects most stable model on first visit via `DEFAULT_MODEL` + `FALLBACK_CHAIN`
- **Typewriter streaming cursor** — blinking `█` at end of streaming text, removed on completion
- **Ambient status bar** — model name idle, "Receiving" during stream, info/error events with auto-revert timer
- **Context horizon** — archived older messages dimmed with separator banner
- **Toast notification layer** — reserved for user actions and critical alerts
- **Styled confirm modals** — model switch warns "History will be preserved"; Wipe System requires typed "DESTROY"
- **Scroll-to-bottom FAB** — appears when user scrolls up mid-stream
- **Per-message model label** — AI responses show which model replied (`AI [ModelName]:`)
- **Per-message latency** — response time appended to timestamp (`3:45 PM · 2.3s`)
- **Date-aware timestamps** — today → `3:45 PM`, yesterday → `Yesterday 3:45 PM`, older → date
- **Copy/delete on all messages** — hover any message for copy and delete buttons
- **Retry on error** — failed requests show a Retry button
- **Active model indicator** — current model shown in the input area header bar
- **Multi-line input** — auto-resizing textarea (Enter sends, Shift+Enter newlines)
- **Char count + draft auto-save** — unsent input saved to sessionStorage
- **.env file injection** — vault has a 📂 .env button that opens a native file picker; reads `KEY=VALUE` lines via `FileReader`, strips quotes/comments, feeds into `saveKeys()` for full state sync (localStorage + model validation). Works under `file://` protocol. macOS users press Cmd+Shift+. to reveal hidden dotfiles.
- **Provider filter buttons** — clicking All/Groq/OR/Google/NVIDIA filters the model fleet with active-state toggling
- **Show/hide API keys** — eye toggle on all password fields in the vault
- **Image validation** — explicit MIME type check (JPG/PNG/GIF/WebP only)
- **Page unload warning** — warns before closing tab with unsent input
- **Image generation badge** — shows "3 images generated" below galleries
- **Pixel-art avatar** — retro Gameboy-style face in terminal header, mouth animates during streaming, eyes blink randomly, rendered via single `drawImage()` per frame
- **Context window usage meter** — live bar + percentage in terminal header, color-coded by threshold
- **Pentatonic token arpeggio** — AI output streams with ascending melodic scale (C5→C6), one note per 5 tokens, resets per response
- **Keyclick arpeggio** — user keystrokes produce a pentatonic scale step (gain 0.012, 20ms), backspace plays a lower A4 note (440Hz)
- **Audio toggle** — header button swaps 🔊/🔇, persists mute state to localStorage, all playSound() gates through `audioMuted`

## Accessibility

- `role="region"` + `aria-label` on the 3 main panels
- `role="listbox"` / `role="option"` with `aria-selected` on the model fleet
- `role="dialog"` + `aria-modal` on modals with focus trapping
- `aria-live="polite"` on terminal and toast container
- `aria-hidden="true"` on decorative scanlines overlay
- `aria-label` on all buttons and interactive elements
- `prefers-reduced-motion` media query disables CRT flicker, scanlines, and animations

## Stabilization Audit (2026-06-04)

Ten patches applied to bulletproof the 5-Module IIFE baseline against race conditions, memory leaks, and network fragility:

### Critical
- **C1** — `App.selectModel()` now aborts active stream before switching (prevents state desync)
- **C2** — Tool-loop abort orphans `isStreaming`; now resets all stream state + shows error
- **C3** — `streamOpenAI`/`streamGoogle` get 15s per-chunk timeout via `Promise.race` + `finally`-guarded watchdog
- **C4** — `tryNext` fallback now calls `DomLayer.syncFleetSelection()` (no DOM in ApiLayer per separation rule)

### Warning
- **W1** — Wipe modal guards against accumulating keydown listeners via `_wipeHandlerAttached` flag
- **W2** — Scroll listener on `#terminal-output` now actually toggles `userScrolledAway` and the FAB
- **W3** — `_fallbackInProgress` guard prevents concurrent fallback recursion in `callProvider`

### Optimization
- **O1** — `stopStreaming()` resets `isStreaming`/`abortController`/avatar synchronously
- **O3** — `getUiState()` caches `estimateTokens()` to avoid O(n) calls per property

## UI Fixes (2026-06-04)

Three long-standing wiring gaps closed:

| # | Issue | Fix |
|---|-------|-----|
| **U1** | "API Keys & Vault" button (`#vault-btn`) in the left panel had no click handler — only the header 🔑 button worked | Added `document.getElementById('vault-btn').addEventListener('click', toggleVault)` in `init()` |
| **U2** | Fleet filter buttons (All/Groq/OR/Google/NVIDIA) were rendered with `data-filter` attributes but had no JavaScript — clicking them did nothing | Added event delegation on `#filter-bar` via `e.target.closest('[data-filter]')` — sets `currentFilter` in StateManager, updates active button styles, calls `renderModelList()` |
| **U3** | Dead `fleet-toggle` and `prompt-toggle` elements referenced in `init()` but never existed in the HTML — silently no-opped by `?.` | Removed both lines |

## `.env` Key Injection (2026-06-04)

Added one-time `.env` file loading at `index.html:1488-1529` via `App.loadEnvFile()` / `App.handleEnvFile()`:

- Uses `FileReader` to read the selected file — works under `file://` protocol
- Regex-backed parser: strips leading/trailing whitespace, removes surrounding `"` or `'` quotes, skips `#` comment lines and blanks
- Maps `GROQ_API_KEY` → `key-groq`, `OPENROUTER_API_KEY` → `key-openrouter`, `GOOGLE_API_KEY` → `key-google`, `NVIDIA_API_KEY` → `key-nvidia`
- Fills DOM inputs then calls `saveKeys()` for full state sync (localStorage persist, vault close, toast, model validation)
- File size guardrail: rejects files over 10KB
- Error handling: `try/catch` + `reader.onerror` → `DomLayer.showToast('error', ...)`

## Text Wrapping Fix (2026-06-04)

Long tool results and other content no longer cause horizontal overflow in the terminal. Two changes applied:

### CSS — `#terminal-output` wrapping (index.html:80)
Added `overflow-wrap: break-word; word-break: break-word; white-space: pre-wrap` on `#terminal-output`, with `white-space: normal` re-overrides on direct `.msg-container` children and `.markdown-body` descendants to prevent `<pre>` code blocks from inheriting wrapping (they keep `overflow-x: auto` / native `white-space: pre`).

### Tool result span — `whitespace-pre-wrap` (index.html:813)
The result `<span>` in `renderToolCallCard()` now has the `whitespace-pre-wrap` Tailwind class so multi-line tool output preserves newlines while long lines wrap. Previously the span had no wrapping behavior — long JSON or text results would overflow horizontally, forcing a scrollbar on `#terminal-output`.

## Model Fleet Audit (2026-06-04)

Purged 12 models from the fleet (56 → 44) to enforce two rules: purely free models only, chat/vision only.

### Removed (12)
| Model | Reason |
|---|---|
| Whisper v3 | Audio/STT |
| Whisper v3 Turbo | Audio/STT |
| GPT-OSS-Safeguard | Guard/safety, not for general chat |
| Prompt Guard 86M | Guard-only model |
| Prompt Guard 22M | Guard-only model |
| Gemini 2.5 Flash | Paid-only since April 1, 2026 |
| Gemini 2.5 Pro | Paid-only since April 1, 2026 |
| Gemini 2.5 Flash Audio | Audio, not chat |
| Gemini Nano Banana | Image gen, not chat |
| Gemini 3.1 Flash TTS | TTS/audio, not chat |
| Gemini 3.1 Flash Image | Image gen, not chat |
| Gemini Embedding 2 | Embedding, not chat |

## Input Morph Feature (2026-06-04)

Multi-line input now causes a smooth layout morph: when the user types past a single line, the textarea grows via CSS `transition: height 0.25s ease-out`, the `#chat-input-area` expands upward at the same rate (driven by flex content reflow), and the `#terminal-output` compresses proportionally (flex `1` sees less remaining space). On send, the collapse animates back.

### Implementation (4 changes, ~20 lines)

| # | What | Where | Detail |
|---|------|-------|--------|
| **C1** | CSS transitions | `<style>` block | `#terminal-input { transition: height 0.25s ease-out; }`, `#chat-input-area { transition: all 0.25s ease-out; }`, `.input-expanded { border-top-color ...; box-shadow ...; }` |
| **C2** | `handleInput` | App module | Raised cap from `200px` to `Math.min(35vh, 350)`. Toggles `.input-expanded` class on `#chat-input-area` when `nh > 40` (multi-line threshold). Height set in explicit px so transitions fire. |
| **C3** | `sendMessage` | App module | On send, reads `scrollHeight` (single-line after clearing), sets it as explicit px height — CSS transition morphs it down. Removes `.input-expanded` class. |
| **C4** | Seed px height in `init()` | App module | `document.getElementById('terminal-input').style.height = ...scrollHeight + 'px'` ensures first `handleInput` call has a numeric start point for the transition. |

### Behavior
- **Typing multi-line** → textarea grows, input area rises, terminal compresses (0.25s ease-out)
- **Send** → textarea collapses to single-line, input area drops, terminal re-expands (0.25s ease-out)
- **Max expansion** ~35% of viewport height (cap 350px), then textarea scrolls internally
- **Visual feedback** — subtle green glow on top border + box-shadow when `.input-expanded`
- **`prefers-reduced-motion`** — transitions disabled, no animation

### Providers after purge
| Provider | Models | Free tier |
|---|---|---|
| Groq | 8 | 30 RPM / 14,400 RPD, no CC |
| OpenRouter | 19 | 20 RPM / 50 RPD (`:free` endpoints) |
| Google | 3 | 10–30 RPM (Flash/Flash-Lite only) |
| NVIDIA | 14 | ~40 RPM, no CC |

## Build Audit & Hardening (2026-06-04)

A comprehensive code audit identified 17 issues across 4 categories. All 17 were fixed.

### Key Utility Functions Added

| Function | Location | Purpose |
|----------|----------|---------|
| `safeEval(expr)` | Utilities | Recursive-descent parser for math expressions — no `eval()` or `Function()` constructor. Handles `+`, `-`, `*`, `/`, `%`, `()`, decimals. |
| `findModelItem(modelId, provider)` | Utilities | Iterates `.model-item` NodeList comparing by `dataset.modelId`/`dataset.provider`. Replaces 6 unsafe CSS selector interpolations (prevents CSS injection). |
| `_buildUserMessageElement(text, attachment, onDelete)` | DomLayer | Shared helper that creates user message DOM (div + timestamp + copy + delete buttons). Used by both `addUserMessage` and `renderConversation`, eliminating ~30 lines of duplicated code. |

### New Module Constants

| Constant | Value | Used by |
|----------|-------|---------|
| `INPUT_MAX_HEIGHT` | `350` | `loadDraft`, `handleInput` (replaced hardcoded `200`/`350` disparity) |
| `FETCH_TIMEOUT` | `30000` | `streamOpenAI`, `streamGoogle` initial connection timeout |

### Retry Guard (E2) — `DomLayer.showError`
The Retry button now checks `StateManager.get('isStreaming')` before calling `App.sendMessage()`. Prevents double-stream race on rapid retry clicks.

### Attachment Lifecycle (E9) — `App.sendMessage`
`App.removeAttachment()` no longer fires synchronously before the stream starts. It's now called inside `onToken` on the first token received (guarded by `streamState.attachmentCleared` flag). If the request fails pre-stream (e.g., no API key), the attachment remains in `pendingAttachment` so the retry can include it.

### Fallback Separation (L4) — `ApiLayer.callProvider`
The `tryNext` function no longer imports `DomLayer`. All DOM operations are pushed to the App layer via two new callbacks:
- **`onFallback(fbModel, failedModel)`** — App creates the fallback notice element, calls `syncFleetSelection`, `updateActiveModelBar`, `updateTerminalStatus`
- **`onFallbackNotice(errMsg)`** — App calls `showInfoInStatus` with the error message

### Model Validation (L2) — `validateProviderModels`
Now uses provider-specific model-list endpoints instead of always hitting OpenRouter's:

| Provider | Validation Endpoint |
|----------|-------------------|
| Groq | `api.groq.com/openai/v1/models` |
| OpenRouter | `openrouter.ai/api/v1/models` |
| NVIDIA | `integrate.api.nvidia.com/v1/chat/completions` |
| Google | `generativelanguage.googleapis.com/v1beta/models?key=` |

Uses `findModelItem` instead of CSS selector injection for marking unverified models.

### Confirm Modal (E6) — `showConfirmModal`
Button selectors changed from fragile `id` attributes (`.ok-btn`, `.cancel-btn` class names) to prevent ID collisions. Overlay cleanup now nullifies the variable after `remove()` to ensure only one overlay exists at a time.

### Context Trim Unification (L3) — `App.selectModel`
The inline context-trimming loop was removed. `selectModel` now calls `StateManager.trimHistoryForModel(model.ctx, 2048)` — reusing the same function that `sendMessage` uses.

### Default Model Selection (R6) — `loadConversation`
Fallback chain: saved active model → `DEFAULT_MODEL` → first model whose provider has a configured API key → `allModels[0]`.

### File Stats
- `index.html` grew from ~1,738 to ~1,818 lines (net +80)
- JS parses clean via `new Function(script)` — no syntax errors

## Sonic System — MS-DOS Auditory Aesthetic (2026-06-04)

A Web Audio API oscillator-based sound engine generates chiptune-style effects inside the browser — no external audio files, zero dependencies. The `playSound(type)` function lives at `index.html:243-267` and is guarded by a visibility check (`document.hidden`), 40ms throttle, and lazy `AudioContext` init on first click/keydown.

### Sound Palette

| Sound | Type | Waveform | Frequencies | Duration | Character |
|-------|------|----------|-------------|----------|-----------|
| `click` | Cursor relay | square | 1000Hz | 35ms | crisp tactile blip |
| `keyclick` | User keystroke | sine | 660Hz (A4 on backspace) | 15ms | soft breath-like blip |
| `type` | Token keystroke | square | pentatonic scale step | 25ms | melodic typewriter click |
| `start` | Send/retry | square | 523→659Hz (ascending) | 180ms | launch chime |
| `done` | Response complete | square | 784→659→523Hz (descending) | 320ms | victory arpeggio |
| `error` | Failure | sawtooth | 200→80Hz (descending) | 300ms | low groan |
| `poweron` | Boot sequence | square | 262→330→392→523Hz (ascending) | 400ms | system power-up |
| `select` | Confirm/attach | square | 660Hz | 50ms | high blip |
| `toggle` | Toggle/reset | square | 440→880Hz (ascending) | 100ms | brief chirp |
| `stop` | Manual abort | square | 200→500Hz (rising) | 120ms | rising buzz |
| `deploy` | Config commit/tool exec | square | 523→784Hz (ascending) | 180ms | confirmation |
| `wipe` | System wipe | sawtooth | 300→100Hz (descending) | 350ms | power-down moan |

### Trigger Map

| Action | Sound | Location | Trigger Point |
|--------|-------|----------|---------------|
| Page boot (300ms delay) | `poweron` | `init()` line ~1806 | `setTimeout(() => playSound('poweron'), 300)` after `AvatarEngine.init()` |
| Send message | `click` + `start` | `sendMessage()` lines 1351, 1364 | Before user msg render, after input clear |
| Token every 5 chunks | `type` | `onToken` callback line 1385 | `streamState.tokenCount % 5 === 0` |
| User keystroke (printable) | `keyclick` | `handleKeyDown()` line 1705 | Uniform 660Hz sine tap, 50ms throttle |
| User backspace | `keyclick` (440Hz) | `handleKeyDown()` line 1705 | Lower A4 note, distinguishable |
| Audio toggle on/off | — | `audio-toggle-btn` click line ~1783 | Swaps 🔊/🔇, persists to localStorage |
| Response complete | `done` | `finalizeResponse()` line 1428 | Before latency/timestamp update |
| Manual stop | `stop` | `stopStreaming()` line 1462 | Before abort controller fires |
| Error with retry | `error` | `showError()` line 844 | Before DOM render |
| Model selected | `select` | `selectModel()` doSwitch line 1503 | After state save, before status update |
| Vault open/close | `toggle` | `toggleVault()` line 1056 | On modal class toggle |
| Apply prompt | `deploy` | `applySystemPrompt()` line 1590 | After state save |
| Reset prompt | `toggle` | `resetSystemPrompt()` line 1601 | After state save |
| Filter button click | `click` | Filter handler line 1788 | After `renderModelList()` |
| Image attached | `select` | `handleAttachment()` line 1724 | After preview shown |
| Attachment removed | `click` | `removeAttachment()` line 1728 | After DOM removal |
| .env file loaded | `deploy` | `handleEnvFile()` line 1561 | After `saveKeys()` |
| Wipe confirmed | `wipe` | `wipeSystem()` handler line 1641 | Before `StateManager.wipeAll()` |
| Provider fallback | `error` + `select` (80ms gap) | `onFallback` callback line 1408 | After notice appended to terminal |
| Tool execution card | `deploy` | `renderToolCallCard()` line 880 | After card appended to terminal |

### Design Principles
- **Always audible**, never annoying — volume caps (gain 0.02–0.07), short decays (<400ms), throttle prevents stacking
- **Narrative pairing** — `error + select` on fallback creates a "failure → recovery" sonic arc
- **No dependency on user gesture after first click** — `armAudio()` lazy-init capture-expires on first `click`/`keydown`
- **Honors `document.hidden`** — sounds cut instantly when tab backgrounded; resumes on focus
- **No layout overhead** — pure oscillator → gain → destination graph, ~6μs per call

## Comprehensive Build — Feature & Fix Pack (2026-06-04)

A feature-and-hardening pass adding 7 new user-visible features, 3 safety fixes, and a test suite.

### Safety Fixes

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| **S1** | XSS via `marked.parse()` rendered raw HTML from AI responses | `finalizeResponseDOM`, `renderConversation` | Added `DOMPurify` CDN (`purify.min.js`); all `marked.parse()` output wrapped in `DOMPurify.sanitize()` |
| **S2** | `_fallbackInProgress` reset before `attempt()` — race window allowed concurrent fallback chains | `callProvider()` | `_fallbackInProgress` now resets only in `onDone`/`onError` callbacks (via `resetFlag()`); never cleared before `attempt()` |
| **S3** | `.env` field map missing `GEMINI_API_KEY` — users with that variable name got no Google key injected | `handleEnvFile()` | Added `GEMINI_API_KEY:'key-google'` to field map alongside existing `GOOGLE_API_KEY` |

### New Features

| # | Feature | What | How |
|---|---------|------|-----|
| **F1** | Google function calling | Google models (Gemini 3.5 Flash, 3.1 Flash-Lite, 2.5 Flash-Lite) now send/receive tool calls | `streamGoogle()` converts OpenAI-format tools to Google `functionDeclarations`, handles `role: 'tool'` / `functionCall` message conversion, streams `functionCall` parts back as OpenAI-format `tool_calls` |
| **F2** | Web search tool | New `web_search` tool in `HARDCODED_TOOLS` | Uses DuckDuckGo Instant Answer API (`api.duckduckgo.com`) — no API key needed. Returns abstract, related topics, source URLs. `ToolExecutor.execute()` made async to support it |
| **F3** | Regenerate button | ↻ button on all AI response containers | `App.regenerateResponse()` removes last user+AI message pair from history/DOM, re-sends the user's original text. Guarded against streaming, image messages (requires re-attach), empty histories |
| **F4** | Capability filter pills | 👁 Vision / 🔧 Tools / ⚡ Fast buttons in filter bar | Stacks with provider filter. `StateManager` stores `capabilityFilters` array; `renderModelList()` filters by both provider and capabilities. Active state shown with green tint |
| **F5** | Streaming speed metrics | Live `▸ X t/s · Y tok · Z.Zs` in header `#token-flow` area | `setInterval` at 500ms in `startStream()`; `DomLayer.updateTokenFlow()` updates inline. Cleaned up in all exit paths. Final stats persist in header on completion |
| **F6** | Thinking indicator | Status bar shows `▸ Processing...` before first token | `sendMessage()` sets 'info' state instead of 'streaming'; `onToken` switches to streaming on first token. 8s timeout shows `⚠ Slow response — still waiting`; `slowWarning` cleaned up in all exit paths |
| **F7** | Image paste from clipboard | Pasting an image into the textarea attaches it | `handlePaste()` checks `clipboardData.items` for image MIME types, feeds into `handleAttachment()`. Wired in `init()` via `paste` event |

### UX Improvements

| # | Improvement | Detail |
|---|-------------|--------|
| **U1** | Keyboard shortcuts | `Esc` — stop stream / close vault / close confirm. `Ctrl/Cmd+L` — clear chat (wipes history+DOM, keeps keys/config). `Ctrl/Cmd+Shift+C` — copy last AI response text |
| **U2** | Model filter active styling | `.cap-filter-btn.active` CSS class with green glow, toggled on click with visual active/inactive state |
| **U3** | XSS-safe historical messages | `renderConversation()` now uses DOMPurify for `marked.parse()` output, same as live responses |

### Code Quality

| # | Change | Detail |
|---|--------|--------|
| **C1** | `$(id)` helper | Global `$('terminal-input')` shorthand for `document.getElementById()` added at Utilities section |
| **C2** | `ToolExecutor.execute()` made async | `web_search` uses `fetch()` which requires async; all callers updated (`handleToolCalls` now `async`, `onDone` chain uses `.catch()`) |
| **C3** | Slow-warning timer lifecycle | `streamState.slowWarning` created in `startStream()`, cleared in: `onToken` (first token), `onError`, `finalizeResponse`, `handleToolCalls` abort, `stopStreaming` — no dangling timers |

### Tests

New `test/index.html` — self-contained browser-based test runner. Covers:
- `parseCtx()` — K/M/infinity edge cases
- `safeEval()` — arithmetic, precedence, parens, decimals, unary, div-by-zero, syntax errors
- `estimateTokens()` — empty, string, image content, multi-message
- `parseApiError()` — known codes, unknown, JSON body parsing
- `escapeHtml()` — ampersand, angle brackets, quotes

Open `test/index.html` in any browser; results render on-screen.

## `peek()` Bug Fix — `0` falsy coercion (2026-06-04)

The `safeEval()` parser's `peek()` function used `return tokens[pos] || null`, which coerced the number `0` (falsy) to `null`. This made any expression involving a zero value fail with `"Expected number or ("` — the zero was invisible to the parser. Two tests were failing silently:

- **`safeEval — division by zero throws`** — `5 / 0` never reached the div-by-zero guard; `0` peeked as `null`, parser threw `"Expected number or ("`, catch handler returned `false` (wrong error message).
- **`escapeHtml — quotes preserved`** — test expected `&quot;` entities, but `innerHTML` serialization only escapes `&`, `<`, `>` in text content (per HTML spec). Quotes are safe unescaped.

### Fixes
| File | Line | Change |
|------|------|--------|
| `index.html` | 487 | `tokens[pos] \|\| null` → `pos < tokens.length ? tokens[pos] : null` |
| `test/index.html` | 76 | Same fix (test's copy of `safeEval`) |
| `test/index.html` | 178 | `'&quot;hello&quot;'` → `'"hello"'` (match innerHTML behavior) |

All 30 tests now pass (100%).

### File Stats
- `index.html` grew from ~1,818 to ~2,070 lines (net +252)
- `test/index.html` ~175 lines
- `AGENTS.md` grew from ~330 to ~430 lines
