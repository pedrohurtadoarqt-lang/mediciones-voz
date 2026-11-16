// Prueba del modo agente con casos de contexto. Uso: node test/agent-eval.js <modelo>
const B = require('../src/bc3.js'), E = require('../src/engine.js'), fs = require('fs');
global.Engine = E; const AI = require('../src/ai.js');
const cat = E.prepareCatalog(B.parseBC3(fs.readFileSync('data/Palma48_2026_COAATMCA.bc3')));
const model = process.argv[2] || 'gemini-flash-latest';
const P = (code, lineas, orient) => { const d = cat.byCode.get(code); const ls = lineas.map((l) => Object.assign({ uds: 1, a: null, h: null }, l, { p: E.parcial(Object.assign({ uds: 1, a: null, h: null }, l)) })); return { ref: d.c, r: d.r, u: d.u, orient: orient || E.orientOf(d), lineas: ls, total: ls.reduce((a, l) => a + l.p, 0) }; };
const suelo = P('RSG010h', [{ est: 'Salita', com: 'Parte 1', l: 4, a: 3 }, { est: 'Salita', com: 'Parte 2', l: 2, a: 1.5 }]);
const picado = P('DRF020b', [{ est: 'Salita', com: 'Perímetro', l: 14.2, h: 2.6 }, { est: 'Salita', com: 'Deducción puerta', uds: -1, l: 0.82, h: 2.03 }]);
const CASES = [
  ['ahora la pintura de las paredes aprovechando lo de antes', { activa: suelo, otras: [] }],
  ['no, el segundo era de dos por uno ochenta', { activa: suelo, otras: [] }],
  ['quita la última', { activa: suelo, otras: [] }],
  ['pintura plástica en las paredes, lo mismo que el picado', { activa: null, otras: [picado, suelo] }],
  ['el dormitorio tiene cuatro veinte por tres diez y dos cincuenta de alto, hay que pintar las paredes', { activa: null, otras: [] }],
  ['me he equivocado, la altura es dos setenta', { activa: picado, otras: [] }]
];
(async () => {
  for (const [frase, c] of CASES) {
    const ctx = { frase, estancia: 'Salita', altura: null, activa: c.activa, otras: c.otras, resto: [], historial: [], candidatas: AI.candidates(cat, frase).map((d) => ({ c: d.c, u: d.u, r: d.r, path: d.path })) };
    const t0 = Date.now();
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer proxy-injected' }, body: JSON.stringify(AI.agentRequestBody(ctx, model)) });
    const j = await res.json();
    if (!res.ok) { console.log('ERROR', frase, JSON.stringify(j).slice(0, 200)); continue; }
    const out = JSON.parse(j.choices[0].message.content);
    console.log('\n«' + frase + '»  (' + (Date.now() - t0) + ' ms, ' + j.usage.prompt_tokens + '+' + j.usage.completion_tokens + ' tokens)');
    out.acciones.forEach((a) => { const o = {}; Object.entries(a).forEach(([k, v]) => { if (v !== null && !(Array.isArray(v) && !v.length)) o[k] = v; }); console.log('   ', JSON.stringify(o)); });
    console.log('    → ' + out.mensaje + (out.pregunta ? '  [PREGUNTA: ' + out.pregunta + ' ' + (out.opciones || []).join(' / ') + ']' : ''));
  }
})();
