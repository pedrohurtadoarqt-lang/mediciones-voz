// Genera dist/mediciones-voz.html (archivo único autocontenido) y dist/artifact.html (cuerpo para publicar).
const fs = require('fs'), path = require('path');
const BC3 = require('./src/bc3.js');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const bc3File = process.argv[2] || path.join(__dirname, 'data', 'Palma48_2026_COAATMCA.bc3');
const cat = BC3.parseBC3(fs.readFileSync(bc3File), 'Precios de Mallorca 2026');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const fontB64 = (n) => fs.readFileSync(path.join(__dirname, 'src', 'fonts', 'LiberationSans-' + n + '.ttf')).toString('base64');
const fontJs = 'window.PDF_FONTS={regular:"' + fontB64('Regular') + '",bold:"' + fontB64('Bold') + '",italic:"' + fontB64('Italic') + '"};';
const catJs = 'window.CATALOGO_BASE=' + JSON.stringify(cat).replace(/<\//g, '<\\/') + ';';
const head = '<title>Mediciones por Voz</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="theme-color" content="#0F172A">\n<style>\n' + src('styles.css') + '</style>\n';
const scripts = ['<script>' + safe(src('vendor-jspdf.umd.min.js')) + '</script>', '<script>' + catJs + '</script>', '<script>' + fontJs + '</script>', '<script>' + safe(src('bc3.js')) + '</script>', '<script>' + safe(src('engine.js')) + '</script>', '<script>' + safe(src('app.js')) + '</script>'].join('\n');
const body = src('body.html');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'mediciones-voz.html'), '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head + '</head>\n<body>\n' + body + scripts + '\n</body>\n</html>\n');
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), head + body + scripts + '\n');
console.log('Partidas:', cat.partidas.length, '| tamaño:', (fs.statSync(path.join(__dirname, 'dist', 'mediciones-voz.html')).size / 1e6).toFixed(2), 'MB');

// Versión PWA (para GitHub Pages / cualquier hosting https): instalable y offline.
const pwa = path.join(__dirname, 'dist', 'pwa');
fs.mkdirSync(pwa, { recursive: true });
const pwaHead = '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="icon.svg">\n<meta name="apple-mobile-web-app-capable" content="yes">\n';
const swReg = '<script>if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function(){});</script>';
fs.writeFileSync(path.join(pwa, 'index.html'), '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + pwaHead + head + '</head>\n<body>\n' + body + scripts + '\n' + swReg + '\n</body>\n</html>\n');
const ver = Date.now().toString(36);
fs.writeFileSync(path.join(pwa, 'sw.js'), "const C='mediciones-voz-" + ver + "';\nself.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.webmanifest','icon.svg'])).then(()=>self.skipWaiting()));});\nself.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});\nself.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));});\n");
fs.writeFileSync(path.join(pwa, 'manifest.webmanifest'), JSON.stringify({ name: 'Mediciones por Voz', short_name: 'Mediciones', start_url: './', scope: './', display: 'standalone', background_color: '#0F172A', theme_color: '#0F172A', lang: 'es', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, null, 2));
fs.writeFileSync(path.join(pwa, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0F172A"/><rect x="206" y="96" width="100" height="196" rx="50" fill="#F59E0B"/><path d="M146 250a110 110 0 00220 0" fill="none" stroke="#F59E0B" stroke-width="28" stroke-linecap="round"/><path d="M256 360v56M196 416h120" stroke="#F1F5F9" stroke-width="28" stroke-linecap="round"/></svg>');
console.log('PWA en dist/pwa');
