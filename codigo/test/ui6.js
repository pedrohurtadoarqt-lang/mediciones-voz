const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/dist/pwa/index.html'); await p.waitForTimeout(1200);
  await p.click('button[data-a=sugerencias]'); await p.waitForTimeout(200);
  await p.click('#sgtype [data-t="Partida que falta"]'); await p.fill('#sgtext', 'No encuentra quitar gotelé');
  await p.screenshot({ path: 'test/sg.png' });
  let nav = null; p.on('request', (r) => { if (r.url().startsWith('mailto:')) nav = r.url(); });
  await p.evaluate(() => { window.__h = null; }); 
  const url = await p.evaluate(() => new Promise((res) => { const d = Object.getOwnPropertyDescriptor(Location.prototype, 'href'); document.querySelector('#sgsend').click(); setTimeout(() => res(document.querySelector('#toast').textContent), 300); }));
  console.log('toast:', url); console.log('ERRORS', errs); await b.close();
})();
