const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1200);
  await pg.click('button[data-a=open]'); await pg.waitForTimeout(300);
  await pg.click('#btnKeyboard'); await pg.fill('#typein', 'picado de azulejos'); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(200);
  await pg.fill('#typein', 'pared 3 por 2,5'); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(200);
  await pg.click('button[data-a=pickp]'); await pg.waitForTimeout(200);
  await pg.fill('#pq', 'levantado de entarimado'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: 'test/sheet.png' });
  await pg.click('#pres .pitem >> nth=0'); await pg.waitForTimeout(300);
  console.log('activa:', await pg.textContent('.resumen'));
  console.log('talk:', await pg.textContent('#talk'));
  await pg.click('button[data-a=stop]'); await pg.waitForTimeout(200);
  const dl = pg.waitForEvent('download'); await pg.click('#btnMenu'); await pg.click('text=Descargar registro'); const d = await dl; await d.saveAs('test/reg.txt');
  console.log(require('fs').readFileSync('test/reg.txt', 'utf8').split('\n').slice(0, 8).join('\n'));
  console.log('ERRORS', errs); await b.close();
})();
