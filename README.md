# freeAI

**28 free models. One file. No server. No build step. Ambient intelligence that audits itself.**

Open `index.html` in any browser and you're running a multi-model AI command center with a pixel-art avatar, chiptune sound design, and an adversarial shadow model that fact-checks every fourth response. The whole thing ships as vanilla JS. No `npm install`, no Docker, no SaaS login.

---

## Why I Built This

Here's the thing. AI chat UIs come in two flavors right now.

**Flavor one**: SaaS products that want your credit card before you've typed three messages. Monthly subscriptions, usage caps, dark patterns around model selection, your data shipped off to six analytics providers before the first token streams back.

**Flavor two**: Open-source wrappers that give you one model behind a chat box and call it a day. No context management, no fallback when the provider goes down, no awareness of what happened in your last three sessions. You're just talking to an API endpoint with a prettier `<textarea>`.

I wanted neither. I wanted a tool that feels like a tool — responsive, opinionated, aware of what I've been working on. Something that doesn't just relay tokens but actually watches the conversation for contradictions, surfaces questions I forgot I asked, and lets me compare four models side by side when I'm not sure which one to trust.

So I built it. The whole thing runs client-side. Your API keys stay in localStorage. The only requests leaving your browser are the ones you authorize to Groq and OpenRouter. That's it.

If you've got free-tier API keys from both providers, you're running 28 models without spending a dollar.

---

## What It Actually Does

You type a message. The model streams back markdown with a typewriter cursor. Behind the scenes, a pub/sub state manager keeps the UI reactive without scattering `DomLayer.updateX()` calls through business logic. Every state change — model switch, new message, stream start/stop — propagates to the DOM through a single subscribe queue.

But the surface-level stuff — chat, markdown, streaming — that's table stakes. Everyone has that. The interesting part is what happens *around* the conversation.

### The Ambient Intelligence Layer

This is the thing I haven't seen anywhere else. freeAI runs a background intelligence loop that fires after every fourth message (and a summarizer every sixth):

**Adversarial Shadow Model.** A second, cheap model silently audits the primary response. Every sentence gets classified: green (agreed), amber (uncertain), or red (disputed). The sentences render with colored underlines. Hover any underline to see what the shadow flagged. Sentence matching uses text-snippet prefix alignment so annotations stay correct even on markdown-heavy responses. This isn't a "confidence score" sitting in a sidebar — it's embedded directly in the text you're reading.

**Session Intelligence Watcher.** The same background loop scans the last ten messages for contradictions, unresolved questions, and topic drift. If it finds something, it surfaces a non-intrusive `// Notice:` card with clickable follow-ups. You don't have to remember what you asked three exchanges ago — the system does.

**Delta Mode.** Toggle one button and your next query fans out to four diverse models simultaneously: fast, deep-reasoning, creative, and your current model. Responses render side-by-side in a comparison grid. Same system prompt, same question, no conversation history — a clean A/B/C/D test. Staggered dispatch prevents rate-limit collisions.

**Knowledge Graph.** Entity extraction fires on every response. Local keyword extraction always runs (named entities, acronyms, quoted phrases) with expanded skip lists filtering 80+ noise words, 10 multi-word phrases, and 40+ common acronyms. When a cheap model is available — works with OpenRouter-only configs — sub-LLM enrichment adds entity types: concept, person, decision, question. Entities persist across refreshes, live in a chip rail above the composer, color-coded by type. Click any chip to see its relationships. The graph accumulates session over session.

**Temporal Cognition.** Every session persists with a timestamp and auto-generated summary (a cheap LLM call fires every 6 messages, writing a 1-sentence summary to `pendingSessionSummary`). The session timeline lives in the left sidebar — past sessions color-coded, summarized, clickable. The system prompt auto-injects context from your last three sessions so the model knows what you've been working on without you repeating yourself.

### The Fleet

28 models across two free-tier providers. Not 28 variations of the same thing — these span agentic models (Kimi K2.6, Owl Alpha, Laguna M1), reasoning models (Gemma 4 31B, Nemotron-3 Super), vision models (Llama 4 Scout, Nemotron Nano Omni), coding models (Qwen3 Coder, GPT-OSS-120B), and speed-layer models for the cheap stuff (Llama 3.1 8B, Liquid LFM).

Filter by provider, capability (vision, tools, fast), or free-text search. The fleet panel shows every model's context window, tool support, weakness, and provider — no hunting through docs to figure out what you've got available.

### The Details

- **TF-IDF RAG** with sentence-aware chunking. Drag a `.md` or `.txt` file into the reference doc panel, toggle RAG on, and relevant chunks auto-inject into the system prompt before every send. No vector database, no embedding API — just term frequency-inverse document frequency running in the browser.
- **Function calling** with four local tools: system time, safe math expression evaluation (recursive descent parser, no `eval()`), DuckDuckGo web search, and a UI state inspector.
- **Auto failover** with retry+backoff. If Groq returns a 429, the system parses the `Retry-After` header, waits, retries up to 3x, then falls through to OpenRouter on the fallback chain. On the next send, it auto-reverts to your preferred model.
- **Free-tier guardrails** baked in: TPM-aware history trimming for Groq's free tier (4K token budget before every send), base64 image data scrubbing after send to prevent localStorage bloat, background sub-call cancellation when a new message fires, session pruning at 20 sessions.
- **CRT phosphor aesthetic** with scanlines, flicker, green-on-black palette, and amber accent for warnings/errors. The whole thing looks like a terminal that fell through a time warp.
- **Procedural pixel-art avatar** — 16×16 sprite engine, five-state expression machine (idle, listening, thinking, speaking, error), breathing animation, blinking, pupil tracking that follows your cursor or the input field, 700ms red-tint error flash on API failures. All drawn on a `<canvas>` at 12fps with `image-rendering: pixelated`.
- **Web Audio API chiptune** — DOS-style oscillator effects. Pentatonic arpeggio on response completion. Square-wave key clicks. Sawtooth error sound. Power-on sequence on boot. Toggle mute or switch to eight voice profiles (narrator, speedrunner, chipmunk, possessed demon, theatre kid, etc.).
- **Voice input** via the Web Speech Recognition API with personality quips. Voice output via SpeechSynthesis with the same profile system.
- **Export/import** as JSON (full state: conversation, RAG config, reference doc) or Markdown (just the chat).
- **Persistent state** — model selection, API keys, system prompt, reference doc, knowledge graph, session history, audio preferences, voice profile, and unsent drafts all survive refresh.

---

## Getting Started

You need two free API keys. Both providers offer free tiers — no credit card required.

1. Get a [Groq API key](https://console.groq.com/keys) (free tier)
2. Get an [OpenRouter API key](https://openrouter.ai/keys) (free tier)
3. Clone the repo, open `index.html`
4. Click **API Keys & Vault** → paste both keys → **Commit Config**
5. Pick a model from the Fleet panel and start typing

Or create a `.env` file in the project root and load it through the vault's **.env** button:

```
GROQ_API_KEY=gsk_your_key_here
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Keys never leave your browser except to hit the provider APIs. Nothing phones home.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `Escape` | Kill audio → stop streaming → cancel voice → close modals |
| `Ctrl+L` | End session + clear chat |
| `Ctrl+Shift+C` | Copy last AI response |

---

## Architecture

```
index.html    — Entry point, CSS, 600 lines of phosphor-terminal design
app.js        — Orchestrator: send, delta queries, ambient watcher, shadow audit,
                entity extraction, voice input, event wiring, init (1,535 lines)
dom.js        — All DOM rendering: chat, model list, context meter, stream output,
                delta grid, system cards, shadow annotations, knowledge graph (1,009 lines)
state.js      — Centralized pub/sub store, streaming counter, token cache,
                session schema v2, knowledge graph store, pending summaries (237 lines)
api.js        — SSE streaming, failover chain, rate-limit retry, tool-call parsing (187 lines)
models.js     — Fleet data (28 models), constants, tool definitions (60 lines)
rag.js        — TF-IDF chunking, indexing, retrieval — sentence-aware (49 lines)
tools.js      — Local tool executor: time, math, web search, UI state (95 lines)
avatar.js     — Procedural pixel-art sprite engine — 16×16, 12fps, 5 expressions (333 lines)
sound.js      — Web Audio API chiptune oscillator, pentatonic arpeggio (39 lines)
icons.js      — Inline SVG icon definitions — 25 Heroicons outline (45 lines)
utils.js      — Token estimation, recursive descent math parser, debounce (126 lines)
```

Every file is plain JS. No transpiler, no bundler, no framework. The CSS lives in a single `<style>` block in `index.html` — 290 lines of custom properties and CRT-styled components on top of Tailwind's utility classes loaded from CDN.

### Data Flow

```
User Input → app.js (sendMessage)
  → state.js (recompileSystemMessage, pushMessage)
  → api.js (streaming SSE, auto-failover)
    → dom.js (updateStreamText per token)
  → app.js (finalizeResponse)
    → state.js (pushMessage, saveConversation)
    → app.js (shadow audit, entity extraction, ambient watcher)
      → dom.js (annotations, system cards, knowledge graph)
```

### Reactive State

`StateManager.subscribe()` fires DOM updates automatically. No manual update calls in business logic:

| Key | DOM Reaction |
|-----|-------------|
| `selectedModel` | Active model bar, context meter, model profile, terminal status |
| `conversationHistory` | Context meter, session stats, session timeline |
| `isStreaming` | Send/Stop button swap (zero layout shift) |

`isStreaming` uses a counter, not a boolean — `incrementStreaming()` / `decrementStreaming()` — so Delta Mode's parallel model fan-out doesn't race-condition the Stop button.

---

## Requirements

- A modern browser (Chrome, Firefox, Safari, Edge)
- Internet connection (CDN: Tailwind CSS, JetBrains Mono, marked.js, DOMPurify)
- Free API keys from Groq and/or OpenRouter

---

## License

MIT. Do whatever you want. If you build something cool with it, I'd like to see it.
