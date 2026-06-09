# freeAI — War Chest Command Center

Multi-file HTML + JS chat interface for Groq and OpenRouter (free tier). No build step, no dependencies.

## Usage

Open `index.html` in any browser. Requires internet (CDN deps: Tailwind CSS, JetBrains Mono, marked.js, DOMPurify).

The active model persists across page refreshes. On first visit, the fallback chain selects the best available model with a configured API key.

## Architecture

`index.html` contains `<style>`, HTML, and `<script>` with two helper files loaded before the main script: `models.js` (fleet data + constants) and `rag.js` (TF-IDF utilities). The JS is organized as IIFE modules loaded in dependency order:

| Module | Purpose |
|--------|---------|
| **Sound System** | Web Audio API chiptune oscillator — `playSound(type)` with throttle, mute, and lazy AudioContext init |
| **AvatarEngine** | 32×32 pixel-art sprite engine with dirty-state rAF loop, blink/mouth animation, `prefers-reduced-motion` support |
| **Utility Functions** | `safeEval`, `parseCtx`, `estimateTokens`, `escapeHtml`, `formatTimestamp`, `findModelItem`, `$()` shorthand |
| **RAG Utils** | Pure JS TF-IDF chunking, indexing, and retrieval on reference documents |
| **StateManager** | Centralized store with `get`/`set`/`subscribe`/`pushMessage`/`trimHistoryForModel`. All persistent state flows through this module. Uses `localStorage` with `war_chest_*` prefix. |
| **DomLayer** | All DOM creation and manipulation — rendering, toasts, modals, streaming output, context meter, tool call cards, export, TTS. Owns `marked.parse()` + `DOMPurify.sanitize()`. |
| **ToolExecutor** | Local tool functions (`get_system_time`, `evaluate_math`, `get_ui_state`, `web_search`) with blind-retry guard (aborts after 2 identical consecutive calls). |
| **ApiLayer** | Network layer — `streamOpenAI` (SSE for OpenAI-compatible endpoints), `callProvider` (dispatch with auto pre-stream failover). |
| **App** | Orchestrator — `sendMessage`, `selectModel`, `stopStreaming`, `wipeSystem`, `saveKeys`, voice input, regenerate, all event wiring, `init()`. |

## Providers

| Provider | Endpoint | Auth |
|----------|----------|------|
| Groq | `api.groq.com/openai/v1/chat/completions` | Bearer token |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | Bearer token |

Both use the OpenAI-compatible streaming API — no custom streaming path needed.

## Model Fleet (27 models)

- **Groq** (8) — 30 RPM, no CC required
- **OpenRouter** (19) — 20 RPM on `:free` endpoints

Models are filtered by provider and capability (Vision / Tools / Fast). Custom models can be added via `localStorage`.

## Key Behaviors

- **Model switching preserves history** — context-horizon banner and archiving for overflow; vision guard strips images on non-vision models
- **Context guard on send** — drops oldest non-system messages if estimated tokens exceed context window
- **Automatic provider failover** — pre-stream failures walk `FALLBACK_CHAIN` to next provider with configured key
- **Streaming typewriter cursor** — blinking `█` removed on completion, text rendered as markdown via `marked.parse()` + DOMPurify
- **Context meter** — live bar in header, color-coded green/yellow/red by usage percentage
- **Pentatonic arpeggio** — one note per 5 tokens during streaming (C5→C6), resets per response

## Data Persistence

All state in `localStorage` with `war_chest_*` prefix. Session-only: `war_chest_draft` (unsent input). No server-side storage.

**Wipe System** (🗑️) requires typing "DESTROY" and clears all localStorage keys plus sessionStorage draft.

## Design Decisions

- Zero build step — works from `file://` protocol
- All audio via Web Audio API oscillators — no audio files
- TF-IDF RAG on reference docs — no external vector DB
- Pixel-art avatar via offscreen canvas sprite strip — no image assets
