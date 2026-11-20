// Comprueba que la frase interrogativa sale más aguda y que suena el pitido antes de abrir el micro
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.addInitScript(() => {
    window.__log = [];
    class U { constructor(t) { this.text = t; this.pitch = 1; } }
    window.SpeechSynthesisUtterance = U;
    Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, paused: false, getVoices: () => [], addEventListener() {}, cancel() {}, resume() {},
      speak(u) { window.__log.push('voz[' + u.pitch + ']: ' + u.text); setTimeout(() => u.onend && u.onend(), 30); } } });
    const AC = window.AudioContext; window.AudioContext = class extends AC { createOscillator() { const o = super.createOscillator(); const st = o.start.bind(o); o.start = (t) => { window.__log.push('pitido ' + o.frequency.value); st(t); }; return o; } };
  });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.argv[2]); await pg.waitForTimeout(1200);
  await pg.click('[data-a="newobra"]'); await pg.waitForTimeout(300);
  await pg.fill('#ftit', 'Prueba tono'); await pg.click('text=Crear y empezar');
  await pg.waitForTimeout(500);
  console.log('start visible', await pg.isVisible('#btnStart')); await pg.click('#btnStart', { timeout: 3000 }).catch((e) => console.log('nostart')); await pg.waitForTimeout(800); await pg.click('#btnKeyboard'); await pg.fill('#typein', 'vivienda'); await pg.press('#typein', 'Enter');
  await pg.waitForTimeout(2500);
  console.log((await pg.evaluate(() => window.__log)).join('\n'));
  console.log('ERRORES', errs); await b.close();
})();
