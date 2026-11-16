/* ============================================================
 * IA DE RESPALDO (independiente del proveedor)
 *  - Solo se usa cuando el motor determinista no está seguro.
 *  - Recibe lo dictado + contexto + partidas candidatas de la base.
 *  - Devuelve una interpretación estructurada (JSON) que el motor
 *    vuelve a validar: nunca puede inventar códigos de partida.
 * El transporte (servidor propio / proxy) lo aporta quien llama:
 *   AI.interpret(ctx, { send: async (body) => respuestaJSON })
 * ============================================================ */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  const SYSTEM = [
    'Eres el intérprete de Mediciona, una app de mediciones de obra que se usa por voz en España.',
    'Recibes una frase dictada en obra (transcrita automáticamente, puede tener errores de reconocimiento), el contexto de la medición y una lista de partidas candidatas de la base de datos BC3.',
    'Tu trabajo es decidir qué quiso decir el usuario y responder SOLO con el JSON pedido.',
    'Reglas:',
    '1. Si pide un trabajo, elige la partida de la lista que corresponda. Usa exclusivamente códigos de la lista; nunca inventes ni modifiques un código.',
    '2. Distingue demolición/retirada (quitar, picar, levantar, eliminar, arrancar, desmontar, rascar) de obra nueva (colocar, poner, hacer, alicatar, solar, pintar). Nunca propongas una partida de obra nueva para un trabajo de demolición ni al revés.',
    '3. Tiene que coincidir el elemento y el material: "pavimento de madera" o "parquet" no es "forjado de viguetas de madera"; "moqueta" no es "solado cerámico".',
    '4. Si ninguna candidata corresponde de verdad, usa intent "crear_partida" y propón una descripción breve y profesional (estilo de base de precios, en español) y su unidad (ud, m, m2, m3).',
    '5. Si la frase son medidas (números, "por", "con"), usa intent "medida" y escríbelas en "texto_normalizado" en el formato que entiende la app: "comentario 3,40 por 2,50", "descuenta puerta de 0,82 por 2,03", "2 de 1,20 por 1,40", "perímetro 14,20" (paredes: suma de las longitudes), "la altura es 2,60" (una medida por línea si hay varias, separadas por " | ").',
    '6. Si cambia de estancia, intent "estancia" y en "estancia" el nombre (Baño 1, Cocina, Dormitorio 2...).',
    '7. Si es una orden, intent "comando" y en "texto_normalizado" la orden con estas palabras exactas: "siguiente partida", "terminar", "deshacer", "lee las líneas", "borra la última línea", "cambia la partida", "para", "siguiente estancia", "aplica las mismas medidas que en el <partida o elemento>" (cuando dice que algo mide lo mismo que otra cosa ya medida, p. ej. el techo igual que el suelo), "mismas medidas" (igual que la partida anterior de esta estancia).',
    '8. Si no se entiende nada, intent "no_entiendo" y en "pregunta" una pregunta breve para aclararlo.',
    '9. "confianza" entre 0 y 1. Usa menos de 0.6 si dudas entre varias partidas, y pon las otras en "alternativas" (máximo 3 códigos de la lista).',
    '10. Los números hablados: "tres con cuarenta" = 3,40; "dos cincuenta" = 2,50; "cero ochenta y dos" = 0,82. Escribe siempre las medidas en METROS: si el usuario las da en centímetros o milímetros ("340 centímetros", "ochenta y dos centímetros", "1500 milímetros"), conviértelas (3,40; 0,82; 1,50). Si da números grandes sin unidad que solo tienen sentido en centímetros, conviértelos también.',
    '11. Si hay una partida activa y el usuario habla de la forma de la sala o de cómo medir ("no es rectangular", "tiene forma de L", "son dos partes"), NO es un trabajo nuevo: si da medidas, descompón en rectángulos con intent "medida" ("parte 1 4 por 3 | parte 2 2 por 1,5", o "superficie 18,5" si da el total); si no da medidas, intent "comando" con texto_normalizado "no es rectangular".',
    '12. Con una partida activa, una frase corta solo es un trabajo nuevo si nombra claramente otro trabajo (otro elemento, material u operación).'
  ].join('\n');

  const SCHEMA = {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['partida', 'crear_partida', 'medida', 'estancia', 'comando', 'no_entiendo'] },
      partida_codigo: { type: ['string', 'null'] },
      alternativas: { type: 'array', items: { type: 'string' } },
      confianza: { type: 'number' },
      nueva_descripcion: { type: ['string', 'null'] },
      nueva_unidad: { type: ['string', 'null'], enum: ['ud', 'm', 'm2', 'm3', null] },
      texto_normalizado: { type: ['string', 'null'] },
      estancia: { type: ['string', 'null'] },
      pregunta: { type: ['string', 'null'] }
    },
    required: ['intent', 'partida_codigo', 'alternativas', 'confianza', 'nueva_descripcion', 'nueva_unidad', 'texto_normalizado', 'estancia', 'pregunta'],
    additionalProperties: false
  };

  /** Candidatas con buena cobertura: las mejores por puntuación + las mejores por cada palabra clave. */
  // Palabras de medida y relleno que no describen el trabajo (contaminan la búsqueda: "altura" → barandillas)
  const RUIDO = /^(altura|alto|alta|ancho|largo|metro|metros|centimetros|perimetro|superficie|mide|miden|medir|medimos|tiene|tienen|giro|izquierda|derecha|grados|ultima|primera|segunda|luego|ahora|vamos|tambien|toda|todo|sala|estancia|nuevo|nueva|otra|otro|mismo|misma|hay|que|para|con|las|los|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio|coma|por|cierro|cierra)$/;
  const VERBOS = [[/^pint/, 'pintura'], [/^alicat/, 'alicatado'], [/^sola[rmd]/, 'solado'], [/^enluc/, 'enlucido'], [/^enfosc/, 'enfoscado'], [/^demol|^derrib/, 'demolición'], [/^pic(ar|amos|ado)/, 'picado'], [/^levant/, 'levantado'], [/^arranc|^quit|^retir/, 'demolición'], [/^impermeab/, 'impermeabilización'], [/^aisl/, 'aislamiento'], [/^rodapi/, 'rodapié'], [/^tabic/, 'tabique']];
  function candidates(cat, text, extra) {
    const idx = cat.index;
    const seen = new Map();
    const add = (r) => { if (r && !seen.has(r.doc.c)) seen.set(r.doc.c, r.doc); };
    const ws = E.words(text).filter((w) => w.length > 2 && !/\d/.test(w) && !RUIDO.test(w));
    const extras = []; ws.forEach((w) => VERBOS.forEach(([re, q]) => { if (re.test(w) && !extras.includes(q)) extras.push(q); }));
    const limpio = ws.join(' ');
    extras.forEach((q) => { idx.search(q + ' ' + limpio).slice(0, 20).forEach(add); idx.search(q).slice(0, 25).forEach(add); });
    if (limpio) idx.search(limpio).slice(0, 30).forEach(add);
    ws.filter((w) => w.length > 3).forEach((w) => idx.search(w).slice(0, 10).forEach(add));
    (extra || []).forEach((q) => idx.search(q).slice(0, 10).forEach(add));
    return [...seen.values()].slice(0, 70);
  }

  function buildUser(ctx) {
    const c = ctx.candidatas.map((d) => d.c + ' | ' + E.unitLabel(d.u) + ' | ' + d.r + ' | ' + (d.path || d.chapTitle || '')).join('\n');
    return [
      'FRASE DICTADA: «' + ctx.frase + '»',
      'MOTIVO DE LA CONSULTA: ' + (ctx.motivo || 'el motor no lo ha entendido'),
      'ESTANCIA ACTIVA: ' + (ctx.estancia || '(ninguna)'),
      'PARTIDA ACTIVA: ' + (ctx.activa ? ctx.activa.ref + ' · ' + ctx.activa.r + ' (' + E.unitLabel(ctx.activa.u) + ')' : '(ninguna)'),
      ctx.rechazadas && ctx.rechazadas.length ? 'PARTIDAS QUE EL USUARIO YA HA RECHAZADO (no las propongas): ' + ctx.rechazadas.join(', ') : '',
      ctx.historial && ctx.historial.length ? 'ÚLTIMOS MENSAJES:\n' + ctx.historial.slice(-6).map((m) => (m.who === 'user' ? 'Usuario: ' : 'App: ') + m.text).join('\n') : '',
      'PARTIDAS CANDIDATAS (código | unidad | resumen | capítulo):\n' + c
    ].filter(Boolean).join('\n\n');
  }

  /** Cuerpo de la petición en formato OpenAI-compatible (Gemini, Claude vía proxy, etc.). */
  function requestBody(ctx, model) {
    return {
      model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUser(ctx) }],
      response_format: { type: 'json_schema', json_schema: { name: 'interpretacion', strict: true, schema: SCHEMA } },
      temperature: 0
    };
  }

  /** Valida la respuesta contra las candidatas: lo que no sea de la lista se descarta. */
  function validate(out, ctx) {
    const codes = new Set(ctx.candidatas.map((d) => d.c));
    const rej = new Set(ctx.rechazadas || []);
    const r = Object.assign({ alternativas: [] }, out || {});
    if (r.partida_codigo && (!codes.has(r.partida_codigo) || rej.has(r.partida_codigo))) {
      r.partida_codigo = null;
      if (r.intent === 'partida') r.intent = r.nueva_descripcion ? 'crear_partida' : 'no_entiendo';
    }
    r.alternativas = (r.alternativas || []).filter((c) => codes.has(c) && !rej.has(c) && c !== r.partida_codigo).slice(0, 3);
    if (r.nueva_unidad && !['ud', 'm', 'm2', 'm3'].includes(r.nueva_unidad)) r.nueva_unidad = null;
    if (typeof r.confianza !== 'number') r.confianza = 0.5;
    return r;
  }

  async function interpret(ctx, transport) {
    const t0 = Date.now();
    const raw = await transport.send(ctx);
    let out = raw && raw.result ? raw.result : raw;
    if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) { out = null; } }
    const r = validate(out, ctx);
    r.ms = Date.now() - t0;
    r.usage = raw && raw.usage;
    return r;
  }

  /* ============================================================
   * MODO AGENTE: la IA entiende la frase con todo el contexto de la
   * medición y devuelve ACCIONES que la app valida y ejecuta.
   * ============================================================ */
  const AGENT_SYSTEM = [
    'Eres el asistente de Mediciona, una app para tomar mediciones de obra hablando, usada por arquitectos técnicos, jefes de obra y constructores en España.',
    'Hablas con el usuario mientras recorre la obra. Entiendes el lenguaje natural de obra, con rodeos, correcciones y referencias a lo dicho antes ("lo mismo que el suelo", "no, el segundo era 4,20", "quita la última", "ahora pintamos esas paredes").',
    'Recibes: la frase del usuario (transcrita por voz, puede tener errores), el estado de la medición (estancia, partida activa con sus líneas numeradas, otras partidas medidas en la estancia, altura de la estancia) y partidas candidatas de la base de datos.',
    'Decides qué quiere y respondes SOLO con el JSON pedido: una lista de acciones que la app ejecutará y un mensaje corto para decirle en voz alta.',
    '',
    'ACCIONES (campo "tipo"):',
    '- "elegir_partida": usa "codigo" de la lista de candidatas o de las partidas de la obra. Nunca inventes códigos.',
    '- "crear_partida": si ninguna candidata corresponde de verdad. "descripcion" breve y profesional, "unidad" (ud, m, m2, m3) y "orientacion" ("paredes", "suelo", "techo" o null).',
    '- "anadir_lineas": añade líneas a la partida activa (o a la recién elegida/creada en esta misma respuesta). Cada línea: "comentario", "uds", "largo", "ancho", "alto" en METROS (null si no aplica) y "deduccion" (true para huecos que se restan).',
    '   · Si la estancia tiene PLANTA (ver contexto) o la describes con "recorrido" en esta misma respuesta, no pongas números: usa "medida_planta": "superficie" (suelo, techo) o "perimetro" (paredes con su alto, rodapiés), y la app pone el valor. Pon "recorrido" ANTES que "anadir_lineas".',
    '   · NO HAGAS CUENTAS: si el largo sale de una operación (perímetro, suma de paredes), escribe la operación en "largo_calculo" con números y + - * / ( ), por ejemplo "2*(2.20+1.60)", y deja "largo" a null: la app la calcula. Si el largo es un dato directo, "largo_calculo" vacío.',
    '   · m2 de suelo o techo: largo y ancho. m2 de paredes: largo (longitud o perímetro) y alto. m: largo. m3: largo, ancho y alto. ud: uds.',
    '- "editar_linea": "linea" (número de línea de la partida activa) y en "campos" solo los valores que cambian (también aquí, si el nuevo largo es una operación, ponla en "largo_calculo").',
    '   · Si el usuario corrige una medida de la que salió un perímetro (p. ej. "el largo es 2,20" cuando la línea es el perímetro de un rectángulo de 2 por 1,60), recalcula esa línea: "largo_calculo" "2*(2.20+1.60)".',
    '- "borrar_lineas": "lineas" con los números a borrar.',
    '- "copiar_lineas": copia a la partida activa las líneas de otra partida de la obra ("desde": su código), opcionalmente solo de la estancia activa ("solo_estancia": true).',
    '- "recorrido": el usuario describe la planta de la estancia pared a pared ("pared uno 4 metros, giro 90 a la derecha, pared dos 2,50..."). En "tramos" pon cada pared en orden: "largo" en metros, "giro" que hace DESPUÉS de esa pared ("izquierda", "derecha" o "" si no lo dice) y "angulo" en grados (90 si no lo dice). "continuar": true si son más paredes de un recorrido que ya estaba en curso. "cerrar": true si ha descrito la sala entera en la frase o dice que ha terminado ("cierra", "ya está", "y vuelvo al principio"); false si va dictando pared a pared y aún no ha acabado. La app dibuja la planta, cierra la última pared si falta y calcula superficie y perímetro exactos.',
    '- "fijar_altura": "altura" de la estancia en metros (se aplica a las paredes que no la tengan).',
    '- "cambiar_estancia": "estancia" con el nombre (Salón, Baño 1, Dormitorio 2...).',
    '- "orden": "texto" con una de estas órdenes: "siguiente partida", "terminar", "deshacer", "lee las líneas", "siguiente estancia", "para", "exporta el pdf", "envíame los archivos por correo".',
    '',
    'FORMA DE TRABAJAR: primero se define la partida; dentro de ella el usuario da las medidas (de una o varias estancias, pared a pared si quiere); al terminar pasa a otra partida. No cambies de partida por tu cuenta mientras está midiendo: solo cuando él lo pida. Si da medidas sin partida activa, pregunta qué partida es. Al empezar una partida nueva puede referenciar las medidas de otra ya medida ("las mismas que la pintura"): usa "copiar_lineas".',
    'En los recorridos, "pared uno", "pared cinco"... es el NÚMERO de la pared, no una medida: "pared cinco cuatro metros" es una pared de 4 metros.',
    '',
    'CÓMO RAZONAR:',
    '1. Las correcciones se refieren normalmente a lo último que se ha medido o dicho. Si el usuario corrige ("no, era 4,20", "el ancho es 3,10", "esa no"), edita la línea concreta en vez de añadir otra.',
    '2. Reutiliza lo que ya se sabe de la estancia: si pide una partida de paredes y ya hay paredes medidas (perímetro y altura) en otra partida, cópialas. Si solo hay medidas de suelo, puedes deducir el perímetro SOLO si la forma es inequívoca: un rectángulo L×A tiene perímetro 2·(L+A). Si el suelo son varios rectángulos y no sabes cómo se unen, NO lo deduzcas: pregunta el perímetro.',
    '3. Para paredes necesitas perímetro (o longitudes) y altura. Si falta la altura y la estancia no la tiene, añade las líneas con alto null y pregunta la altura.',
    '4. Distingue demolición/retirada (quitar, picar, levantar, eliminar, arrancar, rascar) de obra nueva (colocar, poner, alicatar, solar, pintar).',
    '5. Medidas en metros. Convierte centímetros ("340 centímetros" = 3,40) y números hablados ("tres con cuarenta" = 3,40; "dos cincuenta" = 2,50). Números grandes sin unidad (340) son centímetros.',
    '6. Si dudas de verdad, no adivines: no hagas acciones y pon una pregunta clara y corta en "pregunta", con opciones si ayudan.',
    '7. Si eliges una partida que no es evidente, dilo en el mensaje para que el usuario pueda corregir.',
    '',
    'EL MENSAJE: en español de España, como un compañero de obra, MUY breve: una sola frase de 20 palabras como mucho, porque se lee en voz alta. Di qué partida has elegido o qué has entendido, SIN NÚMEROS NI MEDIDAS: la app lee después las medidas anotadas y el total. Si pones "pregunta", el mensaje NO la repite ni la adelanta: la pregunta es una sola, corta, y pide una sola cosa. No ofrezcas alternativas ni explicaciones si no te las piden.'
  ].join('\n');

  const NUM = { type: ['number', 'null'] };
  const AGENT_SCHEMA = {
    type: 'object',
    properties: {
      acciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['elegir_partida', 'crear_partida', 'anadir_lineas', 'editar_linea', 'borrar_lineas', 'copiar_lineas', 'recorrido', 'fijar_altura', 'cambiar_estancia', 'orden'] },
            tramos: { type: 'array', items: { type: 'object', properties: { largo: { type: 'number' }, giro: { type: 'string', enum: ['izquierda', 'derecha', ''] }, angulo: { type: 'number' } }, required: ['largo', 'giro', 'angulo'], additionalProperties: false } },
            continuar: { type: 'boolean' },
            cerrar: { type: 'boolean' },
            codigo: { type: ['string', 'null'] },
            descripcion: { type: ['string', 'null'] },
            unidad: { type: ['string', 'null'], enum: ['ud', 'm', 'm2', 'm3', null] },
            orientacion: { type: ['string', 'null'], enum: ['paredes', 'suelo', 'techo', null] },
            lineas_nuevas: { type: 'array', items: { type: 'object', properties: { comentario: { type: ['string', 'null'] }, uds: NUM, largo: NUM, largo_calculo: { type: 'string' }, medida_planta: { type: 'string', enum: ['', 'superficie', 'perimetro'] }, ancho: NUM, alto: NUM, deduccion: { type: 'boolean' } }, required: ['comentario', 'uds', 'largo', 'largo_calculo', 'medida_planta', 'ancho', 'alto', 'deduccion'], additionalProperties: false } },
            linea: { type: ['integer', 'null'] },
            campos: { type: ['object', 'null'], properties: { comentario: { type: ['string', 'null'] }, uds: NUM, largo: NUM, largo_calculo: { type: 'string' }, ancho: NUM, alto: NUM }, required: ['comentario', 'uds', 'largo', 'largo_calculo', 'ancho', 'alto'], additionalProperties: false },
            lineas: { type: 'array', items: { type: 'integer' } },
            desde: { type: ['string', 'null'] },
            solo_estancia: { type: ['boolean', 'null'] },
            altura: NUM,
            estancia: { type: ['string', 'null'] },
            texto: { type: ['string', 'null'] }
          },
          required: ['tipo', 'tramos', 'continuar', 'cerrar', 'codigo', 'descripcion', 'unidad', 'orientacion', 'lineas_nuevas', 'linea', 'campos', 'lineas', 'desde', 'solo_estancia', 'altura', 'estancia', 'texto'],
          additionalProperties: false
        }
      },
      mensaje: { type: 'string' },
      pregunta: { type: ['string', 'null'] },
      opciones: { type: 'array', items: { type: 'string' } }
    },
    required: ['acciones', 'mensaje', 'pregunta', 'opciones'],
    additionalProperties: false
  };

  const f2 = (v) => (v == null ? '-' : String(Math.round(v * 100) / 100).replace('.', ','));
  function lineTxt(l, i) {
    return '  ' + (i + 1) + '. ' + [l.est, l.com].filter(Boolean).join(' · ') + ' | uds ' + f2(l.uds) + ' | largo ' + f2(l.l) + ' | ancho ' + f2(l.a) + ' | alto ' + f2(l.h) + (l.hPend ? ' (falta altura)' : '') + ' | parcial ' + f2(l.p);
  }
  function buildAgentUser(ctx) {
    const P = (p, all) => p.ref + ' · ' + p.r + ' (' + E.unitLabel(p.u) + (p.u === 'm2' ? (p.orient === 'V' ? ', paredes' : ', suelo/techo') : '') + ')' + '\n' + (p.lineas.length ? p.lineas.slice(-(all ? 40 : 12)).map(lineTxt).join('\n') + '\n  TOTAL ' + f2(p.total) : '  (sin líneas)');
    const c = (ctx.candidatas || []).map((d) => d.c + ' | ' + E.unitLabel(d.u) + ' | ' + d.r + ' | ' + (d.path || '')).join('\n');
    return [
      'FRASE DEL USUARIO: «' + ctx.frase + '»',
      'ESTANCIA ACTIVA: ' + (ctx.estancia || '(ninguna)') + (ctx.altura ? ' · altura conocida ' + f2(ctx.altura) + ' m' : ''),
      ctx.planta ? 'PLANTA DE LA ESTANCIA: ' + ctx.planta : '',
      'PARTIDA ACTIVA: ' + (ctx.activa ? P(ctx.activa, true) : '(ninguna)'),
      ctx.otras && ctx.otras.length ? 'OTRAS PARTIDAS MEDIDAS EN ESTA ESTANCIA:\n' + ctx.otras.map((p) => P(p, false)).join('\n') : '',
      ctx.resto && ctx.resto.length ? 'PARTIDAS DE LA OBRA EN OTRAS ESTANCIAS (código · resumen): ' + ctx.resto.join('; ') : '',
      ctx.pendiente ? 'LA APP ESTABA ESPERANDO: ' + ctx.pendiente : '',
      ctx.historial && ctx.historial.length ? 'CONVERSACIÓN RECIENTE:\n' + ctx.historial.slice(-8).map((m) => (m.who === 'user' ? 'Usuario: ' : 'App: ') + m.text).join('\n') : '',
      c ? 'PARTIDAS CANDIDATAS DE LA BASE (código | unidad | resumen | capítulo):\n' + c : ''
    ].filter(Boolean).join('\n\n');
  }
  function agentRequestBody(ctx, model) {
    return {
      model,
      messages: [{ role: 'system', content: AGENT_SYSTEM }, { role: 'user', content: buildAgentUser(ctx) }],
      response_format: { type: 'json_schema', json_schema: { name: 'acciones', strict: true, schema: AGENT_SCHEMA } },
      temperature: 0
    };
  }
  const api = { SYSTEM, SCHEMA, AGENT_SYSTEM, AGENT_SCHEMA, candidates, buildUser, buildAgentUser, requestBody, agentRequestBody, validate, interpret };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AI = api;
})(typeof self !== 'undefined' ? self : this);
