// Model fleet data and configuration constants

const models = [
    { provider: 'groq', color: '🟢', name: 'Qwen3 32B', desc: 'Primary Fallback — 60 RPM', ctx: '131K', tools: 'Function Calling', modelId: 'qwen/qwen3-32b', type: 'chat', tags: ['balanced', 'coding', 'fast'], weakness: 'lower reasoning depth vs 70B+ models' },
    { provider: 'groq', color: '🟢', name: 'Llama 4 Scout', desc: 'Vision — 20MB Images', ctx: '131K', tools: 'Function Calling', modelId: 'meta-llama/llama-4-scout-17b-16e-instruct', type: 'chat', vision: true, tags: ['vision', 'multimodal', 'image-understanding'], weakness: 'no audio/video input' },
    { provider: 'groq', color: '🟢', name: 'GROQ Compound', desc: '70K TPM — No TPD Cap', ctx: '131K', tools: 'Built-in Tools', builtInTools: ['web_search', 'code_execution', 'browser_automation'], modelId: 'groq/compound', type: 'chat', tags: ['agentic', 'web-search', 'code-exec', 'browser-automation'], weakness: 'tool calls incur extra cost' },
    { provider: 'groq', color: '🟢', name: 'Llama 3.3 70B', desc: 'Smartest — 280 t/s', ctx: '131K', tools: 'Function Calling', modelId: 'llama-3.3-70b-versatile', type: 'chat', tags: ['reasoning', 'smartest', 'fast-inference'], weakness: 'not multimodal' },
    { provider: 'groq', color: '🟢', name: 'GROQ Compound Mini', desc: 'High-volume compression', ctx: '131K', tools: 'Built-in Tools', builtInTools: ['web_search'], modelId: 'groq/compound-mini', type: 'chat', tags: ['agentic', 'single-tool', 'low-latency'], weakness: 'single-tool only, less capable than full Compound' },
    { provider: 'groq', color: '🟢', name: 'GPT-OSS-120B', desc: 'Heavy coding, built-in tools', ctx: '131K', tools: 'Function Calling', builtInTools: ['web_search', 'browser_search'], modelId: 'openai/gpt-oss-120b', type: 'chat', tags: ['coding', 'open-weights', 'reasoning'], weakness: 'higher latency than 20B variant' },
    { provider: 'groq', color: '🟢', name: 'GPT-OSS-20B', desc: 'Speed layer — 1000+ t/s', ctx: '131K', tools: 'Function Calling', builtInTools: ['web_search', 'browser_search'], modelId: 'openai/gpt-oss-20b', type: 'chat', tags: ['speed', 'lightweight', 'high-throughput'], weakness: 'less capable on complex reasoning' },
    { provider: 'groq', color: '🟢', name: 'Llama 3.1 8B', desc: 'Volume — 500K TPD', ctx: '131K', tools: 'Function Calling', modelId: 'llama-3.1-8b-instant', type: 'chat', tags: ['high-volume', 'fastest', 'budget'], weakness: 'basic reasoning, small context depth' },
    { provider: 'openrouter', color: '🟠', name: 'Owl Alpha', desc: 'Smart Agent — 1M ctx', ctx: '1M', tools: 'Function Calling', modelId: 'openrouter/owl-alpha', type: 'chat', vision: true, tags: ['agentic', 'long-context', 'coding', 'tool-use'], weakness: 'slow speed (19th percentile), weak general knowledge' },
    { provider: 'openrouter', color: '🟠', name: 'Qwen3 Coder', desc: 'Best for Code — 1M ctx', ctx: '1M', tools: 'Function Calling', modelId: 'qwen/qwen3-coder:free', type: 'chat', tags: ['coding', 'long-context', 'excellent'], weakness: 'narrow focus — coding only' },
    { provider: 'openrouter', color: '🟠', name: 'Nemotron-3 Super', desc: 'Deep Logic — 1M ctx', ctx: '1M', tools: 'Function Calling', modelId: 'nvidia/nemotron-3-super-120b-a12b:free', type: 'chat', tags: ['reasoning', 'deep-logic', 'large-model'], weakness: 'free tier may have rate limits' },
    { provider: 'openrouter', color: '🟠', name: 'Gemma 4 31B', desc: 'Frontier Reasoning', ctx: '262K', tools: 'Function Calling', modelId: 'google/gemma-4-31b-it:free', type: 'chat', tags: ['reasoning', 'frontier', 'google'], weakness: 'free tier rate-limited' },
    { provider: 'openrouter', color: '🟠', name: 'Gemma 4 26B', desc: 'Efficient Vision MoE', ctx: '262K', tools: 'Function Calling', modelId: 'google/gemma-4-26b-a4b-it:free', type: 'chat', tags: ['efficient', 'vision', 'moe'], weakness: 'MoE may have unpredictable latency' },
    { provider: 'openrouter', color: '🟠', name: 'Kimi K2.6', desc: 'Agent Swarm — 100+ agents', ctx: '262K', tools: 'Function Calling', modelId: 'moonshotai/kimi-k2.6:free', type: 'chat', tags: ['agentic', 'multi-agent', 'swarm'], weakness: 'complex setup, overkill for simple Q&A' },
    { provider: 'openrouter', color: '🟠', name: 'Qwen3 Next 80B', desc: 'Fast — No thinking overhead', ctx: '262K', tools: 'Function Calling', modelId: 'qwen/qwen3-next-80b-a3b-instruct:free', type: 'chat', tags: ['fast', 'efficient', 'no-thinking-overhead'], weakness: 'less capable than full thinking models' },
    { provider: 'openrouter', color: '🟠', name: 'Laguna M1', desc: 'SWE Agent — Complex', ctx: '262K', tools: 'Function Calling', modelId: 'poolside/laguna-m.1:free', type: 'chat', tags: ['swe', 'coding', 'agentic'], weakness: 'narrow — software engineering only' },
    { provider: 'openrouter', color: '🟠', name: 'Laguna XS2', desc: 'SWE Agent — Lightweight', ctx: '262K', tools: 'Function Calling', modelId: 'poolside/laguna-xs.2:free', type: 'chat', tags: ['swe', 'lightweight', 'agentic'], weakness: 'less capable than M1 for complex tasks' },
    { provider: 'openrouter', color: '🟠', name: 'Nemotron Nano Omni', desc: 'Vision+Audio+Tools', ctx: '256K', tools: 'Function Calling', modelId: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', type: 'chat', vision: true, tags: ['multimodal', 'vision', 'audio', 'omnimodal'], weakness: 'novel model, ecosystem young' },
    { provider: 'openrouter', color: '🟠', name: 'Nemotron Nano 30B', desc: 'Open weights, privacy', ctx: '256K', tools: 'Function Calling', modelId: 'nvidia/nemotron-3-nano-30b-a3b:free', type: 'chat', tags: ['open-weights', 'privacy', 'efficient'], weakness: 'less capable than larger Nemotron models' },
    { provider: 'openrouter', color: '🟠', name: 'OpenRouter Free', desc: 'Smart router: auto-selects', ctx: '200K', tools: 'Function Calling', modelId: 'openrouter/free', type: 'chat', tags: ['router', 'auto-select', 'fallback'], weakness: 'no control over which model responds' },
    { provider: 'openrouter', color: '🟠', name: 'GPT-OSS-120B (OR)', desc: 'OpenAI open-weight', ctx: '131K', tools: 'Function Calling', modelId: 'openai/gpt-oss-120b:free', type: 'chat', tags: ['open-weights', 'coding', 'reasoning'], weakness: 'free tier — variable reliability' },
    { provider: 'openrouter', color: '🟠', name: 'Llama 3.3 70B (OR)', desc: 'Most widely deployed', ctx: '131K', tools: 'Function Calling', modelId: 'meta-llama/llama-3.3-70b-instruct:free', type: 'chat', tags: ['popular', 'well-tested', 'reasoning'], weakness: 'no multimodal support' },
    { provider: 'openrouter', color: '🟠', name: 'GPT-OSS-20B (OR)', desc: 'Fast — 21B MoE', ctx: '131K', tools: 'Function Calling', modelId: 'openai/gpt-oss-20b:free', type: 'chat', tags: ['fast', 'lightweight', 'moe'], weakness: 'less capable than 120B variant' },
    { provider: 'openrouter', color: '🟠', name: 'GLM 4.5 Air', desc: 'Hybrid thinking modes', ctx: '131K', tools: 'Function Calling', modelId: 'z-ai/glm-4.5-air:free', type: 'chat', tags: ['thinking-modes', 'hybrid', 'chinese'], weakness: 'English performance may lag behind specialized models' },
    { provider: 'openrouter', color: '🟠', name: 'Liquid LFM 1.2B Think', desc: 'Edge-device reasoning', ctx: '32K', tools: 'None', modelId: 'liquid/lfm-2.5-1.2b-thinking:free', type: 'chat', tags: ['edge', 'small', 'reasoning'], weakness: 'tiny context, limited capability' },
    { provider: 'openrouter', color: '🟠', name: 'Liquid LFM 1.2B Fast', desc: 'On-device, edge inference', ctx: '32K', tools: 'None', modelId: 'liquid/lfm-2.5-1.2b-instruct:free', type: 'chat', tags: ['edge', 'small', 'fast'], weakness: 'tiny context, limited capability' },
    { provider: 'openrouter', color: '🟠', name: 'Nemotron Nano 12B VL', desc: 'Vision+Docs model', ctx: '128K', tools: 'None', modelId: 'nvidia/nemotron-nano-12b-v2-vl:free', type: 'chat', vision: true, tags: ['vision', 'docs', 'ocr'], weakness: 'no tool support' },

];

const HARDCODED_TOOLS = [
    { type: 'function', function: { name: 'get_system_time', description: "Returns the user's local browser time, date, timezone, and Unix timestamp. No arguments needed.", parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'evaluate_math', description: 'Evaluates a mathematical expression safely. Use for arithmetic, percentages, and basic algebra. Pass a raw expression string.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'A math expression using +, -, *, /, %, parentheses, and decimals' } }, required: ['expression'] } } },
    { type: 'function', function: { name: 'get_ui_state', description: 'Returns the current terminal state: active model name and provider, token usage, context window usage, message count, and tool support level.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'web_search', description: 'Search the web for current information. Uses DuckDuckGo. Returns an abstract, related topics, and source URLs. Good for news, facts, and recent events.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query string' } }, required: ['query'] } } }
];

const PROVIDER_ENDPOINTS = {
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

const DEFAULT_MODEL = { provider: 'groq', modelId: 'llama-3.3-70b-versatile' };
const FALLBACK_CHAIN = [
    { provider: 'groq', modelId: 'llama-3.3-70b-versatile' },
    { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free' },
];

const MAX_HISTORY = 100;
const MAX_TOOL_ITERATIONS = 5;
const INPUT_MAX_HEIGHT = 350;
const STORAGE_KEY_HISTORY = 'war_chest_history';
const STORAGE_KEY_PROMPT = 'war_chest_prompt';
const STORAGE_KEY_REFDOC = 'war_chest_ref_doc';
const STORAGE_KEY_DRAFT = 'war_chest_draft';
const STORAGE_KEY_ACTIVE_MODEL = 'war_chest_active_model';
const SYSTEM_PROMPT = 'You are an elite tactical AI operating within the War Chest Command Center. Be concise, highly accurate, and structure outputs beautifully using markdown.';
