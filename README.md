# War Chest Command Center

Multi-model LLM chat interface for multiple AI providers. No build step, no dependencies — open `index.html` in any browser.

![War Chest](https://img.shields.io/badge/status-active-00ff41?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-00ff41?style=flat-square)
![Stack](https://img.shields.io/badge/vanilla-js-00ff41?style=flat-square)

## Features

- **43 models** across Groq, OpenRouter, Google, and NVIDIA
- **Streaming responses** with typewriter cursor and markdown rendering
- **TF-IDF RAG** — attach reference documents for context-grounded chat
- **Pixel-art avatar** — 32×32 sprite engine with blink/mouth animation
- **Audio cues** — Web Audio API chiptune oscillator (pentatonic arpeggio per response)
- **Vision support** — image attachments on compatible models
- **Function calling** — local tools (time, math, web search, UI state)
- **Auto failover** — walks provider chain if one is unavailable
- **Context meter** — live token usage bar in header
- **System prompt editor** + per-session reference docs
- **Export/import** chat history
- **Persistent state** — model selection, API keys, conversation history survive refresh

## Providers

| Provider | Models | Auth |
|----------|--------|------|
| Groq | 8 | API key |
| OpenRouter | 19 | API key |
| Google | 3 | API key |
| NVIDIA | 13 | API key |

## Getting Started

1. Open `index.html` in a browser
2. Click the **🔑 API Keys & Vault** button
3. Enter your API keys (or click **📂 .env** to load from a `.env` file)
4. Select a model from the fleet panel
5. Start chatting

## API Keys

Create a `.env` file in the project root:

```
GROQ_API_KEY=gsk_your_key_here
GEMINI_API_KEY=AIza_your_key_here
NVIDIA_API_KEY=nvapi-your-key-here
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Load it via the vault's **📂 .env** button. Keys are stored in `localStorage` only.

## Architecture

```
index.html       — HTML + CSS + entry point
models.js        — Fleet data (43 models) and constants
rag.js           — TF-IDF chunking, indexing, retrieval
sound.js         — Web Audio API chiptune oscillator
avatar.js        — Pixel-art sprite engine (32×32)
utils.js         — Utility functions
state.js         — Centralized state manager (localStorage)
dom.js           — DOM rendering, streaming output, modals
tools.js         — Local tool functions
api.js           — Network layer (OpenAI-compatible + Google)
app.js           — Orchestrator: send, select, wipe, voice, init
```

## Requirements

- Internet connection (CDN deps: Tailwind CSS, JetBrains Mono, marked.js, DOMPurify)
- A modern browser (Chrome, Firefox, Safari, Edge)

## License

MIT
