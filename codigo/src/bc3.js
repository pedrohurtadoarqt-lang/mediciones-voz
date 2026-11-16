/* ============================================================
 * Parser BC3 (FIEBDC-3) — solo estructura, SIN precios.
 * Conserva: código, unidad, resumen, texto (~T) y jerarquía (~C/~D).
 * Funciona en navegador y en Node (se usa en el build para el
 * catálogo embebido y en la app para importar .bc3 propios).
 * ============================================================ */
(function (root) {
  'use strict';

  /** Detecta la codificación declarada en ~V (campo 6: ANSI / 850 / 437 / UTF-8). */
  function detectEncoding(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 600));
    const m = head.match(/~V\|([^\r\n]*)/);
    if (m) {
      const f = m[1].split('|');
      const enc = (f[4] || '').trim().toUpperCase();
      if (enc.includes('UTF')) return 'utf-8';
    }
    // Heurística: si decodifica como UTF-8 sin errores y contiene bytes altos, es UTF-8.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return 'utf-8';
    } catch (e) {
      return 'windows-1252';
    }
  }

  function decode(bytes) {
    const enc = detectEncoding(bytes);
    return new TextDecoder(enc).decode(bytes);
  }

  function cleanCode(c) {
    return (c || '').split('\\')[0].trim();
  }

  const UNIT_MAP = {
    'u': 'ud', 'ud': 'ud', 'uds': 'ud', 'un': 'ud', 'pa': 'ud', 'p.a.': 'ud', 'pza': 'ud', 'mes': 'ud', 'h': 'ud',
    'm': 'm', 'ml': 'm', 'm.': 'm', 'mts': 'm',
    'm2': 'm2', 'm²': 'm2', 'm 2': 'm2',
    'm3': 'm3', 'm³': 'm3', 'm 3': 'm3',
    'kg': 'kg', 't': 't', 'l': 'l'
  };
  function normUnit(u) {
    const k = (u || '').trim().toLowerCase();
    return UNIT_MAP[k] || (k ? k : 'ud');
  }

  /** Quita importes monetarios que algunas bases incrustan en el texto (p.ej. "16,04 €/m²"). */
  function stripPrices(t) {
    return (t || '')
      .replace(/,?\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*€(?:\s*\/\s*[a-z²³0-9]+)?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Parsea un BC3 y devuelve un catálogo:
   * { nombre, capitulos: {cod:{t:titulo, p:padre}}, raiz:[cods], partidas:[{c,u,r,t,ch}] }
   * ch = código del capítulo inmediato (hoja). Los precios se descartan.
   */
  function parseBC3(input, nombre) {
    const text = typeof input === 'string' ? input : decode(input);
    // Registros: empiezan por "~X|" a principio de línea.
    const recs = text.split(/\r?\n(?=~[A-Z]\|)/);
    const C = {}, T = {}, D = {};
    let titulo = '';
    for (let r of recs) {
      r = r.replace(/^﻿/, '');
      if (r[0] !== '~' || r[2] !== '|') continue;
      const type = r[1];
      const body = r.slice(3);
      if (type === 'C') {
        const f = body.replace(/\r?\n/g, '').split('|');
        const code = cleanCode(f[0]);
        // Campos: 0 código | 1 unidad | 2 resumen | 3 precio (IGNORADO) | 4 fecha | 5 tipo
        C[code] = { u: (f[1] || '').trim(), r: (f[2] || '').trim(), tipo: (f[5] || '').trim() };
      } else if (type === 'T') {
        const i = body.indexOf('|');
        const code = cleanCode(body.slice(0, i));
        let t = body.slice(i + 1);
        if (t.endsWith('|')) t = t.slice(0, -1);
        T[code] = t.replace(/\r\n/g, '\n').trim();
      } else if (type === 'D') {
        const f = body.replace(/\r?\n/g, '').split('|');
        const code = cleanCode(f[0]);
        // hijo\factor\rendimiento\  -> rendimientos IGNORADOS
        const parts = (f[1] || '').split('\\');
        const kids = [];
        for (let k = 0; k < parts.length; k += 3) {
          const kc = cleanCode(parts[k]);
          if (kc) kids.push(kc);
        }
        D[code] = kids;
      } else if (type === 'V') {
        // nada
      }
    }

    const isChap = (c) => c.endsWith('#');
    const rootCode = Object.keys(C).find((c) => c.endsWith('##'));
    if (rootCode) titulo = C[rootCode].r;

    const capitulos = {};
    const partidas = [];
    const seen = new Set();
    const raiz = [];

    function walk(code, parent) {
      const kids = D[code] || [];
      for (const k of kids) {
        if (isChap(k)) {
          const kk = k.replace(/#+$/, '');
          if (capitulos[kk]) continue;
          capitulos[kk] = { t: (C[k] ? C[k].r : kk), p: parent };
          if (parent === null) raiz.push(kk);
          walk(k, kk);
        } else if (parent !== null && !seen.has(k) && C[k]) {
          seen.add(k);
          partidas.push({
            c: k,
            u: normUnit(C[k].u),
            r: stripPrices(C[k].r).replace(/\.$/, ''),
            t: stripPrices(T[k] || ''),
            ch: parent
          });
        }
      }
    }

    if (rootCode) {
      walk(rootCode, null);
    } else {
      // Sin raíz ##: tomar como raíz los capítulos que no son hijos de nadie.
      const child = new Set();
      Object.values(D).forEach((ks) => ks.forEach((k) => child.add(k)));
      Object.keys(C).filter((c) => isChap(c) && !child.has(c)).forEach((c) => {
        const cc = c.replace(/#+$/, '');
        capitulos[cc] = { t: C[c].r, p: null };
        raiz.push(cc);
        walk(c, cc);
      });
    }

    // Base sin capítulos: partidas = conceptos con descomposición y texto.
    if (!partidas.length) {
      capitulos.GEN = { t: 'GENERAL', p: null };
      raiz.push('GEN');
      for (const code of Object.keys(C)) {
        if (isChap(code) || !D[code]) continue;
        partidas.push({ c: code, u: normUnit(C[code].u), r: stripPrices(C[code].r), t: stripPrices(T[code] || ''), ch: 'GEN' });
      }
    }

    return { nombre: nombre || titulo || 'Base BC3', titulo, capitulos, raiz, partidas };
  }

  const api = { parseBC3, decode, normUnit, stripPrices };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BC3 = api;
})(typeof self !== 'undefined' ? self : this);
