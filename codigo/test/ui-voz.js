// Voz natural: con cuenta simulada y audio PCM simulado; y vuelta a la voz del móvil si la nube falla
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.addInitScript(() => {
    window.__log = [];
    class U { constructor(t) { this.text = t; this.pitch = 1; } }
    window.SpeechSynthesisUtterance = U;
    Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, paused: false, getVoices: () => [], addEventListener() {}, cancel() {}, resume() {}, speak(u) { window.__log.push('móvil: ' + u.text); setTimeout(() => u.onend && u.onend(), 30); } } });
    const AC = window.AudioContext; window.AudioContext = class extends AC { createBufferSource() { const s = super.createBufferSource(); const st = s.start.bind(s); s.start = (t) => { window.__log.push('nube: ' + s.buffer.duration.toFixed(2) + ' s'); st(t); }; return s; } };
  });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1000);
  await pg.evaluate(() => {
    const real = window.Cloud; let falla = false; window.__falla = (v) => { falla = v; };
    // 0,3 s de PCM a 24 kHz
    const n = 7200, bytes = new Uint8Array(n * 2); for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i / 10) * 8000) & 0xffff; bytes[2 * i] = v & 255; bytes[2 * i + 1] = v >> 8; }
    const pcm = btoa(String.fromCharCode(...bytes));
    // El mismo audio en WAV (lo que devuelve el modelo actual)
    const hdr = new DataView(new ArrayBuffer(44)); const w = (o, t) => [...t].forEach((c, i) => hdr.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); hdr.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); hdr.setUint32(16, 16, true); hdr.setUint16(20, 1, true); hdr.setUint16(22, 1, true); hdr.setUint32(24, 24000, true); hdr.setUint32(28, 48000, true); hdr.setUint16(32, 2, true); hdr.setUint16(34, 16, true); w(36, 'data'); hdr.setUint32(40, n * 2, true);
    const wav = btoa(String.fromCharCode(...new Uint8Array(hdr.buffer), ...bytes));
    let usaWav = false; window.__wav = (v) => { usaWav = v; };
    window.Cloud = new Proxy(real, { get: (t, k) => k === 'user' ? { id: 'u', email: 'x@y' } : k === 'voz' ? async () => { if (falla) throw new Error('caída'); return usaWav ? { audio: wav, mime: 'audio/wav' } : { audio: pcm, rate: 24000 }; } : t[k] });
  });
  await pg.click('#btnMenu'); await pg.click('.menu-list >> text=Ajustes'); await pg.waitForTimeout(300);
  await pg.selectOption('#selvozn', 'Puck'); await pg.waitForTimeout(1200);
  await pg.evaluate(() => window.__wav(true));
  await pg.selectOption('#selvozn', 'Kore'); await pg.waitForTimeout(1200);
  await pg.evaluate(() => window.__falla(true));
  await pg.click('#chkvozn'); await pg.click('#chkvozn'); await pg.waitForTimeout(1500);
  console.log((await pg.evaluate(() => window.__log)).join('\n'));
  console.log('ERRORES', errs); await b.close();
})();
