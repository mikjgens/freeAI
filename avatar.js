// Avatar Engine — pixel-art sprite strip (IIFE, dirty-state)

const AvatarEngine = (() => {
    const canvas = document.getElementById('ai-face');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const face = [
        "    X      X    ", "    X XXXX X    ", "     XXXXXX     ", "    XXXXXXXX    ",
        "  XX  XX  XX  X ", " X   XX  XX   X ", " X  XXXXXXXX  X ", " X  X      X  X ",
        " X  XXXXXXXX  X ", "  XX        XX  ", "   XXXXXXXXXX   ", "                ",
        "                ", "                ", "                ", "                "
    ];
    const FW = 16, FH = 16, BG = '#050505', FG = '#00ff41', DY = 3;
    const strip = document.createElement('canvas');
    strip.width = FW * 4;
    strip.height = FH;
    const sCtx = strip.getContext('2d');
    sCtx.imageSmoothingEnabled = false;
    function drawBase(c, ox, oy) {
        c.fillStyle = BG; c.fillRect(ox, oy, FW, FH);
        c.fillStyle = FG;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { if (face[y][x] === 'X') c.fillRect(ox + x, oy + y + DY, 1, 1); }
    }
    drawBase(sCtx, 0, 0);
    drawBase(sCtx, 16, 0);
    sCtx.fillStyle = BG; sCtx.fillRect(16 + 3, 8 + DY, 10, 1);
    sCtx.fillStyle = FG; sCtx.fillRect(16 + 3, 9 + DY, 10, 1);
    drawBase(sCtx, 32, 0);
    sCtx.fillStyle = BG; sCtx.fillRect(32 + 5, 5 + DY, 2, 1); sCtx.fillRect(32 + 9, 5 + DY, 2, 1);
    drawBase(sCtx, 48, 0);
    sCtx.fillStyle = BG; sCtx.fillRect(48 + 3, 8 + DY, 10, 1);
    sCtx.fillStyle = FG; sCtx.fillRect(48 + 3, 9 + DY, 10, 1);
    sCtx.fillStyle = BG; sCtx.fillRect(48 + 5, 5 + DY, 2, 1); sCtx.fillRect(48 + 9, 5 + DY, 2, 1);
    let state = { speaking: false, blinkFrame: 0, lastMouthOpen: false, needsRedraw: true };
    let animId = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function render() {
        if (reducedMotion) return;
        if (state.blinkFrame > 0) { state.blinkFrame--; state.needsRedraw = true; }
        else if (Math.random() < 0.01) { state.blinkFrame = 6; state.needsRedraw = true; }
        const mouthOpen = state.speaking && Math.floor(Date.now() / 100) % 2 === 0;
        if (mouthOpen !== state.lastMouthOpen) { state.lastMouthOpen = mouthOpen; state.needsRedraw = true; }
        if (state.needsRedraw) {
            const blink = state.blinkFrame > 0;
            let fi = 0;
            if (blink && mouthOpen) fi = 3; else if (blink) fi = 2; else if (mouthOpen) fi = 1;
            ctx.drawImage(strip, fi * FW, 0, FW, FH, 0, 0, 32, 32);
            state.needsRedraw = false;
        }
        animId = requestAnimationFrame(render);
    }
    return {
        init: () => {
            if (reducedMotion) { ctx.fillStyle = BG; ctx.fillRect(0, 0, 32, 32); ctx.drawImage(strip, 0, 0, FW, FH, 0, 0, 32, 32); return; }
            if (!animId) animId = requestAnimationFrame(render);
        },
        startSpeaking: () => { state.speaking = true; state.needsRedraw = true; },
        stopSpeaking: () => { state.speaking = false; state.needsRedraw = true; }
    };
})();
