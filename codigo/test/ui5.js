const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  // Android (Chrome)
  const c1 = await b.newContext({ ...devices['Pixel 7'] });
  const p1 = await c1.newPage(); p1.on('pageerror', e => errs.push(e.message));
  await p1.goto('http://localhost:8765/'); await p1.waitForTimeout(2000);
  const man = await p1.evaluate(async () => { const r = await fetch('manifest.webmanifest'); return (await r.json()).short_name; });
  const sw = await p1.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
  console.log('manifest:', man, '| SW registrado (solo https):', sw);
  await p1.screenshot({ path: 'test/b_home.png' });
  await p1.click('button[data-a=open]'); await p1.waitForTimeout(400);
  await p1.screenshot({ path: 'test/b_obra.png' });
  // iPhone (Safari)
  const c2 = await b.newContext({ ...devices['iPhone 14'] });
  const p2 = await c2.newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto('http://localhost:8765/'); await p2.waitForTimeout(2500);
  await p2.screenshot({ path: 'test/b_ios.png' });
  console.log('guía iOS visible:', await p2.isVisible('.ios-guide'), '| tarjeta instalar:', await p2.isVisible('.installcard'));
  console.log('ERRORS', errs); await b.close();
})();
