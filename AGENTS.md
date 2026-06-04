# freeAI — War Chest Command Center

Single-file HTML chat interface for multiple LLM providers. No build step, no dependencies.

## Open to use

Open `free-ai-model-chat-v1.1.1.html` in any browser. Requires internet (CDN deps: Tailwind CSS, JetBrains Mono, marked.js).

## Providers (each needs an API key)

| Provider   | Endpoint                                                    |
|------------|-------------------------------------------------------------|
| Groq       | `api.groq.com/openai/v1/chat/completions`                   |
| OpenRouter | `openrouter.ai/api/v1/chat/completions`                     |
| Google     | `generativelanguage.googleapis.com/v1beta/models/…`         |
| NVIDIA NIM | `integrate.api.nvidia.com/v1/chat/completions`              |

Keys are set via the **Core Config** (⚙️) button and stored in `localStorage` under `war_chest_keys`.

## Data persistence

All state lives in browser `localStorage` with the `war_chest_*` prefix:
- `war_chest_keys` — API keys
- `war_chest_history` — conversation history (capped at 100 messages)
- `war_chest_prompt` — custom system prompt
- `war_chest_ref_doc` — uploaded reference document
- `war_chest_custom_models` — user-defined models
- `war_chest_validated` — model validation cache

**Wipe System** (🗑️) clears all of the above. No server-side storage.

## Architecture

- ~1300 lines in one file: `<style>`, HTML, and `<script>`.
- Model definitions are hardcoded in the JS `models` array (line ~553). Custom models can be added via the UI.
- Groq / OpenRouter / NVIDIA use the OpenAI-compatible streaming API (`streamOpenAI`). Google uses its own `streamGenerateContent` endpoint (`streamGoogle`).
- Model routing is provider-keyed via `PROVIDER_ENDPOINTS` (line 637).
- `callProvider` (line 918) is the dispatch entrypoint.
