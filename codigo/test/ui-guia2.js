// Interfaz: borrar estancia, crear partida desde la pantalla, plegar la conversación, exportar
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1500);
  await pg.click('text=Nueva obra'); await pg.fill('#ftit', 'Prueba 2'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  for (const t of ['vivienda', 'salón 4 por 3', '2,60', 'una puerta de 0,82 por 2,03', 'no', 'baño', '2 por 1,8', 'la misma', 'iguales que el salón', 'no', 'pasillo', '3 por 1', '2,6', 'ninguna']) await say(t);
  await pg.click('.zdel >> nth=2'); await pg.click('.sheet button:text-is("Eliminar")'); await pg.waitForTimeout(200);
  console.log('zonas tras borrar:', await pg.$$eval('.toma-z .r', (x) => x.map((e) => e.firstChild.textContent)));
  await pg.click('#btnDock'); await pg.waitForTimeout(200); await pg.screenshot({ path: 'test/g2_min.png' });
  await pg.click('#btnDock'); await pg.waitForTimeout(100);
  await say('elegir trabajos'); await say('correcto'); await say('no'); await say('no');
  await pg.click('.tw-main:has-text("Solado de gres")');
  await pg.fill('#tnd', 'mover estatua de sitio'); await pg.selectOption('#tnz', { label: 'Salón' }); await pg.click('text=Crear partida'); await pg.waitForTimeout(200);
  await pg.evaluate(() => document.querySelector('main').scrollTo(0, 99999)); await pg.screenshot({ path: 'test/g2_trab.png' });
  await pg.click('text=Generar mediciones'); await pg.waitForTimeout(300); await say('1'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: 'test/g2_fin.png' });
  console.log('partidas:', await pg.$$eval('.monitor .plist button.pitem .r', (x) => x.map((e) => e.firstChild.textContent)));
  console.log('ERRORES', errs); await b.close();
})();
