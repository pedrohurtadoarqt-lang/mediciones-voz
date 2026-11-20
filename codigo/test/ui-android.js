// Simula un Android cuya síntesis de voz NO avisa del final (sin onend) y comprueba que el micro se reabre solo
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  await pg.addInitScript(() => {
    window.__ev = [];
    const synth = { speaking: false, pending: false, paused: false, _q: [],
      speak(u) { this._q.push(u); this.pending = true; setTimeout(() => { this.pending = false; this.speaking = true; window.__ev.push('habla:' + u.text.slice(0, 30)); setTimeout(() => { this.speaking = false; }, 300 + u.text.length * 5); }, 20); },
      cancel() { this.speaking = false; this.pending = false; }, resume() {}, getVoices() { return []; }, addEventListener() {} };
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.SpeechRecognition = window.webkitSpeechRecognition = function () { const r = this; r.start = () => { window.__ev.push('MICRO ABIERTO @' + Date.now()); setTimeout(() => r.onstart && r.onstart(), 10); window.__rec = r; }; r.abort = () => {}; r.stop = () => {}; };
  });
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1200);
  await pg.click('text=Nueva obra'); await pg.fill('#ftit', 'Android'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(300);
  await pg.click('#btnStart'); await pg.waitForTimeout(3500);
  // El usuario «dice» vivienda: resultado final del reconocimiento
  console.log('antes:', JSON.stringify(await pg.evaluate(() => window.__ev)), '|', await pg.textContent('#vstate'), '| modo:', await pg.evaluate(() => typeof window.webkitSpeechRecognition));
  const t0 = Date.now();
  await pg.evaluate(() => { const r = window.__rec; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'vivienda' }], { isFinal: true })] }); r.onend && r.onend(); });
  await pg.waitForTimeout(6000);
  const ev = await pg.evaluate(() => window.__ev);
  console.log(ev.join('\n'));
  const abiertos = ev.filter((e) => e.startsWith('MICRO')).length;
  console.log('Veces que se abre el micro sin tocar:', abiertos);
  await b.close();
})();
