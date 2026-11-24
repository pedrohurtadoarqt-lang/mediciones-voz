/* ============================================================
 * CERTIFICACIONES
 * Presupuesto de la obra (BC3 con precios y mediciones) → estructura
 * navegable por capítulos; en cada partida se anota lo ejecutado
 * (líneas de medición o porcentaje) y se calcula la certificación:
 * a origen, anterior y actual, con importes.
 * Sin DOM: se prueba en Node.
 * ============================================================ */
(function (root) {
  'use strict';
  const B = root.BC3 || (typeof require !== 'undefined' ? require('./bc3.js') : null);
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; };
  const r2 = (v) => Math.round((v || 0) * 100) / 100;
  const cleanCode = (c) => (c || '').split('\\')[0].trim();

  /**
   * Lee un presupuesto BC3 conservando precios y líneas de medición (~M).
   * Devuelve { titulo, capitulos: [{ codigo, titulo, partidas: [{ codigo, u, r, t, precio, cantidad, lineas:[{com,uds,l,a,h}] }] }] }
   */
  function leerPresupuestoBC3(input) {
    const text = typeof input === 'string' ? input : B.decode(input);
    const recs = text.split(/\r?\n(?=~[A-Z]\|)/);
    const C = {}, T = {}, D = {}, M = {};
    for (let r of recs) {
      r = r.replace(/^﻿/, '');
      if (r[0] !== '~' || r[2] !== '|') continue;
      const type = r[1], f = r.slice(3).replace(/\r?\n/g, '').split('|');
      if (type === 'C') {
        const code = cleanCode(f[0]); if (!code) continue;
        C[code] = { u: B.normUnit(f[1]), r: (f[2] || '').trim(), precio: num((f[3] || '').split('\\')[0]), tipo: f[5] || '' };
      } else if (type === 'T') T[cleanCode(f[0])] = (f[1] || '').replace(/\\n/g, '\n').trim();
      else if (type === 'D') {
        const padre = cleanCode(f[0]), parts = (f[1] || '').split('\\');
        const hijos = [];
        for (let i = 0; i + 2 < parts.length + 1; i += 3) { const h = cleanCode(parts[i]); if (h) hijos.push({ c: h, factor: num(parts[i + 1]) ?? 1, rend: num(parts[i + 2]) ?? 1 }); }
        D[padre] = hijos;
      } else if (type === 'M') {
        const [padre, hijo] = (f[0] || '').split('\\').map(cleanCode);
        const total = num(f[2]);
        const campos = (f[3] || '').split('\\');
        const lineas = [];
        // cada línea: TIPO \ COMENTARIO \ UNIDADES \ LONGITUD \ LATITUD \ ALTURA
        for (let i = 0; i + 5 < campos.length + 1; i += 6) {
          const com = (campos[i + 1] || '').trim(), uds = num(campos[i + 2]), l = num(campos[i + 3]), a = num(campos[i + 4]), h = num(campos[i + 5]);
          if (com || uds != null || l != null || a != null || h != null) lineas.push({ com, uds, l, a, h });
        }
        M[(padre || '') + '\\' + (hijo || '')] = { total, lineas };
        M['*\\' + hijo] = M['*\\' + hijo] || { total, lineas };
      }
    }
    const raiz = Object.keys(C).find((k) => /##$/.test(k)) || Object.keys(D).find((k) => !Object.values(D).some((hs) => hs.some((h) => h.c === k)));
    const titulo = raiz ? (C[raiz] || {}).r || '' : '';
    const capitulos = [];
    const esCap = (c) => /#$/.test(c) || (D[c] && D[c].some((h) => D[h.c] || /#$/.test(h.c) || (C[h.c] && C[h.c].u)));
    const recorrer = (code, prefijo, ruta) => {
      for (const h of (D[code] || [])) {
        const c = h.c, k = C[c] || {};
        if (/#$/.test(c)) {
          const cod = c.replace(/#+$/, '');
          const cap = { codigo: cod, titulo: (ruta ? ruta + ' › ' : '') + (k.r || cod), partidas: [] };
          capitulos.push(cap);
          recorrer(c, cod, cap.titulo);
          if (!cap.partidas.length) capitulos.splice(capitulos.indexOf(cap), 1);
        } else {
          const cap = capitulos[capitulos.length - 1] && ruta ? capitulos[capitulos.length - 1] : null;
          const m = M[code + '\\' + c] || M['*\\' + c];
          const p = { codigo: c, u: k.u || 'ud', r: k.r || c, t: T[c] || '', precio: k.precio || 0, cantidad: m && m.total != null ? m.total : (h.rend || 0), lineas: m ? m.lineas : [] };
          if (cap) cap.partidas.push(p);
          else { let g = capitulos.find((x) => x.codigo === '00'); if (!g) { g = { codigo: '00', titulo: 'Partidas', partidas: [] }; capitulos.push(g); } g.partidas.push(p); }
        }
      }
    };
    if (raiz) recorrer(raiz, '', '');
    return { titulo, capitulos };
  }

  /** Importe de un presupuesto o de lo certificado. */
  const importe = (cant, precio) => r2((cant || 0) * (precio || 0));
  function parcialLinea(l) { const xs = [l.uds, l.l, l.a, l.h].filter((v) => v != null); return xs.length ? r2(xs.reduce((a, v) => a * v, 1)) : 0; }

  /**
   * Cantidad ejecutada a origen de una partida en una certificación:
   * líneas medidas, o un porcentaje de lo presupuestado.
   */
  function ejecutado(p, e) {
    if (!e) return 0;
    if (e.lineas && e.lineas.length) return r2(e.lineas.reduce((a, l) => a + parcialLinea(l), 0));
    if (e.pct != null) return r2((p.cantidad || 0) * e.pct / 100);
    return r2(e.cantidad || 0);
  }
  /** Resumen de la certificación nº n: a origen, anterior y actual por partida y totales. */
  function resumen(cert, n) {
    const actual = cert.certs[n - 1] || { ej: {} }, previa = n > 1 ? cert.certs[n - 2] : null;
    let tot = { pres: 0, origen: 0, anterior: 0, actual: 0 };
    const caps = cert.pres.capitulos.map((c) => {
      const ps = c.partidas.map((p) => {
        const k = c.codigo + '|' + p.codigo;
        const o = ejecutado(p, actual.ej[k]), a = previa ? ejecutado(p, previa.ej[k]) : 0;
        const fila = { p, k, origen: o, anterior: a, actual: r2(o - a), pct: p.cantidad ? r2(o / p.cantidad * 100) : 0, impPres: importe(p.cantidad, p.precio), impOrigen: importe(o, p.precio), impAnterior: importe(a, p.precio), impActual: importe(o - a, p.precio) };
        tot.pres += fila.impPres; tot.origen += fila.impOrigen; tot.anterior += fila.impAnterior; tot.actual += fila.impActual;
        return fila;
      });
      return { codigo: c.codigo, titulo: c.titulo, filas: ps, impPres: r2(ps.reduce((a, f) => a + f.impPres, 0)), impOrigen: r2(ps.reduce((a, f) => a + f.impOrigen, 0)), impActual: r2(ps.reduce((a, f) => a + f.impActual, 0)) };
    });
    Object.keys(tot).forEach((k) => { tot[k] = r2(tot[k]); });
    tot.pct = tot.pres ? r2(tot.origen / tot.pres * 100) : 0;
    return { caps, tot };
  }
  /** Nueva certificación: parte de la anterior (a origen) para seguir midiendo. */
  function nueva(cert) {
    const prev = cert.certs[cert.certs.length - 1];
    const c = { n: cert.certs.length + 1, fecha: Date.now(), ej: prev ? JSON.parse(JSON.stringify(prev.ej)) : {} };
    cert.certs.push(c);
    return c;
  }


  /* ---------------- Salidas ---------------- */
  const X = () => root.Exporters || (typeof require !== 'undefined' ? require('./export.js') : null);
  const cleanB = (v) => String(v == null ? '' : v).replace(/[|~\\]/g, '/').replace(/\r?\n/g, ' ').trim();
  const nb = (v, d) => (v == null || isNaN(v) ? '' : String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d)));
  /** Líneas de lo ejecutado (si se midió por porcentaje, una línea con ese porcentaje). */
  function lineasEj(p, e) {
    if (!e) return [];
    if (e.lineas && e.lineas.length) return e.lineas;
    if (e.pct != null) return [{ com: 'Ejecutado ' + nb(e.pct, 2) + ' % de lo presupuestado', uds: null, l: r2((p.cantidad || 0) * e.pct / 100), a: null, h: null }];
    if (e.cantidad) return [{ com: 'Ejecutado', uds: null, l: e.cantidad, a: null, h: null }];
    return [];
  }

  /** BC3 de la certificación nº n (estilo Presto): mismo presupuesto, con la medición ejecutada a origen y sus precios. */
  function buildBC3(cert, n) {
    const R = [], res = resumen(cert, n), d = new Date(cert.certs[n - 1].fecha || Date.now());
    const f = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2);
    const raiz = (cleanB(cert.pres.titulo || cert.titulo).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 14) || 'OBRA') + '##';
    R.push('~V||FIEBDC-3/2016|Mediciona|' + cleanB('Certificación nº ' + n + ' · ' + (cert.pres.titulo || cert.titulo)) + '\\|ANSI|Certificación a origen|2|||');
    R.push('~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|');
    R.push('~C|' + raiz + '||' + cleanB(cert.pres.titulo || cert.titulo) + '|' + nb(res.tot.origen, 2) + '|' + f + '|0|');
    R.push('~D|' + raiz + '|' + res.caps.map((c) => cleanB(c.codigo) + '#\\1\\1\\').join('') + '|');
    const usados = new Set();
    res.caps.forEach((c) => {
      const cc = cleanB(c.codigo) + '#';
      R.push('~C|' + cc + '||' + cleanB(c.titulo) + '|' + nb(c.impOrigen, 2) + '|' + f + '|0|');
      R.push('~D|' + cc + '|' + c.filas.map((x) => cleanB(x.p.codigo) + '\\1\\' + nb(x.origen, 3) + '\\').join('') + '|');
      c.filas.forEach((x) => {
        const pc = cleanB(x.p.codigo);
        if (!usados.has(pc)) {
          usados.add(pc);
          R.push('~C|' + pc + '|' + cleanB(x.p.u) + '|' + cleanB(x.p.r) + '|' + nb(x.p.precio, 2) + '|' + f + '|0|');
          if (x.p.t) R.push('~T|' + pc + '|' + String(x.p.t).replace(/[|~]/g, '/').replace(/\\/g, '/') + '|');
        }
        const ls = lineasEj(x.p, cert.certs[n - 1].ej[x.k]);
        if (ls.length) R.push('~M|' + cc + '\\' + pc + '|' + '|' + nb(x.origen, 3) + '|' + ls.map((l) => '\\' + cleanB(l.com) + '\\' + nb(l.uds, 3) + '\\' + nb(l.l, 3) + '\\' + nb(l.a, 3) + '\\' + nb(l.h, 3) + '\\').join('') + '|');
      });
    });
    return X().encodeCp1252(R.join('\r\n') + '\r\n');
  }

  /** Excel de la certificación nº n: presupuesto, ejecutado (origen, anterior, actual) e importes, con sus líneas. */
  function buildXLSX(cert, n) {
    const res = resumen(cert, n), rows = [];
    const H = ['Código', 'Descripción', 'Ud', 'Presupuesto', 'Precio', 'A origen', 'Anterior', 'Actual', '%', 'Importe origen', 'Importe anterior', 'Importe actual'];
    const s = (v, st) => ({ v, t: 's', s: st || 0 }), nm = (v, st) => (v == null ? null : { v, t: 'n', s: st || 2 });
    rows.push(H.map((h) => s(h, 1)));
    res.caps.forEach((c) => {
      rows.push([s(c.codigo, 5), s(c.titulo, 5), s('', 5), s('', 5), s('', 5), s('', 5), s('', 5), s('', 5), s('', 5), nm(c.impOrigen, 5), s('', 5), nm(c.impActual, 5)]);
      c.filas.forEach((x) => {
        rows.push([s(x.p.codigo, 3), s(x.p.r, 3), s(x.p.u, 3), nm(x.p.cantidad, 4), nm(x.p.precio, 4), nm(x.origen, 4), nm(x.anterior, 4), nm(x.actual, 4), nm(x.pct, 4), nm(x.impOrigen, 4), nm(x.impAnterior, 4), nm(x.impActual, 4)]);
        lineasEj(x.p, cert.certs[n - 1].ej[x.k]).forEach((l) => {
          rows.push([s('', 7), s('   ' + (l.com || '-'), 0), s('', 0), null, null, nm(parcialLinea(l), 2), null, null, null, null, null, null,
            ]);
          const r = rows[rows.length - 1]; r.push(s([l.uds, l.l, l.a, l.h].map((v) => (v == null ? '' : String(v).replace('.', ','))).join(' × ').replace(/^( × )+|( × )+$/g, ''), 7));
        });
      });
    });
    rows.push([s('', 5), s('TOTAL CERTIFICACIÓN Nº ' + n, 5), s('', 5), nm(res.tot.pres, 5), s('', 5), s('', 5), s('', 5), s('', 5), nm(res.tot.pct, 5), nm(res.tot.origen, 5), nm(res.tot.anterior, 5), nm(res.tot.actual, 5)]);
    const col = (i) => String.fromCharCode(65 + i);
    const xesc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cell = (c, ci, ri) => { if (!c) return ''; const ref = col(ci) + ri; return c.t === 's' ? '<c r="' + ref + '" t="inlineStr" s="' + c.s + '"><is><t xml:space="preserve">' + xesc(c.v) + '</t></is></c>' : '<c r="' + ref + '" s="' + c.s + '"><v>' + c.v + '</v></c>'; };
    const widths = [11, 60, 6, 12, 10, 11, 11, 11, 8, 14, 14, 14, 24];
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>' +
      rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.map((c, ci) => cell(c, ci, i + 1)).join('') + '</row>').join('') +
      '</sheetData><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><sz val="9"/><color rgb="FF64748B"/><name val="Arial"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill></fills>' +
      '<borders count="2"><border/><border><top style="thin"><color rgb="FF94A3B8"/></top></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8">' +
      '<xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>' +
      '<xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/><xf fontId="2" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      '<xf fontId="2" fillId="0" borderId="1" numFmtId="164" applyFont="1" applyBorder="1" applyNumberFormat="1"/><xf fontId="2" fillId="3" borderId="0" numFmtId="164" applyFont="1" applyFill="1" applyNumberFormat="1"/>' +
      '<xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/><xf fontId="3" fillId="0" borderId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return X().zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Certificación ' + n + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ]);
  }

  /** Lo que se dice al dictar lo ejecutado de una partida: «todo», «la mitad», «60 por ciento», «12 metros», «3 por 2,5»… */
  function interpretarDictado(texto, p) {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(',', '.')));
    if (/\b(nada|cero|sin empezar|no se ha hecho|no se ha empezado)\b/.test(t) && !nums.length) return { pct: 0 };
    if (/\b(todo|toda|completo|completa|terminad|acabad|entera|entero|cien por cien)\b/.test(t) && !/por ciento|%/.test(t)) return { pct: 100 };
    if (/\bla mitad\b/.test(t)) return { pct: 50 };
    if (/\bun cuarto\b/.test(t)) return { pct: 25 };
    if (/\btres cuartos\b/.test(t)) return { pct: 75 };
    if (/(por ciento|%)/.test(t) && nums.length) return { pct: Math.min(100, nums[0]) };
    if (nums.length >= 2 && /\b(por|x)\b/.test(t)) return { lineas: [{ com: texto.replace(/\d.*$/, '').trim() || 'Ejecutado', uds: nums.length > 2 ? nums[0] : 1, l: nums.length > 2 ? nums[1] : nums[0], a: nums.length > 2 ? nums[2] : nums[1], h: nums[3] ?? null }] };
    if (nums.length === 1) return { cantidad: nums[0] };
    return null;
  }

  const api = { leerPresupuestoBC3, ejecutado, resumen, nueva, parcialLinea, importe, buildBC3, buildXLSX, lineasEj, interpretarDictado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Certificacion = api;
})(typeof self !== 'undefined' ? self : this);
