# War Chest Command Center v3.0

Multi-model LLM chat interface with **ambient intelligence**. No build step, no dependencies — open `index.html` in any browser.

![War Chest](https://img.shields.io/badge/status-active-00ff41?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-00ff41?style=flat-square)
![Stack](https://img.shields.io/badge/vanilla-js-00ff41?style=flat-square)

## Features

- **43 models** across Groq, OpenRouter, Google, and NVIDIA
- **Streaming responses** with typewriter cursor and markdown rendering
- **TF-IDF RAG** — sentence-aware chunking on reference documents
- **Pixel-art avatar** — 32x32 sprite engine with blink/mouth animation
- **Audio cues** — Web Audio API chiptune oscillator (pentatonic arpeggio per response)
- **Vision support** — image attachments on compatible models
- **Function calling** — local tools (time, math, web search, UI state)
- **Auto failover** — walks provider chain if one is unavailable
- **Context meter** — live token usage bar in header
- **System prompt editor** + per-session reference docs
- **Export/import** chat history as JSON
- **Persistent state** — model selection, API keys, sessions survive refresh

### Ambient Intelligence (v3.0)

| Feature | Description |
|---------|-------------|
| **Temporal Cognition** | Session timeline sidebar. Past sessions color-coded and summarized. System prompt auto-injects user session context. Ctrl+L to close a session — it persists for later recall. |
| **Model Personality Delta** | Toggle Delta Mode to fan a query out to 4 diverse models simultaneously (fast, deep-reasoning, creative, and your current). Responses render side-by-side in a comparison grid. |
| **Ambient Session Intelligence** | A "session watcher" runs every 4 messages in the background, looking for contradictions, unresolved questions, and drift. It surfaces non-intrusive `// Notice:` cards with clickable follow-ups. |
| **Knowledge Graph** | Entity extraction runs on each response. A canvas-based force-directed graph accumulates per session in the right sidebar — nodes color-coded by type (concept, person, decision, question). |
| **Adversarial Shadow Model** | A second, cheap model silently audits every response. Sentences get green (agreed), amber (uncertain), or red (disputed) underlines. Hover to see the shadow's concern. |

## Providers

| Provider | Models | Auth |
|----------|--------|------|
| Groq | 8 | API key |
| OpenRouter | 19 | API key |
| Google | 3 | API key |
| NVIDIA | 13 | API key |

## Getting Started

1. Open `index.html` in a browser
2. Click **API Keys & Vault** in the left sidebar
3. Enter your API keys (or click **.env** to load from a `.env` file)
4. Select a model from the fleet panel
5. Start chatting

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | Newline in input |
| `Escape` | Stop streaming / close modals / cancel voice input |
| `Ctrl+L` | Clear chat + end current session |
| `Ctrl+Shift+C` | Copy last AI response to clipboard |

## API Keys

Create a `.env` file in the project root:

```
GROQ_API_KEY=gsk_your_key_here
GEMINI_API_KEY=AIza_your_key_here
NVIDIA_API_KEY=nvapi-your-key-here
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Load it via the vault's **.env** button. Keys are stored in `localStorage` only — never sent to any server except the provider APIs.

## Architecture

```
index.html       — HTML + CSS + entry point
models.js        — Fleet data (43 models) and constants
rag.js           — TF-IDF chunking (sentence-aware), indexing, retrieval
icons.js         — Inline SVG icon definitions
sound.js         — Web Audio API chiptune oscillator
avatar.js        — Pixel-art sprite engine (32x32)
utils.js         — Utilities (debounce, token estimation, safeEval, etc.)
state.js         — Centralized state with pub/sub, streaming counter, token cache,
                   session schema v2, knowledge graph store
dom.js           — All DOM rendering: chat, model list, context meter, streaming output,
                   delta comparison grid, system cards, shadow annotations, knowledge graph canvas
tools.js         — Local tool functions (time, math, web search, UI state)
api.js           — Network layer — OpenAI-compatible SSE + Google streamGenerateContent,
                   auto failover across providers
app.js           — Orchestrator: sendMessage, delta queries, ambient watcher, shadow audit,
                   entity extraction, event wiring, voice input, init
```

### Data Flow

```
User Input -> app.js (sendMessage)
  -> state.js (recompileSystemMessage, pushMessage)
  -> api.js (callProvider — streaming SSE)
    -> dom.js (updateStreamText on each token)
  -> app.js (finalizeResponse)
    -> state.js (pushMessage, saveConversation)
    -> app.js (shadow audit, entity extraction, ambient watcher)
      -> dom.js (annotations, system cards, knowledge graph)
```

### Storage Schema

Sessions are stored in `localStorage` under `war_chest_history` as versioned JSON:

```json
{
  "version": 2,
  "currentSessionId": "uuid",
  "sessions": [{
    "id": "uuid",
    "started": 1234567890,
    "ended": 1234567900,
    "summary": "User worked on deployment config",
    "topics": ["kubernetes", "CI/CD"],
    "messages": [...]
  }]
}
```

v1 flat arrays auto-migrate on first load. The session timeline in the left sidebar shows the last 10 sessions.

### Reactive State

`StateManager.subscribe()` fires DOM updates automatically on state changes:

| State Key | DOM Reaction |
|-----------|-------------|
| `selectedModel` | Update active model bar, context meter, model profile, terminal status |
| `conversationHistory` | Update context meter, session stats |
| `isStreaming` | Show/hide Send/Stop buttons |

No manual `DomLayer.updateX()` calls scattered through business logic. Adding a new feature with UI reactions is one `subscribe()` call away.

### Streaming Counter

`isStreaming` is controlled by a `streamingCount` counter (not a boolean). `StateManager.incrementStreaming()` / `decrementStreaming()` enable parallel model fan-out in Delta Mode without race conditions on the Stop button.

## Performance

| Optimization | Impact |
|-------------|--------|
| Provider validation: 4 parallel fetches (was 40+ sequential) | ~8s → ~1s startup |
| Token estimate cache (invalidated only on push) | 0-cost context meter during streaming |
| Model item Map cache | O(1) lookup on model switch |
| Debounced localStorage writes (800ms) | Single write per tool-loop, not 10 |
| `contain: content` on terminal output | Layout boundary prevents cascade recalc |
| Sentence-aware chunking | Semantic RAG without missing context mid-sentence |

## Requirements

- Internet connection (CDN deps: Tailwind CSS, JetBrains Mono, marked.js, DOMPurify)
- A modern browser (Chrome, Firefox, Safari, Edge)

## License

MIT
