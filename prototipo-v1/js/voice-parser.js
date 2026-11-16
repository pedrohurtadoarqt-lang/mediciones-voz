/*
 * Gramática de dictado de mediciones en castellano.
 *
 *   "Dormitorio principal 4 por 3 con 20"        -> Dormitorio principal | L 4.00 | A 3.20
 *   "Largo 4 con 50, ancho 3, alto 2 con 60"       -> L 4.50 | A 3.00 | H 2.60
 *   "Salón dos veces cinco metros cincuenta"       -> Salón | N 2 | L 5.50
 *   "Menos puerta 0,80 por 2,10"                   -> Puerta | N -1 | L 0.80 | H...
 *   "Dormitorio 2: 3 por 4"                        -> Dormitorio 2 | L 3 | A 4
 *
 * Órdenes: "borrar" / "deshacer", "repetir", "total", "buscar <texto>",
 * "opción <n>", "pausa".
 */
(function (global) {
  'use strict';

  var UNITS = {
    cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
    veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
    veintinueve: 29
  };
  var TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
  var HUNDREDS = {
    cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
    cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
    setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900
  };

  var FIELD_WORDS = {
    n: ['unidades', 'unidad', 'uds', 'ud', 'numero', 'cantidad', 'piezas', 'veces', 'vez'],
    l: ['largo', 'larga', 'longitud', 'long', 'largura', 'lineal'],
    a: ['ancho', 'ancha', 'anchura', 'latitud', 'fondo'],
    h: ['alto', 'alta', 'altura', 'profundidad', 'canto', 'espesor', 'grosor', 'profundo']
  };
  var FIELD_OF = {};
  Object.keys(FIELD_WORDS).forEach(function (f) { FIELD_WORDS[f].forEach(function (w) { FIELD_OF[w] = f; }); });

  var SEP = { por: 1, x: 1, '*': 1, 'multiplicado': 1 };
  var DEC = { con: 1, coma: 1, punto: 1 };
  var LENGTH_UNITS = { metro: 1, metros: 1, m: 1, mts: 1, mt: 1, cm: 1, centimetro: 1, centimetros: 1, milimetros: 1, mm: 1 };
  var NEG = { menos: 1, deducir: 1, deduccion: 1, descontar: 1, descuento: 1, restar: 1, resta: 1 };
  var FILLER = { de: 1, del: 1, el: 1, la: 1, los: 1, las: 1, y: 1, en: 1, a: 1, es: 1, son: 1, mide: 1, medida: 1, total: 0 };

  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'ñ');
  }

  // Convierte la cadena en tokens: {w: palabra normalizada, o: original, num?: valor, digits?: 'texto decimal'}
  function tokenize(text) {
    var t = text
      .replace(/(\d)\s*[x×]\s*(\d)/gi, '$1 por $2')
      .replace(/(\d)\s*['’]\s*(\d)/g, '$1,$2')            // 4'50
      .replace(/(\d)\s*(m²|m2|m³|m3|ml|cm|mm|m)\b/gi, '$1 $2')
      .replace(/\bdos puntos\b/gi, ':')
      .replace(/([:;,.!?])(?!\d)/g, ' $1 ')
      .replace(/(\D)([,.])(\d)/g, '$1 $2$3');
    var raw = t.split(/\s+/).filter(Boolean);
    var toks = [];
    raw.forEach(function (o) {
      var w = stripAccents(o.toLowerCase());
      if (/^-?\d+([.,]\d+)?$/.test(w)) {
        var parts = w.replace('-', '').split(/[.,]/);
        var v = parseFloat(parts[0] + (parts[1] ? '.' + parts[1] : ''));
        if (w.charAt(0) === '-') v = -v;
        toks.push({ w: w, o: o, num: v, digits: w.replace(/[^0-9]/g, ''), dec: !!parts[1], fromDigits: true });
      } else if (/^[:;]$/.test(w)) {
        toks.push({ w: ':', o: o, punct: true, colon: true });
      } else if (/^[,.!?]$/.test(w)) {
        toks.push({ w: w, o: o, punct: true });
      } else {
        toks.push({ w: w, o: o });
      }
    });
    return toks;
  }

  function isNumWord(w) { return w in UNITS || w in TENS || w in HUNDREDS || w === 'mil'; }

  // Agrupa palabras numéricas contiguas ("treinta y cinco", "ciento veinte") en un único token.
  function joinNumberWords(toks) {
    var out = [];
    var i = 0;
    while (i < toks.length) {
      var tk = toks[i];
      if (!tk.num && tk.num !== 0 && isNumWord(tk.w)) {
        var total = 0, cur = 0, last = null, start = i, digitsSeq = '', allSmall = true;
        while (i < toks.length) {
          var w = toks[i].w;
          if (w in HUNDREDS) {
            if (last && last !== 'mil') break;
            cur += HUNDREDS[w]; last = 'h'; allSmall = false;
          } else if (w in TENS) {
            if (last === 't' || last === 'u') break;
            cur += TENS[w]; last = 't';
          } else if (w in UNITS) {
            if (last === 'u') break;            // "dos tres" -> dos números
            if (last === 't' ) break;           // "treinta cinco" sin "y" -> se separa
            if (last === 'h' && UNITS[w] === 0) break;
            cur += UNITS[w]; last = 'u';
          } else if (w === 'y' && last === 't' && i + 1 < toks.length && toks[i + 1].w in UNITS && UNITS[toks[i + 1].w] < 10 && UNITS[toks[i + 1].w] > 0) {
            last = 'ty'; i++; continue;
          } else if (w === 'mil') {
            cur = (cur || 1) * 1000; total += cur; cur = 0; last = 'mil'; allSmall = false;
          } else break;
          if (last === 'ty') last = 'u';
          i++;
          if (last === 'u' && toks[i - 1].w === 'cero') { break; }
        }
        // "ty" tras sumar unidad: tratamos "treinta y cinco" como 't' luego 'u'
        var val = total + cur;
        var orig = toks.slice(start, i).map(function (x) { return x.o; }).join(' ');
        out.push({ w: String(val), o: orig, num: val, digits: (toks[start].w === 'cero' ? '0' : String(val)), dec: false });
        continue;
      }
      out.push(tk);
      i++;
    }
    // Fusionar ceros iniciales para decimales: "cero cinco" -> digits "05"
    var merged = [];
    for (var k = 0; k < out.length; k++) {
      var a = out[k];
      if (a.num === 0 && !a.fromDigits && k + 1 < out.length && typeof out[k + 1].num === 'number' && !out[k + 1].fromDigits) {
        var b = out[k + 1];
        merged.push({ w: '0' + b.digits, o: a.o + ' ' + b.o, num: b.num, digits: '0' + b.digits, dec: false, leadingZero: true });
        k++;
        continue;
      }
      merged.push(a);
    }
    return merged;
  }

  function isNum(t) { return t && typeof t.num === 'number'; }

  // Une "4 con 50", "4 coma 5", "4 metros 50", "4 y medio", "1 metro 20 centímetros"
  function joinDecimals(toks) {
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (isNum(t) && !t.dec) {
        var nx = toks[i + 1], nx2 = toks[i + 2], nx3 = toks[i + 3];
        // 4 con 50 / 4 coma 50 / 4 punto 5
        if (nx && DEC[nx.w] && isNum(nx2) && !nx2.dec) {
          out.push(mk(t, nx2, [t, nx, nx2])); i += 2;
          if (toks[i + 1] && /^(centimetros|cm)$/.test(toks[i + 1].w)) i++;
          continue;
        }
        // 4 metros (con) 50 (centímetros)
        if (nx && /^(metro|metros|m|mts|mt)$/.test(nx.w)) {
          var j = i + 2;
          if (toks[j] && (DEC[toks[j].w] || toks[j].w === 'y')) j++;
          if (isNum(toks[j]) && !toks[j].dec && toks[j].num < 100 && !(toks[j + 1] && SEP[toks[j + 1].w] === undefined && FIELD_OF[toks[j + 1].w] === 'n')) {
            var cm = toks[j + 1] && /^(centimetros|cm)$/.test(toks[j + 1].w);
            var dec = toks[j];
            // "1 metro 5 centímetros" -> 1.05 ; "1 metro 5" -> 1.5
            var digits = cm && dec.digits.length === 1 ? '0' + dec.digits : dec.digits;
            out.push(mk(t, { digits: digits }, toks.slice(i, j + 1)));
            i = cm ? j + 1 : j;
            continue;
          }
          out.push(t); i += 1; // descarta "metros"
          continue;
        }
        // "dos sesenta" / "3 20" -> 2,60 / 3,20 (forma habitual de dictar en obra)
        if (isNum(nx) && !nx.dec && !nx.leadingZero && t.num >= 0 && t.num < 100 && nx.num >= 10 && nx.num < 100 && nx.digits.length === 2 &&
            !(toks[i + 2] && FIELD_OF[toks[i + 2].w] === 'n')) {
          out.push(mk(t, nx, [t, nx])); i += 1; continue;
        }
        // 4 y medio / 4 y cuarto
        if (nx && nx.w === 'y' && nx2 && (nx2.w === 'medio' || nx2.w === 'media' || nx2.w === 'cuarto')) {
          var v = t.num + (nx2.w === 'cuarto' ? 0.25 : 0.5);
          out.push({ w: String(v), o: [t.o, nx.o, nx2.o].join(' '), num: v, digits: String(v), dec: true });
          i += 2; continue;
        }
        // 50 centímetros -> 0.50
        if (nx && /^(centimetros|cm)$/.test(nx.w)) {
          out.push({ w: String(t.num / 100), o: t.o + ' ' + nx.o, num: t.num / 100, dec: true, digits: '' }); i++; continue;
        }
      }
      if ((t.w === 'medio' || t.w === 'media') && !(out.length && isNum(out[out.length - 1]))) {
        out.push({ w: '0.5', o: t.o, num: 0.5, dec: true, digits: '05' }); continue;
      }
      out.push(t);
    }
    return out;
  }

  function mk(intTok, decTok, src) {
    var v = parseFloat(String(intTok.num) + '.' + decTok.digits);
    if (intTok.num < 0) v = -parseFloat(String(-intTok.num) + '.' + decTok.digits);
    return { w: String(v), o: src.map(function (x) { return x.o; }).join(' '), num: v, digits: String(v), dec: true };
  }

  function cap(s) { s = s.trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function cleanLabel(words) {
    var arr = words.slice();
    // quitar muletillas iniciales y finales
    while (arr.length && (FILLER[stripAccents(arr[0].toLowerCase())] || /^[,.:;]$/.test(arr[0]))) arr.shift();
    while (arr.length && (FILLER[stripAccents(arr[arr.length - 1].toLowerCase())] || /^[,.:;]$/.test(arr[arr.length - 1]))) arr.pop();
    return cap(arr.join(' ').replace(/\s+([,.:;])/g, '$1'));
  }

  function detectCommand(text) {
    var s = stripAccents(text.toLowerCase()).replace(/[.,!?¡¿]/g, ' ').replace(/\s+/g, ' ').trim();
    var m;
    if (/^(borra|borrar|deshacer|deshaz|elimina|eliminar|anula|anular|quita|quitar)( (la|esa|esta))?( (ultima|linea|ultima linea|medicion))*$/.test(s)) return { cmd: 'undo' };
    if (/^(repite|repetir|lee|leer|que has (puesto|apuntado))( (la )?ultima( linea)?)?$/.test(s)) return { cmd: 'repeat' };
    if (/^(total|cuanto llevo|suma|suma total|dime el total)( (de la )?partida)?$/.test(s)) return { cmd: 'total' };
    if ((m = s.match(/^(busca|buscar|partida|busqueda)\s+(.+)$/))) return { cmd: 'search', query: m[2] };
    if ((m = s.match(/^(opcion|elige|elegir|selecciona|seleccionar|numero)\s+(\S+)$/))) {
      var toks = joinNumberWords(tokenize(m[2]));
      if (toks.length === 1 && isNum(toks[0])) return { cmd: 'choose', index: toks[0].num };
    }
    if (/^(pausa|para|parar|detente|deten|detener|stop|deja de escuchar|silencio)( de escuchar)?$/.test(s)) return { cmd: 'stop' };
    if (/^(nueva linea|linea en blanco|en blanco)$/.test(s)) return { cmd: 'blank' };
    if ((m = s.match(/^(comentario|nota|titulo)\s+(.+)$/))) return { cmd: 'comment', text: cap(text.trim().split(/\s+/).slice(1).join(' ')) };
    return null;
  }

  /**
   * @param {string} text transcripción
   * @param {object} opts {unit: 'm²'|'u'|...}
   * @returns {{cmd?:string, label:string, n:?number, l:?number, a:?number, h:?number, ok:boolean, raw:string}}
   */
  function parseUtterance(text, opts) {
    opts = opts || {};
    var raw = (text || '').trim();
    var cmd = detectCommand(raw);
    if (cmd) { cmd.raw = raw; return cmd; }

    var toks = joinDecimals(joinNumberWords(tokenize(raw)));
    var res = { label: '', n: null, l: null, a: null, h: null, raw: raw, ok: false };
    var negative = false;
    var used = new Array(toks.length);
    var pending = null;      // campo esperando número ("largo 4")
    var free = [];           // números sin campo explícito {idx, num}

    // Etiqueta explícita con ':'
    var colonIdx = -1;
    for (var c = 0; c < toks.length; c++) if (toks[c].colon) { colonIdx = c; break; }

    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (i <= colonIdx) continue;
      if (NEG[t.w]) { negative = true; used[i] = true; continue; }
      if (FIELD_OF[t.w] && !isNum(t)) {
        var f = FIELD_OF[t.w];
        // "4 de largo" / "2 veces" / "3 unidades": el número va antes
        var prev = i - 1;
        if (prev > colonIdx && toks[prev] && toks[prev].w === 'de') prev--;
        if (prev > colonIdx && isNum(toks[prev]) && !used[prev]) {
          res[f] = toks[prev].num; used[prev] = true; used[i] = true;
          if (toks[i - 1].w === 'de') used[i - 1] = true;
          free = free.filter(function (x) { return x.idx !== prev; });
          continue;
        }
        if (f === 'n' && (t.w === 'veces' || t.w === 'vez')) { used[i] = true; continue; }
        pending = f; used[i] = true; continue;
      }
      if (isNum(t)) {
        if (pending && res[pending] === null) { res[pending] = t.num; pending = null; used[i] = true; continue; }
        free.push({ idx: i, num: t.num, isInt: !t.dec && Math.round(t.num) === t.num });
        continue;
      }
      if (SEP[t.w] || LENGTH_UNITS[t.w] || t.w === 'm2' || t.w === 'm²' || t.w === 'm3' || t.w === 'm³' || t.w === 'ml' || t.punct) {
        if (!t.colon) used[i] = true;
        continue;
      }
      if (pending && (t.w === 'de' || t.w === 'es' || t.w === 'son' || t.w === 'a')) { used[i] = true; continue; }
    }

    // Cadena de dimensiones unidas por "por": los números enteros sueltos pegados a la etiqueta
    // y fuera de la cadena pasan a formar parte de la etiqueta ("dormitorio 2 4 por 3").
    var chained = {};
    for (var k = 0; k < toks.length; k++) {
      if (SEP[toks[k].w]) {
        var p = k - 1; while (p >= 0 && (LENGTH_UNITS[toks[p].w])) p--;
        var n2 = k + 1; while (n2 < toks.length && (LENGTH_UNITS[toks[n2].w])) n2++;
        if (p >= 0 && isNum(toks[p])) chained[p] = true;
        if (n2 < toks.length && isNum(toks[n2])) chained[n2] = true;
      }
    }
    var hasChain = Object.keys(chained).length > 0;
    if (hasChain && colonIdx < 0) {
      free = free.filter(function (fr) {
        if (chained[fr.idx]) return true;
        var before = toks[fr.idx - 1];
        if (fr.isInt && before && !isNum(before) && !used[fr.idx - 1] && !SEP[before.w] && !FIELD_OF[before.w]) {
          return false; // pasa a etiqueta
        }
        return true;
      });
    }
    free.forEach(function (fr) { used[fr.idx] = true; });

    // Asignación posicional
    var nums = free.map(function (x) { return x.num; });
    var slots = ['l', 'a', 'h'];
    var unit = stripAccents((opts.unit || '').toLowerCase());
    var countUnit = /^(u|ud|uds|unidad|pa|t|kg|pza)$/.test(unit);
    if (nums.length >= 4 && res.n === null) { res.n = nums.shift(); }
    if (nums.length === 1 && countUnit && res.n === null && res.l === null && res.a === null && res.h === null) {
      res.n = nums.shift();
    }
    nums.forEach(function (v) {
      for (var s = 0; s < slots.length; s++) {
        if (res[slots[s]] === null) { res[slots[s]] = v; return; }
      }
    });

    if (negative) res.n = res.n === null ? -1 : -Math.abs(res.n);

    // Etiqueta: palabras no consumidas
    var labelWords = [];
    if (colonIdx >= 0) {
      labelWords = toks.slice(0, colonIdx).map(function (x) { return x.o; });
    } else {
      for (var q = 0; q < toks.length; q++) {
        if (used[q]) { if (labelWords.length && isNum(toks[q])) break; continue; }
        if (NEG[toks[q].w]) continue;
        labelWords.push(toks[q].o);
      }
    }
    res.label = cleanLabel(labelWords);
    res.ok = res.n !== null || res.l !== null || res.a !== null || res.h !== null;
    return res;
  }

  function subtotal(line) {
    var vals = [line.n, line.l, line.a, line.h].filter(function (v) { return v !== null && v !== undefined && v !== '' && !isNaN(v); });
    if (!vals.length) return 0;
    return vals.reduce(function (acc, v) { return acc * Number(v); }, 1);
  }

  // Número -> texto hablable ("4 con 50")
  function speakNum(v) {
    if (v === null || v === undefined) return '';
    var r = Math.round(v * 100) / 100;
    var s = r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    var neg = s.charAt(0) === '-'; if (neg) s = s.slice(1);
    var parts = s.split('.');
    var out = parts[1] ? parts[0] + ' con ' + (parts[1].length === 1 ? parts[1] + '0' : parts[1]) : parts[0];
    return (neg ? 'menos ' : '') + out;
  }

  var api = { parseUtterance: parseUtterance, subtotal: subtotal, speakNum: speakNum, _tokenize: tokenize, stripAccents: stripAccents };
  if (typeof module !== 'undefined') module.exports = api;
  global.VoiceParser = api;
})(typeof window !== 'undefined' ? window : this);
