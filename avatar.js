// Avatar Engine — pixel-art sprite strip (IIFE, dirty-state)

const AvatarEngine = (() => {
    const canvas = document.getElementById('ai-face');
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const SCALE = 4;
    const FACE_DATA = ["  X  X  "," X XXX X ","  XXXXXX "," XXXXXXX ","XX XX XX ","X XX XX X","X XXXX X","X X    X","X XXXX X"," XX   XX "," XXXXXX  ","         ","         ","         ","         ","         "];
    const FW = 8, FH = 8, BG = '#050505', FG = '#00ff41';
    const strip = document.createElement('canvas');
    strip.width = FW * 4;
    strip.height = FH;
    const sCtx = strip.getContext('2d');
    sCtx.imageSmoothingEnabled = false;
    function drawBase(c, ox, oy) {
        c.fillStyle = BG; c.fillRect(ox, oy, FW, FH);
        c.fillStyle = FG;
        for (let y = 0; y < FH; y++) {
            const row = FACE_DATA[y] || '';
            for (let x = 0; x < FW && x < row.length; x++) {
                if (row[x] === 'X') c.fillRect(ox + x, oy + y, 1, 1);
            }
        }
    }
    drawBase(sCtx, 0, 0);
    drawBase(sCtx, FW, 0);
    sCtx.fillStyle = BG; sCtx.fillRect(FW + 2, 5, 4, 1);
    sCtx.fillStyle = FG; sCtx.fillRect(FW + 2, 6, 4, 1);
    drawBase(sCtx, FW * 2, 0);
    sCtx.fillStyle = BG; sCtx.fillRect(FW * 2 + 2, 2, 2, 1); sCtx.fillRect(FW * 2 + 4, 2, 2, 1);
    drawBase(sCtx, FW * 3, 0);
    sCtx.fillStyle = BG; sCtx.fillRect(FW * 3 + 2, 5, 4, 1);
    sCtx.fillStyle = FG; sCtx.fillRect(FW * 3 + 2, 6, 4, 1);
    sCtx.fillStyle = BG; sCtx.fillRect(FW * 3 + 2, 2, 2, 1); sCtx.fillRect(FW * 3 + 4, 2, 2, 1);
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
            ctx.drawImage(strip, fi * FW, 0, FW, FH, 0, 0, FW * SCALE, FH * SCALE);
            state.needsRedraw = false;
        }
        animId = requestAnimationFrame(render);
    }
    return {
        init: () => {
            if (reducedMotion) { ctx.fillStyle = BG; ctx.fillRect(0, 0, FW * SCALE, FH * SCALE); ctx.drawImage(strip, 0, 0, FW, FH, 0, 0, FW * SCALE, FH * SCALE); return; }
            if (!animId) animId = requestAnimationFrame(render);
        },
        startSpeaking: () => { state.speaking = true; state.needsRedraw = true; },
        stopSpeaking: () => { state.speaking = false; state.needsRedraw = true; }
    };
})();
