/* ============================================================
 * ASISTENTE GUIADO (toma de datos → selección de trabajos → mediciones)
 *  1) "¿Qué vamos a medir?" → vivienda, estancia, instalaciones, fachada,
 *     cubierta u otra cosa.
 *  2) El asistente pide las medidas paso a paso (recorrido de paredes,
 *     alturas, huecos, fachadas, faldones, puntos de agua…) y las guarda
 *     en obra.toma.
 *  3) El usuario elige en la pantalla los trabajos de cada capítulo y la
 *     app genera el estado de mediciones a partir de lo medido.
 * Si no entiende una respuesta la vuelve a pedir con otras palabras y, al
 * segundo intento, consulta a la IA con la pregunta en curso.
 * Sin DOM: se prueba en Node igual que el motor.
 * ============================================================ */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const { norm, tokenize, parseMeasure, calcPlanta, plantaSVG, parseRecorrido, estanciaName, fmt, fmtUds, round2, unitSpoken, orientOf } = E;
  const cap = (s) => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const art = (est) => {
    const n = norm(est), w0 = n.split(' ')[0];
    if (/^(cocina|terraza|galeria|entrada|habitacion|escalera|azotea|cubierta|fachada|despensa|zona|planta|oficina|sala|suite|bodega|tienda|nave|piscina|lavanderia)/.test(n) || (/(a|ion)$/.test(w0) && !/^(dia|sofa|clima|sistema|tema|programa)$/.test(w0))) return 'la ' + est.toLowerCase();
    return 'el ' + est.toLowerCase();
  };
  const contentLen = (n) => n.split(/\s+/).filter((w) => w.length > 3).length;
  const deArt = (est) => { const a = art(est); return a.startsWith('el ') ? 'del ' + a.slice(3) : 'de ' + a; };
  const plural = (n, s, p) => (Math.abs(n) === 1 ? s : (p || s + 's'));

  /* ---------------- Lectura de respuestas ---------------- */
  const SI = /^(si|sip|claro|correcto|afirmativo|eso es|por supuesto|ok|okey|vale|venga|de acuerdo|tiene|lleva|hay|efectivamente|exacto|asi es|lo tiene|tambien|yes)\b/;
  const NO = /^(no|nop|ninguno|ninguna|nada|tampoco|sin|negativo|para nada|no tiene|no lleva|no hay)\b/;
  function yesNo(n) { if (NO.test(n)) return false; if (SI.test(n)) return true; return null; }
  const FIN = /^(ya esta|ya|listo|lista|hecho|termin|terminado|terminamos|fin|nada mas|no hay mas|ninguna mas|ninguno mas|no mas|eso es todo|es todo|basta|siguiente|seguimos|vale ya|ya he terminado|he terminado|cierra|cierro|ninguna|ninguno|no)\b/;
  // El tokenizador del motor ya pasa «30 cm» y «300 mm» a metros: aquí no se vuelve a convertir
  function cmv(v) { return v; }
  /** Primer número de la frase (en metros si dice cm/mm). */
  function num(text) {
    const t = tokenize(text).filter((x) => x.k === 'N');
    return t.length ? cmv(t[0].v, t[0]) : null;
  }
  /** Número entero pequeño (cantidades: puntos, tipos, unidades). */
  function count(text) {
    const n = norm(text);
    if (/\b(salon|comedor|cocina|bano|aseo|dormitorio|habitacion|pasillo|recibidor|terraza|estancia|planta|fachada|pilar|viga)\b/.test(n)) return null;
    if (/^(ninguno|ninguna|nada|cero|no tiene|no hay|ningun)\b/.test(n)) return 0;
    const v = num(text);
    return v !== null && v >= 0 && v < 1000 ? Math.round(v) : null;
  }
  /** Ancho y alto ("12 por 7", "12 de ancho y 7 de alto", "ancho 12 alto 7"). */
  function dims2(text) {
    const n = norm(text);
    const r = {};
    const lab = n.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros)?\s*de\s*(ancho|largo|alto|altura|longitud)/g) || [];
    lab.forEach((m) => { const mm = m.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros)?\s*de\s*(\w+)/); const v = parseFloat(mm[1].replace(',', '.')); if (/alt/.test(mm[2])) r.alto = v; else r.ancho = v; });
    if (r.ancho != null || r.alto != null) return r;
    const pm = parseMeasure(text);
    if (pm.labeled.l != null) r.ancho = pm.labeled.l;
    if (pm.labeled.a != null) r.ancho = r.ancho ?? pm.labeled.a;
    if (pm.labeled.h != null) r.alto = pm.labeled.h;
    const d = pm.dims.slice();
    if (pm.n !== null && !d.length && r.ancho == null) d.push(pm.n);
    if (r.ancho == null && d.length) r.ancho = d.shift();
    if (r.alto == null && d.length) r.alto = d.shift();
    const big = (v) => (v != null && v > 30 && Number.isInteger(v) ? round2(v / 100) : v);
    if (pm.cm) { if (r.ancho != null) r.ancho = round2(r.ancho / 100); if (r.alto != null) r.alto = round2(r.alto / 100); }
    else { r.ancho = big(r.ancho); r.alto = big(r.alto); }
    return r;
  }
  /** Etiqueta libre de una frase (quita números y muletillas). */
  function etiqueta(text) {
    const w = String(text).replace(/\d+(?:[.,']\d+)?/g, ' ').split(/[\s,;:.]+/).filter(Boolean);
    const FUERA = /^(por|de|del|y|x|metros?|m|cm|centimetros?|ancho|alto|altura|largo|mide|tiene|con|coma|la|el|misma|mismo|igual|que|anterior|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|faldon)$/;
    const out = w.filter((x) => !FUERA.test(norm(x)));
    return cap(out.join(' ').trim());
  }

  /* ---------------- Autocorrecciones dentro de una frase ----------------
   * «una puerta de 0,82 por 2,30, no, perdón, 2,03» → «una puerta de 0,82 por 2,03»
   * «dos sesenta… digo dos setenta» → «2,7» · «12 por 7, no, 8 de alto» → «12 por 8» */
  const MARCA = /^(no|noo|perdon|perdona|digo|corrijo|rectifico|error|espera|mejor|dicho|quiero|decir|sea|equivocado|equivoque|me|he|era|eran|es|son)$/;
  const MARCA_INI = /^(no|noo|perdon|perdona|digo|corrijo|rectifico|error|espera|mejor|quiero|sea|equivocado|equivoque)$/;
  const numTxt = (v) => String(round2(v)).replace('.', ',');
  const txtTok = (t) => (t.k === 'N' ? (t.art ? t.orig : numTxt(t.v)) : t.w);
  function corregirFrase(text) {
    let tk = tokenize(String(text));
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const esN = (t) => t.k === 'N' && !t.art;
      // última marca de corrección con números delante y detrás
      let i0 = -1;
      for (let i = tk.length - 1; i > 0; i--) {
        if (tk[i].k === 'W' && MARCA_INI.test(tk[i].n) && !(tk[i].n === 'mejor' && !(tk[i + 1] && tk[i + 1].n === 'dicho')) && !(tk[i].n === 'quiero' && !(tk[i + 1] && tk[i + 1].n === 'decir'))) {
          if (tk.slice(0, i).some(esN) && tk.slice(i + 1).some(esN)) { i0 = i; break; }
        }
      }
      if (i0 < 0) break;
      // la marca puede ser una racha («no, perdón, digo»): se salta entera
      let a = i0; while (a > 0 && tk[a - 1].k === 'W' && MARCA.test(tk[a - 1].n)) a--;
      let b = i0; while (b + 1 < tk.length && tk[b + 1].k === 'W' && MARCA.test(tk[b + 1].n)) b++;
      const izq = tk.slice(0, a), der = tk.slice(b + 1);
      const iN = izq.map((t, k) => (esN(t) ? k : -1)).filter((k) => k >= 0);
      const dN = der.filter(esN);
      const etiqueta = der.find((t) => t.k === 'W' && /^(alto|altura|ancho|anchura|largo|longitud)$/.test(t.n));
      let res;
      if (dN.length === 1 && etiqueta && iN.length >= 2) {
        res = izq.slice(); const k = /^alt/.test(etiqueta.n) ? iN[iN.length - 1] : iN[0]; res[k] = Object.assign({}, res[k], { v: dN[0].v });
      } else if (dN.length < iN.length) {
        res = izq.slice(); const sust = iN.slice(iN.length - dN.length);
        sust.forEach((k, j) => { res[k] = Object.assign({}, res[k], { v: dN[j].v }); });
        der.filter((t) => t.k === 'W' && /^(izquierda|derecha|grados?)$/.test(t.n)).forEach((t) => res.push(t));
      } else {
        const lead = []; for (const t of izq) { if (esN(t)) break; lead.push(t); }
        const derLead = []; for (const t of der) { if (esN(t)) break; derLead.push(t); }
        const pre = derLead.some((t) => t.k === 'W' && !/^(de|la|el|es|son|era|a|y)$/.test(t.n)) ? [] : lead.slice();
        let d2 = der.slice(); while (pre.length && d2.length && pre[pre.length - 1].k === 'W' && d2[0].k === 'W' && pre[pre.length - 1].n === d2[0].n) d2 = d2.slice(1);
        res = pre.concat(d2);
      }
      tk = res;
    }
    return tk.map(txtTok).join(' ');
  }

  /** Primera versión oída: lo dicho antes de la primera marca de corrección (con números a ambos lados). */
  function primeraVersion(text) {
    const tk = tokenize(String(text)); const esN = (t) => t.k === 'N' && !t.art;
    for (let i = 1; i < tk.length; i++) {
      if (tk[i].k === 'W' && MARCA_INI.test(tk[i].n) && tk.slice(0, i).some(esN) && tk.slice(i + 1).some(esN)) {
        let a = i; while (a > 0 && tk[a - 1].k === 'W' && MARCA.test(tk[a - 1].n)) a--;
        return tk.slice(0, a).map(txtTok).join(' ');
      }
    }
    return null;
  }
  /* Correcciones de palabra («una puerta, digo una ventana»): categorías de palabras que se sustituyen entre sí */
  const CATS = [
    /^(puertas?|ventanas?|balconeras?|ventanal(es)?|huecos?)$/, /^(plana|inclinada|azotea|tejado)$/, /^(plato|banera|ducha)$/,
    /^(derecha|izquierda)$/, /^(fontaneria|electricidad|instalaciones)$/, /^(reducido|normal|suspendido)$/,
    /^(unidades|unidad|metros?|cuadrados?|cubicos?|lineales?)$/, /^(norte|sur|este|oeste|principal|trasera|lateral|delantera|posterior)$/,
    /^(salon|comedor|cocina|bano|aseo|dormitorio|habitacion|pasillo|recibidor|terraza|balcon|galeria|lavadero|despacho|estudio|vestidor|trastero|garaje|sotano|cuarto|sala|local|oficina|entrada|distribuidor)$/,
    /^(pilar|pilares|viga|vigas|canto|cantos|muro|techo|forjado)$/, /^(si|no)$/
  ];
  const catDe = (w) => CATS.findIndex((re) => re.test(w));
  const FUERTE = /\b(digo|perdon|perdona|mejor dicho|quiero decir|me he equivocado|me equivoque|corrijo|rectifico|o sea)\b/;
  /** Dos versiones de una frase con corrección de palabra, o null. */
  function versionesPalabra(text, estricto) {
    const orig = String(text).replace(/(?<!\d)[.,;:]|[.,;:](?!\d)|[!?¡¿]/g, ' ').split(/\s+/).filter(Boolean);
    const w = orig.map((x) => norm(x));
    // última marca: fuerte, o «no» entre dos palabras de la misma categoría
    let a = -1, b = -1;
    for (let i = w.length - 1; i > 0; i--) {
      const dos = w[i - 1] + ' ' + w[i];
      if (/^(mejor dicho|quiero decir|me equivoque|o sea)$/.test(dos)) { a = i - 1; b = i; break; }
      if (/^(he equivocado)$/.test(dos) && w[i - 2] === 'me') { a = i - 2; b = i; break; }
      if (/^(digo|perdon|perdona|corrijo|rectifico)$/.test(w[i])) { a = i; b = i; break; }
      if (w[i] === 'no' && i + 1 < w.length) {
        const der = w.slice(i + 1).map(catDe).filter((c) => c >= 0 && c !== CATS.length - 1);
        const izq = w.slice(0, i).map(catDe).filter((c) => c >= 0 && c !== CATS.length - 1);
        if (der.length && izq.includes(der[0])) { a = i; b = i; break; }
      }
    }
    if (a < 1 || b >= w.length - 1) return null;
    while (a > 0 && /^(no|perdon|perdona|digo|eh|bueno)$/.test(w[a - 1])) a--;
    while (b + 1 < w.length && /^(no|perdon|perdona|digo|eh|bueno|que)$/.test(w[b + 1])) b++;
    const L = orig.slice(0, a), Rr = orig.slice(b + 1), lw = w.slice(0, a), rw = w.slice(b + 1);
    if (!L.length || !Rr.length) return null;
    // ¿Qué palabra corrige? La primera de la derecha con categoría conocida, sustituida en la izquierda
    for (let j = 0; j < rw.length; j++) {
      const c = catDe(rw[j]); if (c < 0) continue;
      let k = -1; for (let q = lw.length - 1; q >= 0; q--) if (catDe(lw[q]) === c) { k = q; break; }
      if (k >= 0) {
        // Expresión entera de esa categoría («plato de ducha» → «bañera»)
        let k0 = k; while (k0 - 2 >= 0 && lw[k0 - 1] === 'de' && catDe(lw[k0 - 2]) === c) k0 -= 2;
        const ART = /^(el|la|los|las|un|una|unos|unas)$/;
        let ini = k0, nuevo = [Rr[j]];
        if (j > 0 && ART.test(rw[j - 1]) && k0 > 0 && ART.test(lw[k0 - 1])) { nuevo = [Rr[j - 1], Rr[j]]; ini = k0 - 1; }
        const v2 = L.slice(0, ini).concat(nuevo, L.slice(k + 1), Rr.slice(j + 1));
        return [L.join(' '), v2.join(' ')];
      }
    }
    // Sin palabra equivalente: la segunda versión es lo dicho después de la marca
    return estricto ? null : [L.join(' '), Rr.join(' ')];
  }
  /** Texto para leer y mostrar: los números con dos decimales. */
  const verTxt = (text) => tokenize(String(text)).map((t) => (t.k === 'N' ? (t.art ? t.orig : Number.isInteger(t.v) ? String(t.v) : fmt(t.v)) : t.w)).join(' ');
  /** Versión corta para elegir: solo números y palabras con significado (sin lo mal oído). */
  const verCorto = (text) => tokenize(String(text)).filter((t) => t.k === 'N' || /^(por|x|de|puertas?|ventanas?|balconeras?|alto|ancho|largo|derecha|izquierda|grados|fachada|faldon|y)$/.test(t.n)).map((t) => (t.k === 'N' ? (t.art ? t.orig : Number.isInteger(t.v) ? String(t.v) : fmt(t.v)) : t.w)).join(' ').replace(/\b(de|y|por)\s+(?=(de|y|por)\b)/g, '').replace(/^(de|y|por)\s+|\s+(de|y|por)$/g, '').trim();
  const huecosTxt = (hs) => (hs && hs.length ? hs.map((x) => fmtUds(x.uds || 1) + ' ' + plural(x.uds || 1, x.bal ? 'balconera' : x.tipo) + ' de ' + fmt(x.an) + ' por ' + (x.al ? fmt(x.al) : '¿?')).join(', ') : 'ninguno');
  // Frases que corrigen algo dicho antes («las ventanas de antes son puertas», «en realidad eran dos»…)
  const CORR_REF = /(de antes|anterior|anteriores|en realidad|me he equivocado|me equivoque|me he confundido|no son|no es|no eran|no era|eran|cambia|cambiar|corrige|corregir|rectifica|equivocad|lo de antes|las de antes|los de antes)/;
  const numsDe = (text) => tokenize(String(text)).filter((t) => t.k === 'N' && !t.art).map((t) => round2(t.v));

  /** Modo breve: quita ejemplos y explicaciones, deja la pregunta. */
  function abreviar(t) {
    let x = String(t).replace(/,?\s*(?:por ejemplo|p\. ej\.?),?\s*«[^»]*»(?:\s*(?:,|o|y)\s*«[^»]*»)*/gi, '').replace(/\s*\([^)]*\)/g, '');
    const frases = (x.match(/[^.?!]+[.?!]*/g) || [x]).map((f) => f.trim()).filter(Boolean);
    const fuera = /(si es rectangular|si tiene la misma altura|se descontar|si quieres|lo normal|normalmente|puedes añadir|tambi[eé]n puedes|dime tambi[eé]n|con eso hago|aplico un|si conoces la pendiente|cuando termines|puedes numerarlas|si te resulta|si prefieres|o di «atr[aá]s»)/i;
    const quedan = frases.filter((f) => !fuera.test(f));
    return (quedan.length ? quedan : frases.slice(-1)).join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  /* ---------------- Recorrido de paredes ---------------- */
  const ANG = new Set([30, 45, 60, 90, 120, 135, 150, 180, 270]);
  /** Lee paredes dictadas: "4 derecha 3 derecha…", "pared uno 4 metros, giro 90 a la derecha…",
   *  "4 por 3" (rectángulo) o "superficie 18 perímetro 17". */
  function parseWalk(text) {
    const n = norm(text);
    // Superficie y perímetro directos
    const ms = n.match(/superficie\s*(?:de|es|son)?\s*([\d.,]+)/), mp = n.match(/perimetro\s*(?:de|es|son)?\s*([\d.,]+)/);
    if (ms || mp) return { directo: { area: ms ? parseFloat(ms[1].replace(',', '.')) : null, perimetro: mp ? parseFloat(mp[1].replace(',', '.')) : null } };
    const hayGiro = /(izquierda|derecha|giro|gira|grados)/.test(n);
    // Rectángulo: "4 por 3", "es rectangular de 4 por 3"
    if (!hayGiro && /\bpor\b|x/.test(n)) {
      const d = dims2(text);
      if (d.ancho > 0 && d.alto > 0) return { rect: [d.ancho, d.alto] };
    }
    if (/pared/.test(n) && hayGiro) { const r = parseRecorrido(text); if (r) return { tramos: r }; }
    if (!hayGiro) {
      const tk = tokenize(text).filter((x) => x.k === 'N' && !x.art);
      if (tk.length === 1 && (tk[0].unit || /\b(pared|metros?)\b/.test(n)) && tk[0].v >= 0.3) return { tramos: [{ l: cmv(tk[0].v, tk[0]), giro: '', ang: 90 }] };
      return null;
    }
    const s = n.replace(/(\d+)\s*[°º]/g, '$1 grados');
    const tk = tokenize(s);
    const out = [];
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i];
      if (t.k === 'N') {
        const nx = tk[i + 1], pv = tk[i - 1];
        const esAng = (nx && nx.k === 'W' && /^grados?$/.test(nx.n)) || (ANG.has(t.v) && !t.unit && out.length && ((pv && pv.k === 'W' && /^(giro|gira|giramos|a|izquierda|derecha)$/.test(pv.n)) || (nx && nx.k === 'W' && /^(a|hacia|izquierda|derecha)$/.test(nx.n))));
        if (esAng) { if (out.length) out[out.length - 1].ang = t.v; continue; }
        if (pv && pv.k === 'W' && pv.n === 'pared' && tk[i + 1] && tk[i + 1].k === 'N') continue; // "pared 2, 3 metros": el 2 es el número de pared
        let l = cmv(t.v, t);
        if (!t.unit && Number.isInteger(l) && l >= 100) l = round2(l / 100);
        if (l > 0 && l < 200) out.push({ l: round2(l), giro: '', ang: 90 });
      } else if (t.k === 'W' && (t.n === 'izquierda' || t.n === 'derecha')) {
        if (out.length && !out[out.length - 1].giro) out[out.length - 1].giro = t.n;
      }
    }
    return out.length ? { tramos: out } : null;
  }
  function rectTramos(a, b) { return [{ l: a, giro: 'derecha', ang: 90 }, { l: b, giro: 'derecha', ang: 90 }, { l: a, giro: 'derecha', ang: 90 }, { l: b, giro: 'derecha', ang: 90 }]; }

  /* ---------------- Huecos (puertas y ventanas) ---------------- */
  function parseHuecos(text) {
    // Trozos: «una puerta de 80», «una de 90», «y una ventana de 60 por 90», «otra igual»…
    const limpio = String(text).replace(/^\s*(?:son|es|hay|tiene|tengo|pues|vale|si|sí)[\s,]+/i, '');
    const parts = limpio.replace(/(\d)\s+(?=(?:una|un|otra|otro)\s)/gi, '$1, ').split(/\s*(?:,|;|\by\b|\bmas\b|\bmás\b)\s+(?:luego\s+|tambi[eé]n\s+|adem[aá]s\s+|despu[eé]s\s+)?(?=(?:otra|otro|una|un|dos|tres|cuatro|cinco|seis)\b|\d+\s+(?:puertas?|ventanas?|balconeras?|de)\b)|\s*,\s*(?=(?:puertas?|ventanas?|balconeras?))/i);
    const out = [];
    let tipoPrev = null;
    for (const p of parts) {
      const n = norm(p);
      let tipo = /(puerta|balconera)/.test(n) ? 'puerta' : /(ventana|ventanal|hueco|vent)/.test(n) ? 'ventana' : null;
      const pm = parseMeasure(p);
      let uds = pm.n;
      if (uds == null) { const m = n.match(/^(?:hay\s+|tiene\s+)?(dos|tres|cuatro|cinco|seis|\d+)\s+(puertas?|ventanas?|balconeras?|de\b)/); if (m) uds = /^\d/.test(m[1]) ? +m[1] : { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }[m[1]]; }
      let d = pm.dims.slice();
      if (uds != null && d.length === 3 && pm.n === null) d = d.slice(1);
      if (uds != null && pm.n === null && d.length && d[0] === uds && /^(dos|tres|cuatro|cinco|seis|\d+)\s+de\b/.test(n)) d = d.slice(1);
      const conv = (v) => (v == null ? v : (pm.cm || (v > 10 && Number.isInteger(v)) ? round2(v / 100) : v));
      let an = conv(d[0]), al = conv(d[1]);
      if (!tipo && an == null) continue;
      if (!tipo) tipo = tipoPrev || (al >= 1.9 && an <= 1.2 ? 'puerta' : 'ventana'); // «una de 90»: mismo tipo que el anterior
      tipoPrev = tipo;
      out.push({ tipo, uds: uds || 1, an: an ?? null, al: al ?? null, bal: /balconera/.test(n) });
    }
    return out;
  }

  /* ---------------- Normativa REBT (ITC-BT-25, electrificación básica) ---------------- */
  function rebt(nombre, area) {
    const n = norm(nombre || ''); const s = area || 0;
    const porM2 = (k, min) => Math.max(min, Math.ceil(s / k));
    if (/salon|comedor|estar|sala/.test(n)) return { luz: porM2(10, 1), tomas: porM2(6, 3), nota: '1 punto de luz cada 10 m² y 1 toma cada 6 m² (mínimo 3)' };
    if (/dormitorio|habitacion|cuarto|suite/.test(n)) return { luz: porM2(10, 1), tomas: porM2(6, 3), nota: '1 punto de luz cada 10 m² y 1 toma cada 6 m² (mínimo 3)' };
    if (/bano|aseo/.test(n)) return { luz: 1, tomas: 1, nota: '1 punto de luz y 1 toma' };
    if (/cocina/.test(n)) return { luz: porM2(10, 1), tomas: 5, c3: 1, nota: '1 punto de luz cada 10 m², 2 tomas de uso general, 3 sobre la encimera y 1 de 25 A para cocina y horno' };
    if (/pasillo|distribuidor/.test(n)) return { luz: Math.max(1, Math.ceil(s / 5)), tomas: 1, nota: '1 punto de luz cada 5 m de longitud y 1 toma' };
    if (/recibidor|entrada|hall|vestibulo/.test(n)) return { luz: 1, tomas: 1, nota: '1 punto de luz y 1 toma' };
    if (/terraza|balcon|porche|patio/.test(n)) return { luz: porM2(10, 1), tomas: 0, nota: '1 punto de luz cada 10 m²' };
    if (/garaje|trastero/.test(n)) return { luz: porM2(10, 1), tomas: porM2(10, 1), nota: '1 punto de luz y 1 toma cada 10 m²' };
    if (/lavadero|galeria|lavanderia/.test(n)) return { luz: 1, tomas: 1, nota: '1 punto de luz y 1 toma' };
    return { luz: porM2(10, 1), tomas: porM2(6, 1), nota: '1 punto de luz cada 10 m² y 1 toma cada 6 m²' };
  }

  /* ============================================================
   * CATÁLOGO DE TRABAJOS TÍPICOS
   *  c: código de la base · q: búsqueda si la base no lo tiene · u: unidad
   *  regla: cómo se mide a partir de la toma de datos
   *  def: zonas en las que se marca por defecto (regex sobre el nombre)
   * ============================================================ */
  const T = (ambito, capitulo, id, label, u, c, regla, extra) => Object.assign({ ambito, capitulo, id, label, u, c, regla, q: label }, extra || {});
  const TRABAJOS = [
    // ---- Interior (vivienda / estancia) ----
    T('interior', 'Demoliciones', 'dem_mob_coc', 'Levantado de mobiliario de cocina', 'm', 'DSC020', 'preguntar', { zonas: /cocina/, pide: '¿Cuántos metros de mobiliario de cocina hay que levantar en {zona}?' }),
    T('interior', 'Demoliciones', 'dem_mob_bano', 'Levantado de aparatos sanitarios y mobiliario de baño', 'ud', 'DSM020', 'ud_zona', { zonas: /bano|aseo/ }),
    T('interior', 'Demoliciones', 'dem_ins_ele', 'Levantado de instalación eléctrica', 'ud', 'DIE060', 'ud_obra'),
    T('interior', 'Demoliciones', 'dem_ins_fon', 'Levantado de instalación de fontanería', 'ud', 'DIF105', 'ud_zona', { zonas: /bano|aseo|cocina|lavadero|galeria/ }),
    T('interior', 'Demoliciones', 'dem_ins_san', 'Levantado de red de desagües', 'ud', 'DIS105', 'ud_zona', { zonas: /bano|aseo|cocina|lavadero|galeria/ }),
    T('interior', 'Demoliciones', 'dem_puertas', 'Desmontaje de puertas de paso', 'ud', 'DLP220', 'puertas_paso'),
    T('interior', 'Demoliciones', 'dem_carp_ext', 'Levantado de carpinterías exteriores', 'ud', 'DLC010', 'ud_ventanas'),
    T('interior', 'Demoliciones', 'dem_enfosc', 'Demolición de enfoscado', 'm2', 'DRF010b', 'paredes'),
    T('interior', 'Demoliciones', 'dem_yeso', 'Demolición de guarnecido de yeso', 'm2', 'DRF020b', 'paredes'),
    T('interior', 'Demoliciones', 'dem_alic', 'Demolición de alicatado', 'm2', 'DRA010', 'paredes', { zonas: /bano|aseo|cocina/ }),
    T('interior', 'Demoliciones', 'dem_gres', 'Demolición de solado de gres', 'm2', 'DRS020', 'suelo'),
    T('interior', 'Demoliciones', 'dem_terrazo', 'Demolición de solado de terrazo', 'm2', 'DRS010b', 'suelo'),
    T('interior', 'Demoliciones', 'dem_rodapie', 'Demolición de rodapiés', 'm', 'DRS021', 'rodapie'),
    T('interior', 'Demoliciones', 'dem_tarima', 'Demolición de tarima de madera', 'm2', 'DRS040', 'suelo'),
    T('interior', 'Demoliciones', 'dem_laminado', 'Demolición de suelo laminado', 'm2', 'DRS050', 'suelo'),
    T('interior', 'Demoliciones', 'dem_ftecho', 'Demolición de falso techo', 'm2', 'DRT020', 'techo'),
    T('interior', 'Demoliciones', 'dem_tab_lad', 'Demolición de tabique de ladrillo cerámico', 'm2', 'DPT020b', 'preguntar', { pide: 'Dime el largo y el alto del tabique de ladrillo a demoler en {zona}, por ejemplo «3,20 por 2,60».' }),
    T('interior', 'Demoliciones', 'dem_mares', 'Demolición de muro de marés', 'm3', 'DEC050b', 'preguntar', { pide: 'Dime largo, alto y espesor del muro de marés a demoler en {zona}, por ejemplo «4 por 2,60 por 0,20».' }),
    T('interior', 'Demoliciones', 'dem_pyl', 'Demolición de tabique o trasdosado de placa de yeso laminado', 'm2', 'DPS010', 'preguntar', { pide: 'Dime el largo y el alto del tabique de placa de yeso a demoler en {zona}.' }),
    T('interior', 'Apeos', 'apeo_met', 'Apeo con estructura metálica', 'm', 'EAP010', 'preguntar', { pide: '¿Cuántos metros de apeo metálico hacen falta en {zona}?' }),
    T('interior', 'Revestimientos', 'rev_enfosc', 'Enfoscado de mortero', 'm2', 'RPE005b', 'paredes'),
    T('interior', 'Revestimientos', 'rev_yeso', 'Guarnecido de yeso en paredes', 'm2', 'RPG010f', 'paredes'),
    T('interior', 'Revestimientos', 'rev_yeso_t', 'Guarnecido de yeso en techos', 'm2', 'RPG010', 'techo'),
    T('interior', 'Revestimientos', 'rev_alic', 'Alicatado', 'm2', 'RAG012b', 'paredes', { zonas: /bano|aseo|cocina/ }),
    T('interior', 'Solados', 'sol_gres', 'Solado de gres porcelánico', 'm2', 'RSG010h', 'suelo'),
    T('interior', 'Solados', 'sol_piedra', 'Solado de piedra natural', 'm2', 'RSP010r', 'suelo'),
    T('interior', 'Solados', 'sol_rodapie', 'Rodapié de gres porcelánico', 'm', 'RSG020', 'rodapie'),
    T('interior', 'Albañilería', 'alb_tab_lad', 'Tabique de ladrillo', 'm2', 'FFQ010e2', 'preguntar', { pide: 'Dime el largo y el alto del tabique de ladrillo nuevo en {zona}.' }),
    T('interior', 'Albañilería', 'alb_tab_pyl', 'Tabique de placa de yeso laminado', 'm2', 'FBY010', 'preguntar', { pide: 'Dime el largo y el alto del tabique de placa de yeso en {zona}.' }),
    T('interior', 'Albañilería', 'alb_ft_pyl', 'Falso techo de placa de yeso laminado', 'm2', 'RTA020d', 'techo'),
    T('interior', 'Albañilería', 'alb_ft_esc', 'Falso techo de escayola', 'm2', 'RTA010', 'techo'),
    T('interior', 'Albañilería', 'alb_ayudas', 'Ayudas de albañilería (según la superficie reformada)', 'm2', 'HYA030', 'sup_total'),
    T('interior', 'Carpintería interior', 'car_puertas', 'Puertas de paso nuevas', 'ud', 'LPM010b', 'puertas_paso', { nuevas: true }),
    T('interior', 'Pintura', 'pin_par', 'Pintura plástica en paredes', 'm2', 'RIP030', 'paredes'),
    T('interior', 'Pintura', 'pin_tec', 'Pintura plástica en techos', 'm2', 'RIP030', 'techo'),
    // ---- Fachada ----
    T('fachada', 'Fachada', 'fac_limp', 'Limpieza de fachada', 'm2', 'D3001.0040', 'fachada'),
    T('fachada', 'Fachada', 'fac_prep', 'Preparación de la superficie para pintar (rascado, lijado…)', 'm2', 'RYP020', 'fachada'),
    T('fachada', 'Fachada', 'fac_pint', 'Pintura de fachada', 'm2', 'RFP010', 'fachada'),
    T('fachada', 'Fachada', 'fac_fis', 'Reparación de fisuras', 'm', '3009.0050', 'preguntar', { pide: '¿Cuántos metros de fisuras hay que reparar en {zona}?' }),
    T('fachada', 'Fachada', 'fac_canto_emp', 'Reparación de cantos de forjado por empuje', 'm', 'EHY091', 'preguntar', { pide: '¿Cuántos metros de canto de forjado hay que reparar por empuje en {zona}?' }),
    T('fachada', 'Fachada', 'fac_canto_cor', 'Reparación de cantos de forjado por corrosión de armaduras', 'm', 'EHY090', 'preguntar', { pide: '¿Cuántos metros de canto de forjado con armaduras oxidadas hay en {zona}?' }),
    T('fachada', 'Fachada', 'fac_dem_enf', 'Demolición de enfoscado', 'm2', 'DRF010b', 'fachada'),
    T('fachada', 'Fachada', 'fac_enf', 'Enfoscado', 'm2', 'RPE010c', 'fachada'),
    T('fachada', 'Fachada', 'fac_san_h', 'Saneado de elementos de hormigón', 'm', 'EHK011', 'preguntar', { pide: '¿Cuántos metros de elementos de hormigón hay que sanear en {zona}?' }),
    T('fachada', 'Fachada', 'fac_res_h', 'Restauración de elementos de hormigón', 'm', 'EHY030', 'preguntar', { pide: '¿Cuántos metros de elementos de hormigón hay que restaurar en {zona}?' }),
    T('fachada', 'Fachada', 'fac_sellado', 'Sellado de carpinterías', 'm', 'NEC010c', 'perim_ventanas'),
    T('fachada', 'Fachada', 'fac_dem_fiola', 'Demolición de fiolas (vierteaguas)', 'm', 'DHE100', 'vierteaguas'),
    T('fachada', 'Fachada', 'fac_fiola', 'Sustitución de fiolas (vierteaguas)', 'm', 'ECS040', 'vierteaguas'),
    T('fachada', 'Medios auxiliares', 'fac_andamio', 'Montaje y desmontaje de andamio', 'm2', '0XA130', 'fachada_bruta'),
    // ---- Cubierta ----
    T('cubierta', 'Demoliciones', 'cub_dem_pl', 'Demolición de cubierta plana', 'm2', 'DQA010', 'cub_sup', { tipos: 'plana' }),
    T('cubierta', 'Demoliciones', 'cub_dem_in', 'Demolición de cubierta inclinada', 'm2', 'DQC040', 'cub_sup', { tipos: 'inclinada' }),
    T('cubierta', 'Impermeabilización', 'cub_imp', 'Impermeabilización de cubierta (con remonte en antepechos)', 'm2', 'QAX010', 'cub_imper'),
    T('cubierta', 'Impermeabilización', 'cub_sum', 'Sumideros', 'ud', 'ASI020b', 'preguntar', { tipos: 'plana', pide: '¿Cuántos sumideros tiene {zona}?' }),
    T('cubierta', 'Impermeabilización', 'cub_prueba', 'Prueba de estanqueidad', 'ud', 'XRQ010', 'ud_zona', { tipos: 'plana' }),
    T('cubierta', 'Aislamiento', 'cub_ais', 'Aislamiento térmico en cubierta', 'm2', 'NAF010f', 'cub_sup'),
    T('cubierta', 'Solados', 'cub_sol', 'Solado de cubierta', 'm2', 'RSG010j', 'cub_sup', { tipos: 'plana' }),
    T('cubierta', 'Solados', 'cub_teja', 'Cobertura de teja', 'm2', 'QTT210m', 'cub_sup', { tipos: 'inclinada' }),
    // ---- Fontanería (se marcan solos con lo respondido) ----
    T('fontaneria', 'Fontanería', 'fon_inst', 'Instalación interior de fontanería de la estancia', 'ud', null, 'fon_inst', { auto: true }),
    T('fontaneria', 'Fontanería', 'fon_af', 'Puntos de agua fría', 'ud', 'IFP010', 'fon_af', { auto: true }),
    T('fontaneria', 'Fontanería', 'fon_afc', 'Puntos de agua fría y caliente', 'ud', 'IFP020', 'fon_afc', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_ino_sus', 'Inodoro suspendido', 'ud', 'SAC020e', 'fon_ino_sus', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_ino', 'Inodoro con tanque bajo', 'ud', 'SAC020d', 'fon_ino', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_lavabo', 'Lavabo', 'ud', 'SAC020', 'fon_lavabo', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_bide', 'Bidé', 'ud', 'SAC020g', 'fon_bide', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_plato', 'Plato de ducha', 'ud', 'SAD025d', 'fon_plato', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_banera', 'Bañera', 'ud', 'SAC020h', 'fon_banera', { auto: true }),
    T('fontaneria', 'Aparatos sanitarios', 'fon_mampara', 'Mampara de ducha', 'ud', 'SMM020', 'fon_mampara', { auto: true }),
    T('fontaneria', 'Saneamiento', 'san_32', 'Desagües de Ø32 mm (lavabo, bidé)', 'ud', 'ISD005', 'san_32', { auto: true }),
    T('fontaneria', 'Saneamiento', 'san_40', 'Desagües de Ø40 mm (ducha, bañera, fregadero, lavadora, lavavajillas)', 'ud', 'ISD005b', 'san_40', { auto: true }),
    T('fontaneria', 'Saneamiento', 'san_110', 'Desagües de Ø110 mm (inodoro)', 'ud', 'ISD005c', 'san_110', { auto: true }),
    // ---- Electricidad ----
    // ---- Generales de toda obra (se marcan solas) ----
    T('obra', 'Gestión de residuos', 'gen_residuos', 'Contenedores para residuos de obra (4,2 m³)', 'ud', 'GRA010', 'residuos', { auto: true }),
    T('obra', 'Seguridad y salud', 'gen_sys', 'Seguridad y salud (partida alzada, % del presupuesto)', 'ud', 'YSS010', 'sys', { auto: true }),
    T('electricidad', 'Electricidad', 'ele_cuadro', 'Cuadro eléctrico de vivienda', 'ud', 'IEI110', 'ele_cuadro', { auto: true }),
    T('electricidad', 'Electricidad', 'ele_luz', 'Puntos de luz', 'ud', 'D1902.0080', 'ele_luz', { auto: true }),
    T('electricidad', 'Electricidad', 'ele_t16', 'Tomas de corriente de 16 A', 'ud', 'IEM060', 'ele_t16', { auto: true }),
    T('electricidad', 'Electricidad', 'ele_t25', 'Toma de 25 A para cocina y horno', 'ud', 'IEM060b', 'ele_t25', { auto: true }),
    T('electricidad', 'Electricidad', 'ele_c4', 'Tomas para lavadora, lavavajillas y termo', 'ud', 'IEM066', 'ele_c4', { auto: true })
  ];
  const CAP_ORDEN = ['Demoliciones', 'Apeos', 'Revestimientos', 'Solados', 'Albañilería', 'Carpintería interior', 'Pintura', 'Fachada', 'Medios auxiliares', 'Impermeabilización', 'Aislamiento', 'Fontanería', 'Aparatos sanitarios', 'Saneamiento', 'Electricidad', 'Otras partidas', 'Gestión de residuos', 'Seguridad y salud'];
  const AMBITO_LABEL = { obra: 'Toda la obra', interior: 'Estancias', fachada: 'Fachadas', cubierta: 'Cubiertas', fontaneria: 'Fontanería', electricidad: 'Electricidad' };

  /* ---------------- Reglas de medición ---------------- */
  const L = (com, uds, l, a, h) => ({ com, uds, l: l ?? null, a: a ?? null, h: h ?? null });
  const huecosDe = (z, tipo) => (z.huecos || []).filter((x) => !tipo || x.tipo === tipo);
  function fonApar(z) {
    const f = z.f || {}; const t = norm(z.nombre);
    const banoLike = f.tipo === 'bano' || /bano|aseo/.test(t);
    return {
      lavabo: banoLike ? 1 : 0, bide: f.bide ? 1 : 0,
      ino_sus: f.inodoro === 'suspendido' ? 1 : 0, ino: f.inodoro && f.inodoro !== 'suspendido' ? 1 : 0,
      plato: f.ducha === 'plato' ? 1 : 0, banera: f.ducha === 'banera' ? 1 : 0, mampara: f.ducha === 'plato' && f.mampara ? 1 : 0,
      fregadero: f.tipo === 'cocina' ? 1 : 0, lavadero: f.tipo === 'lavadero' ? 1 : 0,
      lavadora: f.lavadora ? 1 : 0, lavavajillas: f.lavavajillas ? 1 : 0
    };
  }
  const REGLAS = {
    suelo: (z) => (z.area ? [Object.assign(L('Superficie según planta', 1, z.area), { dePlanta: 'superficie' })] : []),
    techo: (z) => (z.area ? [Object.assign(L('Techo, superficie según planta', 1, z.area), { dePlanta: 'superficie' })] : []),
    paredes: (z) => {
      if (!z.perimetro) return [];
      const out = [Object.assign(L('Perímetro por altura', 1, z.perimetro, null, z.altura || null), { dePlanta: 'perimetro', hPend: !z.altura })];
      huecosDe(z).forEach((x) => { if (x.an && x.al) out.push(L('Deducción ' + (x.bal ? 'balconera' : x.tipo), -Math.abs(x.uds || 1), x.an, null, x.al)); });
      return out;
    },
    rodapie: (z) => {
      if (!z.perimetro) return [];
      const out = [Object.assign(L('Perímetro', 1, z.perimetro), { dePlanta: 'perimetro' })];
      huecosDe(z, 'puerta').forEach((x) => { if (x.an) out.push(L('Deducción ' + (x.bal ? 'balconera' : 'puerta'), -Math.abs(x.uds || 1), x.an)); });
      return out;
    },
    perimetro: (z) => (z.perimetro ? [Object.assign(L('Perímetro', 1, z.perimetro), { dePlanta: 'perimetro' })] : []),
    ud_zona: (z) => [L(z.nombre, 1)],
    ud_puertas: (z) => { const n = huecosDe(z, 'puerta').reduce((a, x) => a + (x.uds || 1), 0); return n ? [L('Puertas', n)] : []; },
    ud_ventanas: (z) => { const n = huecosDe(z, 'ventana').reduce((a, x) => a + (x.uds || 1), 0); return n ? [L('Ventanas', n)] : []; },
    fachada: (z) => {
      if (!z.ancho || !z.alto) return [];
      const out = [L('Fachada', 1, z.ancho, null, z.alto)];
      if (z.descontar !== false) (z.ventanas || []).forEach((v, i) => { if (v.an && v.al) out.push(L('Deducción ventana tipo ' + (i + 1), -Math.abs(v.uds || 1), v.an, null, v.al)); });
      return out;
    },
    fachada_bruta: (z) => (z.ancho && z.alto ? [L('Fachada', 1, z.ancho, null, z.alto)] : []),
    perim_ventanas: (z) => (z.ventanas || []).filter((v) => v.an && v.al).map((v, i) => Object.assign(L('Ventana tipo ' + (i + 1) + ' (' + fmt(v.an) + ' × ' + fmt(v.al) + ')', v.uds || 1, round2(2 * (v.an + v.al))), {})),
    vierteaguas: (z) => (z.ventanas || []).filter((v) => v.an).map((v, i) => L('Ventana tipo ' + (i + 1), v.uds || 1, v.an)),
    cub_sup: (z) => {
      if (z.tipo === 'plana') return z.area ? [Object.assign(L('Superficie según planta', 1, z.area), { dePlanta: 'superficie' })] : [];
      return (z.faldones || []).map((f) => L(f.nombre + ' (verdadera magnitud ×' + fmt(z.factor || 1.05) + ')', z.factor || 1.05, f.l, f.a));
    },
    cub_imper: (z) => {
      const out = REGLAS.cub_sup(z);
      if (z.tipo === 'plana' && z.perimetro) out.push(L('Remonte en antepechos', 1, z.perimetro, null, Math.max(0.2, z.remonte || 0.2)));
      return out;
    },
    fon_inst: (z) => [L(z.nombre, 1)],
    fon_af: (z) => (z.f && z.f.af ? [L(z.nombre, z.f.af)] : []),
    fon_afc: (z) => (z.f && z.f.afc ? [L(z.nombre, z.f.afc)] : []),
    fon_ino_sus: (z) => (fonApar(z).ino_sus ? [L(z.nombre, 1)] : []),
    fon_ino: (z) => (fonApar(z).ino ? [L(z.nombre + (z.f.inodoro === 'reducido' ? ', reducido' : ''), 1)] : []),
    fon_lavabo: (z) => (fonApar(z).lavabo ? [L(z.nombre, 1)] : []),
    fon_bide: (z) => (fonApar(z).bide ? [L(z.nombre, 1)] : []),
    fon_plato: (z) => (fonApar(z).plato ? [L(z.nombre, 1)] : []),
    fon_banera: (z) => (fonApar(z).banera ? [L(z.nombre, 1)] : []),
    fon_mampara: (z) => (fonApar(z).mampara ? [L(z.nombre, 1)] : []),
    // Diámetros mínimos de desagüe según CTE DB HS 5, tabla 4.1
    san_32: (z) => { const a = fonApar(z); const n = a.lavabo + a.bide; return n ? [L(z.nombre + ': ' + [a.lavabo && 'lavabo', a.bide && 'bidé'].filter(Boolean).join(', '), n)] : []; },
    san_40: (z) => { const a = fonApar(z); const k = [['ducha', a.plato], ['bañera', a.banera], ['fregadero', a.fregadero], ['lavadero', a.lavadero], ['lavadora', a.lavadora], ['lavavajillas', a.lavavajillas]].filter((x) => x[1]); const n = k.reduce((s, x) => s + x[1], 0); return n ? [L(z.nombre + ': ' + k.map((x) => x[0]).join(', '), n)] : []; },
    san_110: (z) => { const a = fonApar(z); const n = a.ino + a.ino_sus; return n ? [L(z.nombre + ': inodoro', n)] : []; },
    ele_cuadro: (z) => (z.cuadro ? [L('Cuadro general', 1)] : []),
    ele_luz: (z) => (z.e && z.e.luz ? [L(z.nombre, z.e.luz)] : []),
    ele_t16: (z) => (z.e && z.e.tomas ? [L(z.nombre, z.e.tomas)] : []),
    ele_t25: (z) => (z.e && z.e.c3 ? [L(z.nombre + ': cocina y horno', z.e.c3)] : []),
    ele_c4: (z) => (z.e && z.e.c4 && z.e.c4.length ? [L(z.nombre + ': ' + z.e.c4.join(', '), z.e.c4.length)] : [])
  };
  // Reglas que se calculan una vez para toda la obra
  /** Puertas de paso de las estancias medidas, agrupadas por medida (sin balconeras).
   *  Si el usuario corrigió el total (puertas vistas desde dos estancias) o dijo cuántas se cambian, se ajusta. */
  function puertasPaso(zs, obra) {
    const grupos = new Map();
    zs.forEach((z) => (z.huecos || []).filter((x) => x.tipo === 'puerta' && !x.bal).forEach((x) => {
      const k = fmt(x.an || 0.82) + ' × ' + fmt(x.al || 2.03);
      const gg = grupos.get(k) || { an: x.an || 0.82, al: x.al || 2.03, n: 0, est: [] };
      gg.n += x.uds || 1; if (!gg.est.includes(z.nombre)) gg.est.push(z.nombre); grupos.set(k, gg);
    }));
    const lista = [...grupos.values()].sort((a, b) => b.n - a.n);
    const g = obra.guia || {};
    const objetivo = Math.min(g.puertasCambio || Infinity, g.puertasTotal || Infinity);
    let sum = lista.reduce((a, x) => a + x.n, 0);
    while (isFinite(objetivo) && sum > objetivo && lista.length) { const mayor = lista.reduce((m, x) => (x.n > m.n ? x : m), lista[0]); mayor.n--; sum--; if (!mayor.n) lista.splice(lista.indexOf(mayor), 1); }
    return lista;
  }
  /** Volumen de escombro estimado a partir de las demoliciones medidas (m³ esponjados) y contenedores de 4,2 m³. */
  function estimarResiduos(obra) {
    let vol = 0;
    obra.partidas.forEach((p) => {
      if (p.ref === 'GRA010' || p.ref === 'YSS010') return;
      const dem = /DEMOLIC/i.test(p.chapTitle || '') || /^(demolic|levantad|desmontaj|picado|eliminaci)/i.test(p.r || '');
      if (!dem) return;
      const t = E.totalOf(p); const r = norm(p.r);
      if (p.u === 'm3') vol += t;
      else if (p.u === 'm2') vol += t * (/(tabique|fabrica|muro|forjado|losa|cubierta)/.test(r) ? 0.1 : /(solado|pavimento|terrazo|baldosa)/.test(r) ? 0.05 : 0.03);
      else if (p.u === 'm') vol += t * 0.02;
      else if (p.u === 'ud') vol += t * (/(sanitari|bano|banera|inodoro|mobiliario)/.test(r) ? 0.3 : 0.15);
    });
    const esp = round2(vol * 1.3);
    return { vol: esp, n: Math.max(1, Math.ceil(esp / 4.2)) };
  }
  const REGLAS_OBRA = {
    residuos: (zs, w, obra) => {
      const g = obra.guia || {};
      if (g.contenedores) return [L('Contenedores indicados en obra', g.contenedores)];
      const r = estimarResiduos(obra);
      return [L('Estimación según las demoliciones: ' + fmt(r.vol) + ' m³ de escombro esponjado', r.n)];
    },
    sys: (zs, w, obra) => [L('Partida alzada: ' + fmt((obra.guia && obra.guia.sysPct) || 2, 1).replace(/,0$/, '') + ' % del presupuesto de ejecución material', 1)],
    ud_obra: () => [L('Vivienda', 1)],
    puertas_paso: (zs, w, obra) => puertasPaso(zs, obra).map((x) => Object.assign(L('Puertas de ' + fmt(x.an) + ' × ' + fmt(x.al) + ' (' + x.est.join(', ') + ')', x.n), w.nuevas ? { _c: x.an <= 0.76 ? 'LPM010' : 'LPM010b' } : {})),
    sup_total: (zs) => zs.filter((z) => z.area).map((z) => Object.assign(L('Superficie reformada', 1, z.area), { est: z.nombre, dePlanta: 'superficie' }))
  };
  const CODIGO_INST = (z) => { const t = norm(z.nombre), f = (z.f && z.f.tipo) || ''; if (/aseo/.test(t)) return 'IFI010b'; if (f === 'cocina' || /cocina/.test(t)) return 'IFI010d'; if (f === 'lavadero' || /lavadero|galeria|lavanderia/.test(t)) return 'IFI010c'; return 'IFI010'; };

  const REGLA_LABEL = {
    suelo: 'Superficie del suelo', techo: 'Superficie del techo', paredes: 'Perímetro × altura − huecos', rodapie: 'Perímetro − puertas', perimetro: 'Perímetro',
    ud_zona: '1 por zona', ud_obra: '1 para toda la obra', ud_puertas: 'Nº de puertas', ud_ventanas: 'Nº de ventanas', sup_total: 'Superficie total medida',
    fachada: 'Ancho × alto − ventanas', fachada_bruta: 'Ancho × alto', perim_ventanas: 'Perímetro de las ventanas', vierteaguas: 'Ancho de las ventanas',
    cub_sup: 'Superficie (inclinadas × factor de pendiente)', cub_imper: 'Superficie + remonte en antepechos', preguntar: 'Te pregunto la medida'
  };
  const REGLAS_AMBITO = {
    interior: ['suelo', 'techo', 'paredes', 'rodapie', 'perimetro', 'ud_zona', 'ud_puertas', 'ud_ventanas', 'preguntar'],
    fachada: ['fachada', 'fachada_bruta', 'perim_ventanas', 'vierteaguas', 'ud_zona', 'preguntar'],
    cubierta: ['cub_sup', 'cub_imper', 'perimetro', 'ud_zona', 'preguntar'],
    fontaneria: ['ud_zona', 'preguntar'], electricidad: ['ud_zona', 'preguntar']
  };
  /** Regla por defecto para una partida añadida a mano desde la base. */
  function reglaPara(ambito, d) {
    const o = orientOf(d);
    if (d.u === 'm2') return ambito === 'interior' ? (o === 'V' ? 'paredes' : /techo/.test(norm(d.r)) ? 'techo' : 'suelo') : ambito === 'fachada' ? 'fachada' : ambito === 'cubierta' ? 'cub_sup' : 'preguntar';
    if (d.u === 'm') return ambito === 'interior' && /rodapi|zocalo/.test(norm(d.r)) ? 'rodapie' : ambito === 'cubierta' && /mimbel|remate|albardilla|canal/.test(norm(d.r)) ? 'perimetro' : 'preguntar';
    if (d.u === 'ud') return 'ud_zona';
    return 'preguntar';
  }
  /** Añade a la pantalla de trabajos una partida de la base elegida por el usuario. */
  function anadirExtra(obra, d, ambito) {
    const g = obra.guia || (obra.guia = {});
    g.extra = g.extra || [];
    const id = 'x_' + d.c.replace(/\W+/g, '_') + '_' + ambito;
    if (!g.extra.some((x) => x.id === id)) g.extra.push({ id, ambito, capitulo: 'Otras partidas', label: d.r, u: d.u, c: d.c, q: d.r, regla: reglaPara(ambito, d) });
    const w = g.extra.find((x) => x.id === id);
    g.sel = g.sel || {};
    g.sel[id] = { on: true, zonas: zonasDe(obra, w).map((z) => z.id) };
    return w;
  }
  /** Partida dictada por el usuario que no está en la base (se pregunta su medición al generar). */
  function anadirPropia(obra, desc, u, ambito, zonas) {
    const g = obra.guia || (obra.guia = {});
    g.extra = g.extra || [];
    const id = 'p_' + norm(desc).replace(/[^a-z0-9]+/g, '_').slice(0, 40) + '_' + ambito;
    let w = g.extra.find((x) => x.id === id);
    if (!w) { w = { id, ambito, capitulo: 'Otras partidas', label: cap(desc), u, c: null, propia: true, regla: 'preguntar', pide: (u === 'ud' ? '¿Cuántas unidades de ' : u === 'm' ? '¿Cuántos metros de ' : u === 'm3' ? 'Dime largo, ancho y alto de ' : 'Dime largo por ancho de ') + desc.toLowerCase() + ' en {zona}?' }; g.extra.push(w); }
    w.u = u;
    g.sel = g.sel || {};
    g.sel[id] = { on: true, zonas: zonas && zonas.length ? zonas : zonasDe(obra, w).map((z) => z.id) };
    return w;
  }
  /** Elimina una zona medida (estancia, fachada…) y todo lo que salió de ella. */
  function borrarZona(obra, id) {
    const t = obra.toma; if (!t) return null;
    const z = t.zonas.find((x) => x.id === id); if (!z) return null;
    t.zonas = t.zonas.filter((x) => x.id !== id);
    const g = obra.guia || {};
    Object.values(g.sel || {}).forEach((s) => { s.zonas = (s.zonas || []).filter((x) => x !== id); if (!s.zonas.length) s.on = false; });
    Object.keys(g.resp || {}).forEach((k) => { if (k.endsWith('|' + id)) delete g.resp[k]; });
    (g.preguntas || []).splice(0, Infinity, ...(g.preguntas || []).filter((q) => q.zid !== id));
    obra.partidas.forEach((p) => { p.lineas = p.lineas.filter((l) => !(l.guia && l.guia.split('|')[1] === id)); });
    obra.partidas = obra.partidas.filter((p) => !(p.guia && !p.lineas.length));
    const otra = t.zonas.some((x) => norm(x.nombre) === norm(z.nombre));
    if (!otra) {
      if (obra.plantas) delete obra.plantas[norm(z.nombre)];
      if (z.ambito === 'interior' && obra.estancias) obra.estancias = obra.estancias.filter((e) => norm(e) !== norm(z.nombre));
      if (obra.estActiva && norm(obra.estActiva) === norm(z.nombre)) obra.estActiva = '';
    }
    return z;
  }
  function buscarZona(obra, frase, ambito) {
    const zs = ((obra.toma && obra.toma.zonas) || []).filter((z) => !ambito || z.ambito === ambito);
    const n = norm(frase);
    const exact = zs.filter((z) => n.includes(norm(z.nombre)));
    if (exact.length) return exact.sort((a, b) => b.nombre.length - a.nombre.length)[0];
    const w0 = (z) => norm(z.nombre).split(' ')[0];
    const parc = zs.filter((z) => w0(z).length > 3 && n.includes(w0(z)));
    return parc.length === 1 ? parc[0] : null;
  }
  /** Trabajos que tiene sentido ofrecer para la toma de datos de la obra. */
  function trabajosPara(obra) {
    const zs = (obra.toma && obra.toma.zonas) || [];
    const amb = new Set(zs.map((z) => z.ambito));
    const extra = ((obra.guia && obra.guia.extra) || []).map((x) => Object.assign({ capitulo: 'Otras partidas' }, x));
    return TRABAJOS.concat(extra).filter((w) => (amb.has(w.ambito) || (w.ambito === 'obra' && amb.size)) && zonasDe(obra, w).length);
  }
  function zonasDe(obra, w) {
    const zs = ((obra.toma && obra.toma.zonas) || []).filter((z) => w.ambito === 'obra' || z.ambito === w.ambito);
    return zs.filter((z) => !w.tipos || z.tipo === w.tipos);
  }
  /** Selección por defecto: los trabajos automáticos con cantidad, el resto sin marcar. */
  function selDefault(obra, w) {
    if (!w.auto) return { on: false, zonas: zonasDe(obra, w).filter((z) => !w.zonas || w.zonas.test(norm(z.nombre))).map((z) => z.id) };
    if (w.ambito === 'obra') return { on: true, zonas: zonasDe(obra, w).map((z) => z.id) };
    const zs = zonasDe(obra, w).filter((z) => (w.regla === 'fon_inst' || w.regla === 'ele_cuadro') ? (w.regla === 'fon_inst' || z.cuadro) : REGLAS[w.regla](z).length);
    return { on: zs.length > 0, zonas: zs.map((z) => z.id) };
  }
  function seleccion(obra) {
    const g = obra.guia || (obra.guia = {});
    g.sel = g.sel || {};
    trabajosPara(obra).forEach((w) => { if (!g.sel[w.id]) g.sel[w.id] = selDefault(obra, w); });
    return g.sel;
  }

  /** Busca la partida en la base; si no está, otra equivalente; si tampoco, una partida nueva. */
  function resolverDoc(cat, w, code) {
    if (w.propia && !code) return null;
    const c = code || w.c;
    if (c && cat.byCode.get(c)) return cat.byCode.get(c);
    const res = cat.index.search(w.q || w.label).filter((r) => r.doc.u === w.u && r.s >= 0.55);
    return res.length ? res[0].doc : null;
  }

  /**
   * Genera (o regenera) el estado de mediciones a partir de la toma y la selección.
   * Devuelve { partidas, lineas, preguntas:[{wid, zid, pide, u}] }
   */
  function generar(obra, cat) {
    const sel = seleccion(obra);
    const zsAll = (obra.toma && obra.toma.zonas) || [];
    // Se quitan las líneas generadas antes por el asistente (se rehacen con los datos actuales)
    obra.partidas.forEach((p) => { p.lineas = p.lineas.filter((l) => !l.guia || l.guia.startsWith('manual|')); });
    obra.partidas = obra.partidas.filter((p) => !(p.guia && !p.lineas.length));
    const preguntas = [];
    let nl = 0; const tocadas = new Set();
    const nextId = (p) => p.lineas.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1;
    const partidaPara = (w, code) => {
      const d = resolverDoc(cat, w, code);
      const refs = obra.guia.refs || (obra.guia.refs = {});
      if (!d && !refs[w.id]) { obra.propiaSeq = (obra.propiaSeq || 0) + 1; refs[w.id] = 'PROPIA.' + String(obra.propiaSeq).padStart(3, '0'); }
      const ref = d ? d.c : refs[w.id];
      let p = obra.partidas.find((x) => x.ref === ref);
      if (!p) {
        p = d ? { ref: d.c, u: d.u, r: d.r, t: d.t, chap: d.chap, chapTitle: d.chapTitle, chapOrder: d.chapOrder, subTitle: d.subTitle }
          : { ref, propia: true, u: w.u, r: w.label, t: w.label, chap: 'G-' + norm(w.capitulo).replace(/\W+/g, ''), chapTitle: w.capitulo.toUpperCase(), chapOrder: 900 + CAP_ORDEN.indexOf(w.capitulo), subTitle: '' };
        Object.assign(p, { uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), lineas: [], creada: Date.now() + obra.partidas.length, guia: true });
        p.orient = /^(paredes|fachada|fachada_bruta)$/.test(w.regla) ? 'V' : /^(suelo|techo|cub_sup|cub_imper|sup_total)$/.test(w.regla) ? 'H' : orientOf(p);
        obra.partidas.push(p);
      }
      return p;
    };
    const add = (p, w, z, lines) => {
      lines.forEach((ln, i) => {
        const l = Object.assign({ id: nextId(p), est: z ? z.nombre : '' }, ln, { guia: w.id + '|' + (z ? z.id : 'obra') + '|' + i });
        if (l.hPend === false) delete l.hPend;
        p.lineas.push(l); nl++;
      });
      if (lines.length) { p.mod = Date.now(); tocadas.add(p.uid); }
    };
    const lista = trabajosPara(obra); lista.sort((a, b) => (a.ambito === 'obra') - (b.ambito === 'obra'));
    for (const w of lista) {
      const s = sel[w.id];
      if (!s || !s.on) continue;
      const zs = w.ambito === 'obra' ? zsAll.slice() : zsAll.filter((z) => s.zonas.includes(z.id) && z.ambito === w.ambito);
      if (!zs.length) continue;
      if (REGLAS_OBRA[w.regla]) {
        const lines = REGLAS_OBRA[w.regla](zs, w, obra);
        const porCodigo = new Map();
        lines.forEach((ln) => { const c = ln._c || ''; delete ln._c; porCodigo.set(c, (porCodigo.get(c) || []).concat([ln])); });
        porCodigo.forEach((ls, c) => add(partidaPara(w, c || null), w, null, ls));
        continue;
      }
      for (const z of zs) {
        if (w.regla === 'preguntar') {
          const prev = (obra.guia.resp || {})[w.id + '|' + z.id];
          if (prev && prev.length) add(partidaPara(w), w, z, prev);
          else if (!prev) preguntas.push({ wid: w.id, zid: z.id });
          continue;
        }
        const lines = (REGLAS[w.regla] || (() => []))(z, w, obra);
        if (lines.length) add(partidaPara(w, w.regla === 'fon_inst' ? CODIGO_INST(z) : null), w, z, lines);
      }
    }
    if (sel.gen_residuos && sel.gen_residuos.on && !(obra.guia || {}).contenedoresOk) preguntas.push({ wid: 'gen_residuos', zid: 'obra', residuos: true });
    E.obraChapters(obra);
    return { partidas: tocadas.size, lineas: nl, preguntas };
  }

  /* ============================================================
   * DIÁLOGO GUIADO
   * ============================================================ */
  const EST_DEF = ['Salón', 'Cocina', 'Baño 1', 'Dormitorio 1', 'Dormitorio 2', 'Pasillo', 'Terraza'];
  const FON_EST = ['Baño', 'Cocina', 'Lavadero', 'Otra'];
  const AYUDA_WALK = 'Dime cada pared en metros, en el sentido de las agujas del reloj, y hacia dónde giras: por ejemplo «4 metros, derecha, 3 metros, derecha». Si la estancia es rectangular, basta con «4 por 3».';

  class Guia {
    constructor(dialog) { this.dlg = dialog; this.fails = 0; }
    get io() { return this.dlg.io; }
    get obra() { return this.dlg.obra; }
    get g() { const o = this.obra; return o.guia || (o.guia = {}); }
    get toma() { const o = this.obra; return o.toma || (o.toma = { zonas: [] }); }
    get activo() { return !!(this.obra && this.obra.guia && this.obra.guia.paso && !this.obra.guia.fin); }
    zona(id) { return this.toma.zonas.find((z) => z.id === (id || this.g.d.zid)); }
    nuevaZona(ambito, nombre, extra) {
      this.toma.seq = (this.toma.seq || 0) + 1;
      const z = Object.assign({ id: 'z' + this.toma.seq, ambito, nombre }, extra || {});
      this.toma.zonas.push(z);
      return z;
    }
    save() { this.obra.updated = Date.now(); this.io.save(); this.io.render(); }

    /* ---- salida ---- */
    ask(text, chips, opts) {
      if (this.io.breve && this.io.breve()) text = abreviar(text);
      const c = (chips || []).slice();
      const g = this.obra && this.obra.guia;
      if (g && (g.hist || []).length && g.paso !== 'inicio' && !c.some((x) => /^(atras|volver atras)$/.test(norm(x.value || x.label || '')))) c.push({ label: '↩ Atrás', value: 'atrás' });
      this.dlg.ask(text, c, opts);
    }
    say(paso, d, pre) {
      const g = this.g;
      if (g.paso && g.paso !== paso) { g.hist = (g.hist || []).concat([{ paso: g.paso, d: g.d, toma: JSON.stringify(this.toma) }]).slice(-40); }
      g.paso = paso; g.d = Object.assign({}, d || {}); g.fin = false;
      this.fails = 0; g.conf = null; g.buf = null; g.elegir = null; this.lastFail = null;
      this.save();
      const q = this.preg(paso, g.d);
      this.ask((pre ? pre + ' ' : '') + q.t, q.c);
    }
    /** Pregunta del paso; en modo breve, la versión corta si la hay. */
    preg(paso, d) {
      const s = this.pasos[paso]; const q = s.q.call(this, d);
      if (this.io.breve && this.io.breve() && s.qb) { const t = s.qb.call(this, d); if (t) return { t, c: q.c }; }
      return q;
    }
    repetir(pre) { const q = this.preg(this.g.paso, this.g.d); this.ask((pre ? pre + ' ' : '') + q.t, q.c); }

    /* ---- entrada ---- */
    start(pre) { this.g.fin = false; this.say('inicio', {}, pre); }
    resume() { if (!this.activo) return false; this.repetir('Seguimos con la medición guiada.'); return true; }
    handle(text, n, input) {
      const g = this.g;
      this.aiTok = (this.aiTok || 0) + 1; // si había una consulta a la IA en curso, se abandona
      if (/^(para|parar|paro|stop|basta|basta ya|calla|callate|silencio|espera|pausa|para de escuchar|deja de escuchar|para ya)$/.test(n)) { this.io.pause && this.io.pause(); return; }
      if (/^(repite|repitelo|como dices|que has dicho|perdona|seguir midiendo|seguimos|continuar|continua|otra vez)$/.test(n)) return this.repetir();
      if (/^(modo breve|habla menos|sin ejemplos|menos explicaciones|modo rapido|mas corto|abrevia)\b/.test(n)) { this.io.setBreve && this.io.setBreve(true); return this.repetir('Vale, modo breve.'); }
      if (/^(modo completo|con ejemplos|mas explicaciones|explicamelo|modo normal)\b/.test(n)) { this.io.setBreve && this.io.setBreve(false); return this.repetir('Vale, te lo explico todo.'); }
      if (g.elegir) {
        const r1 = this.resolverEleccion(text, n, input);
        if (r1 !== false) return r1;
      }
      if (g.propuesta) {
        const pr = g.propuesta; const v = input && input.act && typeof input.act.ok === 'boolean' ? input.act.ok : yesNo(n);
        if (v !== null) {
          g.propuesta = null;
          if (!v) { this.save(); return this.repetir('Vale, no cambio nada. Dímelo de otra forma o di «atrás».'); }
          const z = this.zona(pr.zid);
          if (z) { if (pr.huecos) z.huecos = pr.huecos; if (pr.altura) z.altura = pr.altura; }
          this.save(); this.io.flash && this.io.flash('ok');
          return this.repetir('Corregido.');
        }
        g.propuesta = null;
      }
      // «Las ventanas de antes son puertas»: cambio de tipo de los huecos anotados
      if (!(input && input.act)) {
        const mt = n.match(/(puertas?|ventanas?|balconeras?)\b.*\b(?:son|eran|es|era|serian|en realidad son)\s+(?:unas?\s+|las?\s+|todas?\s+)?(puertas?|ventanas?|balconeras?)/);
        if (mt && mt[1].slice(0, 4) !== mt[2].slice(0, 4)) {
          const de = /^puert/.test(mt[1]) ? 'puerta' : /^balc/.test(mt[1]) ? 'balconera' : 'ventana', a = /^puert/.test(mt[2]) ? 'puerta' : /^balc/.test(mt[2]) ? 'balconera' : 'ventana';
          const z = this.zonaHuecos(n, (x) => x.tipo === (de === 'balconera' ? 'puerta' : de) && (de !== 'balconera' || x.bal));
          if (z) {
            const hs = z.huecos.map((x) => Object.assign({}, x));
            hs.forEach((x) => { if (x.tipo === (de === 'balconera' ? 'puerta' : de)) { x.tipo = a === 'balconera' ? 'puerta' : a; x.bal = a === 'balconera'; if (x.tipo === 'puerta' && !x.al) x.al = 2.03; } });
            return this.proponer(z, { huecos: hs }, 'Cambio en ' + art(z.nombre) + ' las ' + plural(2, de) + ' a ' + plural(2, a) + '. Quedaría: ' + huecosTxt(hs) + '. ¿Correcto?');
          }
        }
        // Corrección de algo dicho antes que no se resuelve con las reglas: la arregla la IA con el contexto
        if (CORR_REF.test(n) && n.split(' ').length >= 3 && /(puert|ventan|hueco|balconer|altura|alto)/.test(n) && !/(iguales? que|mism[ao]s? que)/.test(n)) {
          const z = this.zonaHuecos(n, () => true);
          if (z && this.aiOk()) return this.editarConIA(text, z);
        }
      }
      // «No, era 2,03» justo después de anotar algo: se corrige lo último sin volver atrás
      if (!(input && input.act) && g.ultima && /^(digo|perdon|perdona|me he equivocado|me equivoque|corrijo|rectifico|mejor dicho|quiero decir|no+,? (era|es|eran|son|digo|perdon) )/.test(n) && !/\d|\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/.test(n)) {
        const resto = text.replace(/^\s*(?:no+[\s,]+)?(?:digo|perd[oó]n|perdona|me he equivocado|me equivoqu[eé]|corrijo|rectifico|mejor dicho|quiero decir|era|es|eran|son)\b[\s,.:;]*/i, '').replace(/^(?:era|es|eran|son)\s+/i, '');
        const vp = resto.trim() ? versionesPalabra(g.ultima.text + ' digo ' + resto, true) : null;
        if (vp && norm(vp[0]) !== norm(vp[1])) return this.elegirEntre([g.ultima.text, vp[1]], 'ultima', 'Tengo anotado');
      }
      if (!(input && input.act) && g.ultima && /^(no+|perdon|perdona|me he equivocado|me equivoque|error|corrijo|rectifico|espera|mejor dicho|quiero decir|era|eran)\b/.test(n) && /\d|\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/.test(n)) {
        const u = g.ultima;
        const resto = text.replace(/^\s*(?:no+|perd[oó]n|perdona|me he equivocado|me equivoqu[eé]|error|corrijo|rectifico|espera|mejor dicho|quiero decir)\b[\s,.:;]*/i, '').replace(/^(?:era|eran|es|son)\s+/i, '');
        const nuevo = corregirFrase(u.text + ' , no , ' + resto), viejo = corregirFrase(u.text);
        if (numsDe(nuevo).join() !== numsDe(viejo).join()) return this.elegirEntre([viejo, nuevo], 'ultima', 'Tengo anotado');
      }
      if (!(input && input.act) && (/^(atras|anterior|deshaz|deshacer|corrige|corregir|rectifica|error)\b/.test(n) || /(me he equivocado|me equivoque|me he confundido|esta mal|eso no es|no es eso|eso no\b|vuelve atras|volver atras|vamos atras|ir atras|para atras|paso anterior|un paso atras|retrocede|no queria decir|no era eso|borra eso|quita eso|deshaz eso)/.test(n))) return this.atras();
      if (/^(ayuda|que puedo decir|no se|como)\b/.test(n) && !(input && input.act)) return this.ayuda();
      if (/^(saltar|salta|siguiente pregunta|pasa|no lo se|no se sabe|luego)$/.test(n) && this.pasos[g.paso].saltar) return this.pasos[g.paso].saltar.call(this, g.d);
      if (/^(cancela|cancelar|dejalo|olvidalo|salir del asistente|medicion libre|modo libre)\b/.test(n)) {
        g.fin = true; this.save();
        return this.ask('Vale, dejo el asistente guiado. Puedes dictarme trabajos y medidas libremente, o decir «medir otra zona» para volver a empezar.', this.dlg.idleChips());
      }
      // «Borra el baño», «elimina la estancia cocina»
      const mb = n.match(/^(?:borra|borrar|elimina|eliminar|quita|quitar)\s+(?:la |el |esta |este )?(?:estancia|zona|fachada|cubierta|habitacion)?\s*(.*)$/);
      if (mb && !(input && input.act) && !/^(la |el )?(ultima|ultimo|linea|hueco|puerta|ventana|faldon)/.test(mb[1] || '')) {
        const z = buscarZona(this.obra, mb[1] || '') || (/^(esta|este)?\s*(estancia|zona|habitacion)?$/.test(mb[1] || '') ? this.zona() : null);
        if (z) return this.pedirBorrar(z);
      }
      // Incidencia fuera del guion («este pilar tiene los hierros oxidados…»)
      if (!(input && input.act) && !/^(inc_|nueva_|borrar_)/.test(g.paso) && g.paso !== 'trabajos' && n.split(' ').length >= 3) {
        const inc = detectarIncidencia(n);
        if (inc) return this.incidencia(inc, text);
      }
      // «Añade armario empotrado en la habitación»: partida dictada en cualquier momento
      const mp = n.match(/^(?:anade|anadir|añade|añadir|crea|crear|apunta|mete|quiero (?:anadir|poner)|nueva partida|otra partida|partida nueva)\s+(?:una |un |la |el |partida (?:de |para )?)?(.{4,})$/);
      if (mp && !(input && input.act) && !/^(puerta|ventana|hueco|otra igual|otro igual|faldon|fachada)/.test(mp[1])) return this.nuevaPartida(text.replace(/^\s*\S+\s+(?:(?:una|un|la|el)\s+)?(?:partida\s+(?:de\s+|para\s+)?)?/i, ''));
      const s = this.pasos[g.paso];
      if (!s) { g.fin = true; return this.dlg.st_idle(text, n, input); }
      const pasoIni = g.paso, dIni = g.d;
      // Confirmación de una interpretación aproximada («¿Es rectangular de 3 por 3?»)
      if (g.conf) {
        const c = g.conf; g.conf = null;
        const v = yesNo(n);
        if (v === true) { const r0 = s.a.call(this, c.txt, norm(c.txt), { conf: true }, g.d); if (r0 !== false) return r0; }
        if (v === false) { this.save(); return this.ask('Vale. ' + (s.ayuda ? s.ayuda.call(this, g.d) : s.q.call(this, g.d).t), s.q.call(this, g.d).c); }
      }
      // Frase cortada por una pausa («3 por…»): se espera al resto
      if (g.buf) { text = g.buf + ' ' + text; n = norm(text); g.buf = null; }
      // Corrección dentro de la misma frase: se pregunta cuál de las dos versiones oídas es la buena
      if (!(input && input.act) && /\d|\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(n)) {
        const c = corregirFrase(text), p0 = primeraVersion(text);
        if (p0 && norm(c) !== norm(p0) && numsDe(c).join() !== numsDe(p0).join()) return this.elegirEntre([p0, c], 'frase', 'He oído dos medidas');
      }
      if (!(input && input.act)) {
        const vp = versionesPalabra(text);
        if (vp && norm(vp[0]) !== norm(vp[1])) return this.elegirEntre(vp, 'frase', 'He oído dos cosas');
        if (!vp && FUERTE.test(n) && n.split(' ').length > 2 && !/^(digo|perdon|perdona|me he equivocado|me equivoque|corrijo|rectifico)\b/.test(n)) return this.ask('Me has corregido algo y no sé qué parte. Dímelo otra vez, solo la versión buena.', this.pasos[g.paso].q.call(this, g.d).c);
      }
      if (!(input && input.act) && /\d|\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(n) && /\b(por|x|de|con|coma|punto|y|mas)\s*$/.test(n)) { g.buf = text; this.save(); return this.ask('Sigue, te escucho.', []); }
      const r = s.a.call(this, text, n, input || {}, g.d);
      if (r === false) return this.noEntiendo(text);
      this.lastFail = null;
      // Se recuerda la última respuesta con medidas para poder corregirla en la frase siguiente
      if (this.obra.guia && !(input && input.act) && n.split(' ').length >= 1 && !/^(si|no|vale|ok|ninguna|ninguno|ya esta|atras)$/.test(n)) this.obra.guia.ultima = { paso: pasoIni, d: dIni, text };
      return r;
    }
    atras(msg) {
      const g = this.g;
      g.conf = null; g.buf = null; this.lastFail = null;
      if (/^(inc_q|nueva_|borrar_zona)/.test(g.paso)) { this.fails = 0; return this.volver(g.paso === 'inc_q' ? 'Vale, no anoto esa reparación.' : 'Cancelado.'); }
      // Primero se deshace lo último anotado dentro de esta misma pregunta (la puerta, la pared, la fachada…)
      const sp = this.pasos[g.paso];
      if (!msg && sp && sp.deshacer) { const m = sp.deshacer.call(this, g.d); if (m) { this.fails = 0; this.save(); return this.repetir(m); } }
      const h = (g.hist || []).pop();
      if (!h) { this.fails = 0; return this.repetir((msg ? msg + ' ' : '') + 'Empezamos esta pregunta de nuevo.'); }
      const antes = this.toma.zonas.map((z) => z.nombre);
      this.obra.toma = JSON.parse(h.toma); g.paso = h.paso; g.d = /^(inicio|est_nombre|est_mas|cub_nombre|mas_zona|ins_tipo)$/.test(h.paso) ? {} : h.d; this.fails = 0;
      // Las zonas empezadas y sin ninguna medida (salvo la de esta pregunta) se quitan
      const vacia = (z) => (z.ambito === 'interior' && z.area == null && !(z.tramos || []).length) || (z.ambito === 'cubierta' && z.area == null && !(z.faldones || []).length && !z.tipo);
      this.toma.zonas = this.toma.zonas.filter((z) => !(vacia(z) && z.id !== (g.d && g.d.zid)));
      const quitadas = antes.filter((x) => !this.toma.zonas.some((z) => z.nombre === x));
      quitadas.forEach((x) => { if (this.obra.estancias) this.obra.estancias = this.obra.estancias.filter((e) => e !== x || this.toma.zonas.some((z) => z.nombre === e)); });
      this.save();
      this.repetir((msg ? msg + ' ' : '') + (quitadas.length ? 'He quitado ' + quitadas.map((x) => art(x)).join(' y ') + '.' : 'He deshecho la última respuesta.'));
    }
    ayuda() { const s = this.pasos[this.g.paso]; this.ask((s.ayuda ? s.ayuda.call(this, this.g.d) : 'Respóndeme a la pregunta.') + ' También puedes decir «atrás» para corregir la anterior o «saltar».', this.pasos[this.g.paso].q.call(this, this.g.d).c); }
    /** No entendido: primero se vuelve a preguntar con otras palabras; después, la IA. */
    noEntiendo(text) {
      const g = this.g;
      const s = this.pasos[g.paso];
      // ¿Era la continuación de la frase anterior (pausa al dictar)? Se prueban juntas antes de contar el fallo
      if (this.lastFail && this.lastFail.paso === g.paso) {
        const junto = this.lastFail.text + ' ' + text;
        this.lastFail = null;
        const r = s.a.call(this, junto, norm(junto), {}, g.d);
        if (r !== false) return r;
      }
      this.lastFail = { paso: g.paso, text };
      this.fails++;
      const ayuda = s.ayuda ? s.ayuda.call(this, g.d) : s.q.call(this, g.d).t;
      const chips = s.q.call(this, g.d).c;
      const salidas = CH([{ label: 'Volver atrás', value: 'atrás' }].concat(s.saltar ? [{ label: 'Saltar', value: 'saltar' }] : []));
      // Si se puede adivinar lo que quería decir, se confirma en vez de repetir la pregunta
      const guess = s.aprox ? s.aprox.call(this, text, g.d) : null;
      if (guess && this.fails <= 3) { g.conf = guess; this.save(); return this.ask(guess.q, CH([{ label: 'Sí', value: 'sí' }, { label: 'No', value: 'no' }]).concat(salidas)); }
      if (this.fails === 1) return this.ask('Perdona, no te he entendido. ' + ayuda, chips.concat(salidas).slice(0, 6));
      if (this.fails === 2 && this.aiOk()) return this.consultarIA(text, s, ayuda);
      if (this.fails <= 3) return this.ask('No consigo entenderlo. Podemos volver al paso anterior' + (s.saltar ? ', saltar este dato' : '') + ' o probar otra vez: ' + ayuda, salidas.concat(chips).slice(0, 6));
      // No se insiste más: se vuelve un paso atrás para no atascarse
      this.lastFail = null;
      if (g.paso === 'inc_q' && INC_Q[g.d.i] && INC_Q[g.d.i].tipo === 'modo') { this.g.incModo = 'fases'; return this.sigIncQ('Lo pongo desglosado por fases; si lo prefieres en una partida, di «una sola partida» la próxima vez.'); }
      if (/^(inc_q|nueva_|borrar_zona)/.test(g.paso)) return this.volver('Para no atascarnos, lo dejo sin anotar. Puedes decírmelo luego.');
      return this.atras('Para no atascarnos, volvemos al paso anterior.');
    }
    aiOk() { return !!(this.io.agent && this.io.aiReady && this.io.aiReady()); }
    consultarIA(text, s, ayuda) {
      const io = this.io;
      const q = s.q.call(this, this.g.d);
      const formato = s.formato ? s.formato.call(this, this.g.d) : ayuda;
      const token = (this.aiTok = (this.aiTok || 0) + 1);
      const paso = this.g.paso;
      io.note && io.note('Lo consulto con la IA…');
      const ctx = {
        obra_id: this.obra.id, frase: text, estancia: (this.zona() || {}).nombre || '', altura: null, planta: '',
        activa: null, otras: [], resto: [], candidatas: [],
        historial: (io.history ? io.history() : []).slice(-6),
        pendiente: ('ASISTENTE GUIADO. Pregunta: «' + q.t + '». Formato de respuesta: ' + formato + '. No elijas partidas ni añadas líneas: devuelve SOLO una acción "orden" con la respuesta del usuario reescrita en ese formato en "texto". Si no se puede deducir, sin acciones y con una "pregunta" breve para aclararlo.').slice(0, 600)
      };
      const fallback = () => { if (token !== this.aiTok || this.g.paso !== paso) return; this.ask('No lo tengo claro. ' + ayuda + (s.saltar ? ' O di «saltar».' : ''), q.c); };
      const timer = setTimeout(() => { if (token === this.aiTok) { this.aiTok++; fallback(); } }, 15000);
      Promise.resolve(io.guia ? io.guia(Object.assign({ pregunta: q.t, formato }, ctx)) : io.agent(ctx)).then((raw) => {
        clearTimeout(timer);
        if (token !== this.aiTok || this.g.paso !== paso) return;
        const r = raw && raw.result ? raw.result : raw;
        const txt = respuestaIA(r);
        if (txt) { this.g.conf = { txt, q: 'He entendido: «' + txt + '». ¿Es correcto?' }; this.save(); return this.ask(this.g.conf.q, CH([{ label: 'Sí', value: 'sí' }, { label: 'No', value: 'no' }])); }
        if (r && r.pregunta) return this.ask(r.pregunta, (r.opciones || []).slice(0, 5).map((o) => ({ label: cap(o), value: o })).concat(q.c || []).slice(0, 6));
        fallback();
      }).catch(() => { clearTimeout(timer); fallback(); });
    }

    /** Pregunta cuál de las versiones oídas es la correcta (no se anota nada hasta elegir). */
    elegirEntre(ops, modo, intro) {
      const g = this.g;
      g.elegir = { ops, modo };
      this.save();
      const corto = (x) => { const v = verCorto(x); return v.length >= 3 ? v : verTxt(x); };
      if (intro === 'He oído dos medidas') { const a = corto(ops[0]), b = corto(ops[1]); if (norm(a) !== norm(b)) { const t2 = 'He oído dos medidas: «' + a + '» y «' + b + '». ¿Cuál es la correcta?'; return this.ask(t2, [{ label: b, value: 'la segunda', act: { op: 1 } }, { label: a, value: 'la primera', act: { op: 0 } }, { label: 'Ninguna, lo repito', value: 'ninguna', act: { op: -1 } }]); } }
      const t = intro === 'Tengo anotado'
        ? 'Tengo anotado «' + verTxt(ops[0]) + '» y ahora me dices «' + verTxt(ops[1]) + '». ¿Cuál es la correcta?'
        : intro + ': «' + verTxt(ops[0]) + '» y «' + verTxt(ops[1]) + '». ¿Cuál es la correcta?';
      return this.ask(t, [{ label: verTxt(ops[1]), value: 'la segunda', act: { op: 1 } }, { label: verTxt(ops[0]), value: 'la primera', act: { op: 0 } }, { label: 'Ninguna, lo repito', value: 'ninguna', act: { op: -1 } }]);
    }
    resolverEleccion(text, n, input) {
      const g = this.g; const e = g.elegir;
      let op = input && input.act && typeof input.act.op === 'number' ? input.act.op : null;
      if (op === null) {
        if (/^(ninguna|ninguno|ni una ni otra|lo repito|ninguna de las dos)/.test(n)) op = -1;
        else if (/(primer|la de antes|la anterior|la vieja|la que tenias|como estaba|la uno)/.test(n)) op = 0;
        else if (/(segund|ultim|la nueva|la buena|la otra|la dos|la correcta es la segunda|la que te acabo)/.test(n)) op = 1;
        else {
          const ns = numsDe(text);
          if (ns.length) { const enA = ns.every((v) => numsDe(e.ops[0]).includes(v)), enB = ns.every((v) => numsDe(e.ops[1]).includes(v)); if (enB && !enA) op = 1; else if (enA && !enB) op = 0; }
        }
      }
      if (op === null) { g.elegir = null; this.save(); return false; } // no es una elección: se trata como respuesta nueva
      g.elegir = null; this.save();
      if (op === -1) return this.repetir('Vale, dímelo otra vez.');
      const elegido = e.ops[op];
      if (e.modo === 'ultima') return op === 0 ? this.repetir('Vale, lo dejo como estaba.') : this.corregirUltima(elegido, true);
      // Corrección en la misma frase: se aplica la versión elegida a la pregunta en curso
      const s = this.pasos[g.paso];
      const r = s.a.call(this, elegido, norm(elegido), {}, g.d);
      if (r === false) return this.noEntiendo(elegido);
      if (this.obra.guia) this.obra.guia.ultima = { paso: g.paso, d: g.d, text: elegido };
      return r;
    }
    /** Deshace en silencio la última respuesta con medidas y aplica la versión elegida. */
    corregirUltima(text, elegido) {
      const g = this.g; const u = g.ultima; if (!u || !this.pasos[u.paso]) return false;
      const nuevo = elegido ? text : corregirFrase(u.text + ' , no , ' + text);
      if (norm(nuevo) === norm(u.text) || (!elegido && norm(nuevo) === norm(corregirFrase(u.text)))) return false;
      // Volver al estado de antes de esa respuesta
      const sp = this.pasos[g.paso];
      if (g.paso === u.paso && sp.deshacer) { if (!sp.deshacer.call(this, g.d)) return false; }
      else {
        const h = (g.hist || []).slice().reverse().find((x) => x.paso === u.paso); if (!h) return false;
        while (g.hist.length && g.hist[g.hist.length - 1] !== h) g.hist.pop();
        g.hist.pop(); this.obra.toma = JSON.parse(h.toma);
      }
      g.paso = u.paso; g.d = u.d; g.conf = null; g.buf = null; g.ultima = null; this.fails = 0; this.save();
      this.io.note && this.io.note('Corrijo: ' + verTxt(nuevo));
      const r = this.pasos[u.paso].a.call(this, nuevo, norm(nuevo), {}, g.d);
      if (r === false) return this.repetir('No he podido corregirlo; dímelo de nuevo.');
      g.ultima = { paso: u.paso, d: u.d, text: nuevo };
      return r;
    }
    /** Estancia a la que se refiere una corrección: la nombrada, la de la pregunta en curso o la última con huecos. */
    zonaHuecos(n, filtro) {
      const ints = this.toma.zonas.filter((x) => x.ambito === 'interior');
      const nombrada = buscarZona({ toma: { zonas: ints } }, n);
      if (nombrada) return nombrada;
      const actual = this.g.d && this.g.d.zid ? this.zona(this.g.d.zid) : null;
      if (actual && actual.ambito === 'interior' && (actual.huecos || []).some(filtro)) return actual;
      return ints.filter((x) => (x.huecos || []).some(filtro)).pop() || null;
    }
    /** Propone un cambio y espera el sí o el no antes de aplicarlo. */
    proponer(z, cambio, texto) {
      this.g.propuesta = Object.assign({ zid: z.id }, cambio); this.save();
      return this.ask(texto, [{ label: 'Sí, correcto', value: 'sí', act: { ok: true } }, { label: 'No', value: 'no', act: { ok: false } }]);
    }
    /** La IA rehace los datos de la estancia a partir de la corrección y de la conversación; el usuario confirma. */
    editarConIA(text, z) {
      const io = this.io; const token = (this.aiTok = (this.aiTok || 0) + 1);
      io.note && io.note('Lo reviso con la IA…');
      const ctx = {
        obra_id: this.obra.id, frase: text, estancia: z.nombre, altura: z.altura || null, planta: '', activa: null, otras: [], resto: [], candidatas: [],
        historial: (io.history ? io.history() : []).slice(-8),
        pendiente: ('CORRECCIÓN DE DATOS DE LA ESTANCIA «' + z.nombre + '». Anotado ahora: altura ' + (z.altura ? fmt(z.altura) : '¿?') + '; huecos: ' + huecosTxt(z.huecos) + '. El usuario corrige lo anotado (mira también la conversación). Devuelve SOLO una acción "orden" cuyo "texto" sea el estado COMPLETO y CORREGIDO con este formato exacto: «altura A | huecos: N puertas de ANCHO por ALTO, N ventanas de ANCHO por ALTO» en metros con coma decimal; puerta sin alto: 2,03; sin huecos: «huecos: ninguno». Si no se puede deducir, sin acciones y con una "pregunta" breve.').slice(0, 600)
      };
      const fallo = () => { if (token !== this.aiTok) return; this.ask('No he podido entender la corrección. Dime de nuevo todos los huecos de ' + art(z.nombre) + ', o di «atrás».', []); };
      const timer = setTimeout(() => { if (token === this.aiTok) { this.aiTok++; fallo(); } }, 15000);
      Promise.resolve(io.guia ? io.guia(ctx) : io.agent(ctx)).then((raw) => {
        clearTimeout(timer); if (token !== this.aiTok) return;
        const r = raw && raw.result ? raw.result : raw;
        const txt = respuestaIA(r);
        if (!txt) return r && r.pregunta ? this.ask(r.pregunta, []) : fallo();
        const partes = txt.split('|');
        const alt = /altura/i.test(partes[0]) ? num(partes[0]) : null;
        const hsTxt = (partes.find((x) => /huecos?/i.test(x)) || txt).replace(/^.*huecos?\s*:?/i, '');
        const hs = /ningun/i.test(hsTxt) ? [] : parseHuecos(hsTxt).map((x) => (x.tipo === 'puerta' && x.an && !x.al ? Object.assign(x, { al: 2.03 }) : x));
        if (!hs.length && !/ningun/i.test(hsTxt) && !alt) return fallo();
        const cambio = { huecos: hs }; if (alt && alt > 1 && alt < 8) cambio.altura = round2(alt);
        return this.proponer(z, cambio, 'Te propongo dejar ' + art(z.nombre) + ' así: ' + (cambio.altura ? 'altura ' + fmt(cambio.altura) + '; ' : '') + 'huecos: ' + huecosTxt(hs) + '. ¿Correcto?');
      }).catch(() => { clearTimeout(timer); fallo(); });
    }
    /* ---- borrar zonas ---- */
    pedirBorrar(z) {
      const g = this.g;
      g.ret = g.ret || { paso: g.paso, d: g.d, fin: g.fin };
      g.fin = false;
      this.g.paso = 'borrar_zona'; this.g.d = { zid: z.id }; this.fails = 0; this.save();
      return this.ask('¿Elimino ' + art(z.nombre) + ' y todo lo que he medido en ' + (art(z.nombre).startsWith('la') ? 'ella' : 'él') + '?', CH(['Sí, eliminar', 'No']));
    }
    volver(pre) {
      const g = this.g; const r = g.ret; g.ret = null;
      if (r && (r.fin || r.paso === 'hecho' || r.paso === 'libre')) {
        g.paso = r.paso; g.fin = true; this.save();
        if (this.toma.zonas.length && this.obra.partidas.some((p) => p.guia)) generar(this.obra, this.dlg.cat);
        this.save();
        return this.ask((pre ? pre + ' ' : '') + '¿Algo más?', this.dlg.idleChips());
      }
      if (!r || !this.pasos[r.paso] || (r.d && r.d.zid && !this.zona(r.d.zid))) return this.say(r && r.paso === 'trabajos' ? 'trabajos' : this.sigPasoTras(), {}, pre);
      g.paso = r.paso; g.d = r.d; this.fails = 0; this.save();
      return this.repetir(pre);
    }
    sigPasoTras() {
      const t = this.g.tipo;
      if (t === 'fachada') return this.toma.zonas.some((z) => z.ambito === 'fachada') ? 'fac_lista' : 'fac_lista';
      if (t === 'cubierta') return 'cub_nombre';
      if (t === 'instalaciones') return 'ins_tipo';
      return this.toma.zonas.some((z) => z.ambito === 'interior') ? 'est_mas' : 'est_nombre';
    }
    /* ---- incidencias fuera del guion ---- */
    incidencia(inc, frase) {
      const g = this.g;
      if (!g.ret) g.ret = { paso: g.paso, d: g.d, fin: g.fin };
      g.fin = false;
      const z = this.zona && g.d && g.d.zid ? this.zona(g.d.zid) : null;
      const ult = this.toma.zonas.length ? this.toma.zonas[this.toma.zonas.length - 1] : null;
      inc.est = z ? z.nombre : (g.paso && g.paso !== 'hecho' && g.paso !== 'libre' && ult ? ult.nombre : (this.obra.estActiva || ''));
      g.paso = 'inc_q'; g.d = { inc, i: -1 }; this.fails = 0; this.save();
      return this.sigIncQ('Entendido: ' + INC_TXT[inc.tipo](inc).toLowerCase().replace(/^./, (c) => c.toUpperCase()) + '.');
    }
    sigIncQ(pre) {
      const d = this.g.d; const inc = d.inc;
      let i = d.i + 1; while (INC_Q[i] && !INC_Q[i].si.call(this, inc)) i++;
      if (INC_Q[i]) { this.g.d = { inc, i }; this.save(); return this.repetir(pre); }
      // Todas las respuestas: se anotan las partidas
      const hechas = anotarIncidencia(this.obra, this.dlg.cat, inc, inc.est);
      this.save();
      this.io.flash && this.io.flash('ok');
      const cant = inc.tipo === 'humedad' ? (inc.causa === 'capilaridad' ? fmt(inc.largo) + ' metros de muro' : fmt(inc.sup) + ' metros cuadrados') : inc.tipo === 'fisura' ? fmt(inc.largo) + ' metros de fisuras'
        : inc.el === 'canto' ? fmt(inc.largo) + ' metros de canto' : inc.el === 'pilar' || inc.el === 'viga' ? fmt(hechas[0] ? E.parcial(hechas[0].l) : 0) + ' metros lineales de ' + inc.el + (inc.n > 1 ? (inc.el === 'pilar' ? 'es' : 's') : '') : fmt(hechas[0] ? E.parcial(hechas[0].l) : 0) + ' metros cuadrados de reparación';
      const msg = (pre ? pre + ' ' : '') + 'Anotado' + (inc.est ? ' en ' + art(inc.est) : '') + ': ' + cant + (hechas.length > 1 ? ', en ' + hechas.length + ' partidas' : ', en una partida') + '.';
      return this.volver(msg + ' Seguimos.');
    }
    /* ---- partida dictada que no está en la lista ---- */
    nuevaPartida(frase) {
      const g = this.g;
      let desc = String(frase).trim().replace(/[.,;]+$/, '');
      const zRef = buscarZona(this.obra, desc);
      if (zRef) desc = desc.replace(new RegExp('\\s*(?:en|del|de la|de|para)\\s+(?:el|la|los|las)?\\s*' + zRef.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'i'), '').replace(new RegExp('\\s*(?:en|del|de la|de)\\s+(?:el|la)?\\s*' + norm(zRef.nombre).split(' ')[0] + '\\S*.*$', 'i'), '').trim();
      desc = cap(desc);
      if (desc.length < 3) return this.ask('¿Qué partida añado? Dime el trabajo, por ejemplo «armario empotrado».', []);
      if (!g.ret) g.ret = { paso: g.paso, d: g.d };
      const cat = this.dlg.cat;
      const res = cat.index.search(desc);
      const top = res.length && res[0].s >= 0.7 && res[0].miss === 0 ? res[0].doc : null;
      g.paso = 'nueva_partida'; g.d = { desc, zid: zRef ? zRef.id : null, code: top ? top.c : null }; this.fails = 0; this.save();
      if (top) return this.ask('En la base de datos tengo «' + top.r + '», en ' + unitSpoken(top.u) + '. ¿Uso esa o creo una partida nueva «' + desc + '»?', CH([{ label: 'Usar la de la base', value: 'usar la de la base' }, { label: 'Crear nueva', value: 'crear nueva' }]));
      g.paso = 'nueva_unidad'; this.save();
      return this.repetir('Creo la partida «' + desc + '».');
    }
    zonasPara(ambito, zid) { if (zid) return [zid]; const zs = this.toma.zonas.filter((z) => z.ambito === ambito); return zs.map((z) => z.id); }
    ambitoActual() {
      const z = this.g.paso !== 'trabajos' && this.zona(); if (z) return z.ambito;
      const zs = this.toma.zonas; if (zs.some((x) => x.ambito === 'interior')) return 'interior';
      return zs.length ? zs[0].ambito : 'interior';
    }
    terminarNueva(w, pre) {
      const zs = (this.g.sel[w.id] || {}).zonas || [];
      const nombres = zs.map((id) => (this.zona(id) || {}).nombre).filter(Boolean);
      this.save();
      return this.volver((pre ? pre + ' ' : '') + 'Añadida «' + w.label + '»' + (nombres.length ? ' en ' + nombres.map((x) => art(x)).join(', ') : '') + (w.regla === 'preguntar' ? '; te preguntaré la medición al generar.' : '.'));
    }
    /* ---- pantalla de trabajos ---- */
    abrirTrabajos(pre) {
      seleccion(this.obra);
      this.say('trabajos', {}, pre);
      this.io.trabajos && this.io.trabajos(true);
    }
    generarMediciones() {
      const cat = this.dlg.cat;
      this.dlg.snapshot && this.dlg.snapshot();
      const r = generar(this.obra, cat);
      this.io.trabajos && this.io.trabajos(false);
      this.g.preguntas = r.preguntas;
      this.save();
      this.io.flash && this.io.flash('ok');
      if (r.preguntas.length) return this.say('preguntas', { i: 0 }, 'He generado ' + r.partidas + ' ' + plural(r.partidas, 'partida') + ' con lo medido. ' + (r.preguntas.length === 1 ? 'Me falta 1 dato.' : 'Me faltan ' + r.preguntas.length + ' datos.'));
      return this.fin(r);
    }
    fin(r) {
      const ps = this.obra.partidas.filter((p) => p.lineas.length).length;
      const g = this.g; g.fin = true; g.paso = 'hecho'; this.save();
      this.ask('Listo: el estado de mediciones tiene ' + ps + ' ' + plural(ps, 'partida') + '. Puedes revisarlo en pantalla, corregir cualquier línea hablando, exportar el PDF o medir otra zona.',
        [{ label: 'Medir otra zona', value: 'medir otra zona' }, { label: 'Exportar PDF', value: 'exporta el pdf' }, { label: 'Compartir archivos', value: 'compartir los archivos' }, { label: 'Elegir más trabajos', value: 'elegir trabajos' }].concat(this.io.breve && !this.io.breve() ? [{ label: 'Modo breve', value: 'modo breve' }] : []));
    }
  }

  /** Extrae el texto normalizado de una respuesta de la IA (modo guía o modo agente). */
  function respuestaIA(r) {
    if (!r) return '';
    const vacia = (t) => !t || /^(no se puede|no puedo|no lo se|desconocid|n\/?a\b|ninguna respuesta|sin datos|no hay datos|no aplica|no entiendo)/i.test(String(t).trim());
    if (typeof r.respuesta === 'string' && r.respuesta.trim() && !vacia(r.respuesta)) return r.respuesta.trim();
    const ac = Array.isArray(r.acciones) ? r.acciones : [];
    const o = ac.find((a) => a.tipo === 'orden' && a.texto && !vacia(a.texto)); if (o) return o.texto;
    const rec = ac.find((a) => a.tipo === 'recorrido' && a.tramos && a.tramos.length);
    if (rec) return rec.tramos.map((t) => String(t.largo).replace('.', ',') + ' metros ' + (t.giro || 'derecha') + ' ' + (t.angulo || 90) + ' grados').join(', ');
    const h = ac.find((a) => a.tipo === 'fijar_altura' && a.altura); if (h) return String(h.altura).replace('.', ',');
    const ce = ac.find((a) => a.tipo === 'cambiar_estancia' && a.estancia); if (ce) return ce.estancia;
    const li = ac.find((a) => a.tipo === 'anadir_lineas' && a.lineas_nuevas && a.lineas_nuevas.length);
    if (li) return li.lineas_nuevas.map((l) => [(l.comentario || ''), l.uds && l.uds !== 1 ? l.uds + ' de' : '', [l.largo, l.ancho, l.alto].filter((v) => v != null).map((v) => String(v).replace('.', ',')).join(' por ')].filter(Boolean).join(' ')).join(' y ');
    return '';
  }

  /* ============================================================
   * INCIDENCIAS FUERA DEL GUION
   * El usuario describe a su manera una patología que ve («ese pilar tiene los
   * hierros oxidados, habrá que repararlo»). Se detecta en cualquier momento,
   * se hacen las preguntas justas y se añaden todas las partidas del proceso
   * (desglosadas por fases o en una partida completa). Después se sigue donde se estaba.
   * ============================================================ */
  const P_HA = /(oxid|corro|armadura|hierros?\b|ferralla|desconch|desprend|saltad|carbonata|aluminosis|pasivar|pasivad|mortero de reparacion|recomponer|reconstruir|sanear|saneado|picar el hormigon|hormigon (danad|en mal estado|deteriorad|roto|podrid|suelto))/;
  function detectarIncidencia(n) {
    const t = ' ' + n + ' ';
    const el = /\b(pilar|pilares|columna|columnas|soporte)\b/.test(t) ? 'pilar' : /\b(viga|vigas|jacena|jacenas|dintel)\b/.test(t) ? 'viga'
      : /(canto|cantos|frente|frentes) (de|del) (forjado|losa)|borde del forjado|cantos? de forjado/.test(t) ? 'canto'
      : /\b(techo|forjado|losa|vigueta|viguetas|bovedilla|muro|pared|paramento)\b/.test(t) ? 'superficie' : null;
    if (P_HA.test(n) && (el || /(armadura|hierros?\b|ferralla|oxid|corro|pasiv)/.test(n))) return { tipo: 'rep_ha', el: el || 'superficie' };
    if (/(humedad|humedades|capilaridad|salitre|eflorescencia|sube el agua|humedo por abajo|moho|condensacion|filtracion|gotera)/.test(n)) {
      const inc = { tipo: 'humedad', causa: causaHumedad(n) };
      const m2 = n.match(/(\d+(?:[.,]\d+)?|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+metros? cuadrados?/);
      if (m2) { const v = num(m2[0]); if (v > 0) inc.sup = v; }
      return inc;
    }
    if (/(fisura|fisuras|grieta|grietas|agrietad|fisurad|rajad)/.test(n)) return { tipo: 'fisura' };
    return null;
  }
  function causaHumedad(n) {
    if (/(capilaridad|sube|subiendo|desde abajo|desde el suelo|zocalo|salitre|eflorescencia)/.test(n)) return 'capilaridad';
    if (/(condensac|moho|hongo|vaho|mancha negra|puntos negros)/.test(n)) return 'condensacion';
    if (/(filtrac|gotea|gotera|entra agua|entra el agua|lluvia|desde fuera|del exterior|cuando llueve)/.test(n)) return 'filtracion';
    return null;
  }
  const EL_TXT = { pilar: ['pilar', 'pilares'], viga: ['viga', 'vigas'], canto: ['canto de forjado', 'cantos de forjado'], superficie: ['zona', 'zonas'] };
  const INC_TXT = {
    rep_ha: (i) => 'Reparación de ' + (i.el === 'superficie' ? 'hormigón armado' : EL_TXT[i.el][1]) + ' con armaduras oxidadas: picado del hormigón, cepillado de armaduras, pasivado y mortero de reparación',
    humedad: (i) => i.causa === 'capilaridad' ? 'Tratamiento de humedad por capilaridad: picado del revestimiento, barrera química por inyección y mortero de saneamiento'
      : i.causa === 'condensacion' ? 'Tratamiento de humedad por condensación: limpieza con fungicida y pintura antimoho'
      : i.causa === 'filtracion' ? 'Reparación de humedad por filtración: picado, impermeabilización y nuevo revestimiento' : 'Tratamiento de humedad',
    fisura: () => 'Reparación de fisuras: apertura, limpieza y sellado'
  };
  /** Preguntas de cada incidencia (en orden; se saltan las que no aplican). */
  const INC_Q = [
    { k: 'n', tipo: 'count', si: (i) => i.tipo === 'rep_ha' && (i.el === 'pilar' || i.el === 'viga'), q: (i) => (i.el === 'viga' ? '¿Cuántas vigas hay en esa situación, contando esta?' : '¿Cuántos pilares hay en esa situación, contando este?'), c: ['1', '2', '3', '4'] },
    { k: 'largo', tipo: 'num', si: (i) => i.tipo === 'rep_ha' && i.el === 'pilar', q: (i) => '¿Cuántos metros de altura hay que reparar en ' + (i.n > 1 ? 'cada pilar' : 'el pilar') + '? Si es entero, dime su altura.', c: ['1', '2', '2,60', '3'] },
    { k: 'largo', tipo: 'num', si: (i) => i.tipo === 'rep_ha' && i.el === 'viga', q: (i) => '¿Cuántos metros de ' + (i.n > 1 ? 'cada viga' : 'viga') + ' hay que reparar?', c: ['1', '2', '3', '4'] },
    { k: 'largo', tipo: 'num', si: (i) => i.tipo === 'rep_ha' && i.el === 'canto', q: () => '¿Cuántos metros de canto de forjado hay que reparar en total?', c: [] },
    { k: 'canto', tipo: 'num', si: (i) => i.tipo === 'rep_ha' && i.el === 'canto', q: () => '¿Qué canto tiene el forjado? Lo normal son 30 centímetros.', c: ['25 cm', '30 cm', '35 cm'] },
    { k: 'sup', tipo: 'dims', si: (i) => i.tipo === 'rep_ha' && i.el === 'superficie', q: () => '¿Qué superficie hay que reparar? Largo por ancho, por ejemplo «3 por 2». Si son varias zonas, dime el total.', c: [] },
    { k: 'causa', tipo: 'causa', si: (i) => i.tipo === 'humedad' && !i.causa, q: () => '¿De qué es la humedad? Por capilaridad, que sube desde el suelo; por condensación, con manchas y moho; o por filtración, que entra agua.', c: [{ label: 'Capilaridad', value: 'capilaridad' }, { label: 'Condensación', value: 'condensación' }, { label: 'Filtración', value: 'filtración' }] },
    { k: 'largo', tipo: 'num', si: (i) => i.tipo === 'humedad' && i.causa === 'capilaridad', q: () => '¿Cuántos metros de muro tienen humedad?', c: [] },
    { k: 'alto', tipo: 'num', si: (i) => i.tipo === 'humedad' && i.causa === 'capilaridad', q: () => '¿Hasta qué altura hay que tratar? Normalmente 1 metro por encima de la mancha.', c: ['1', '1,20', '1,50'] },
    { k: 'sup', tipo: 'area', si: (i) => i.tipo === 'humedad' && i.causa && i.causa !== 'capilaridad' && !i.sup, q: () => '¿Qué superficie tiene la zona afectada? Dime los metros cuadrados o largo por ancho.', c: ['1', '2', '3'] },
    { k: 'largo', tipo: 'num', si: (i) => i.tipo === 'fisura', q: () => '¿Cuántos metros de fisuras o grietas hay en total?', c: [] },
    { k: 'modo', tipo: 'modo', si: function (i) { return !this.g.incModo; }, q: () => '¿Lo pongo desglosado por fases, una partida por cada trabajo, o en una sola partida que lo incluya todo?', c: [{ label: 'Desglosado por fases', value: 'desglosado' }, { label: 'Una sola partida', value: 'una sola partida' }] }
  ];
  /** Partidas de cada incidencia: [código, unidad, resumen si no está en la base, línea]. */
  function incPartidas(i, modo) {
    const N = i.n || 1, f = (v) => fmt(v);
    if (i.tipo === 'rep_ha') {
      let line, com;
      // Pilares y vigas se valoran por metro lineal de elemento reparado
      if (i.el === 'pilar' || i.el === 'viga') {
        com = (N > 1 ? N + (i.el === 'pilar' ? ' pilares' : ' vigas') : (i.el === 'pilar' ? 'Pilar' : 'Viga')) + ', ' + f(i.largo) + ' m ' + (N > 1 ? 'cada ' + (i.el === 'pilar' ? 'uno' : 'una') : '');
        line = L(com.trim(), N, i.largo);
        if (modo === 'una') return [[i.el === 'pilar' ? 'EHY095' : 'EHY096', 'm', 'Reparación de ' + i.el + ' de hormigón armado con armaduras corroídas', line]];
        return [['EHP010', 'm', 'Picado de hormigón deteriorado en pilar o viga', line], ['EHP020', 'm', 'Limpieza de armaduras con cepillo metálico', Object.assign({}, line)], ['EHP030', 'm', 'Pasivado de armaduras', Object.assign({}, line)], ['EHP040', 'm', 'Reconstrucción con mortero de reparación', Object.assign({}, line)]];
      }
      else if (i.el === 'canto') { com = 'Canto de forjado de ' + f(i.canto) + ' m, ' + f(i.largo) + ' m'; line = L(com, 1, i.largo, null, i.canto); }
      else { com = 'Superficie de hormigón armado'; line = L(com, 1, i.sup[0], i.sup[1]); }
      if (modo === 'una') {
        if (i.el === 'canto') return [['EHY090', 'm', 'Reparación de canto de forjado por corrosión de armaduras', L(com, 1, i.largo)]];
        return [['EHY097', 'm2', 'Reparación de hormigón armado con armaduras corroídas', line]];
      }
      return [['D3001.0070', 'm2', 'Picado de hormigón deteriorado', line], ['EHK045', 'm2', 'Limpieza de armaduras con cepillo metálico', Object.assign({}, line)], ['D3002.0020', 'm2', 'Pasivado de armaduras', Object.assign({}, line)], ['D3002.0030', 'm2', 'Reconstrucción con mortero de reparación', Object.assign({}, line)]];
    }
    if (i.tipo === 'humedad' && i.causa !== 'capilaridad') {
      const com = 'Zona afectada de ' + f(i.sup) + ' m²';
      const ln = L(com, 1, i.sup);
      if (i.causa === 'condensacion') {
        if (modo === 'una') return [['RIX030', 'm2', 'Tratamiento de humedad por condensación', ln]];
        return [['RIX010', 'm2', 'Limpieza con solución fungicida', ln], ['RIX020', 'm2', 'Pintura antimoho', Object.assign({}, ln)]];
      }
      if (modo === 'una') return [['NIX020', 'm2', 'Reparación de humedad por filtración', ln]];
      return [['DRF010b', 'm2', 'Picado del revestimiento', ln], ['NIX010', 'm2', 'Impermeabilización con mortero impermeable', Object.assign({}, ln)], ['RPE005b', 'm2', 'Enfoscado', Object.assign({}, ln)]];
    }
    if (i.tipo === 'humedad') {
      const com = 'Muro de ' + f(i.largo) + ' m, tratado hasta ' + f(i.alto) + ' m';
      if (modo === 'una') return [['NHX010', 'm', 'Tratamiento de muro con humedad por capilaridad', L(com, 1, i.largo)]];
      return [['DRF010b', 'm2', 'Picado del revestimiento', L(com, 1, i.largo, null, i.alto)], ['D3006.0060', 'm', 'Barrera química por inyección', L(com, 1, i.largo)], ['D3006.0010', 'm2', 'Mortero macroporoso de saneamiento', L(com, 1, i.largo, null, i.alto)]];
    }
    const com = 'Fisuras, ' + f(i.largo) + ' m';
    if (modo === 'una') return [['3009.0050', 'm', 'Limpieza y cosido de grietas', L(com, 1, i.largo)]];
    return [['D3001.0120', 'm', 'Apertura de fisura', L(com, 1, i.largo)], ['D3002.0080', 'm', 'Sellado de fisuras', L(com, 1, i.largo)]];
  }
  /** Anota las partidas de la incidencia en la obra (no se tocan al regenerar las del asistente). */
  function anotarIncidencia(obra, cat, i, est) {
    const modo = (obra.guia && obra.guia.incModo) || 'fases';
    const seq = (obra.guia.incSeq = (obra.guia.incSeq || 0) + 1);
    const hechas = [];
    incPartidas(i, modo).forEach(([code, u, label, ln]) => {
      const d = cat.byCode.get(code) || (cat.index.search(label).filter((r) => r.doc.u === u && r.s >= 0.6)[0] || {}).doc || null;
      let p = obra.partidas.find((x) => x.ref === (d ? d.c : 'INC.' + code));
      if (!p) {
        p = d ? { ref: d.c, u: d.u, r: d.r, t: d.t, chap: d.chap, chapTitle: d.chapTitle, chapOrder: d.chapOrder, subTitle: d.subTitle }
          : { ref: 'INC.' + code, propia: true, u, r: label, t: label, chap: 'G-reparaciones', chapTitle: 'REPARACIONES', chapOrder: 950, subTitle: '' };
        Object.assign(p, { uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), lineas: [], creada: Date.now() + obra.partidas.length });
        p.orient = orientOf(p); obra.partidas.push(p);
      }
      const id = p.lineas.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1;
      const l = Object.assign({ id, est: est || '' }, ln, { inc: 'i' + seq });
      p.lineas.push(l); p.mod = Date.now(); hechas.push({ p, l });
    });
    E.obraChapters(obra);
    return hechas;
  }

  /* ---------------- Pasos del guion ----------------
   * q(d) → { t: pregunta, c: chips }  ·  a(text, n, input, d) → false si no se entiende
   * ayuda(d) → reformulación · formato(d) → instrucción para la IA · saltar(d) opcional */
  const CH = (labels) => labels.map((l) => (typeof l === 'string' ? { label: l, value: l } : l));
  const P = {};
  Guia.prototype.pasos = P;

  /** Números de una frase (sin artículos «un/una»), pasados a metros. */
  const numeros = (text) => tokenize(text).filter((x) => x.k === 'N' && !x.art).map((x) => { let v = cmv(x.v, x); if (!x.unit && Number.isInteger(v) && v >= 100) v = round2(v / 100); return v; }).filter((v) => v > 0 && v < 200);
  const aproxPlanta = function (text) {
    const v = numeros(text);
    if (v.length === 2) return { txt: String(v[0]).replace('.', ',') + ' por ' + String(v[1]).replace('.', ','), q: '¿Quieres decir una planta rectangular de ' + fmt(v[0]) + ' por ' + fmt(v[1]) + '?' };
    if (v.length >= 3 && v.length <= 12) return { txt: v.map((x) => String(x).replace('.', ',') + ' metros derecha').join(', '), q: '¿Son ' + v.length + ' paredes de ' + v.map((x) => fmt(x)).join(', ') + ', girando siempre a la derecha?' };
    return null;
  };
  P.inicio = {
    qb: () => '¿Qué medimos?',
    q: () => ({ t: '¿Qué vamos a medir? Una vivienda o reforma integral, una estancia, instalaciones, una fachada, una cubierta u otra cosa.', c: CH([{ label: 'Vivienda / reforma integral', value: 'vivienda', act: { g: 'vivienda' } }, { label: 'Estancia o habitación', value: 'estancia', act: { g: 'estancia' } }, { label: 'Instalaciones', value: 'instalaciones', act: { g: 'instalaciones' } }, { label: 'Fachada', value: 'fachada', act: { g: 'fachada' } }, { label: 'Cubierta', value: 'cubierta', act: { g: 'cubierta' } }, { label: 'Otra cosa', value: 'otra cosa', act: { g: 'otra' } }]) }),
    ayuda: () => 'Dime solo el tipo de trabajo: vivienda, estancia, instalaciones, fachada, cubierta u otra cosa.',
    formato: () => 'una de estas palabras exactas: vivienda, estancia, instalaciones, fachada, cubierta, otra',
    a(text, n, input) {
      let k = input.act && input.act.g;
      let est = null;
      if (!k) {
        if (/(fachada|medianera|frente del edificio)/.test(n)) k = 'fachada';
        else if (/(cubierta|tejado|azotea|terrado|faldon)/.test(n)) k = 'cubierta';
        else if (/(instalac|fontaner|electric|agua|enchufe|luz|desague|saneamiento)/.test(n)) k = 'instalaciones';
        else if (/(vivienda|piso|casa|integral|completa|chalet|apartamento|toda la|reforma)/.test(n)) k = 'vivienda';
        else if (/^(otra|otro|otra cosa|algo distinto|libre|diferente)/.test(n)) k = 'otra';
        else { const m = n.match(/(estancia|habitacion|parcial|bano|aseo|cocina|dormitorio|salon|comedor|pasillo|terraza|local|despacho|oficina|lavadero|recibidor)/); if (m) { k = 'estancia'; if (!/^(estancia|habitacion|parcial)$/.test(m[1])) est = estanciaName(text.replace(/^(?:una?|el|la)\s+/i, '')); } }
      }
      if (!k) return false;
      this.obra.ambito = { vivienda: 'vivienda', estancia: 'estancia', instalaciones: 'instalaciones', fachada: 'libre', cubierta: 'libre', otra: 'libre' }[k];
      this.g.tipo = k;
      if (k === 'vivienda' || k === 'estancia') {
        if (est) return this.say('est_planta', { zid: this.nuevaZona('interior', est).id }, 'Perfecto, medimos ' + art(est) + '.');
        return this.say('est_nombre', {}, k === 'vivienda' ? 'Perfecto, una vivienda. Iremos estancia por estancia.' : 'Perfecto, una estancia.');
      }
      if (k === 'fachada') return this.say('fac_lista', {});
      if (k === 'cubierta') return this.say('cub_nombre', {});
      if (k === 'instalaciones') return this.say('ins_tipo', {});
      // Otra cosa: medición libre con la IA
      this.g.fin = true; this.g.paso = 'libre'; this.save();
      this.dlg.state = { mode: 'idle' };
      return this.ask(this.aiOk() ? 'De acuerdo. Cuéntame qué vamos a medir: el elemento, dónde está y sus medidas, y te iré guiando.' : 'De acuerdo. Dime el primer trabajo a medir, por ejemplo «picado de azulejos», y después sus medidas.', []);
    }
  };

  /* ---- Estancias ---- */
  // Respuestas que no son un nombre de estancia
  const ESTANCIA_VOCAB = /\b(salon|comedor|cocina|bano|aseo|dormitorio|habitacion|cuarto|pasillo|recibidor|entrada|hall|terraza|balcon|galeria|lavadero|despensa|vestidor|estudio|despacho|garaje|trastero|sotano|buhardilla|atico|escalera|escaleras|distribuidor|porche|patio|jardin|local|oficina|almacen|nave|zona|sala|suite|lavanderia|bodega|vestibulo|office|tendedero|azotea|biblioteca|gimnasio|piscina|planta|tienda|consulta|aula|archivo|sala de|cuarto de)\b/;
  const NO_NOMBRE = /^(esta|este|esto|eso|ya|aqui|ahi|alli|ni idea|no se|no lo se|nada|que|bueno|vale|pues|otra cosa|tal vez|quizas|a ver|espera|perdona|como|repite|no entiendo|ayuda|hola|gracias|venga|ok|eh|mm+|bla)\b/;
  const usados = (self) => self.toma.zonas.filter((z) => z.ambito === 'interior').map((z) => norm(z.nombre));
  P.est_nombre = {
    qb() { return usados(this).length ? '¿Siguiente estancia?' : '¿Qué estancia?'; },
    q() { const u = usados(this); return { t: u.length ? '¿Cuál es la siguiente estancia?' : '¿Por qué estancia empezamos?', c: CH(EST_DEF.filter((e) => !u.includes(norm(e))).slice(0, 6)) }; },
    ayuda: () => 'Dime el nombre de la estancia, por ejemplo «salón», «baño 1» o «dormitorio principal».',
    formato: () => 'el nombre de la estancia (Salón, Baño 1, Dormitorio 2…)',
    a(text, n, input) {
      const limpio = text.replace(/^(?:empezamos|empezamos por|vamos|vamos al?|vamos a la|por|el|la|en|al|seguimos (?:con|por)|ahora|pasamos al?|pasamos a la)\s+/i, '').replace(/^(?:el|la)\s+/i, '');
      const mw = limpio.match(/^(.*?)[,.]?\s+(\d+(?:[.,]\d+)?\s*(?:por|x|metros|m\b|derecha|izquierda).*)$/i);
      const base = (mw ? mw[1] : limpio).split(/[,.]/)[0].replace(/\s+(?:que\s+)?(?:es|mide|tiene|son|de|con|rectangular|cuadrad[oa]|rectangulo|en forma de l|irregular|y)\b.*$/i, '').trim();
      const nombre = estanciaName(base || limpio);
      if (!nombre || nombre.split(' ').length > 4 || !/[a-zñ]/i.test(norm(nombre)) || yesNo(norm(nombre)) !== null || NO_NOMBRE.test(norm(nombre)) || /^\d|\bpor\b/.test(norm(nombre))) return false;
      if (!input || (!input.conf && !input.act)) {
        if (!ESTANCIA_VOCAB.test(norm(nombre))) { this.g.conf = { txt: text, q: '¿La estancia se llama «' + nombre + '»?' }; this.save(); return this.ask(this.g.conf.q, CH([{ label: 'Sí', value: 'sí' }, { label: 'No', value: 'no' }])); }
      }
      const u = usados(this);
      let fin = nombre;
      if (u.includes(norm(fin))) { let i = 2; while (u.includes(norm(nombre + ' ' + i))) i++; fin = nombre + ' ' + i; }
      const z = this.nuevaZona('interior', fin);
      this.obra.estancias = this.obra.estancias || []; if (!this.obra.estancias.includes(fin)) this.obra.estancias.push(fin);
      this.obra.estActiva = fin;
      // ¿Ha dictado ya las paredes en la misma frase?
      const resto = mw ? mw[2] : '';
      const w = resto ? parseWalk(resto) : null;
      this.g.d = { zid: z.id };
      if (w) { this.dlg.muteAsk = true; try { this.say('est_planta', { zid: z.id }); } finally { this.dlg.muteAsk = false; } const r = P.est_planta.a.call(this, resto, norm(resto), {}, this.g.d); return r === false ? this.repetir('Vamos con ' + art(fin) + '.') : r; }
      return this.say('est_planta', { zid: z.id }, 'Vamos con ' + art(fin) + '.');
    }
  };
  P.est_planta = {
    qb(d) { const z = this.zona(d.zid); return z && z.tramos && z.tramos.length ? 'Llevo ' + z.tramos.map((t) => fmt(t.l)).join(', ') + '. ¿Siguiente o «cierra»?' : 'Paredes con sus giros, o largo por ancho.'; },
    q(d) {
      const z = this.zona(d.zid);
      if (z && z.tramos && z.tramos.length) return { t: 'Llevo ' + z.tramos.length + ' ' + plural(z.tramos.length, 'pared', 'paredes') + ': ' + z.tramos.map((t) => fmt(t.l)).join(', ') + '. Sigue con la siguiente, o di «cierra».', c: CH(['Cierra', 'Empezar de nuevo']) };
      return { t: 'Dame la longitud de las paredes en el sentido de las agujas del reloj, diciendo el giro, normalmente 90 grados, y hacia qué lado. Dime también si hay puertas o ventanas. Si es rectangular, basta con «4 por 3».', c: CH(['Es rectangular', 'Superficie y perímetro']) };
    },
    ayuda: () => AYUDA_WALK + ' También puedes darme directamente «superficie 18 y perímetro 17».',
    formato: () => 'las paredes como «4,20 metros derecha 90 grados, 3 metros derecha 90 grados, …» (giro tras cada pared); o «4 por 3» si es un rectángulo; o «superficie X perímetro Y»; añade «cierra» si ha terminado',
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      if (/^(es rectangular|rectangular)$/.test(n)) return this.ask('Dime el largo por el ancho, por ejemplo «4 por 3».', []);
      if (/^superficie y perimetro$/.test(n)) return this.ask('Dime la superficie y el perímetro, por ejemplo «superficie 18 y perímetro 17».', []);
      if (/^(empezar de nuevo|empezamos de nuevo|borra|de nuevo|otra vez)/.test(n)) { z.tramos = []; delete z.area; delete z.perimetro; this.save(); return this.repetir('Empezamos de nuevo.'); }
      if (/(puerta|ventana|balconera)/.test(n)) z.huecosMencion = true;
      const cierra = /(cierr|ya esta|termin|vuelvo al principio|eso es todo|hasta el inicio)/.test(n);
      const w = parseWalk(text);
      if (!w && cierra && z.tramos && z.tramos.length >= 2) return this.cerrarPlanta(z, true);
      if (!w) return false;
      if (w.directo) {
        if (w.directo.area) z.area = round2(w.directo.area);
        if (w.directo.perimetro) z.perimetro = round2(w.directo.perimetro);
        if (!z.area) return this.ask('¿Y la superficie del suelo, en metros cuadrados?', []);
        if (!z.perimetro) return this.ask('¿Y el perímetro, en metros?', []);
        z.planta = null; this.save();
        return this.say('est_altura', { zid: z.id }, 'Anotado: ' + fmt(z.area) + ' metros cuadrados y ' + fmt(z.perimetro) + ' de perímetro.');
      }
      if (w.rect) { z.tramos = rectTramos(w.rect[0], w.rect[1]); return this.cerrarPlanta(z, true, 'Rectangular de ' + fmt(w.rect[0]) + ' por ' + fmt(w.rect[1]) + '.'); }
      z.tramos = (z.tramos || []).concat(w.tramos);
      const res = calcPlanta(z.tramos);
      if ((res.cierre === 'exacto' && z.tramos.length >= 3) || cierra) return this.cerrarPlanta(z, true);
      this.save();
      return this.repetir();
    }
  };
  Guia.prototype.cerrarPlanta = function (z, ok, pre) {
    const res = calcPlanta(z.tramos);
    z.area = res.area; z.perimetro = res.perimetro;
    z.planta = { tramos: z.tramos, pts: res.pts.map((q) => [round2(q[0]), round2(q[1])]), area: res.area, perimetro: res.perimetro, cierre: res.cierre, supuestas: res.supuestas, aviso: res.aviso, est: z.nombre };
    this.obra.plantas = this.obra.plantas || {}; this.obra.plantas[norm(z.nombre)] = Object.assign({ abierta: false, fecha: Date.now() }, z.planta);
    this.io.sketch && this.io.sketch(plantaSVG(z.planta), 'Planta ' + z.nombre);
    const msg = (pre ? pre + ' ' : '') + 'Planta: ' + fmt(res.area) + ' metros cuadrados y ' + fmt(res.perimetro) + ' de perímetro' +
      (res.cierre === '1' ? ', cerrando con una pared de ' + fmt(res.supuestas[0]) : res.cierre === '2' ? ', cerrando con dos paredes de ' + fmt(res.supuestas[0]) + ' y ' + fmt(res.supuestas[1]) : '') + '.' + (res.aviso ? ' Ojo: ' + res.aviso + '; si quieres repetirla, di «atrás».' : '');
    return this.say('est_altura', { zid: z.id }, msg);
  };
  P.est_planta.aprox = aproxPlanta;
  P.est_planta.deshacer = function (d) { const z = this.zona(d.zid); if (z && z.tramos && z.tramos.length && z.area == null) { const t = z.tramos.pop(); return 'He quitado la última pared, de ' + fmt(t.l) + '.'; } return null; };
  P.est_altura = {
    qb(d) { const z = this.zona(d.zid); return '¿Altura ' + (z ? (art(z.nombre).startsWith('el ') ? 'del ' + art(z.nombre).slice(3) : 'de ' + art(z.nombre)) : '') + '?'; },
    q(d) {
      const z = this.zona(d.zid);
      const prev = this.toma.zonas.filter((x) => x.ambito === 'interior' && x.altura && x.id !== d.zid).pop();
      return { t: '¿Qué altura tiene ' + art(z.nombre) + ', del suelo al techo?', c: CH((prev ? [{ label: 'La misma: ' + fmt(prev.altura), value: String(prev.altura).replace('.', ',') }] : []).concat(['2,50', '2,60', '2,70'])) };
    },
    ayuda: () => 'Dime solo la altura en metros, por ejemplo «2,60» o «dos sesenta».',
    formato: () => 'la altura en metros con coma decimal, por ejemplo «2,60»',
    saltar(d) { return this.say('est_huecos', { zid: d.zid }, 'Sin altura por ahora: las paredes quedarán pendientes de altura.'); },
    aprox(text) { const v = numeros(text).map((x) => (x > 20 ? round2(x / 100) : x)).filter((x) => x > 1.5 && x < 8); return v.length ? { txt: String(v[0]).replace('.', ','), q: '¿La altura es ' + fmt(v[0]) + ' metros?' } : null; },
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      let v = null;
      if (/(misma|igual|lo mismo)/.test(n)) { const cand = this.toma.zonas.filter((x) => x.ambito === 'interior' && x.altura && x.id !== d.zid); const prev = buscarZona({ toma: { zonas: cand } }, n) || cand.pop(); if (prev) v = prev.altura; }
      if (v == null) v = num(text);
      if (v != null && v > 20 && v < 2000) v = round2(v / 100);
      if (!(v > 0.5 && v < 20)) return false;
      z.altura = round2(v); this.save();
      return this.say('est_huecos', { zid: z.id }, 'Altura ' + fmt(z.altura) + '.');
    }
  };
  P.est_huecos = {
    qb(d) { const z = this.zona(d.zid); if (d.pend) return null; return (z.huecos || []).length ? '¿Alguna más?' : '¿Puertas o ventanas? Con medidas, o «ninguna».'; },
    q(d) {
      const z = this.zona(d.zid); const h = z.huecos || [];
      if (d.pend && d.pend.an) return { t: '¿Qué alto tiene ' + (d.pend.tipo === 'puerta' ? 'la puerta' : 'la ventana') + ' de ' + fmt(d.pend.an) + ' de ancho?', c: CH(d.pend.tipo === 'puerta' ? ['2,03', '2,10'] : ['0,90', '1,10', '1,20']) };
      if (d.pend) return { t: '¿Qué medidas tiene ' + (d.pend.tipo === 'puerta' ? 'la puerta' : 'la ventana') + '? Ancho por alto, por ejemplo «0,82 por 2,03».', c: CH(d.pend.tipo === 'puerta' ? ['0,72 por 2,03', '0,82 por 2,03'] : ['1,20 por 1,10']) };
      if (h.length) return { t: '¿Alguna puerta o ventana más?', c: CH(['No, ninguna más', 'Otra igual']) };
      // (también vale «la ventana igual que el salón»)
      const prevH = this.toma.zonas.filter((x) => x.ambito === 'interior' && x.id !== d.zid && (x.huecos || []).length).pop();
      return { t: (z.huecosMencion ? 'Me has dicho que hay huecos. ' : '') + '¿Tiene puertas o ventanas? Dímelas con sus medidas, por ejemplo «una puerta de 0,82 por 2,03» o «dos ventanas de 1,20 por 1,10»' + (prevH ? ', o «iguales que ' + art(prevH.nombre) + '»' : '') + '. Se descontarán de las paredes.', c: CH(['Ninguna'].concat(prevH ? [{ label: 'Iguales que ' + prevH.nombre, value: 'iguales que ' + prevH.nombre }] : []).concat(['Una puerta de 0,82 por 2,03'])) };
    },
    ayuda: () => 'Dime cada hueco así: «una puerta de 0,82 por 2,03» o «dos ventanas de 1,20 por 1,10». Si son como los de otra estancia: «la puerta y la ventana iguales que el salón». Si no hay ninguno, di «ninguna».',
    formato: () => 'cada hueco como «N puertas de ANCHO por ALTO» o «N ventanas de ANCHO por ALTO» separados por « y »; o «ninguna» si no hay',
    saltar(d) { return this.siguienteEstancia(d); },
    a(text, n, input, d) {
      const z = this.zona(d.zid); z.huecos = z.huecos || [];
      if (d.pend && !/\d|\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\b/.test(n)) return this.repetir();
      if (d.pend) {
        let an, al;
        if (d.pend.an) { const v = numeros(text)[0]; if (!(v > 0)) return false; an = d.pend.an; al = v > 10 ? round2(v / 100) : v; }
        else { const dm = dims2(text); if (!(dm.ancho > 0 && dm.alto > 0)) return false; an = dm.ancho; al = dm.alto; }
        z.huecos.push(Object.assign({}, d.pend, { an, al }));
        const cola = (d.cola || []).slice();
        this.g.d = cola.length ? { zid: d.zid, pend: cola[0], cola: cola.slice(1) } : { zid: d.zid }; this.save();
        return this.repetir('Anotada: ' + fmt(an) + ' por ' + fmt(al) + '.');
      }
      // «La puerta y la ventana iguales que en el salón», «las mismas que la anterior»
      if (/(igual|iguales|misma|mismas|mismo|mismos|lo mismo)/.test(n) && !/^(otra|otro) igual/.test(n)) {
        const otras = this.toma.zonas.filter((x) => x.ambito === 'interior' && x.id !== z.id && (x.huecos || []).length);
        const src = buscarZona({ toma: { zonas: otras } }, n) || (otras.length && (/(anterior|de antes|ultima|otra estancia)/.test(n) || !/(que el|que la|que en)/.test(n)) ? otras[otras.length - 1] : null);
        if (src) {
          const cl = n.split(/\s*(?:,|;|\by una\b|\by un\b|\by dos\b|\by tres\b|\bmas\b)\s*/).find((x) => /(igual|misma|mismo|lo mismo)/.test(x)) || n;
          const soloP = /puerta/.test(cl) && !/ventana/.test(cl), soloV = /ventana/.test(cl) && !/puerta/.test(cl);
          const cop = src.huecos.filter((x) => (soloP ? x.tipo === 'puerta' : soloV ? x.tipo === 'ventana' : true)).map((x) => Object.assign({}, x));
          if (cop.length) {
            cop.forEach((x) => z.huecos.push(x));
            parseHuecos(text).filter((x) => x.an && x.al).forEach((x) => z.huecos.push(x));
            this.save();
            return this.repetir('Copiado ' + deArt(src.nombre) + ': ' + cop.map((x) => fmtUds(x.uds) + ' ' + plural(x.uds, x.bal ? 'balconera' : x.tipo) + ' de ' + fmt(x.an) + ' por ' + fmt(x.al)).join(' y ') + '.');
          }
        } else if (/(que el|que la|que en|anterior)/.test(n)) return this.ask('¿Iguales que qué estancia? ' + (otras.length ? 'Tengo huecos en ' + otras.map((x) => x.nombre).join(', ') + '.' : 'Todavía no hay huecos en otras estancias.'), CH(otras.map((x) => ({ label: 'Igual que ' + x.nombre, value: 'iguales que ' + x.nombre }))));
      }
      if (/^otra igual|^otro igual|^la misma|^igual/.test(n) && z.huecos.length) { const u = z.huecos[z.huecos.length - 1]; u.uds = (u.uds || 1) + 1; this.save(); return this.repetir('Anotada otra igual: ' + fmtUds(u.uds) + ' en total.'); }
      const hs = parseHuecos(text);
      if (!hs.length) {
        if (FIN.test(n) || yesNo(n) === false) return this.siguienteEstancia(d);
        if (yesNo(n) === true) return this.ask('Dímela con sus medidas, por ejemplo «una puerta de 0,82 por 2,03» o «una ventana de 1,20 por 1,10».', CH(['Una puerta de 0,82 por 2,03', 'Una ventana de 1,20 por 1,10']));
        return false;
      }
      let notaAlto = '';
      hs.forEach((x) => { if (x.tipo === 'puerta' && x.an && !x.al) { x.al = 2.03; notaAlto = ' A las puertas sin alto les pongo 2,03.'; } });
      const sinMedida = hs.filter((x) => !(x.an && x.al));
      hs.filter((x) => x.an && x.al).forEach((x) => z.huecos.push(x));
      this.save();
      const hechos = hs.filter((x) => x.an && x.al);
      const pre = (hechos.length ? 'Anotado: ' + hechos.map((x) => fmtUds(x.uds) + ' ' + plural(x.uds, x.bal ? 'balconera' : x.tipo) + ' de ' + fmt(x.an) + ' por ' + fmt(x.al)).join(', ') + '.' : '') + notaAlto;
      if (sinMedida.length) { this.g.d = { zid: d.zid, pend: sinMedida[0], cola: sinMedida.slice(1) }; return this.repetir(pre.trim()); }
      if (hechos.length) return this.repetir(pre.trim());
      return this.repetir('Anotado: ' + hs.map((x) => fmtUds(x.uds) + ' ' + plural(x.uds, x.bal ? 'balconera' : x.tipo) + ' de ' + fmt(x.an) + ' por ' + fmt(x.al)).join(' y ') + '.');
    }
  };
  Guia.prototype.siguienteEstancia = function (d) {
    const z = this.zona(d.zid);
    const ded = (z.huecos || []).reduce((a, x) => a + (x.uds || 1) * (x.an || 0) * (x.al || 0), 0);
    const paredes = z.perimetro && z.altura ? round2(z.perimetro * z.altura - ded) : null;
    const res = 'Resumen ' + (z.nombre ? (art(z.nombre).startsWith('el ') ? 'del ' + art(z.nombre).slice(3) : 'de ' + art(z.nombre)) : '') + ': suelo ' + fmt(z.area) + ' metros cuadrados' + (paredes != null ? ', paredes ' + fmt(paredes) + ' descontando huecos' : '') + '.';
    if (this.g.tipo === 'estancia' && !this.g.masEst) return this.say('est_mas', {}, res);
    return this.say('est_mas', {}, res);
  };
  P.est_mas = {
    qb: () => '¿Otra estancia, instalaciones o trabajos?',
    q() {
      const u = usados(this);
      const otras = EST_DEF.filter((e) => !u.includes(norm(e))).slice(0, 4);
      return { t: (this.g.tipo === 'estancia' ? '¿Medimos otra estancia' : '¿Pasamos a otra estancia') + ', medimos las instalaciones o elegimos ya los trabajos?', c: CH([{ label: 'Elegir trabajos', value: 'elegir trabajos' }, { label: 'Instalaciones', value: 'instalaciones' }].concat(otras.slice(0, 3))) };
    },
    ayuda: () => 'Dime el nombre de la siguiente estancia, o «elegir trabajos» si ya has medido todas.',
    formato: () => '«elegir trabajos» si ha terminado de medir estancias, o el nombre de la siguiente estancia',
    a(text, n, input) {
      if (/(instalac|fontaner|electric)/.test(n)) { this.g.insPreguntado = true; const ri = P.ins_tipo.a.call(this, text, n, {}, {}); return ri === false ? this.say('ins_tipo', {}) : ri; }
      if (/(trabajo|terminar|termin|ya esta|ya estan|eso es todo|no hay mas|ninguna mas|nada mas|elegir|seleccion|he acabado|ya he medido)/.test(n) || /^(no|ninguna|listo|ya)$/.test(n)) return this.finEstancias();
      if (/^(si|otra|otra estancia|seguimos|vale)$/.test(n)) return this.say('est_nombre', {});
      return P.est_nombre.a.call(this, text, n, input, {});
    }
  };

  /* ---- Fin de las estancias: puertas de paso e instalaciones ---- */
  Guia.prototype.finEstancias = function (pre) {
    const g = this.g;
    const n = puertasPaso(this.toma.zonas.filter((z) => z.ambito === 'interior'), { guia: {} }).reduce((a, x) => a + x.n, 0);
    if (n && !g.puertasHecho) return this.say('puertas_total', {}, pre);
    if (!g.insPreguntado && !this.toma.zonas.some((z) => z.ambito === 'fontaneria' || z.ambito === 'electricidad')) return this.say('mas_ins', {}, pre);
    return this.abrirTrabajos(pre || 'Muy bien.');
  };
  P.puertas_total = {
    q() {
      const ls = puertasPaso(this.toma.zonas.filter((z) => z.ambito === 'interior'), { guia: {} });
      const n = ls.reduce((a, x) => a + x.n, 0);
      return { t: 'He contado ' + n + ' ' + plural(n, 'puerta') + ' de paso: ' + ls.map((x) => x.n + ' de ' + fmt(x.an) + ' por ' + fmt(x.al)).join(', ') + '. Si alguna la has dicho en dos estancias, dime cuántas hay en total. ¿Es correcto?', c: CH([{ label: 'Correcto, ' + n, value: 'correcto' }].concat(n > 1 ? [{ label: 'Son ' + (n - 1), value: String(n - 1) }] : [])) };
    },
    ayuda: () => 'Di «correcto» o el número total de puertas de paso, por ejemplo «son 5».',
    formato: () => '«correcto», o el número total de puertas de paso',
    a(text, n) {
      const ls = puertasPaso(this.toma.zonas.filter((z) => z.ambito === 'interior'), { guia: {} });
      const tot = ls.reduce((a, x) => a + x.n, 0);
      if (/^(no|incorrecto|no es correcto|mal)$/.test(n)) return this.ask('¿Cuántas puertas de paso hay en total?', CH(Array.from({ length: Math.min(tot, 5) }, (_, k) => String(k + 1))));
      if (/^(si|correcto|vale|ok|bien|exacto|asi es|eso es)\b/.test(n)) this.g.puertasTotal = null;
      else { const c = count(text); if (c == null || c > tot) return false; this.g.puertasTotal = c; }
      this.save();
      return this.say('puertas_cambio', {});
    }
  };
  P.puertas_cambio = {
    q() { const t = this.g.puertasTotal || puertasPaso(this.toma.zonas.filter((z) => z.ambito === 'interior'), { guia: {} }).reduce((a, x) => a + x.n, 0); return { t: '¿Cambiamos todas las puertas de paso? Son ' + t + '.', c: CH([{ label: 'Sí, todas', value: 'sí, todas' }, 'No', 'Solo algunas']) }; },
    ayuda: () => 'Di «sí, todas», «no» o cuántas se cambian, por ejemplo «cambiamos 3».',
    formato: () => '«sí» (todas), «no», o el número de puertas que se cambian',
    a(text, n) {
      const g = this.g;
      const sel = seleccion(this.obra);
      const marca = (on) => ['dem_puertas', 'car_puertas'].forEach((id) => { if (sel[id]) { sel[id].on = on; if (on) sel[id].zonas = zonasDe(this.obra, TRABAJOS.find((w) => w.id === id)).map((z) => z.id); } });
      if (/^solo algunas/.test(n)) return this.ask('¿Cuántas cambiamos?', []);
      const c = count(text);
      if (yesNo(n) === true || /todas/.test(n)) { g.puertasCambio = null; marca(true); }
      else if (c != null && c > 0) { g.puertasCambio = c; marca(true); }
      else if (yesNo(n) === false || c === 0) { g.puertasCambio = null; marca(false); }
      else return false;
      g.puertasHecho = true; this.save();
      const pre = g.puertasCambio ? 'Anoto el cambio de ' + g.puertasCambio + ' ' + plural(g.puertasCambio, 'puerta') + ': desmontaje y puerta nueva.' : yesNo(n) === false || c === 0 ? 'Sin cambio de puertas.' : 'Anoto el cambio de todas: desmontaje y puerta nueva.';
      return this.finEstancias(pre);
    }
  };
  P.mas_ins = {
    q: () => ({ t: '¿Medimos también las instalaciones en esta misma medición? Fontanería, electricidad o las dos.', c: CH([{ label: 'Fontanería', value: 'fontanería' }, { label: 'Electricidad', value: 'electricidad' }, { label: 'Las dos', value: 'las dos' }, { label: 'No, elegir trabajos', value: 'no' }]) }),
    ayuda: () => 'Di «fontanería», «electricidad», «las dos» o «no».',
    formato: () => 'una de: fontanería, electricidad, las dos, no',
    a(text, n) {
      this.g.insPreguntado = true;
      if (yesNo(n) === false || /(trabajo|elegir|ya esta)/.test(n)) return this.abrirTrabajos('Muy bien.');
      return P.ins_tipo.a.call(this, text, n, {}, {});
    }
  };
  P.inc_q = {
    q(d) { const it = INC_Q[d.i]; return it ? { t: it.q.call(this, d.inc), c: CH(it.c) } : { t: '', c: [] }; },
    ayuda(d) { const it = INC_Q[d.i]; return it && it.tipo === 'dims' ? 'Dime dos medidas separadas por «por», por ejemplo «30 por 30».' : it && it.tipo === 'modo' ? 'Di «desglosado» o «una sola partida».' : 'Dime solo el número.'; },
    formato(d) { const it = INC_Q[d.i]; return it && it.tipo === 'dims' ? '«A por B» en metros' : it && it.tipo === 'modo' ? '«desglosado» o «una sola partida»' : 'un número'; },
    saltar() { this.g.ret = this.g.ret || null; return this.volver('Dejo esa reparación sin anotar.'); },
    a(text, n, input, d) {
      const it = INC_Q[d.i]; const inc = d.inc;
      if (!it) return this.sigIncQ();
      if (/^(cancela|no lo anotes|olvidalo|dejalo|no hace falta)/.test(n)) return this.volver('Vale, no lo anoto.');
      // Cambio de causa en cualquier momento («no es por capilaridad, es por condensación»)
      if (inc.tipo === 'humedad') {
        const ult = n.replace(/^.*\b(es|era|sera)\s+(por\s+)?/, '');
        const c2 = causaHumedad(ult) || causaHumedad(n);
        if (c2 && c2 === inc.causa && !/^(desglos|una sola)/.test(n)) return this.repetir('Sí, por ' + (c2 === 'condensacion' ? 'condensación' : c2 === 'filtracion' ? 'filtración' : 'capilaridad') + '.');
        if (c2 && c2 !== inc.causa) { inc.causa = c2; this.g.d = { inc, i: -1 }; this.save(); return this.sigIncQ('Entendido: ' + INC_TXT.humedad(inc).toLowerCase() + '.'); }
      }
      if (it.tipo === 'causa') { const c3 = causaHumedad(n); if (!c3) return false; inc.causa = c3; this.g.d = { inc, i: d.i }; this.save(); return this.sigIncQ(); }
      if (it.tipo === 'area') { const dm = dims2(text); let v = dm.ancho > 0 && dm.alto > 0 ? round2(dm.ancho * dm.alto) : num(text); if (!(v > 0)) return false; inc.sup = round2(v); this.g.d = { inc, i: d.i }; this.save(); return this.sigIncQ(); }
      if (it.tipo === 'count') { const c = count(text); if (!(c >= 1)) return false; inc.n = c; }
      else if (it.tipo === 'num') { let v = num(text); if (v == null) return false; if (it.k === 'canto' && v > 1.5) v = round2(v / 100); if (v > 200 && it.k !== 'canto') v = round2(v / 100); if (!(v > 0)) return false; inc[it.k] = round2(v); }
      else if (it.tipo === 'dims') { const dm = dims2(text); if (!(dm.ancho > 0 && dm.alto > 0)) return false; const sc = (v) => (it.k === 'sec' && v > 2 ? round2(v / 100) : v); inc[it.k] = [sc(dm.ancho), sc(dm.alto)]; }
      else if (it.tipo === 'modo') { if (/(una sola|en una|completa|todo junto)/.test(n)) { this.g.incModo = 'una'; this.g.d = { inc, i: d.i }; this.save(); return this.sigIncQ(); } }
      if (it.tipo === 'modo') { if (/(desglos|fases|separad|por partes|cada trabajo|varias)/.test(n)) this.g.incModo = 'fases'; else if (/(una|sola|junta|todo|complet|unica)/.test(n)) this.g.incModo = 'una'; else return false; }
      this.g.d = { inc, i: d.i }; this.save();
      return this.sigIncQ();
    }
  };
  P.borrar_zona = {
    q(d) { const z = this.zona(d.zid); return { t: '¿Elimino ' + (z ? art(z.nombre) : 'esa zona') + '?', c: CH(['Sí, eliminar', 'No']) }; },
    ayuda: () => 'Di «sí» para eliminarla o «no» para dejarla.',
    formato: () => '«sí» o «no»',
    a(text, n, input, d) {
      const v = yesNo(n); if (v === null) return false;
      if (!v) return this.volver('No la elimino.');
      this.dlg.snapshot && this.dlg.snapshot();
      const z = borrarZona(this.obra, d.zid);
      if (this.g.ret && this.g.ret.d && this.g.ret.d.zid === d.zid) this.g.ret = null;
      this.save();
      return this.volver((z ? cap(art(z.nombre)) + (art(z.nombre).startsWith('la ') ? ' eliminada.' : ' eliminado.') : 'Eliminado.') + ' Si te has equivocado, di «deshacer».');
    }
  };
  P.nueva_partida = {
    q(d) { return { t: '¿Uso la partida de la base de datos o creo una nueva «' + d.desc + '»?', c: CH([{ label: 'Usar la de la base', value: 'usar la de la base' }, { label: 'Crear nueva', value: 'crear nueva' }]) }; },
    ayuda: () => 'Di «usar la de la base» o «crear nueva».',
    formato: () => '«usar» o «crear nueva»',
    a(text, n, input, d) {
      if (/(usa|usar|esa|la de la base|vale|si)\b/.test(n) && !/(nueva|crear|crea)/.test(n) && d.code) {
        const doc = this.dlg.cat.byCode.get(d.code);
        const amb = d.zid ? this.zona(d.zid).ambito : this.ambitoActual();
        const ww = api.anadirExtra(this.obra, doc, amb);
        if (d.zid) this.g.sel[ww.id].zonas = [d.zid];
        return this.terminarNueva(ww);
      }
      if (/(nueva|crear|crea|otra|no)\b/.test(n)) { this.g.paso = 'nueva_unidad'; this.save(); return this.repetir(); }
      return false;
    }
  };
  P.nueva_unidad = {
    q(d) { return { t: '¿En qué se mide «' + d.desc + '»? En unidades, metros, metros cuadrados o metros cúbicos.', c: CH([{ label: 'Unidades', value: 'unidades' }, { label: 'Metros', value: 'metros' }, { label: 'm²', value: 'metros cuadrados' }, { label: 'm³', value: 'metros cúbicos' }]) }; },
    ayuda: () => 'Dime la unidad: unidades, metros, metros cuadrados o metros cúbicos.',
    formato: () => 'una de: ud, m, m2, m3',
    a(text, n, input, d) {
      const u = /(cubic|m3|³)/.test(n) ? 'm3' : /(cuadrad|m2|²|superficie)/.test(n) ? 'm2' : /(unidad|ud|pieza|uno|una|partida|global)/.test(n) ? 'ud' : /(metro|lineal|ml|^m$)/.test(n) ? 'm' : null;
      if (!u) return false;
      const amb = d.zid ? this.zona(d.zid).ambito : this.ambitoActual();
      const zs = this.toma.zonas.filter((z) => z.ambito === amb);
      if (!d.zid && zs.length > 1) { this.g.paso = 'nueva_zonas'; this.g.d = Object.assign({}, d, { u, amb }); this.save(); return this.repetir(); }
      const w = anadirPropia(this.obra, d.desc, u, amb, this.zonasPara(amb, d.zid));
      return this.terminarNueva(w);
    }
  };
  P.nueva_zonas = {
    q(d) { const zs = this.toma.zonas.filter((z) => z.ambito === d.amb); return { t: '¿En qué ' + (d.amb === 'interior' ? 'estancias' : 'zonas') + '? Dímelas, o «en todas».', c: CH([{ label: 'En todas', value: 'en todas' }].concat(zs.slice(0, 5).map((z) => z.nombre))) }; },
    ayuda: () => 'Dime los nombres separados por «y», por ejemplo «salón y dormitorio 1», o «en todas».',
    formato: () => 'nombres de las estancias separados por « y », o «todas»',
    a(text, n, input, d) {
      const zs = this.toma.zonas.filter((z) => z.ambito === d.amb);
      let ids;
      if (/todas|todos|toda la/.test(n)) ids = zs.map((z) => z.id);
      else ids = n.split(/\s*(?:,|\by\b|\be\b)\s*/).map((tz) => buscarZona({ toma: { zonas: zs } }, tz)).filter(Boolean).map((z) => z.id).filter((x, i, a) => a.indexOf(x) === i);
      if (!ids.length) return false;
      const w = anadirPropia(this.obra, d.desc, d.u, d.amb, ids);
      return this.terminarNueva(w);
    }
  };

  /* ---- Trabajos (pantalla) y preguntas finales ---- */
  P.trabajos = {
    qb: () => 'Marca los trabajos y di «generar».',
    q() { return { t: 'Ahora elige en la pantalla los trabajos que vamos a hacer en cada capítulo. Puedes añadir partidas de la base de datos. Cuando termines, pulsa «Generar mediciones» o dímelo.', c: CH([{ label: 'Generar mediciones', value: 'generar mediciones' }, { label: 'Medir algo más', value: 'medir algo más' }]) }; },
    ayuda: () => 'Marca los trabajos en la pantalla, o dímelos, por ejemplo «solado de gres y pintura». Después di «generar mediciones».',
    formato: () => '«generar mediciones» si ha terminado de elegir; «medir algo más» si quiere volver a medir; o la lista de trabajos que nombra separados por comas',
    a(text, n) {
      if (/(generar|genera|general|mediciones|ediciones|listo|ya esta|hecho|terminar|termina|terminado|acabar|acabado|fin\b|vale ya|eso es todo|hazlo|calcula|con lo marcado|lo marcado|asi esta bien|adelante)/.test(n) || /^(ya|vale|ok|si)$/.test(n)) return this.generarMediciones();
      if (/(medir algo mas|medir mas|otra estancia|volver a medir|me falta|falta medir|otra zona)/.test(n)) { this.io.trabajos && this.io.trabajos(false); return this.volverAMedir(); }
      const ws = trabajosPara(this.obra);
      const sel = seleccion(this.obra);
      const marcados = [];
      const trozos = n.split(/\s*(?:,|\by\b|\btambien\b|\bmas\b)\s*/).filter((x) => x.length > 2);
      const quitar = /^(quita|quitar|desmarca|sin|no)\b/.test(n);
      trozos.forEach((tz) => {
        const pal = tz.replace(/^(quita|quitar|desmarca|sin|no|marca|pon|anade|y)\s+/, '').split(' ').filter((x) => x.length > 3);
        if (!pal.length) return;
        let best = null, bs = 0;
        ws.forEach((w) => { const lw = norm(w.label); const s = pal.filter((p) => lw.includes(p.slice(0, Math.max(4, p.length - 2)))).length / pal.length; if (s > bs) { bs = s; best = w; } });
        if (best && bs >= 0.6) { sel[best.id].on = !quitar; marcados.push(best.label.toLowerCase()); }
      });
      if (!marcados.length) {
        const inc = detectarIncidencia(n); if (inc && n.split(' ').length >= 3) return this.incidencia(inc, text);
        // Solo se crea una partida nueva si se pide («añade…», «crea…», «nueva partida…»)
        if (/^(anade|anadir|crea|crear|nueva partida|otra partida|quiero anadir|pon|mete|apunta)\b/.test(n) && contentLen(n) >= 2) return this.nuevaPartida(text.replace(/^\s*\S+\s+/, ''));
        return false;
      }
      this.save();
      return this.ask((quitar ? 'Quitado: ' : 'Marcado: ') + marcados.join(', ') + '. ¿Algo más, o generamos las mediciones?', this.pasos.trabajos.q.call(this).c);
    }
  };
  Guia.prototype.volverAMedir = function () { return this.say('mas_zona', {}); };
  P.mas_zona = {
    q: () => ({ t: '¿Qué medimos ahora? Otra estancia, instalaciones, una fachada o una cubierta.', c: CH([{ label: 'Otra estancia', value: 'otra estancia' }, { label: 'Instalaciones', value: 'instalaciones' }, { label: 'Fachada', value: 'fachada' }, { label: 'Cubierta', value: 'cubierta' }, { label: 'Volver a los trabajos', value: 'elegir trabajos' }]) }),
    ayuda: () => 'Di «otra estancia», «instalaciones», «fachada», «cubierta» o «volver a los trabajos».',
    formato: () => 'una de: estancia, instalaciones, fachada, cubierta, trabajos',
    a(text, n) {
      if (/trabajo/.test(n)) return this.abrirTrabajos();
      if (/(instalac|fontaner|electric)/.test(n)) { this.g.tipo = this.g.tipo || 'instalaciones'; return P.ins_tipo.a.call(this, text, n, {}, {}); }
      if (/fachada/.test(n)) { this.g.tipo = 'fachada'; return this.say('fac_lista', { mas: true }); }
      if (/(cubierta|tejado|azotea)/.test(n)) { this.g.tipo = 'cubierta'; return this.say('cub_nombre', {}); }
      if (/(estancia|habitacion|otra|si)/.test(n)) { if (this.g.tipo !== 'estancia') this.g.tipo = 'vivienda'; return this.say('est_nombre', {}); }
      const m = /(salon|cocina|bano|aseo|dormitorio|pasillo|terraza|comedor|recibidor|despacho|lavadero)/.test(n);
      if (m) { this.g.tipo = this.g.tipo === 'estancia' ? 'estancia' : 'vivienda'; return P.est_nombre.a.call(this, text, n, {}, {}); }
      return false;
    }
  };
  P.preguntas = {
    q(d) {
      const it = (this.g.preguntas || [])[d.i];
      if (!it) return { t: '', c: [] };
      if (it.residuos) {
        const r = estimarResiduos(this.obra); const pct = this.g.sysPct || 2;
        return { t: 'Para los residuos calculo ' + r.n + ' ' + plural(r.n, 'contenedor', 'contenedores') + ' de 4,2 metros cúbicos según las demoliciones. ¿Lo dejo así o cuántos pongo? La seguridad y salud va como partida alzada del ' + fmt(pct, 0) + ' por ciento; si quieres otro porcentaje, dímelo.', c: CH([{ label: 'Así está bien', value: 'así está bien' }, String(r.n + 1), String(r.n + 2), { label: 'Seguridad al 3 %', value: 'seguridad y salud al 3 por ciento' }]) };
      }
      const w = trabajosPara(this.obra).find((x) => x.id === it.wid) || {}; const z = this.zona(it.zid) || { nombre: '' };
      return { t: (w.pide || '¿Qué medición tiene ' + (w.label || '').toLowerCase() + ' en {zona}?').replace('{zona}', art(z.nombre)), c: CH(['No hay', 'Saltar']) };
    },
    ayuda(d) { const it = (this.g.preguntas || [])[d.i]; const w = it && trabajosPara(this.obra).find((x) => x.id === it.wid); return w && w.u === 'ud' ? 'Dime solo cuántas unidades.' : w && w.u === 'm' ? 'Dime los metros, por ejemplo «4,50», o varios tramos: «2 tramos de 3».' : 'Dime las medidas en metros separadas por «por», por ejemplo «3,20 por 2,60».'; },
    formato(d) { const it = (this.g.preguntas || [])[d.i]; const w = it && trabajosPara(this.obra).find((x) => x.id === it.wid); return w && w.u === 'ud' ? 'un número de unidades' : w && w.u === 'm' ? 'metros, por ejemplo «4,50» o «2 de 3,10»' : w && w.u === 'm3' ? '«LARGO por ALTO por ESPESOR» en metros' : '«LARGO por ALTO» en metros'; },
    saltar(d) { return this.siguientePregunta(d, null); },
    a(text, n, input, d) {
      const it = (this.g.preguntas || [])[d.i];
      if (!it) return this.fin();
      if (it.residuos) {
        const g = this.g;
        const mp = n.match(/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento)/);
        if (mp) { g.sysPct = parseFloat(mp[1].replace(',', '.')); generar(this.obra, this.dlg.cat); this.save(); if (!/contenedor/.test(n)) return this.repetir('Seguridad y salud al ' + fmt(g.sysPct, 0) + ' por ciento.'); }
        const c = /contenedor/.test(n) || !mp ? count(n.replace(/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento)/, '')) : null;
        if (/^(asi|vale|si|ok|bien|correcto|perfecto|esta bien|dejalo)/.test(n)) { g.contenedoresOk = true; }
        else if (c != null && c >= 0) { g.contenedores = c || null; g.contenedoresOk = true; generar(this.obra, this.dlg.cat); }
        else if (!mp) return false;
        this.save();
        if (!g.contenedoresOk) return this.repetir();
        if (d.i + 1 < g.preguntas.length) return this.say('preguntas', { i: d.i + 1 }, 'Anotado.');
        return this.fin();
      }
      if (/^(no hay|ninguno|ninguna|nada|cero|no)$/.test(n)) return this.siguientePregunta(d, []);
      const w = trabajosPara(this.obra).find((x) => x.id === it.wid);
      const pm = parseMeasure(text);
      const conv = (v) => (pm.cm ? round2(v / 100) : v);
      const dd = pm.dims.map(conv);
      let ln;
      if (w.u === 'ud') { const c = pm.n ?? count(text); if (c == null) return false; ln = L(pm.comment || '', c); }
      else if (w.u === 'm') { if (!dd.length && pm.n == null) return false; ln = L(pm.comment || '', dd.length ? (pm.n || 1) : 1, dd.length ? dd[0] : pm.n); }
      else if (w.u === 'm2') { if (dd.length < 2) return false; ln = L(pm.comment || '', pm.n || 1, dd[0], null, dd[1]); }
      else { if (dd.length < 3) return false; ln = L(pm.comment || '', pm.n || 1, dd[0], dd[2], dd[1]); }
      return this.siguientePregunta(d, [ln]);
    }
  };
  Guia.prototype.siguientePregunta = function (d, lines) {
    const it = this.g.preguntas[d.i];
    this.g.resp = this.g.resp || {};
    if (lines) this.g.resp[it.wid + '|' + it.zid] = lines;
    if (lines && lines.length) generar(this.obra, this.dlg.cat);
    const pre = lines && lines.length ? 'Anotado.' : lines ? 'Sin medición.' : 'Lo dejo para luego.';
    if (d.i + 1 < this.g.preguntas.length) return this.say('preguntas', { i: d.i + 1 }, pre);
    this.save();
    return this.fin();
  };

  /* ---- Fachadas ---- */
  const fachadas = (self) => self.toma.zonas.filter((z) => z.ambito === 'fachada');
  P.fac_lista = {
    qb(d) { return fachadas(this).length && !d.mas ? '¿Otra fachada?' : 'Fachadas: nombre, ancho y alto.'; },
    q(d) {
      const fs = fachadas(this);
      if (fs.length && !d.mas) return { t: '¿Otra fachada? Dímela, o di «ya está».', c: CH(['Ya está', 'Misma altura que la anterior']) };
      return { t: 'Perfecto. Ve diciéndome las fachadas: puedes numerarlas o darles una referencia, con el ancho y el alto. Si tiene la misma altura que la anterior, di «misma que la anterior». Por ejemplo: «fachada norte, 12 por 7».', c: [] };
    },
    ayuda: () => 'Dime el nombre de la fachada, el ancho y el alto en metros: «fachada principal 12 por 7». Si la altura es la misma que la anterior: «fachada lateral 8, misma altura».',
    formato: () => '«NOMBRE ANCHO por ALTO» (por ejemplo «Fachada norte 12 por 7»), o «NOMBRE ANCHO misma altura», o «ya está» si ha terminado',
    a(text, n, input, d) {
      const fs = fachadas(this);
      if (fs.length && FIN.test(n) && !/\d/.test(n)) return this.say('fac_desc', {});
      const dm = dims2(text);
      const misma = /(misma|igual|lo mismo)/.test(n);
      const prev = fs[fs.length - 1];
      if (dm.ancho == null) return false;
      let alto = dm.alto;
      if (alto == null && misma && prev) alto = prev.alto;
      if (alto == null) { this.g.d = { pendAncho: dm.ancho, nombre: etiqueta(text) }; return this.ask('¿Y el alto de esa fachada? ' + (prev ? 'O di «misma que la anterior».' : ''), CH(prev ? ['Misma que la anterior'] : [])); }
      const nombre = etiqueta(text) || (d.nombre) || 'Fachada ' + (fs.length + 1);
      const z = this.nuevaZona('fachada', /fachada/i.test(nombre) ? cap(nombre) : 'Fachada ' + nombre.toLowerCase(), { ancho: dm.ancho, alto: round2(alto), ventanas: [] });
      this.save();
      return this.say('fac_lista', {}, 'Anotada ' + z.nombre.toLowerCase() + ': ' + fmt(z.ancho) + ' por ' + fmt(z.alto) + '.');
    }
  };
  P.fac_lista.aprox = function (text) { const v = numeros(text); return v.length === 2 ? { txt: etiqueta(text) + ' ' + String(v[0]).replace('.', ',') + ' por ' + String(v[1]).replace('.', ','), q: '¿' + (etiqueta(text) || 'Una fachada') + ' de ' + fmt(v[0]) + ' de ancho por ' + fmt(v[1]) + ' de alto?' } : null; };
  // Si dijo solo el ancho, el siguiente número (o «misma») completa la fachada
  const facA = P.fac_lista.a;
  P.fac_lista.a = function (text, n, input, d) {
    if (d.pendAncho != null) {
      const fs = fachadas(this); const prev = fs[fs.length - 1];
      let alto = /(misma|igual)/.test(n) && prev ? prev.alto : num(text);
      if (!(alto > 0)) return false;
      const nombre = d.nombre || 'Fachada ' + (fs.length + 1);
      const z = this.nuevaZona('fachada', /fachada/i.test(nombre) ? cap(nombre) : 'Fachada ' + nombre.toLowerCase(), { ancho: d.pendAncho, alto: round2(alto), ventanas: [] });
      this.save();
      return this.say('fac_lista', {}, 'Anotada ' + z.nombre.toLowerCase() + ': ' + fmt(z.ancho) + ' por ' + fmt(z.alto) + '.');
    }
    return facA.call(this, text, n, input, d);
  };
  P.fac_desc = {
    q: () => ({ t: '¿Descontamos las ventanas?', c: CH(['Sí', 'No']) }),
    ayuda: () => 'Respóndeme sí o no: ¿restamos las ventanas de la superficie de las fachadas?',
    formato: () => '«sí» o «no»',
    a(text, n) {
      const v = yesNo(n); if (v === null) return false;
      fachadas(this).forEach((z) => { z.descontar = v; });
      if (!v) return this.abrirTrabajos('Sin descontar ventanas.');
      return this.say('fac_tipos', { fi: 0 });
    }
  };
  P.fac_tipos = {
    q(d) { const z = fachadas(this)[d.fi]; return { t: (z ? z.nombre : 'Fachada') + ': ¿cuántos tipos de ventana diferentes tiene?', c: CH(['Ninguna', '1', '2', '3']) }; },
    ayuda: () => 'Dime cuántos tipos de ventana distintos hay en esta fachada, contando como un tipo las que tienen las mismas medidas.',
    formato: () => 'un número entero (0 si no hay ventanas)',
    a(text, n, input, d) {
      const c = count(text); if (c == null) return false;
      if (!c) return this.sigFachada(d);
      return this.say('fac_tipo', { fi: d.fi, ti: 0, nt: c });
    }
  };
  P.fac_tipo = {
    q(d) { return { t: (d.nt > 1 ? 'Tipo ' + (d.ti + 1) + ': d' : 'D') + 'ame las unidades y las medidas, por ejemplo «3 de 1,20 por 1,40».', c: [] }; },
    ayuda: () => 'Dime cuántas ventanas hay de ese tipo y su ancho por alto: «3 de 1,20 por 1,40».',
    formato: () => '«N de ANCHO por ALTO» en metros',
    a(text, n, input, d) {
      const pm = parseMeasure(text);
      let dd = pm.dims.slice(); let u = pm.n;
      if (u == null && dd.length === 3) u = dd.shift();
      if (dd.length < 2) return false;
      const conv = (v) => (pm.cm || (v > 10 && Number.isInteger(v)) ? round2(v / 100) : v);
      const z = fachadas(this)[d.fi];
      z.ventanas.push({ uds: u || 1, an: conv(dd[0]), al: conv(dd[1]) }); this.save();
      const pre = ((u || 1) === 1 ? 'Anotada 1 de ' : 'Anotadas ' + fmtUds(u) + ' de ') + '' + fmt(conv(dd[0])) + ' por ' + fmt(conv(dd[1])) + '.';
      if (d.ti + 1 < d.nt) return this.say('fac_tipo', { fi: d.fi, ti: d.ti + 1, nt: d.nt }, pre);
      return this.sigFachada(d, pre);
    }
  };
  Guia.prototype.sigFachada = function (d, pre) {
    if (d.fi + 1 < fachadas(this).length) return this.say('fac_tipos', { fi: d.fi + 1 }, pre);
    return this.abrirTrabajos(pre);
  };

  /* ---- Cubiertas ---- */
  P.cub_nombre = {
    q() { const n = this.toma.zonas.filter((z) => z.ambito === 'cubierta').length; return { t: n ? '¿Qué otra cubierta medimos? Dime su nombre.' : '¿Qué cubierta vamos a medir? Dime un nombre, por ejemplo «cubierta principal».', c: CH(n ? ['Cubierta ' + (n + 1)] : ['Cubierta principal', 'Terraza', 'Tejado']) }; },
    ayuda: () => 'Dime solo un nombre para la cubierta, por ejemplo «cubierta principal» o «tejado norte».',
    formato: () => 'el nombre de la cubierta',
    a(text) {
      const nom = cap(text.replace(/^(la|el|una|un)\s+/i, '').split(/[,.]/)[0]).slice(0, 40);
      if (!nom || !/[a-zñ]/i.test(norm(nom))) return false;
      const z = this.nuevaZona('cubierta', nom);
      const n = norm(text);
      if (/plana|azotea|terraza|transitable/.test(n)) { z.tipo = 'plana'; this.save(); return this.say('cub_planta', { zid: z.id }, 'Cubierta plana.'); }
      if (/inclinada|teja|tejado|faldon/.test(n)) { z.tipo = 'inclinada'; this.save(); return this.say('cub_faldones', { zid: z.id }, 'Cubierta inclinada.'); }
      this.save();
      return this.say('cub_tipo', { zid: z.id });
    }
  };
  P.cub_tipo = {
    q: () => ({ t: '¿Es plana o inclinada?', c: CH(['Plana', 'Inclinada']) }),
    ayuda: () => 'Dime «plana» o «inclinada».',
    formato: () => '«plana» o «inclinada»',
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      if (/plan|azotea|transitable|terraza/.test(n)) { z.tipo = 'plana'; this.save(); return this.say('cub_planta', { zid: z.id }); }
      if (/inclin|teja|pendiente|faldon|tejado/.test(n)) { z.tipo = 'inclinada'; this.save(); return this.say('cub_faldones', { zid: z.id }); }
      return false;
    }
  };
  P.cub_planta = {
    qb: () => 'Paredes del antepecho con giros, o largo por ancho.',
    q(d) {
      const z = this.zona(d.zid);
      if (z && z.tramos && z.tramos.length) return { t: 'Llevo ' + z.tramos.length + ' ' + plural(z.tramos.length, 'tramo') + ': ' + z.tramos.map((t) => fmt(t.l)).join(', ') + '. Sigue, o di «cierra».', c: CH(['Cierra', 'Empezar de nuevo']) };
      return { t: 'Ve dándome las medidas de las paredes del antepecho, el ángulo aproximado del giro y hacia dónde gira. Con eso hago el croquis y calculo la superficie. Si es rectangular, basta con «8 por 6».', c: CH(['Superficie y perímetro']) };
    },
    ayuda: () => AYUDA_WALK.replace('la estancia', 'la cubierta') + ' O dame «superficie 48 y perímetro 28».',
    formato: P.est_planta.formato,
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      if (/^superficie y perimetro$/.test(n)) return this.ask('Dime la superficie y el perímetro, por ejemplo «superficie 48 y perímetro 28».', []);
      if (/^(empezar de nuevo|borra|de nuevo)/.test(n)) { z.tramos = []; this.save(); return this.repetir('Empezamos de nuevo.'); }
      const cierra = /(cierr|ya esta|termin|vuelvo al principio|eso es todo)/.test(n);
      const w = parseWalk(text);
      const fin = (pre) => this.say('cub_remonte', { zid: z.id }, pre);
      if (!w && cierra && z.tramos && z.tramos.length >= 2) { this.cerrarCub(z); return fin(this.msgCub(z)); }
      if (!w) return false;
      if (w.directo) { if (w.directo.area) z.area = round2(w.directo.area); if (w.directo.perimetro) z.perimetro = round2(w.directo.perimetro); if (!z.area || !z.perimetro) return this.ask(!z.area ? '¿Y la superficie?' : '¿Y el perímetro?', []); this.save(); return fin('Anotado: ' + fmt(z.area) + ' metros cuadrados.'); }
      if (w.rect) { z.tramos = rectTramos(w.rect[0], w.rect[1]); this.cerrarCub(z); return fin(this.msgCub(z)); }
      z.tramos = (z.tramos || []).concat(w.tramos);
      const res = calcPlanta(z.tramos);
      if ((res.cierre === 'exacto' && z.tramos.length >= 3) || cierra) { this.cerrarCub(z); return fin(this.msgCub(z)); }
      this.save(); return this.repetir();
    }
  };
  P.cub_planta.aprox = aproxPlanta;
  P.cub_planta.deshacer = P.est_planta.deshacer;
  Guia.prototype.cerrarCub = function (z) {
    const res = calcPlanta(z.tramos);
    z.area = res.area; z.perimetro = res.perimetro;
    z.planta = { tramos: z.tramos, pts: res.pts.map((q) => [round2(q[0]), round2(q[1])]), area: res.area, perimetro: res.perimetro, cierre: res.cierre, supuestas: res.supuestas, aviso: res.aviso, est: z.nombre };
    this.io.sketch && this.io.sketch(plantaSVG(z.planta), 'Planta ' + z.nombre);
    this.save();
  };
  Guia.prototype.msgCub = function (z) { return 'Superficie ' + fmt(z.area) + ' metros cuadrados y ' + fmt(z.perimetro) + ' de perímetro de antepecho.' + (z.planta && z.planta.aviso ? ' Ojo: ' + z.planta.aviso + '.' : ''); };
  P.cub_remonte = {
    q: () => ({ t: 'La impermeabilización tiene que remontar el antepecho al menos 20 centímetros. ¿Cuánto lo remontamos?', c: CH(['20 cm', '30 cm', '40 cm']) }),
    ayuda: () => 'Dime la altura del remonte en centímetros, por ejemplo «20 centímetros».',
    formato: () => 'la altura del remonte en metros con coma, por ejemplo «0,20»',
    saltar(d) { this.zona(d.zid).remonte = 0.2; this.save(); return this.say('cub_mas', {}, 'Pongo 20 centímetros.'); },
    a(text, n, input, d) {
      let v = num(text); if (v == null) { if (/(minimo|normal|lo de siempre|20)/.test(n)) v = 0.2; else return false; }
      if (v >= 5) v = round2(v / 100);
      let pre = 'Remonte de ' + fmt(v) + '.';
      if (v < 0.2) { pre = 'El mínimo son 20 centímetros: pongo 0,20.'; v = 0.2; }
      this.zona(d.zid).remonte = v; this.save();
      return this.say('cub_mas', {}, pre);
    }
  };
  P.cub_faldones = {
    qb(d) { const z = this.zona(d.zid); return z && (z.faldones || []).length ? '¿Otro faldón?' : 'Cada faldón: ancho por largo en planta.'; },
    q(d) {
      const z = this.zona(d.zid);
      if (z && z.faldones && z.faldones.length) return { t: '¿Otro faldón? Dímelo, o di «ya está».', c: CH(['Ya está']) };
      return { t: 'Dame el ancho y el largo de cada faldón medidos en planta, por ejemplo «faldón sur 8 por 4». Aplico un 1,05 para obtener la verdadera magnitud; si conoces la pendiente, dímela.', c: [] };
    },
    ayuda: () => 'Dime cada faldón con su ancho por largo en planta: «faldón norte 8 por 4». Si sabes la pendiente: «pendiente 30 por ciento».',
    formato: () => '«faldón NOMBRE ANCHO por LARGO»; o «pendiente N por ciento»; o «ya está» si ha terminado',
    a(text, n, input, d) {
      const z = this.zona(d.zid); z.faldones = z.faldones || [];
      if (/^(inclinada|es inclinada|si|vale|de acuerdo)$/.test(n)) return this.repetir();
      const mp = n.match(/pendiente\s*(?:de|del)?\s*([\d.,]+)\s*(por ciento|%|grados)?/);
      let pre = '';
      if (mp) {
        const v = parseFloat(mp[1].replace(',', '.'));
        z.factor = /grados/.test(mp[2] || '') ? round2(1 / Math.cos(v * Math.PI / 180)) : round2(Math.sqrt(1 + Math.pow(v / 100, 2)));
        pre = 'Con esa pendiente el factor es ' + fmt(z.factor) + '.';
        if (!/por\b|x/.test(n.replace(mp[0], ''))) { this.save(); return this.repetir(pre); }
      }
      if (z.faldones.length && FIN.test(n) && !/\d/.test(n.replace(mp ? mp[0] : '', ''))) return this.say('cub_mas', {}, 'Faldones anotados.');
      const dm = dims2(mp ? text.replace(/pendiente.*?(por ciento|%|grados)/i, '') : text);
      if (!(dm.ancho > 0 && dm.alto > 0)) return pre ? this.repetir(pre) : false;
      const nom = etiqueta(text.replace(/pendiente.*?(por ciento|%|grados)/i, '')) || 'Faldón ' + (z.faldones.length + 1);
      z.faldones.push({ nombre: /^fald/i.test(nom) ? cap(nom) : 'Faldón ' + nom.toLowerCase(), l: dm.ancho, a: dm.alto });
      z.factor = z.factor || 1.05; this.save();
      return this.repetir((pre ? pre + ' ' : '') + 'Anotado: ' + fmt(dm.ancho) + ' por ' + fmt(dm.alto) + ', ' + fmt(round2(dm.ancho * dm.alto * z.factor)) + ' metros cuadrados reales.');
    }
  };
  P.cub_faldones.aprox = function (text) { const v = numeros(text); return v.length === 2 ? { txt: (etiqueta(text) || 'faldón') + ' ' + String(v[0]).replace('.', ',') + ' por ' + String(v[1]).replace('.', ','), q: '¿Un faldón de ' + fmt(v[0]) + ' por ' + fmt(v[1]) + '?' } : null; };
  P.est_huecos.deshacer = function (d) {
    const z = this.zona(d.zid); if (d.pend) { this.g.d = { zid: d.zid }; return 'Vale, quito ese hueco.'; }
    if (z && (z.huecos || []).length) { const x = z.huecos.pop(); return 'He quitado ' + (x.uds > 1 ? 'las ' + x.uds + ' ' + plural(x.uds, x.tipo) : (x.tipo === 'puerta' ? 'la puerta' : 'la ventana')) + ' de ' + fmt(x.an) + ' por ' + fmt(x.al) + '.'; }
    return null;
  };
  P.fac_lista.deshacer = function (d) {
    if (d.pendAncho != null) { this.g.d = {}; return 'Vale, olvido esa fachada.'; }
    const fs = fachadas(this); if (!fs.length) return null;
    const z = fs[fs.length - 1]; this.toma.zonas = this.toma.zonas.filter((x) => x.id !== z.id); return 'He quitado ' + z.nombre.toLowerCase() + '.';
  };
  P.cub_faldones.deshacer = function (d) { const z = this.zona(d.zid); if (z && (z.faldones || []).length) { const f = z.faldones.pop(); return 'He quitado ' + f.nombre.toLowerCase() + '.'; } return null; };
  P.fac_tipo.deshacer = function (d) { const z = fachadas(this)[d.fi]; if (z && d.ti > 0 && z.ventanas.length) { z.ventanas.pop(); this.g.d = Object.assign({}, d, { ti: d.ti - 1 }); return 'He quitado el tipo de ventana anterior. Dímelo otra vez.'; } return null; };
  P.est_huecos.aprox = function (text, d) { if (d.pend) return null; const v = numeros(text); if (v.length !== 2) return null; const t = /puerta/.test(norm(text)) || (v[1] >= 1.9 && v[0] < 1.2) ? 'puerta' : 'ventana'; return { txt: 'una ' + t + ' de ' + String(v[0]).replace('.', ',') + ' por ' + String(v[1]).replace('.', ','), q: '¿Una ' + t + ' de ' + fmt(v[0]) + ' por ' + fmt(v[1]) + '?' }; };
  P.cub_mas = {
    q: () => ({ t: '¿Medimos otra cubierta o elegimos los trabajos?', c: CH([{ label: 'Elegir trabajos', value: 'elegir trabajos' }, 'Otra cubierta']) }),
    ayuda: () => 'Di «otra cubierta» o «elegir trabajos».',
    formato: () => '«otra cubierta» o «elegir trabajos»',
    a(text, n) {
      if (/(otra|si|seguimos)/.test(n) && !/trabajo/.test(n)) return this.say('cub_nombre', {});
      if (/(trabajo|elegir|no|ya|listo|termin)/.test(n)) return this.abrirTrabajos();
      return false;
    }
  };

  /* ---- Instalaciones ---- */
  P.ins_tipo = {
    q: () => ({ t: '¿Qué instalación? Fontanería, electricidad u otra.', c: CH([{ label: 'Fontanería', value: 'fontanería' }, { label: 'Electricidad', value: 'electricidad' }, { label: 'Las dos', value: 'las dos' }, { label: 'Otra', value: 'otra' }]) }),
    ayuda: () => 'Dime «fontanería», «electricidad», «las dos» u «otra».',
    formato: () => 'una de: fontanería, electricidad, las dos, otra',
    a(text, n) {
      const fon = /fontaner|agua|sanitari|desague|saneamiento|las dos|ambas|todo/.test(n), ele = /electric|luz|enchufe|las dos|ambas|todo/.test(n);
      if (fon || ele) { this.g.cola = [fon && 'fon', ele && 'ele'].filter(Boolean); return this.sigInstalacion(); }
      if (/^(otra|otro|otra cosa|clima|calefac|gas|telecom|aire)/.test(n)) {
        this.g.fin = true; this.g.paso = 'libre'; this.save(); this.dlg.state = { mode: 'idle' };
        return this.ask('De acuerdo. Cuéntame qué instalación es y qué elementos lleva, con sus cantidades o medidas, y lo voy anotando.', []);
      }
      return false;
    }
  };
  Guia.prototype.sigInstalacion = function (pre) {
    const c = this.g.cola || [];
    const k = c.shift(); this.g.cola = c;
    if (k === 'fon') return this.say('fon_est', {}, pre);
    if (k === 'ele') return this.say('ele_cuadro', {}, pre);
    return this.abrirTrabajos(pre);
  };
  const FON_Q = {
    bano: [['af', 'num', '¿Cuántos puntos de solo agua fría tiene?'], ['afc', 'num', '¿Cuántos puntos de agua fría y caliente tiene?'], ['susp', 'yn', '¿El inodoro es suspendido?'], ['tipo_ino', 'opt', '¿Reducido o normal?', ['Reducido', 'Normal'], (f) => f.susp === false], ['ducha', 'opt', '¿Plato de ducha o bañera?', ['Plato de ducha', 'Bañera', 'Ninguno']], ['mampara', 'yn', '¿Se prevé mampara?', null, (f) => f.ducha === 'plato'], ['bide', 'yn', '¿Tiene bidé?']],
    cocina: [['af', 'num', '¿Cuántos puntos de solo agua fría tiene?'], ['afc', 'num', '¿Cuántos puntos de agua fría y caliente tiene?'], ['lavadora', 'yn', '¿Lleva toma para lavadora?'], ['lavavajillas', 'yn', '¿Y toma para lavavajillas?']],
    lavadero: [['af', 'num', '¿Cuántos puntos de solo agua fría tiene?'], ['afc', 'num', '¿Cuántos puntos de agua fría y caliente tiene?'], ['lavadora', 'yn', '¿Lleva toma para lavadora?']],
    otra: [['af', 'num', '¿Cuántos puntos de solo agua fría tiene?'], ['afc', 'num', '¿Cuántos puntos de agua fría y caliente tiene?']]
  };
  const fonZonas = (self) => self.toma.zonas.filter((z) => z.ambito === 'fontaneria');
  P.fon_est = {
    qb() { return fonZonas(this).length ? '¿Otra estancia con agua, o «ya está»?' : '¿Qué estancia con agua?'; },
    q() {
      const n = fonZonas(this).length; const hechas = fonZonas(this).map((z) => norm(z.nombre));
      const hum = this.toma.zonas.filter((z) => z.ambito === 'interior' && /(bano|aseo|cocina|lavadero|galeria|lavanderia)/.test(norm(z.nombre)) && !hechas.includes(norm(z.nombre))).map((z) => z.nombre);
      return { t: n ? '¿Otra estancia con agua? ' + (hum.length ? hum.join(', ') + ', u otra' : 'Baño, cocina, lavadero u otra') + '; o di «ya está».' : '¿Por qué estancia empezamos la fontanería? ' + (hum.length ? hum.join(', ') + ', u otra.' : 'Baño, cocina, lavadero u otra.'), c: CH((n ? ['Ya está'] : []).concat(hum.length ? hum : FON_EST).concat(hum.length ? ['Otra'] : [])) };
    },
    ayuda: () => 'Dime el tipo de estancia: baño, cocina, lavadero u otra.',
    formato: () => 'una de: baño, aseo, cocina, lavadero, otra (con su nombre si lo dice); o «ya está»',
    a(text, n) {
      if (fonZonas(this).length && FIN.test(n)) return this.sigInstalacion('Fontanería anotada.');
      let tipo = /(bano|aseo)/.test(n) ? 'bano' : /cocina/.test(n) ? 'cocina' : /(lavadero|galeria|lavanderia|colada)/.test(n) ? 'lavadero' : /^(otra|otro)\b/.test(n) ? 'otra' : null;
      if (!tipo) return false;
      if (tipo === 'otra') return this.say('fon_otra', {});
      const base = estanciaName(text.replace(/^(?:el|la|un|una)\s+/i, '').split(/[,.]/)[0]) || cap(tipo);
      const exist = fonZonas(this).map((z) => norm(z.nombre));
      let nombre = base; let i = 2; while (exist.includes(norm(nombre))) nombre = base.replace(/\s+\d+$/, '') + ' ' + i++;
      const z = this.nuevaZona('fontaneria', nombre, { f: { tipo } }); this.save();
      return this.say('fon_q', { zid: z.id, i: 0 }, cap(nombre) + '.');
    }
  };
  P.fon_otra = {
    q: () => ({ t: '¿Cuál? Dime el nombre de la estancia y, si quieres, qué aparatos o puntos de agua lleva.', c: [] }),
    ayuda: () => 'Dime el nombre, por ejemplo «cuarto de instalaciones», y qué lleva: «un fregadero y una toma de lavadora».',
    formato: () => '«NOMBRE: N puntos de agua fría, N puntos de agua fría y caliente, lavadora sí/no»',
    a(text, n) {
      const nombre = estanciaName(text.split(/[,:.]|\bcon\b|\blleva\b|\btiene\b/)[0]);
      if (!nombre) return false;
      const z = this.nuevaZona('fontaneria', nombre, { f: { tipo: 'otra' } });
      const m = (re) => { const x = n.match(re); return x ? count(x[1]) : null; };
      const af = m(/(\w+)\s+puntos? de (?:solo )?agua fria(?! y)/), afc = m(/(\w+)\s+puntos? de agua fria y caliente/);
      if (af != null) z.f.af = af; if (afc != null) z.f.afc = afc;
      if (/lavadora/.test(n)) z.f.lavadora = !/sin lavadora|no .*lavadora/.test(n);
      this.save();
      if (af != null && afc != null) return this.say('fon_est', {}, 'Anotado ' + nombre.toLowerCase() + '.');
      // Aquí ayuda la IA: con lo que cuente se deducen los puntos; si no, se preguntan
      return this.say('fon_q', { zid: z.id, i: af != null ? 1 : 0 }, cap(nombre) + '.');
    }
  };
  P.fon_q = {
    q(d) {
      const z = this.zona(d.zid); const qs = FON_Q[z.f.tipo] || FON_Q.otra; const it = qs[d.i];
      if (!it) return { t: '', c: [] };
      return { t: it[2], c: CH(it[1] === 'yn' ? ['Sí', 'No'] : it[1] === 'opt' ? it[3] : ['1', '2', '3', '4']) };
    },
    ayuda(d) { const z = this.zona(d.zid); const it = (FON_Q[z.f.tipo] || FON_Q.otra)[d.i]; return it[1] === 'num' ? 'Dime solo el número de puntos, por ejemplo «dos».' : it[1] === 'yn' ? 'Respóndeme sí o no.' : 'Elige: ' + it[3].join(' o ') + '.'; },
    formato(d) { const z = this.zona(d.zid); const it = (FON_Q[z.f.tipo] || FON_Q.otra)[d.i]; return it[1] === 'num' ? 'un número entero' : it[1] === 'yn' ? '«sí» o «no»' : 'una de: ' + it[3].join(', '); },
    saltar(d) { return this.sigFonQ(d); },
    a(text, n, input, d) {
      const z = this.zona(d.zid); const qs = FON_Q[z.f.tipo] || FON_Q.otra; const it = qs[d.i];
      if (!it) return this.say('fon_est', {});
      const [k, tipo] = it;
      if (tipo === 'num') { const c = count(text); if (c == null) return false; z.f[k] = c; }
      else if (tipo === 'yn') { const v = yesNo(n); if (v === null) return false; z.f[k] = v; if (k === 'susp' && v) z.f.inodoro = 'suspendido'; }
      else if (k === 'tipo_ino') { if (/reduc|pequen|compact/.test(n)) z.f.inodoro = 'reducido'; else if (/normal|estandar|tanque|convencional/.test(n)) z.f.inodoro = 'normal'; else return false; }
      else if (k === 'ducha') { if (/plato|ducha/.test(n)) z.f.ducha = 'plato'; else if (/banera/.test(n)) z.f.ducha = 'banera'; else if (/(ninguno|nada|no)/.test(n)) z.f.ducha = null; else return false; }
      this.save();
      return this.sigFonQ(d);
    }
  };
  Guia.prototype.sigFonQ = function (d) {
    const z = this.zona(d.zid); const qs = FON_Q[z.f.tipo] || FON_Q.otra;
    let i = d.i + 1; while (qs[i] && qs[i][4] && !qs[i][4](z.f)) i++;
    if (qs[i]) return this.say('fon_q', { zid: d.zid, i });
    if (z.f.susp && !z.f.inodoro) z.f.inodoro = 'suspendido';
    if (z.f.tipo === 'bano' && !z.f.inodoro) z.f.inodoro = 'normal';
    const extra = [];
    if (z.f.lavadora) extra.push('lavadora'); if (z.f.lavavajillas) extra.push('lavavajillas');
    return this.say('fon_est', {}, (art(z.nombre).startsWith('la ') ? 'Anotada ' : 'Anotado ') + art(z.nombre) + (extra.length ? '; la toma de ' + extra.join(' y ') + ' irá también en electricidad si la medimos' : '') + '.');
  };
  // Electricidad
  const eleZonas = (self) => self.toma.zonas.filter((z) => z.ambito === 'electricidad');
  P.ele_cuadro = {
    q: () => ({ t: 'Electricidad. ¿Se coloca un cuadro eléctrico nuevo?', c: CH(['Sí', 'No']) }),
    ayuda: () => 'Respóndeme sí o no: ¿lleva cuadro eléctrico nuevo?',
    formato: () => '«sí» o «no»',
    a(text, n) { const v = yesNo(n); if (v === null) return false; this.g.cuadro = v; return this.say('ele_est', {}); }
  };
  P.ele_est = {
    qb: () => '¿Qué estancia?',
    q() {
      const hechas = eleZonas(this).map((z) => norm(z.nombre));
      const sug = this.toma.zonas.filter((z) => z.ambito === 'interior' || z.ambito === 'fontaneria').map((z) => z.nombre).filter((x, i, a) => a.indexOf(x) === i && !hechas.includes(norm(x)));
      const c = (sug.length ? sug : EST_DEF.filter((e) => !hechas.includes(norm(e)))).slice(0, 5);
      return { t: hechas.length ? '¿Siguiente estancia? O di «ya está».' : '¿Por qué estancia empezamos la electricidad?', c: CH((hechas.length ? ['Ya está'] : []).concat(c)) };
    },
    ayuda: () => 'Dime el nombre de la estancia, por ejemplo «salón» o «dormitorio 1»; o «ya está» si has terminado.',
    formato: () => 'el nombre de la estancia o «ya está»',
    a(text, n, input) {
      if (eleZonas(this).length && FIN.test(n)) {
        const z0 = eleZonas(this)[0]; if (z0) z0.cuadro = !!this.g.cuadro;
        return this.sigInstalacion('Electricidad anotada.');
      }
      const limpio = text.replace(/^\s*(?:(?:seguimos|vamos|pasamos|empezamos|estamos|ahora|continuamos)\s+)?(?:(?:en|con|por|a|al)\s+)?(?:el|la)?\s*/i, '').split(/[,.]/)[0];
      const ya = buscarZona({ toma: { zonas: this.toma.zonas.filter((x) => x.ambito === 'interior' || x.ambito === 'fontaneria') } }, norm(limpio));
      const nombre = ya ? ya.nombre : estanciaName(limpio);
      if (!nombre || nombre.split(' ').length > 4 || yesNo(norm(nombre)) !== null || NO_NOMBRE.test(norm(nombre))) return false;
      if (!ya && !ESTANCIA_VOCAB.test(norm(nombre)) && !(input && (input.conf || input.act))) { this.g.conf = { txt: text, q: '¿La estancia se llama «' + nombre + '»?' }; this.save(); return this.ask(this.g.conf.q, CH([{ label: 'Sí', value: 'sí' }, { label: 'No', value: 'no' }])); }
      const z = this.nuevaZona('electricidad', nombre, { e: {} });
      if (eleZonas(this).length === 1) z.cuadro = !!this.g.cuadro;
      this.save();
      return this.say('ele_luz', { zid: z.id }, cap(nombre) + '.');
    }
  };
  Guia.prototype.areaDe = function (nombre) { const z = this.toma.zonas.find((x) => x.ambito === 'interior' && norm(x.nombre) === norm(nombre)); return z && z.area || null; };
  const reglaNorma = function (d, k) {
    const z = this.zona(d.zid); const a = this.areaDe(z.nombre) || z.e.sup;
    if (!a && !/bano|aseo|recibidor|entrada|hall|lavadero|galeria/.test(norm(z.nombre))) { this.g.d = Object.assign({}, d, { pideSup: k }); return this.ask('Para aplicar la normativa necesito la superficie. ¿Cuántos metros cuadrados tiene ' + art(z.nombre) + ' aproximadamente?', []); }
    const r = rebt(z.nombre, a);
    return r;
  };
  P.ele_luz = {
    qb: () => '¿Puntos de luz?',
    q: () => ({ t: '¿Cuántos puntos de luz? Si quieres, di «según normativa» y pongo el mínimo del reglamento.', c: CH(['Según normativa', '1', '2', '3']) }),
    ayuda: () => 'Dime el número de puntos de luz, o «según normativa».',
    formato: () => 'un número entero, o «según normativa»',
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      if (d.pideSup) { const v = num(text); if (!(v > 0)) return false; z.e.sup = v; this.g.d = { zid: d.zid }; return P[d.pideSup === 'luz' ? 'ele_luz' : 'ele_tomas'].a.call(this, 'según normativa', 'segun normativa', {}, this.g.d); }
      if (/(normativa|reglamento|minimo|rebt|lo normal)/.test(n)) { const r = reglaNorma.call(this, d, 'luz'); if (!r || !r.luz && r.luz !== 0) return; z.e.luz = r.luz; z.e.norma = true; this.save(); return this.say('ele_tomas', { zid: z.id }, 'Según el reglamento: ' + r.luz + ' ' + plural(r.luz, 'punto') + ' de luz.'); }
      const c = count(text); if (c == null) return false;
      z.e.luz = c; this.save();
      return this.say('ele_tomas', { zid: z.id });
    }
  };
  P.ele_tomas = {
    qb: () => '¿Tomas de corriente?',
    q: () => ({ t: '¿Cuántas tomas de corriente?', c: CH(['Según normativa', '2', '3', '4']) }),
    ayuda: () => 'Dime el número de enchufes, o «según normativa».',
    formato: () => 'un número entero, o «según normativa»',
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      if (d.pideSup) { const v = num(text); if (!(v > 0)) return false; z.e.sup = v; this.g.d = { zid: d.zid }; return P.ele_tomas.a.call(this, 'según normativa', 'segun normativa', {}, this.g.d); }
      let pre = '';
      if (/(normativa|reglamento|minimo|rebt|lo normal)/.test(n)) { const r = reglaNorma.call(this, d, 'tomas'); if (!r || r.tomas == null) return; z.e.tomas = r.tomas; if (r.c3) z.e.c3 = r.c3; pre = 'Según el reglamento: ' + r.tomas + ' ' + plural(r.tomas, 'toma') + (r.c3 ? ' y una de 25 amperios para cocina y horno' : '') + '.'; }
      else { const c = count(text); if (c == null) return false; z.e.tomas = c; }
      // Tomas especiales que salen de lo respondido en fontanería
      const fz = this.toma.zonas.find((x) => x.ambito === 'fontaneria' && norm(x.nombre) === norm(z.nombre));
      if (fz) { z.e.c4 = [fz.f.lavadora && 'lavadora', fz.f.lavavajillas && 'lavavajillas'].filter(Boolean); if (z.e.c4.length) pre = (pre ? pre + ' ' : '') + 'Añado la toma de ' + z.e.c4.join(' y ') + '.'; }
      this.save();
      if (/cocina/.test(norm(z.nombre)) && z.e.c3 == null) return this.say('ele_cocina', { zid: z.id }, pre);
      if (/cocina|lavadero|galeria/.test(norm(z.nombre)) && !fz) return this.say('ele_c4', { zid: z.id }, pre);
      return this.say('ele_est', {}, pre);
    }
  };
  P.ele_cocina = {
    q: () => ({ t: '¿Lleva placa de cocción u horno eléctrico?', c: CH(['Sí', 'No']) }),
    ayuda: () => 'Respóndeme sí o no.', formato: () => '«sí» o «no»',
    a(text, n, input, d) {
      const v = yesNo(n); if (v === null) return false; const z = this.zona(d.zid); z.e.c3 = v ? 1 : 0; this.save();
      const fz = this.toma.zonas.find((x) => x.ambito === 'fontaneria' && norm(x.nombre) === norm(z.nombre));
      return fz ? this.say('ele_est', {}) : this.say('ele_c4', { zid: z.id });
    }
  };
  P.ele_c4 = {
    q: () => ({ t: '¿Qué tomas especiales lleva? Lavadora, lavavajillas o termo; o ninguna.', c: CH(['Lavadora', 'Lavavajillas', 'Lavadora y lavavajillas', 'Ninguna']) }),
    ayuda: () => 'Dime cuáles: lavadora, lavavajillas, termo, o «ninguna».',
    formato: () => 'lista de: lavadora, lavavajillas, termo; o «ninguna»',
    a(text, n, input, d) {
      const z = this.zona(d.zid);
      const l = ['lavadora', 'lavavajillas', 'termo'].filter((x) => n.includes(x));
      if (!l.length && !/(ninguna|ninguno|no|nada)/.test(n)) return false;
      z.e.c4 = l; this.save();
      return this.say('ele_est', {}, l.length ? 'Anotado.' : '');
    }
  };

  const api = { Guia, corregirFrase, versionesPalabra, detectarIncidencia, anotarIncidencia, incPartidas, anadirPropia, borrarZona, buscarZona, puertasPaso, TRABAJOS, REGLA_LABEL, REGLAS_AMBITO, reglaPara, anadirExtra, resolverDoc, CAP_ORDEN, AMBITO_LABEL, REGLAS, trabajosPara, zonasDe, seleccion, generar, parseWalk, parseHuecos, dims2, rebt, respuestaIA, yesNo, count };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Guia = api;
})(typeof self !== 'undefined' ? self : this);
