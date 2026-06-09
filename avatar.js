// Avatar Engine v2 — 16×16 procedural pixel-art character (IIFE, zero deps)
//
// Expression state machine: IDLE → LISTENING → THINKING → SPEAKING → IDLE (+ ERROR flash)
// 12fps logical frame-stepping driven by deltaTime inside a display-rate rAF.
// All art is generated procedurally (no images). Output canvas stays 32×32
// (sprite 16×16, scale 2) so `image-rendering: pixelated` does the rest.
//
// Public API (legacy-compatible):
//   init()                — start the engine (draws immediately at module load too)
//   startSpeaking()       — legacy alias → setExpression('speaking')
//   stopSpeaking()        — legacy alias → setExpression('idle')
//   setExpression(name)   — 'idle' | 'listening' | 'thinking' | 'speaking'
//   flashError()          — 700ms red-tint apologetic flicker, then back to idle
//   lookAt(clientX, clientY) — point the pupils at a screen coordinate
//   destroy()             — cancel rAF, remove all listeners

const AvatarEngine = (() => {
    'use strict';

    const canvas = document.getElementById('ai-face');
    const noop = () => {};
    if (!canvas) return { init: noop, destroy: noop, startSpeaking: noop, stopSpeaking: noop, setExpression: noop, flashError: noop, lookAt: noop };

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const SPR = 16;
    const OUT = canvas.width || 32;
    const SCALE = OUT / SPR;
    const BG  = '#050505';
    const FG  = '#00ff41';
    const DIM = '#00802a';
    const ERR = '#ff4444';

    const STEP_MS    = 1000 / 12;
    const BREATH_SEC = 3.5;
    const BLINK_MIN = 3, BLINK_MAX = 5;
    const SLEEP_AFTER_MS = 45000;
    const ERROR_SEC = 0.7;

    const BLINK_SEQ = ['half', 'closed', 'closed', 'half'];

    const buf = document.createElement('canvas');
    buf.width = SPR; buf.height = SPR;
    const g = buf.getContext('2d');
    g.imageSmoothingEnabled = false;

    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

    function compose(o) {
        const fg  = o.color || FG;
        const dim = o.color || DIM;
        g.fillStyle = BG; g.fillRect(0, 0, SPR, SPR);

        g.fillStyle = dim;
        g.fillRect(4, 1, 8, 1);
        g.fillRect(3, 2, 1, 1); g.fillRect(12, 2, 1, 1);
        g.fillRect(2, 3, 1, 9);
        g.fillRect(13, 3, 1, 9);
        g.fillRect(3, 12, 1, 1); g.fillRect(12, 12, 1, 1);
        g.fillRect(4, 13, 8, 1);

        g.fillStyle = fg;
        const px = clamp(o.pupilX | 0, -1, 1);
        const py = clamp(o.pupilY | 0, -1, 1);
        for (const ex of [4, 9]) {
            if (o.eye === 'closed') { g.fillRect(ex, 6, 3, 1); continue; }
            if (o.eye === 'half') {
                g.fillRect(ex, 5, 3, 2);
                g.fillStyle = BG; g.fillRect(ex + 1 + px, 6, 1, 1);
                g.fillStyle = fg;
                continue;
            }
            g.fillRect(ex, 4, 3, 3);
            g.fillStyle = BG; g.fillRect(ex + 1 + px, 5 + py, 1, 1);
            g.fillStyle = fg;
        }

        if (o.brows) { g.fillRect(4, 3, 3, 1); g.fillRect(9, 2, 3, 1); }

        switch (o.mouth) {
            case 0: g.fillRect(5, 11, 6, 1); break;
            case 1: g.fillRect(6, 10, 4, 3); g.fillStyle = BG; g.fillRect(7, 11, 2, 1); break;
            case 2: g.fillRect(5, 10, 6, 3); g.fillStyle = BG; g.fillRect(6, 11, 4, 1); break;
            case 3: g.fillRect(4, 10, 8, 3); g.fillStyle = BG; g.fillRect(5, 11, 6, 1); break;
            case 4: g.fillRect(5, 10, 1, 1); g.fillRect(10, 10, 1, 1); g.fillRect(6, 11, 4, 1); break;
            case 5: g.fillRect(4, 11, 2, 1); g.fillRect(7, 10, 2, 1); g.fillRect(10, 11, 2, 1); break;
        }
        g.fillStyle = fg;
    }

    function blit(bobY) {
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, OUT, OUT);
        ctx.drawImage(buf, 0, 0, SPR, SPR, 0, bobY * SCALE, SPR * SCALE, SPR * SCALE);
    }

    const S = {
        expr: 'idle',
        t: 0,
        breathT: 0,
        blinkIn: rand(BLINK_MIN, BLINK_MAX),
        blinkIdx: -1,
        mouth: 0,
        mouthHold: 0,
        pupilX: 0, pupilY: 0,
        gazeX: 0, gazeY: 0,
        gazeLocked: false,
        errorT: 0,
        cameFromSpeaking: false,
        sleeping: false,
        lastActivity: now(),
        lastHash: '',
    };

    let rafId = null;
    let lastT = 0, acc = 0;
    let destroyed = false;
    let reduced = false;

    function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
    function rand(a, b) { return a + Math.random() * (b - a); }

    function step(dt) {
        S.t += dt;
        S.breathT = (S.breathT + dt) % BREATH_SEC;

        if (S.errorT > 0) S.errorT -= dt;

        if (S.blinkIdx >= 0) {
            S.blinkIdx++;
            if (S.blinkIdx >= BLINK_SEQ.length) {
                S.blinkIdx = -1;
                const slow = S.expr === 'listening' ? 1.5 : 1;
                S.blinkIn = rand(BLINK_MIN, BLINK_MAX) * slow;
            }
        } else if (S.expr !== 'thinking' && S.errorT <= 0) {
            S.blinkIn -= dt;
            if (S.blinkIn <= 0) S.blinkIdx = 0;
        }

        if (S.errorT > 0) {
            S.mouth = 5;
        } else if (S.expr === 'speaking') {
            if (--S.mouthHold <= 0) {
                const shapes = [1, 2, 2, 3, 3, 0];
                let next = S.mouth;
                while (next === S.mouth) next = shapes[(Math.random() * shapes.length) | 0];
                S.mouth = next;
                S.mouthHold = 1 + ((Math.random() * 2) | 0);
            }
        } else if (S.expr === 'thinking') {
            S.mouth = 0;
        } else {
            S.mouth = (S.expr === 'idle' && S.t < 1.2 && S.cameFromSpeaking) ? 4 : 0;
        }

        if (S.expr === 'thinking') {
            S.gazeX = (Math.floor(S.t / 0.8) % 2) ? -1 : 1;
            S.gazeY = -1;
        }
        S.pupilX = S.gazeX; S.pupilY = S.gazeY;

        if (S.expr === 'idle' && now() - S.lastActivity > SLEEP_AFTER_MS) {
            S.sleeping = true;
            render();
            stopLoop();
            return;
        }

        render();
    }

    function render() {
        const bob = reduced ? 0 : Math.round(Math.sin((S.breathT / BREATH_SEC) * Math.PI * 2));
        let eye = 'open';
        if (S.sleeping) eye = 'half';
        else if (S.blinkIdx >= 0) eye = BLINK_SEQ[S.blinkIdx];

        const o = {
            eye,
            pupilX: S.sleeping ? 0 : S.pupilX,
            pupilY: S.sleeping ? 1 : S.pupilY,
            mouth: S.mouth,
            brows: S.expr === 'thinking' && S.errorT <= 0,
            color: S.errorT > 0 ? ERR : null,
        };
        const hash = [o.eye, o.pupilX, o.pupilY, o.mouth, o.brows, o.color, bob].join('|');
        if (hash === S.lastHash) return;
        S.lastHash = hash;
        compose(o);
        blit(bob);
    }

    function loop(t) {
        if (destroyed) return;
        rafId = requestAnimationFrame(loop);
        const dt = Math.min(t - lastT, 250);
        lastT = t;
        acc += dt;
        while (acc >= STEP_MS) {
            step(STEP_MS / 1000);
            acc -= STEP_MS;
            if (rafId === null) break;
        }
    }

    function startLoop() {
        if (rafId !== null || destroyed || reduced || document.hidden) return;
        lastT = now(); acc = 0;
        rafId = requestAnimationFrame(loop);
    }
    function stopLoop() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function wake() {
        S.lastActivity = now();
        if (S.sleeping) { S.sleeping = false; S.lastHash = ''; }
        startLoop();
    }

    function setExpression(name) {
        if (destroyed) return;
        const valid = { idle: 1, listening: 1, thinking: 1, speaking: 1 };
        if (!valid[name]) name = 'idle';
        if (name === S.expr) { wake(); return; }

        S.cameFromSpeaking = S.expr === 'speaking' && name === 'idle';
        S.expr = name;
        S.t = 0;
        S.mouthHold = 0;
        S.gazeLocked = name === 'listening' || name === 'thinking';

        if (name === 'listening') {
            const input = document.getElementById('terminal-input');
            if (input) {
                const a = canvas.getBoundingClientRect();
                const b = input.getBoundingClientRect();
                S.gazeX = Math.sign(Math.round((b.left + b.width / 2 - (a.left + a.width / 2)) / 80));
                S.gazeY = b.top > a.bottom ? 1 : b.bottom < a.top ? -1 : 0;
            } else { S.gazeX = 0; S.gazeY = 1; }
        } else if (name === 'idle' || name === 'speaking') {
            S.gazeX = 0; S.gazeY = 0;
        }
        wake();
        if (reduced) renderStatic();
    }

    function flashError() {
        if (destroyed) return;
        S.errorT = ERROR_SEC;
        wake();
        if (reduced) renderStatic();
    }

    function lookAt(clientX, clientY) {
        if (destroyed || S.gazeLocked) return;
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = clientX - cx, dy = clientY - cy;
        S.gazeX = Math.abs(dx) < 24 ? 0 : Math.sign(dx);
        S.gazeY = Math.abs(dy) < 24 ? 0 : Math.sign(dy);
        wake();
    }

    function renderStatic() {
        stopLoop();
        S.blinkIdx = -1; S.sleeping = false; S.lastHash = '';
        compose({
            eye: 'open',
            pupilX: S.expr === 'thinking' ? 1 : S.gazeX,
            pupilY: S.expr === 'thinking' ? -1 : S.gazeY,
            mouth: S.errorT > 0 ? 5 : (S.expr === 'speaking' ? 2 : 0),
            brows: S.expr === 'thinking',
            color: S.errorT > 0 ? ERR : null,
        });
        blit(0);
    }

    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reduced = !!(mq && mq.matches);

    function onMotionChange(e) {
        reduced = e.matches;
        if (reduced) renderStatic();
        else { S.lastHash = ''; wake(); }
    }
    function onVisibility() {
        if (document.hidden) stopLoop();
        else { S.lastHash = ''; wake(); }
    }
    let _mouseT = 0;
    function onMouseMove(e) {
        const t = now();
        if (t - _mouseT < 100) return;
        _mouseT = t;
        lookAt(e.clientX, e.clientY);
    }

    if (mq) {
        if (mq.addEventListener) mq.addEventListener('change', onMotionChange);
        else if (mq.addListener) mq.addListener(onMotionChange);
    }

    compose({ eye: 'open', pupilX: 0, pupilY: 0, mouth: 0, brows: false, color: null });
    blit(0);

    return {
        init() {
            if (destroyed) return;
            document.addEventListener('visibilitychange', onVisibility);
            window.addEventListener('mousemove', onMouseMove, { passive: true });
            if (reduced) renderStatic();
            else startLoop();
        },
        destroy() {
            destroyed = true;
            stopLoop();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('mousemove', onMouseMove);
            if (mq) {
                if (mq.removeEventListener) mq.removeEventListener('change', onMotionChange);
                else if (mq.removeListener) mq.removeListener(onMotionChange);
            }
        },
        setExpression,
        flashError,
        lookAt,
        startSpeaking() { setExpression('speaking'); },
        stopSpeaking()  { setExpression('idle'); },
    };
})();
