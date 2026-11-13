const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => {
    // Simulación: el "usuario" responde con frases en orden cada vez que se abre el micro
    const script = ['vivienda', 'cocina', 'picado de azulejos', 'pared frontal tres con cuarenta por dos cincuenta', 'descuenta puerta de 0,82 por 2,03', 'siguiente partida', 'siguiente estancia', 'baño uno', 'quitar azulejos', 'sí, igual', 'pared ducha 1,80 por 2,50'];
    window.__said = []; window.__starts = 0;
    class FakeSR { constructor() { this.lang = ''; } start() { window.__starts++; const me = this; setTimeout(() => { me.onstart && me.onstart(); const t = script.shift(); setTimeout(() => { if (!t) { me.onerror && me.onerror({ error: 'no-speech' }); me.onend && me.onend(); return; } me.onresult && me.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); me.onend && me.onend(); }, 120); }, 60); } abort() { } stop() { } }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
    const fakeSynth = { speaking: false, paused: false, getVoices: () => [{ lang: 'es-ES', name: 'Test', voiceURI: 't' }], addEventListener() {}, cancel() {}, resume() {},
      speak(u) { if (u.text.trim()) window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 20); } };
    Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1200);
  await pg.click('text=Nueva obra'); await pg.fill('#ftit', 'Prueba voz'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(300);
  console.log('start visible:', await pg.isVisible('#btnStart'));
  await pg.click('#btnStart');
  await pg.waitForTimeout(9000);
  const said = await pg.evaluate(() => window.__said);
  console.log(said.join('\n'));
  console.log('starts', await pg.evaluate(() => window.__starts), 'vstate:', await pg.textContent('#vstate'));
  await pg.screenshot({ path: 'test/loop.png' });
  console.log('ERRORS', errs); await b.close();
})();
