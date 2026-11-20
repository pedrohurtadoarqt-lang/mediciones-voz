/*
 * Mediciona · Modo conversación: instrucciones y formato de la IA.
 * Se usa en el servidor (función ai-interpret, modo "conversa") y en las pruebas.
 * La IA NO calcula mediciones: traduce lo que cuenta el usuario a datos de la toma
 * (zonas con sus medidas) y a trabajos; la app mide con sus reglas.
 */
(function (root) {
  'use strict';
  const NUM = { type: ['number', 'null'] };
  const SN = { type: 'string', enum: ['', 'si', 'no'] };

  const ZONA = {
    type: 'object',
    properties: {
      ref: { type: 'string' },
      ambito: { type: 'string', enum: ['interior', 'fachada', 'cubierta', 'piscina', 'fontaneria', 'electricidad'] },
      nombre: { type: 'string' },
      borrar: { type: 'boolean' },
      largo: NUM, ancho: NUM, superficie: NUM, perimetro: NUM,
      tramos: { type: 'array', items: { type: 'object', properties: { largo: { type: 'number' }, giro: { type: 'string', enum: ['izquierda', 'derecha', ''] }, angulo: { type: 'number' } }, required: ['largo', 'giro', 'angulo'], additionalProperties: false } },
      altura: NUM,
      huecos_modo: { type: 'string', enum: ['', 'anadir', 'reemplazar'] },
      huecos: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string', enum: ['puerta', 'ventana', 'balconera'] }, uds: { type: 'number' }, ancho: NUM, alto: NUM }, required: ['tipo', 'uds', 'ancho', 'alto'], additionalProperties: false } },
      cub_tipo: { type: 'string', enum: ['', 'plana', 'inclinada'] },
      remonte: NUM, pendiente: NUM,
      faldones: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, largo: { type: 'number' }, ancho: { type: 'number' } }, required: ['nombre', 'largo', 'ancho'], additionalProperties: false } },
      prof_min: NUM, prof_max: NUM,
      fon_tipo: { type: 'string', enum: ['', 'bano', 'cocina', 'lavadero', 'otra'] },
      agua_fria: NUM, agua_fria_caliente: NUM,
      inodoro: { type: 'string', enum: ['', 'normal', 'suspendido', 'reducido', 'no'] },
      ducha: { type: 'string', enum: ['', 'plato', 'banera', 'no'] },
      mampara: SN, bide: SN, lavadora: SN, lavavajillas: SN,
      cuadro: SN, puntos_luz: NUM, tomas: NUM, segun_norma: SN, horno: SN
    },
    required: ['ref', 'ambito', 'nombre', 'borrar', 'largo', 'ancho', 'superficie', 'perimetro', 'tramos', 'altura', 'huecos_modo', 'huecos', 'cub_tipo', 'remonte', 'pendiente', 'faldones', 'prof_min', 'prof_max', 'fon_tipo', 'agua_fria', 'agua_fria_caliente', 'inodoro', 'ducha', 'mampara', 'bide', 'lavadora', 'lavavajillas', 'cuadro', 'puntos_luz', 'tomas', 'segun_norma', 'horno'],
    additionalProperties: false
  };
  const TRABAJO = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      codigo: { type: 'string' },
      buscar: { type: 'string' },
      unidad: { type: 'string', enum: ['', 'ud', 'm', 'm2', 'm3'] },
      ambito: { type: 'string', enum: ['', 'interior', 'fachada', 'cubierta', 'piscina', 'fontaneria', 'electricidad'] },
      zonas: { type: 'array', items: { type: 'string' } },
      quitar: { type: 'boolean' },
      medidas: { type: 'array', items: { type: 'object', properties: { zona: { type: 'string' }, comentario: { type: 'string' }, uds: NUM, largo: NUM, ancho: NUM, alto: NUM }, required: ['zona', 'comentario', 'uds', 'largo', 'ancho', 'alto'], additionalProperties: false } }
    },
    required: ['id', 'codigo', 'buscar', 'unidad', 'ambito', 'zonas', 'quitar', 'medidas'],
    additionalProperties: false
  };
  const CONV_SCHEMA = {
    type: 'object',
    properties: {
      zonas: { type: 'array', items: ZONA },
      trabajos: { type: 'array', items: TRABAJO },
      contenedores: NUM,
      seguridad_pct: NUM,
      accion: { type: 'string', enum: ['', 'generar', 'deshacer', 'guiado', 'pausa'] },
      mensaje: { type: 'string' },
      pregunta: { type: ['string', 'null'] },
      opciones: { type: 'array', items: { type: 'string' } }
    },
    required: ['zonas', 'trabajos', 'contenedores', 'seguridad_pct', 'accion', 'mensaje', 'pregunta', 'opciones'],
    additionalProperties: false
  };

  /** Instrucciones fijas. `trabajos`: catálogo [{id, ambito, label, u, regla}] de la app. */
  function convSystem(trabajos) {
    const cat = (trabajos || []).map((w) => w.id + ' | ' + w.ambito + ' | ' + w.label + ' | ' + w.u + (w.regla ? ' | ' + w.regla : '')).join('\n');
    return [
      'Eres el ayudante de Mediciona. Acompañas a un técnico o constructor que recorre una obra en España y te va CONTANDO, a su manera y en desorden, qué hay y qué hay que hacer, como se lo contaría a su encargado. Tú tomas nota.',
      'La app guarda una TOMA DE DATOS (zonas con sus medidas) y una lista de TRABAJOS; con eso calcula ella sola el estado de mediciones con sus reglas. Tu trabajo es traducir cada frase a CAMBIOS en esa toma y en esos trabajos, y responder SOLO con el JSON pedido.',
      '',
      'ZONAS (campo "zonas": solo las zonas que esta frase crea o cambia; en cada una, solo los datos que se han dicho; lo demás vacío: null, "" o []):',
      '- "ref": la referencia de una zona que ya existe (ver TOMA ACTUAL) o "" si es nueva. Si el usuario habla de una zona ya anotada, usa su ref.',
      '- "ambito": interior (estancias: salón, baño, dormitorio, pasillo, sótano, local…), fachada, cubierta, piscina, fontaneria (instalación de agua de una estancia), electricidad (instalación eléctrica de una estancia).',
      '- "nombre": nombre corto con mayúscula inicial: «Salón», «Baño 1», «Dormitorio de la niña», «Fachada principal», «Cubierta», «Piscina». Las instalaciones llevan el nombre de su estancia («Baño 1»).',
      '- Planta (interior, cubierta plana, piscina): si es rectangular, "largo" y "ancho" («4 por 3»). Si la describe pared a pared, "tramos" en orden con el giro que hace DESPUÉS de cada pared y el ángulo (90 si no lo dice). Si da directamente la superficie o el perímetro, "superficie" / "perimetro". NO calcules áreas ni perímetros tú.',
      '- "altura": altura libre de una estancia; en fachadas, la altura de la fachada; "largo" es el ancho de la fachada.',
      '- "huecos": puertas, ventanas y balconeras con "uds", "ancho" y "alto" en metros (si no dice el alto de una puerta, null). En fachadas, las ventanas que se descuentan. "huecos_modo": "anadir" para sumarlos a los anotados, "reemplazar" si corrige los anteriores ("no, son dos puertas, no una").',
      '- Cubierta: "cub_tipo" plana o inclinada; "remonte" de la impermeabilización (m); inclinada: "faldones" (ancho × largo en planta) y "pendiente" en %.',
      '- Piscina: "prof_min" y "prof_max" (si solo hay una profundidad, la misma en las dos).',
      '- Fontanería: "fon_tipo", "agua_fria" (puntos solo de fría), "agua_fria_caliente" (puntos de fría y caliente), "inodoro", "ducha" (plato o bañera), "mampara", "bide", "lavadora", "lavavajillas" ("si"/"no"/"").',
      '- Electricidad: "cuadro" nuevo, "puntos_luz", "tomas", "segun_norma" ("si" si pide los mínimos del reglamento), "horno" (toma de 25 A en cocina).',
      '- "borrar": true si pide quitar esa zona entera.',
      '',
      'TRABAJOS (campo "trabajos": solo los que esta frase añade, cambia o quita):',
      '- "id": el id del CATÁLOGO DE TRABAJOS de abajo que corresponda. Es lo preferible: la app ya sabe medirlos (p. ej. pintura de paredes = perímetro × altura − huecos).',
      '- Si no hay ninguno en el catálogo: "codigo" de una de las PARTIDAS CANDIDATAS de la base si alguna encaja de verdad; si tampoco, "buscar" con una descripción breve y profesional (la app la busca en la base o crea una partida nueva) y "unidad". Nunca inventes ids ni códigos.',
      '- "zonas": nombres de las zonas donde se hace (vacío = en todas las de su ámbito, p. ej. «pintar todo el piso»). "ambito" solo si no hay id.',
      '- "quitar": true si dice que ese trabajo no se hace o lo descarta.',
      '- "medidas": SOLO cuando el usuario da una medida propia de ese trabajo que no sale de la zona: «picar 2 metros cuadrados de la pared del baño», «tres sumideros», «hay que reparar cuatro metros de pilar», «un tabique de 3,20 por 2,60». Cada medida con su "zona", un "comentario" corto y uds/largo/ancho/alto en metros (m2 de pared: largo y alto; suelo: largo y ancho; m: largo; ud: uds).',
      '- Patologías que se ven (pilares o vigas con armaduras oxidadas, humedades, grietas, desconchados): trabajos de reparación con sus medidas, como cualquier otro.',
      '- La gestión de residuos y la seguridad y salud las pone la app sola. Si dice cuántos contenedores, "contenedores"; si dice el porcentaje de seguridad y salud, "seguridad_pct".',
      '',
      'CÓMO ENTENDER AL USUARIO:',
      '1. Va saltando de un sitio a otro y mezcla medidas y trabajos: anota todo lo que diga en la zona que corresponda, aunque venga en desorden. Si no dice la zona, es la última de la que se ha hablado (ver CONVERSACIÓN y ZONA EN CURSO).',
      '2. Números hablados: «tres con cuarenta» = 3,40; «dos sesenta» = 2,60; «cuatro veinte» = 4,20; «340» sin unidad = 3,40 m; «80» en un hueco = 0,80 m. Centímetros a metros.',
      '3. Correcciones («no, eran 3,50», «el salón no, el comedor», «la ventana era de 1,40 de alto»): manda la zona con el dato corregido (y los huecos con "reemplazar" si cambia alguno).',
      '4. «Lo mismo que el salón», «igual que el otro dormitorio»: copia esos datos de la TOMA ACTUAL.',
      '5. Distingue quitar/demoler/levantar/picar (demoliciones) de poner/colocar/hacer nuevo. «Cambiar el suelo» = demoler el existente y colocar uno nuevo (dos trabajos).',
      '6. Si una frase solo cuenta cosas («aquí hay humedad», «esto está fatal») sin trabajo claro, anótalo como trabajo de reparación si es evidente; si no, pregunta qué se va a hacer.',
      '7. Órdenes en "accion": «genera las mediciones / ya está / terminamos» = "generar"; «deshaz eso / borra lo último» = "deshacer"; «para / espera» = "pausa"; «prefiero que me preguntes tú / modo guiado» = "guiado".',
      '',
      'CUÁNDO PREGUNTAR ("pregunta"): el protagonista es el usuario. Mientras está contando cosas, NO interrumpas: no preguntes nada y deja "mensaje" vacío o casi. Pregunta solo:',
      '- si algo es ambiguo de verdad y no se puede anotar (¿qué zona?, ¿qué trabajo?);',
      '- o si la frase es corta y parece que ha terminado de contar algo y falta un dato imprescindible de la lista FALTA PARA MEDIR (empieza por el de la zona de la que acaba de hablar);',
      '- o si pide generar las mediciones y queda algo en FALTA PARA MEDIR: entonces pregunta lo primero que falte.',
      'Una sola pregunta, corta, que pida un solo dato, con "opciones" si ayudan (máximo 4, muy cortas). Nunca preguntes algo que ya está en la TOMA ACTUAL.',
      '',
      'EL MENSAJE ("mensaje"): español de España, como un compañero de obra, MUY corto (máximo 12 palabras) porque se lee en voz alta. La app ya repite en voz alta lo que ha anotado (medidas y trabajos), así que NO repitas números ni listes trabajos: normalmente vacío. Úsalo solo para algo que la app no diga (una aclaración o una respuesta a una pregunta del usuario).',
      '',
      'CATÁLOGO DE TRABAJOS (id | ámbito | trabajo | unidad | cómo se mide):',
      cat
    ].join('\n');
  }

  const f2 = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
  /** Mensaje de usuario con el estado actual. */
  function buildConvUser(ctx) {
    const zs = (ctx.zonas || []).map((z) => z.ref + ' | ' + z.ambito + ' | ' + z.nombre + (z.datos ? ' | ' + z.datos : '')).join('\n');
    const ws = (ctx.trabajos || []).map((w) => (w.id || w.codigo) + ' | ' + w.label + ' | en: ' + (w.zonas || []).join(', ')).join('\n');
    const c = (ctx.candidatas || []).map((d) => d.c + ' | ' + d.u + ' | ' + d.r).join('\n');
    return [
      'FRASE DEL USUARIO: «' + ctx.frase + '»',
      ctx.zona ? 'ZONA EN CURSO: ' + ctx.zona : '',
      'TOMA ACTUAL (ref | ámbito | nombre | datos):\n' + (zs || '(nada todavía)'),
      'TRABAJOS ANOTADOS (id | trabajo | zonas):\n' + (ws || '(ninguno)'),
      ctx.faltan && ctx.faltan.length ? 'FALTA PARA MEDIR:\n- ' + ctx.faltan.join('\n- ') : 'FALTA PARA MEDIR: nada',
      ctx.esperando ? 'LA APP ACABA DE PREGUNTAR: ' + ctx.esperando : '',
      ctx.historial && ctx.historial.length ? 'CONVERSACIÓN RECIENTE:\n' + ctx.historial.map((m) => (m.who === 'user' ? 'Usuario: ' : 'App: ') + m.text).join('\n') : '',
      c ? 'PARTIDAS CANDIDATAS DE LA BASE (código | unidad | resumen):\n' + c : ''
    ].filter(Boolean).join('\n\n');
  }
  /** Las respuestas de Claude usan "" y 0 para «sin dato»: se vuelven null. */
  function normaliza(out) {
    const N = (v) => (v === '' || v === 0 ? null : v);
    if (!out || typeof out !== 'object') return null;
    (out.zonas || []).forEach((z) => {
      ['largo', 'ancho', 'superficie', 'perimetro', 'altura', 'remonte', 'pendiente', 'prof_min', 'prof_max', 'agua_fria', 'agua_fria_caliente', 'puntos_luz', 'tomas'].forEach((k) => { z[k] = N(z[k]); });
      (z.huecos || []).forEach((h) => { h.ancho = N(h.ancho); h.alto = N(h.alto); if (!h.uds) h.uds = 1; });
    });
    (out.trabajos || []).forEach((w) => (w.medidas || []).forEach((m) => { ['uds', 'largo', 'ancho', 'alto'].forEach((k) => { m[k] = N(m[k]); }); }));
    out.contenedores = N(out.contenedores); out.seguridad_pct = N(out.seguridad_pct);
    if (out.pregunta === '') out.pregunta = null;
    return out;
  }
  const api = { CONV_SCHEMA, convSystem, buildConvUser, normaliza };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConvAI = api;
})(typeof self !== 'undefined' ? self : this);
