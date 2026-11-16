const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1200);
  for (const k of ['xlsx', 'bc3']) { const dl = pg.waitForEvent('download'); await pg.click('button[data-a=' + k + ']'); const d = await dl; await d.saveAs('test/ui.' + k); console.log(k, d.suggestedFilename()); }
  await pg.screenshot({ path: 'test/home.png' });
  await pg.click('button[data-a=open]'); await pg.waitForTimeout(300);
  await pg.click('#btnKeyboard');
  const dl = pg.waitForEvent('download'); await pg.fill('#typein', 'exporta en excel'); await pg.press('#typein', 'Enter'); const d = await dl; console.log('voz:', d.suggestedFilename());
  const dl2 = pg.waitForEvent('download'); await pg.fill('#typein', 'genera el bc3'); await pg.press('#typein', 'Enter'); const d2 = await dl2; console.log('voz:', d2.suggestedFilename());
  console.log('ERRORS', errs); await b.close();
})();
