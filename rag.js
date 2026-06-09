// TF-IDF document chunking & retrieval for RAG

function chunkDocument(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [], chunkSize = 200;
    let current = [], wordCount = 0;
    for (const s of sentences) {
        const words = s.split(/\s+/).filter(Boolean).length;
        if (wordCount + words > chunkSize && current.length) {
            chunks.push({ index: chunks.length, text: current.join(' ') });
            current = []; wordCount = 0;
        }
        current.push(s.trim()); wordCount += words;
    }
    if (current.length) chunks.push({ index: chunks.length, text: current.join(' ') });
    return chunks;
}

function buildRagIndex(chunks) {
    const index = {};
    for (const chunk of chunks) {
        const words = chunk.text.toLowerCase().split(/\W+/).filter(Boolean);
        for (const word of words) {
            if (!index[word]) index[word] = {};
            if (!index[word][chunk.index]) index[word][chunk.index] = 0;
            index[word][chunk.index]++;
        }
    }
    return index;
}

function retrieveChunks(query, chunks, index) {
    const qWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    if (!qWords.length || !chunks.length) return [];
    const N = chunks.length;
    const scores = chunks.map(() => 0);
    for (const qw of qWords) {
        if (!index[qw]) continue;
        const df = Object.keys(index[qw]).length;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        for (const ci in index[qw]) {
            const tf = 1 + Math.log(1 + index[qw][ci]);
            scores[parseInt(ci)] += tf * idf;
        }
    }
    const indexed = chunks.map((c, i) => ({ index: i, score: scores[i] })).filter(x => x.score > 0);
    indexed.sort((a, b) => b.score - a.score);
    return indexed.slice(0, 3).map(x => chunks[x.index]);
}
