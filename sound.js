// Sound System — DOS-style chiptune effects

let audioCtx;
function armAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('click', armAudio, { capture: true, once: true });
document.addEventListener('keydown', armAudio, { capture: true, once: true });

const PENTATONIC = [523, 587, 659, 784, 880, 1047];
function playSound(type, freqOverride) {
    try { if (StateManager.get('audioMuted')) return; } catch (e) {}
    if (!audioCtx || document.hidden) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    if (playSound._last && now - playSound._last < 0.04 && type === playSound._lastType) return;
    playSound._last = now;
    playSound._lastType = type;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    switch (type) {
        case 'click': osc.type = 'square'; osc.frequency.setValueAtTime(1000, now); gain.gain.setValueAtTime(0.03, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035); osc.start(now); osc.stop(now + 0.035); break;
        case 'type': osc.type = 'square'; osc.frequency.setValueAtTime(freqOverride || 800 + Math.random() * 600, now); gain.gain.setValueAtTime(0.02, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025); osc.start(now); osc.stop(now + 0.025); break;
        case 'keyclick': osc.type = 'sine'; osc.frequency.setValueAtTime(freqOverride || 660, now); gain.gain.setValueAtTime(0.008, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015); osc.start(now); osc.stop(now + 0.015); break;
        case 'start': osc.type = 'square'; osc.frequency.setValueAtTime(523, now); osc.frequency.setValueAtTime(659, now + 0.07); gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18); osc.start(now); osc.stop(now + 0.18); break;
        case 'done': osc.type = 'square'; osc.frequency.setValueAtTime(784, now); osc.frequency.setValueAtTime(659, now + 0.09); osc.frequency.setValueAtTime(523, now + 0.18); gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32); osc.start(now); osc.stop(now + 0.32); break;
        case 'error': osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, now); osc.frequency.linearRampToValueAtTime(80, now + 0.3); gain.gain.setValueAtTime(0.07, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3); osc.start(now); osc.stop(now + 0.3); break;
        case 'poweron': osc.type = 'square'; osc.frequency.setValueAtTime(262, now); osc.frequency.setValueAtTime(330, now + 0.09); osc.frequency.setValueAtTime(392, now + 0.18); osc.frequency.setValueAtTime(523, now + 0.27); gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4); osc.start(now); osc.stop(now + 0.4); break;
        case 'select': osc.type = 'square'; osc.frequency.setValueAtTime(660, now); gain.gain.setValueAtTime(0.04, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05); osc.start(now); osc.stop(now + 0.05); break;
        case 'toggle': osc.type = 'square'; osc.frequency.setValueAtTime(440, now); osc.frequency.setValueAtTime(880, now + 0.05); gain.gain.setValueAtTime(0.03, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1); osc.start(now); osc.stop(now + 0.1); break;
        case 'stop': osc.type = 'square'; osc.frequency.setValueAtTime(200, now); osc.frequency.linearRampToValueAtTime(500, now + 0.08); gain.gain.setValueAtTime(0.04, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12); osc.start(now); osc.stop(now + 0.12); break;
        case 'deploy': osc.type = 'square'; osc.frequency.setValueAtTime(523, now); osc.frequency.setValueAtTime(784, now + 0.08); gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18); osc.start(now); osc.stop(now + 0.18); break;
        case 'wipe': osc.type = 'square'; osc.frequency.setValueAtTime(300, now); osc.frequency.linearRampToValueAtTime(100, now + 0.35); gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35); osc.start(now); osc.stop(now + 0.35); break;
    }
}
