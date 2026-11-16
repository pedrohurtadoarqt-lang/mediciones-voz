// Ejecuta acciones del modo agente con una IA simulada (respuestas fijas) para comprobar que la app las aplica bien.
global.self = global;
const B = require('../src/bc3.js'), E = require('../src/engine.js'), fs = require('fs');
global.Engine = E; global.AI = require('../src/ai.js');
const cat = E.prepareCatalog(B.parseBC3(fs.readFileSync('data/Palma48_2026_COAATMCA.bc3')));
const nul = { codigo: null, descripcion: null, unidad: null, orientacion: null, lineas_nuevas: [], linea: null, campos: null, lineas: [], desde: null, solo_estancia: null, altura: null, estancia: null, texto: null };
const A = (o) => Object.assign({}, nul, o);
const FAKE = {
  'quitar el parquet de la salita': { acciones: [A({ tipo: 'elegir_partida', codigo: 'DRS050' })], mensaje: 'He puesto Levantado de pavimento laminado. ¿Medidas del suelo?', pregunta: null, opciones: [] },
  'son dos rectangulos de 4 por 3 y 2 por 1,5': { acciones: [A({ tipo: 'anadir_lineas', lineas_nuevas: [{ comentario: 'Parte 1', uds: 1, largo: 4, ancho: 3, alto: null, deduccion: false }, { comentario: 'Parte 2', uds: 1, largo: 2, ancho: 1.5, alto: null, deduccion: false }] })], mensaje: 'Anotadas las dos partes: 12 más 3.', pregunta: null, opciones: [] },
  'no, el segundo era de 2 por 1,80': { acciones: [A({ tipo: 'editar_linea', linea: 2, campos: { comentario: null, uds: null, largo: 2, ancho: 1.8, alto: null } })], mensaje: 'Corregida la parte 2: 2 por 1,80.', pregunta: null, opciones: [] },
  'ahora pintura de las paredes aprovechando lo de antes': { acciones: [A({ tipo: 'elegir_partida', codigo: 'RIP030' })], mensaje: 'Pintura plástica en paredes. El suelo son dos rectángulos y no sé cómo se unen, así que no puedo sacar el perímetro.', pregunta: '¿Me dices el perímetro de la salita y la altura?', opciones: [] },
  'perimetro catorce con sesenta y altura dos cincuenta': { acciones: [A({ tipo: 'anadir_lineas', lineas_nuevas: [{ comentario: 'Perímetro', uds: 1, largo: 14.6, ancho: null, alto: 2.5, deduccion: false }] }), A({ tipo: 'fijar_altura', altura: 2.5 })], mensaje: 'Paredes: 14,60 por 2,50.', pregunta: null, opciones: [] },
  'quita la puerta de 82 por 2,03': { acciones: [A({ tipo: 'anadir_lineas', lineas_nuevas: [{ comentario: 'Puerta', uds: 1, largo: 0.82, ancho: null, alto: 2.03, deduccion: true }] })], mensaje: 'Descontada la puerta.', pregunta: null, opciones: [] },
  'ya esta, siguiente estancia': { acciones: [A({ tipo: 'orden', texto: 'siguiente estancia' })], mensaje: 'Vale.', pregunta: null, opciones: [] }
};
const out = [];
const io = { say: (t, ch) => out.push('  APP: ' + t + (ch && ch.length ? '  [' + ch.map((c) => c.label).join(' | ') + ']' : '')), user: (t) => out.push('USER: ' + t), note: (t) => out.push('  (nota) ' + t), save() {}, render() {}, getCatalog: () => cat, exportPdf() {}, confirmPick: () => true, aiReady: () => true, history: () => [],
  agent: (ctx) => new Promise((res) => setTimeout(() => res({ result: FAKE[E.norm(ctx.frase).replace(/[^a-z0-9 ,]/g, '')] || { acciones: [], mensaje: '', pregunta: '¿Cómo dices?', opciones: [] } }), 20)) };
const d = new E.Dialog(io); const obra = { id: 't', titulo: 'P', partidas: [], estancias: [], ambito: 'vivienda', estActiva: 'Salita' }; d.setObra(obra);
(async () => {
  for (const t of Object.keys(FAKE).map((k) => k)) { d.handle(t); await new Promise((r) => setTimeout(r, 60)); }
  console.log(out.join('\n'));
  E.obraChapters(obra).forEach((c) => c.partidas.forEach((p) => { console.log(p.codigo, p.ref, p.r, '=', E.totalOf(p)); p.lineas.forEach((l) => console.log('    ', l.est, '|', l.com, '|', l.uds, l.l, l.a, l.h)); }));
})();
