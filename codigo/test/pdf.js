const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ acceptDownloads: true });
  await pg.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'dist/mediciones-voz.html')); await pg.waitForTimeout(1500);
  const dl = pg.waitForEvent('download'); await pg.click('button[data-a=pdf]'); const d = await dl; await d.saveAs('test/ej.pdf'); await b.close();
})();
