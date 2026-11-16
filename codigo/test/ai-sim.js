global.self = global;
// Simula el flujo de diálogo con una IA de mentira (respuestas fijas) para probar la integración.
const B = require('../src/bc3.js'), E = require('../src/engine.js'), fs = require('fs');
global.Engine = E; const AI = require('../src/ai.js'); global.AI = AI;
const cat = E.prepareCatalog(B.parseBC3(fs.readFileSync('data/Palma48_2026_COAATMCA.bc3')));
const FAKE = {
  'quitar el parquet': { intent: 'partida', partida_codigo: 'DRS050', alternativas: ['DRS040'], confianza: 0.8 },
  'rascar el gotele': { intent: 'crear_partida', nueva_descripcion: 'Eliminación de gotelé en paramentos', nueva_unidad: 'm2', confianza: 0.9 },
  'pared ventana tres cuarenta por dos sesenta y quita la ventana uno veinte por uno diez': { intent: 'medida', texto_normalizado: 'pared ventana 3,40 por 2,60 | descuenta ventana de 1,20 por 1,10', confianza: 1 }
};
const out = []; let pend = Promise.resolve();
const io = { say: (t, ch) => out.push('  APP: ' + t + (ch && ch.length ? '  [' + ch.map((c) => c.label).join(' | ') + ']' : '')), user: (t) => out.push('USER: ' + t), note: (t) => out.push('  (nota) ' + t), save() {}, render() {}, getCatalog: () => cat, exportPdf() {}, confirmPick: () => true,
  aiReady: () => true, history: () => [],
  ai: (ctx) => { const k = E.norm(ctx.frase).replace(/[^a-z0-9 ,]/g, ''); const r = FAKE[k] || { intent: 'no_entiendo', pregunta: '¿Puedes decirlo de otra forma?' }; pend = new Promise((res) => setTimeout(res, 30)); return pend.then(() => Object.assign({ alternativas: [], partida_codigo: null, nueva_descripcion: null, nueva_unidad: null, texto_normalizado: null, estancia: null, pregunta: null }, r)); } };
const d = new E.Dialog(io); const obra = { id: 't', titulo: 'P', partidas: [], estancias: [] }; d.setObra(obra);
const script = ['Medición libre', 'quitar el parquet', 'sí', '5 por 4', 'siguiente partida', 'rascar el gotele', 'sí, crearla', 'pintura plástica interior lisa', 'sí', 'pared ventana tres cuarenta por dos sesenta y quita la ventana uno veinte por uno diez'];
(async () => {
  for (const t of script) { if (t === 'Medición libre') d.handle(d.lastPrompt.chips[4]); else if (t === 'sí, crearla') d.handle(d.lastPrompt.chips[0]); else d.handle(t); await new Promise((r) => setTimeout(r, 80)); }
  console.log(out.join('\n'));
  E.obraChapters(obra).forEach((c) => c.partidas.forEach((p) => { console.log(p.codigo, p.ref, p.r, '=', E.totalOf(p)); p.lineas.forEach((l) => console.log('    ', l.com, l.uds, l.l, l.a, l.h)); }));
})();
