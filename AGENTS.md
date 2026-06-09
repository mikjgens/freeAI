# freeAI — War Chest Command Center

Multi-file HTML + JS chat interface for Groq and OpenRouter (free tier). No build step, no dependencies.

## Usage

Open `index.html` in any browser. Requires internet (CDN deps: Tailwind CSS, JetBrains Mono, marked.js, DOMPurify).

The active model persists across page refreshes. On first visit, the fallback chain selects the best available model with a configured API key.

## Architecture

12 separate JS files loaded by `index.html` in dependency order via `<script>` tags:

| File | Purpose |
|------|---------|
| **models.js** | Fleet data (28 models: 8 Groq + 20 OpenRouter), provider endpoints, fallback chain, tool definitions, storage key constants, system prompt |
| **rag.js** | Pure JS TF-IDF: `chunkDocument` (sentence-aware ~200 word chunks), `buildRagIndex` (inverted index), `retrieveChunks` (top-3 by TF-IDF score) |
| **icons.js** | 32 inline SVG icons (Heroicons outline style) — `icon(name, cls)` lookup function. Zero deps, no icon fonts. |
| **sound.js** | Web Audio API chiptune oscillator — `playSound(type, freqOverride?)` with 12 sound types, throttle (40ms), mute, and lazy AudioContext init |
| **avatar.js** | Procedural 16×16 pixel-art sprite engine (`AvatarEngine`) — 5-state expression machine (IDLE/LISTENING/THINKING/SPEAKING/ERROR), breath bob, blink sequence, pupil tracking, 12fps deltaTime step, reduced-motion live listener, sleep timeout, error flash, frame-hash dirty-checking. Public API: `init`/`destroy`/`setExpression`/`flashError`/`lookAt` plus legacy `startSpeaking`/`stopSpeaking` aliases. |
| **utils.js** | `safeEval` (recursive-descent math parser), `estimateTokens`, `parseCtx`, `escapeHtml`, `formatTimestamp`, `findModelItem`, `debounce`, `$()` shorthand |
| **state.js** | Centralized store (`StateManager`) — `get`/`set`/`subscribe`/`pushMessage`/`trimHistoryForModel`. Token cache invalidation, v2 session format, streaming counter (not boolean). All persistent state flows through this module. Uses `localStorage` with `war_chest_*` prefix. |
| **dom.js** | All DOM rendering (`DomLayer`) — model list, messages, streaming output, tool-call cards, context meter, delta comparison grid, system cards, shadow annotations, knowledge graph chips, TTS, export/import, toasts, modals. Owns `marked.parse()` + `DOMPurify.sanitize()`. |
| **tools.js** | Local tool executor (`ToolExecutor.execute`) — `get_system_time`, `evaluate_math`, `get_ui_state`, `web_search`. Blind-retry guard aborts after 2 identical consecutive calls. |
| **api.js** | Network layer — `streamOpenAI` (SSE for OpenAI-compatible endpoints, with 429/413 retry + backoff), `callProvider` (dispatch with auto pre-stream failover via `FALLBACK_CHAIN`) |
| **app.js** | Orchestrator — `sendMessage`, `selectModel`, `stopStreaming`, `wipeSystem`, `saveKeys`, delta mode, shadow audit, entity extraction, session watcher, session summarizer, voice input, regenerate, all event wiring, `init()`. Also contains `_resolveSubModel()` shared helper and `localEntityExtraction()` fallback. |

## Providers

| Provider | Endpoint | Auth |
|----------|----------|------|
| Groq | `api.groq.com/openai/v1/chat/completions` | Bearer token |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | Bearer token |

Both use the OpenAI-compatible streaming API — no custom streaming path needed.

## Model Fleet (28 models)

- **Groq** (8) — 30 RPM, no CC required
- **OpenRouter** (20) — 20 RPM on `:free` endpoints

Models are filtered by provider and capability (Vision / Tools / Fast). Custom models can be added via `localStorage`.

## Key Behaviors

- **Model switching preserves history** — context-horizon banner and archiving for overflow; vision guard strips images on non-vision models
- **Context guard on send** — drops oldest non-system messages if estimated tokens exceed context window
- **Automatic provider failover** — pre-stream failures walk `FALLBACK_CHAIN` to next provider with configured key
- **Streaming typewriter cursor** — blinking `█` removed on completion, text rendered as markdown via `marked.parse()` + DOMPurify
- **Context meter** — live bar in header, color-coded green/yellow/red by usage percentage
- **Pentatonic arpeggio** — one note per 5 tokens during streaming (C5→C6), resets per response
- **Delta Mode** — fan out query to 4 diverse models simultaneously, render side-by-side comparison grid
- **Adversarial Shadow Model** — cheap model silently audits every 4th response, sentence-level confidence highlighting
- **Session Intelligence** — watcher runs every 4 messages, checks for contradictions/unresolved questions/drift, renders non-intrusive notice cards
- **Knowledge Graph** — entity extraction on every response (local regex + sub-LLM enrichment), chip rail in composer toolbar, persists across refreshes
- **Session Summarization** — cheap LLM call fires every 6 messages, generates 1-sentence summary. Written to `pendingSessionSummary` in state, applied by `endSession()` when user clears chat. Injected into system prompt via `compiledPrompt()` for cross-session memory.
- **Cross-Session Memory** — `compiledPrompt()` injects the last 3 session summaries and pinned knowledge graph entities into the system prompt automatically.

## Ambient Intelligence Sub-Calls

All 4 ambient features share a single cheap-model resolver (`_resolveSubModel()`) that picks the best available fast/free model. Prompts are token-optimized with short field names and conservative context windows (8-10 messages, 200 chars each).

| Feature | Trigger | Context Window | Output Schema |
|---------|---------|----------------|---------------|
| **Session Watcher** | Every 4 messages | 8 msgs × 200 chars | `{"contradictions":[],"questions":[],"drift":false,"rec":""}` |
| **Shadow Audit** | Every 4 messages | question(300) + answer(1500) | `[{"i":0,"s":"first 30 chars","c":"high","f":null}]` |
| **Session Summary** | Every 6 messages | 10 msgs × 200 chars | `{"summary":"one sentence for context memory"}` |
| **Knowledge Graph** | Every response | user(300) + AI(1000) | `{"entities":[{"n":"Name","t":"type"}],"rels":[{"f":"from","to":"to","l":"label"}]}` |

Shadow audit scores are mapped from short fields (`i`,`s`,`c`,`f`) to long form (`sentence_index`,`text_snippet`,`confidence`,`concern`) before `annotateResponse()` applies them. Sentence matching uses text-snippet prefix matching first, falling back to sentence index.

Local entity extraction (`localEntityExtraction()`) runs synchronously as a fallback. Its skip lists filter 80+ common words, 10 multi-word phrases, and 40+ common acronyms to reduce noise in the knowledge graph.

## Data Persistence

All state in `localStorage` with `war_chest_*` prefix. Session-only: `war_chest_draft` (unsent input). No server-side storage.

**Wipe System** requires typing "DESTROY" and clears all localStorage keys plus sessionStorage draft.

## Design Decisions

- Zero build step — works from `file://` protocol
- All audio via Web Audio API oscillators — no audio files
- TF-IDF RAG on reference docs — no external vector DB
- Pixel-art avatar via procedural layer composition (head shell + eyes + pupils + mouth + brows + tint) — no image assets
- 32 inline SVG icons in `icons.js` — no icon fonts or icon CDN
- Streaming counter (`streamingCount`, not boolean) enables parallel model fan-out in Delta Mode without Stop-button race conditions
