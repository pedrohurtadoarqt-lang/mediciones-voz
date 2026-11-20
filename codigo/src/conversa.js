/* ============================================================
 * MODO CONVERSACIÓN
 * El usuario cuenta la obra a su manera (en desorden: medidas, huecos,
 * trabajos, patologías…). La IA traduce cada frase a cambios en la toma
 * de datos (zonas) y en los trabajos; la app los aplica, recalcula el
 * estado de mediciones con las mismas reglas del asistente guiado y
 * repite en voz alta lo anotado. Solo pregunta cuando le falta un dato.
 * Sin DOM: se prueba en Node con una IA simulada.
 * ============================================================ */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const G = root.Guia || (typeof require !== 'undefined' ? require('./guia.js') : null);
  const { norm, fmt, round2, calcPlanta, plantaSVG, estanciaName } = E;
  const cap = (s) => { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const plural = (n, s, p) => (Math.abs(n) === 1 ? s : (p || s + 's'));
  const rectTramos = (a, b) => [a, b, a, b].map((l) => ({ l, giro: 'derecha', ang: 90 }));
  const ok = (v) => typeof v === 'number' && isFinite(v) && v > 0;
  // Medidas fuera de rango: probablemente centímetros o un error de dictado
  const metros = (v, max) => { if (!ok(v)) return null; if (v > (max || 60) && v < 10000) v = v / 100; return v > 0 && v <= (max || 60) ? round2(v) : null; };
  const SN = (v) => (v === 'si' ? true : v === 'no' ? false : undefined);
  const AMB_TXT = { interior: 'estancia', fachada: 'fachada', cubierta: 'cubierta', piscina: 'piscina', fontaneria: 'fontanería', electricidad: 'electricidad' };

  class Conversa {
    constructor(dialog) { this.dlg = dialog; this.undo = []; this.tok = 0; }
    get io() { return this.dlg.io; }
    get obra() { return this.dlg.obra; }
    get activo() { return !!(this.obra && this.obra.modo === 'conversa'); }
    get g() { const o = this.obra; return o.guia || (o.guia = {}); }
    get toma() { const o = this.obra; return o.toma || (o.toma = { zonas: [] }); }
    aiOk() { return !!(this.io.conversa && this.io.aiReady && this.io.aiReady()); }
    save() { this.obra.updated = Date.now(); this.io.save(); this.io.render(); }
    ask(text, chips, opts) { this.ultima = { text, chips }; this.dlg.ask(text, chips || [], opts); }
    chips(extra) {
      const c = (extra || []).slice(0, 4).map((o) => ({ label: o, value: o }));
      if (this.toma.zonas.length) c.push({ label: 'Generar mediciones', value: 'genera las mediciones' });
      return c;
    }

    /* ---- inicio ---- */
    start(pre) {
      this.obra.modo = 'conversa';
      if (!this.obra.ambito) this.obra.ambito = 'conversa';
      this.g.fin = true; // el asistente guiado queda parado
      this.save();
      this.ask((pre ? pre + ' ' : '') + 'Cuéntame la obra a tu manera: por dónde empezamos, las medidas y qué hay que hacer. Yo voy tomando nota y te pregunto lo que falte.',
        [{ label: 'Prefiero que me preguntes tú', value: 'modo guiado' }]);
    }
    resume() {
      const n = this.toma.zonas.length;
      this.ask(n ? 'Seguimos. Llevo ' + n + ' ' + plural(n, 'zona') + ' anotadas. Cuéntame.' : 'Cuéntame la obra: por dónde empezamos y qué hay que hacer.', this.chips());
    }

    /* ---- entrada ---- */
    handle(text, n, input) {
      if (!text) return;
      // Órdenes locales (rápidas, sin IA)
      if (/^(para|parar|stop|basta|calla|callate|silencio|espera|pausa|para de escuchar|deja de escuchar)$/.test(n)) { this.tok++; this.io.pause && this.io.pause(); return; }
      if (/^(repite|repitelo|que has dicho|como dices)$/.test(n) && this.ultima) return this.ask(this.ultima.text, this.ultima.chips);
      if (/^(deshaz|deshacer|deshaz eso|anula|anula eso|atras|vuelve atras|borra lo ultimo|quita lo ultimo)$/.test(n)) return this.deshacer();
      if (/^(modo guiado|medicion guiada|preguntame tu|prefiero que me preguntes tu|asistente guiado)\b/.test(n)) return this.aGuiado();
      if (/^(elegir trabajos|elige trabajos|ver trabajos|pantalla de trabajos|ver los trabajos)\b/.test(n) && this.toma.zonas.length) { this.io.trabajos && this.io.trabajos(true); return this.ask('Aquí tienes los trabajos anotados. Puedes marcar o desmarcar los que quieras y seguir hablando.', this.chips()); }
      // Exportar, compartir, correo: los atiende el motor
      if (/\b(exporta|exportar|pdf|excel|bc3|comparte|compartir|correo|envia|enviame)\b/.test(n) && !/\b(hay|tiene|pared|suelo|techo)\b/.test(n)) return false;
      if (!this.aiOk()) {
        return this.ask('Para la conversación libre necesito la IA: entra en tu cuenta y comprueba la conexión. Mientras tanto puedo preguntarte yo paso a paso.', [{ label: 'Medición guiada', value: 'modo guiado' }]);
      }
      return this.consultar(text);
    }

    /* ---- contexto para la IA ---- */
    datosZona(z) {
      const f = fmt, d = [];
      if (z.rect) d.push(f(z.rect[0]) + ' × ' + f(z.rect[1]));
      else if (z.tramos && z.tramos.length) d.push('paredes ' + z.tramos.map((t) => f(t.l) + (t.giro ? ' ' + t.giro : '')).join(', '));
      if (z.area != null) d.push('superficie ' + f(z.area) + ' m²');
      if (z.perimetro != null) d.push('perímetro ' + f(z.perimetro) + ' m');
      if (z.altura) d.push('altura ' + f(z.altura));
      if (z.ambito === 'fachada') { if (z.ancho) d.push('ancho ' + f(z.ancho)); if (z.alto) d.push('alto ' + f(z.alto)); }
      (z.huecos || []).forEach((h) => d.push(h.uds + ' ' + (h.bal ? 'balconera' : h.tipo) + ' ' + (h.an ? f(h.an) : '?') + ' × ' + (h.al ? f(h.al) : '?')));
      (z.ventanas || []).forEach((v) => d.push(v.uds + ' ventana ' + f(v.an) + ' × ' + f(v.al)));
      if (z.tipo) d.push(z.tipo);
      if (z.remonte) d.push('remonte ' + f(z.remonte));
      (z.faldones || []).forEach((x) => d.push(x.nombre + ' ' + f(x.l) + ' × ' + f(x.a)));
      if (z.prof) d.push('profundidad ' + (z.pmin !== z.pmax ? f(z.pmin) + ' a ' + f(z.pmax) : f(z.prof)));
      if (z.f) d.push(Object.entries(z.f).filter(([, v]) => v != null && v !== false).map(([k, v]) => k + (v === true ? '' : ' ' + v)).join(', '));
      if (z.e) d.push(Object.entries(z.e).filter(([k, v]) => v != null && k !== 'c4').map(([k, v]) => k + ' ' + v).join(', '));
      if (z.cuadro) d.push('cuadro nuevo');
      return d.filter(Boolean).join(' · ');
    }
    /** Datos imprescindibles que faltan para medir los trabajos anotados. */
    faltan() {
      const out = [], sel = G.seleccion(this.obra), zs = this.toma.zonas, g = this.g;
      this._faltan = [];
      const lista = G.trabajosPara(this.obra);
      const nec = {
        paredes: (z) => (!z.perimetro ? 'las medidas de la planta' : !z.altura ? 'la altura' : null),
        suelo: (z) => (z.area == null ? 'las medidas de la planta' : null), techo: (z) => (z.area == null ? 'las medidas de la planta' : null),
        rodapie: (z) => (!z.perimetro ? 'las medidas de la planta' : null), perimetro: (z) => (!z.perimetro ? 'las medidas' : null),
        sup_total: (z) => (z.area == null ? 'las medidas de la planta' : null),
        fachada: (z) => (!z.ancho || !z.alto ? 'el ancho y el alto' : null), fachada_bruta: (z) => (!z.ancho || !z.alto ? 'el ancho y el alto' : null),
        cub_sup: (z) => (z.tipo === 'inclinada' ? (!(z.faldones || []).length ? 'los faldones' : null) : z.area == null ? 'las medidas' : null),
        cub_imper: (z) => (z.area == null && !(z.faldones || []).length ? 'las medidas' : null),
        pis_vaso: (z) => (z.area == null ? 'el largo y el ancho' : !z.prof ? 'la profundidad' : null), pis_exc: (z) => (z.area == null ? 'el largo y el ancho' : !z.prof ? 'la profundidad' : null),
        pis_perim: (z) => (!z.perimetro ? 'el largo y el ancho' : null), pis_anillo: (z) => (!z.perimetro ? 'el largo y el ancho' : null)
      };
      const vistos = new Set();
      lista.forEach((w) => {
        const s = sel[w.id]; if (!s || !s.on || w.ambito === 'obra') return;
        s.zonas.forEach((id) => {
          const z = zs.find((x) => x.id === id); if (!z) return;
          let falta = null;
          if (w.regla === 'preguntar') { const r = (g.resp || {})[w.id + '|' + z.id]; if (!r) falta = (w.pide ? w.pide.replace('{zona}', art(z.nombre)).replace(/^¿|\?$/g, '') : 'la medición de ' + w.label.toLowerCase()); }
          else if (nec[w.regla]) falta = nec[w.regla](z);
          // huecos de fachada sin medidas, ventanas sin alto…
          if (!falta && (z.huecos || []).some((h) => !h.an || !h.al) && /paredes|rodapie/.test(w.regla)) falta = 'las medidas de algún hueco';
          const k = z.nombre + '|' + falta;
          if (falta && !vistos.has(k)) { vistos.add(k); out.push(z.nombre + ': ' + falta + ' (para ' + w.label.toLowerCase() + ')'); this._faltan.push({ z, falta, preg: w.regla === 'preguntar' && w.pide ? w.pide.replace('{zona}', art(z.nombre)) : null }); }
        });
      });
      return out.slice(0, 8);
    }
    contexto(text) {
      const g = this.g, sel = G.seleccion(this.obra);
      const trabajos = G.trabajosPara(this.obra).filter((w) => sel[w.id] && sel[w.id].on && w.ambito !== 'obra').map((w) => ({
        id: w.c && !G.TRABAJOS.some((t) => t.id === w.id) ? '' : w.id, codigo: w.c || '', label: w.label,
        zonas: (sel[w.id].zonas || []).map((id) => (this.toma.zonas.find((z) => z.id === id) || {}).nombre).filter(Boolean)
      }));
      const log = (this.io.historial ? this.io.historial() : []).slice(-10);
      let candidatas = [];
      try {
        const cat = this.dlg.cat;
        if (cat && cat.index) candidatas = cat.index.search(text).slice(0, 25).map((r) => ({ c: r.doc.c, u: E.unitLabel(r.doc.u), r: r.doc.r }));
      } catch (e) { candidatas = []; }
      return {
        obra_id: this.obra.id, frase: text.slice(0, 600),
        zona: g.cZona ? ((this.toma.zonas.find((z) => z.id === g.cZona) || {}).nombre || '') : '',
        zonas: this.toma.zonas.map((z) => ({ ref: z.id, ambito: z.ambito, nombre: z.nombre, datos: this.datosZona(z) })),
        trabajos, faltan: this.faltan(), esperando: g.cPregunta || '', historial: log, candidatas
      };
    }

    /* ---- consulta ---- */
    consultar(text) {
      const tk = ++this.tok;
      this.io.note && this.io.note('Tomando nota…');
      const ctx = this.contexto(text);
      const lim = new Promise((r) => setTimeout(() => r({ timeout: true }), 25000));
      return Promise.race([Promise.resolve().then(() => this.io.conversa(ctx)), lim]).then((res) => {
        if (tk !== this.tok) return;
        if (!res || res.timeout || !res.result) throw new Error((res && res.error) || 'sin respuesta');
        return this.aplicar(res.result, text);
      }).catch((e) => {
        if (tk !== this.tok) return;
        this.ask('No he podido consultarlo ahora mismo (' + (e && e.message ? e.message : 'error') + '). Repítemelo, o si prefieres te pregunto yo paso a paso.', [{ label: 'Repetir', value: text }, { label: 'Medición guiada', value: 'modo guiado' }]);
      });
    }

    /* ---- aplicar la respuesta ---- */
    snapshot() {
      const g = this.g;
      this.undo.push(JSON.stringify({ toma: this.toma, sel: g.sel || {}, resp: g.resp || {}, extra: g.extra || [], plantas: this.obra.plantas || {}, cont: g.contenedores, contOk: g.contenedoresOk, sys: g.sysPct, est: this.obra.estancias || [], estAct: this.obra.estActiva || '' }));
      if (this.undo.length > 30) this.undo.shift();
    }
    deshacer() {
      const s = this.undo.pop();
      if (!s) return this.ask('No hay nada que deshacer.', this.chips());
      const o = JSON.parse(s), g = this.g;
      this.obra.toma = o.toma; g.sel = o.sel; g.resp = o.resp; g.extra = o.extra; this.obra.plantas = o.plantas; g.contenedores = o.cont; g.contenedoresOk = o.contOk; g.sysPct = o.sys; this.obra.estancias = o.est; this.obra.estActiva = o.estAct;
      this.regenerar();
      this.ask('Deshecho: he quitado lo último que anoté.', this.chips());
    }
    zonaPara(zr) {
      const zs = this.toma.zonas;
      let z = zr.ref ? zs.find((x) => x.id === zr.ref) : null;
      const nom = cap((zr.nombre || '').trim()) || (AMB_TXT[zr.ambito] ? cap(AMB_TXT[zr.ambito]) : 'Zona');
      if (!z) z = zs.find((x) => x.ambito === zr.ambito && norm(x.nombre) === norm(nom));
      if (!z) {
        this.toma.seq = (this.toma.seq || 0) + 1;
        z = { id: 'z' + this.toma.seq, ambito: zr.ambito, nombre: zr.ambito === 'interior' ? estanciaName(nom) || nom : nom };
        zs.push(z); z._nueva = true;
      } else if (zr.nombre && norm(zr.nombre) !== norm(z.nombre) && zr.ref === z.id) z.nombre = zr.ambito === 'interior' ? estanciaName(zr.nombre) || cap(zr.nombre) : cap(zr.nombre);
      return z;
    }
    planta(z, zr, cambios) {
      const tr = (zr.tramos || []).map((t) => ({ l: metros(t.largo), giro: t.giro || '', ang: ok(t.angulo) ? t.angulo : 90 })).filter((t) => t.l);
      const L = metros(zr.largo, 200), A = metros(zr.ancho, 200);
      if (tr.length >= 2) { z.tramos = tr; delete z.rect; }
      else if (L && A) { z.rect = [Math.max(L, A), Math.min(L, A)]; z.tramos = rectTramos(z.rect[0], z.rect[1]); }
      else if (ok(zr.superficie) || ok(zr.perimetro)) {
        if (ok(zr.superficie)) z.area = round2(zr.superficie);
        if (ok(zr.perimetro)) z.perimetro = round2(zr.perimetro);
        delete z.rect; z.tramos = [];
        cambios.push(z.area != null ? fmt(z.area) + ' metros cuadrados' : 'perímetro ' + fmt(z.perimetro));
        return;
      } else return;
      const res = calcPlanta(z.tramos);
      z.area = res.area; z.perimetro = res.perimetro;
      z.planta = { tramos: z.tramos, pts: res.pts.map((q) => [round2(q[0]), round2(q[1])]), area: res.area, perimetro: res.perimetro, cierre: res.cierre, supuestas: res.supuestas, aviso: res.aviso, est: z.nombre };
      if (z.ambito === 'interior') { this.obra.plantas = this.obra.plantas || {}; this.obra.plantas[norm(z.nombre)] = Object.assign({ abierta: false, fecha: Date.now() }, z.planta); }
      if (z.rect) cambios.push(fmt(z.rect[0]) + ' por ' + fmt(z.rect[1]));
      else { cambios.push(fmt(res.area) + ' metros cuadrados'); if (res.aviso) cambios.push('ojo: ' + res.aviso); }
      this.sketch = z;
    }
    aplicarZona(zr) {
      const z = this.zonaPara(zr), c = [];
      if (zr.borrar) { G.borrarZona(this.obra, z.id); return { z, txt: 'Quito ' + z.nombre.toLowerCase() + '.' }; }
      const amb = z.ambito;
      if (amb === 'interior' || amb === 'piscina' || (amb === 'cubierta' && zr.cub_tipo !== 'inclinada' && z.tipo !== 'inclinada')) this.planta(z, zr, c);
      if (amb === 'interior') {
        const h = metros(zr.altura, 15); if (h) { z.altura = h; c.push('altura ' + fmt(h)); }
        const hs = (zr.huecos || []).map((x) => ({ tipo: x.tipo === 'ventana' ? 'ventana' : 'puerta', bal: x.tipo === 'balconera', uds: Math.max(1, Math.round(x.uds || 1)), an: metros(x.ancho, 10), al: metros(x.alto, 10) || (x.tipo === 'puerta' ? 2.03 : null) }));
        if (hs.length || zr.huecos_modo === 'reemplazar') {
          z.huecos = zr.huecos_modo === 'reemplazar' ? hs : (z.huecos || []).concat(hs);
          const np = hs.filter((x) => x.tipo === 'puerta' && !x.bal).reduce((a, x) => a + x.uds, 0), nv = hs.filter((x) => x.tipo === 'ventana').reduce((a, x) => a + x.uds, 0), nb = hs.filter((x) => x.bal).reduce((a, x) => a + x.uds, 0);
          const t = [np && np + ' ' + plural(np, 'puerta'), nv && nv + ' ' + plural(nv, 'ventana'), nb && nb + ' ' + plural(nb, 'balconera')].filter(Boolean).join(' y ');
          if (t) c.push(t + (hs.some((x) => !x.an || !x.al) ? ' (me falta alguna medida)' : ''));
          else if (zr.huecos_modo === 'reemplazar') c.push('sin huecos');
        }
        if (!this.obra.estancias) this.obra.estancias = [];
        if (!this.obra.estancias.includes(z.nombre)) this.obra.estancias.push(z.nombre);
        this.obra.estActiva = z.nombre;
      }
      if (amb === 'fachada') {
        const an = metros(zr.largo, 200) || metros(zr.ancho, 200), al = metros(zr.altura, 100);
        if (an) z.ancho = an; if (al) z.alto = al;
        if (an || al) c.push((z.ancho ? fmt(z.ancho) : '?') + ' por ' + (z.alto ? fmt(z.alto) : '?'));
        const vs = (zr.huecos || []).filter((x) => x.tipo !== 'puerta').map((x) => ({ uds: Math.max(1, Math.round(x.uds || 1)), an: metros(x.ancho, 10), al: metros(x.alto, 10) })).filter((v) => v.an && v.al);
        if (vs.length || zr.huecos_modo === 'reemplazar') { z.ventanas = zr.huecos_modo === 'reemplazar' ? vs : (z.ventanas || []).concat(vs); z.descontar = true; const nv = vs.reduce((a, v) => a + v.uds, 0); if (nv) c.push(nv + ' ' + plural(nv, 'ventana')); }
      }
      if (amb === 'cubierta') {
        if (zr.cub_tipo) z.tipo = zr.cub_tipo;
        if (z.tipo === 'inclinada') {
          if (ok(zr.pendiente)) { z.factor = round2(Math.sqrt(1 + Math.pow(zr.pendiente / 100, 2))); c.push('pendiente ' + fmt(zr.pendiente, 0) + ' %'); }
          const fs = (zr.faldones || []).map((x, i) => ({ nombre: cap(x.nombre) || 'Faldón ' + ((z.faldones || []).length + i + 1), l: metros(x.largo, 200), a: metros(x.ancho, 200) })).filter((x) => x.l && x.a);
          if (fs.length) { z.faldones = (z.faldones || []).concat(fs); z.factor = z.factor || 1.05; c.push(fs.length + ' ' + plural(fs.length, 'faldón', 'faldones')); }
          if (!(z.faldones || []).length && metros(zr.largo, 200) && metros(zr.ancho, 200)) { z.faldones = [{ nombre: 'Faldón 1', l: metros(zr.largo, 200), a: metros(zr.ancho, 200) }]; z.factor = z.factor || 1.05; }
        } else {
          if (!z.tipo) z.tipo = 'plana';
          const r = metros(zr.remonte, 3); if (r) { z.remonte = Math.max(0.2, r); c.push('remonte ' + fmt(z.remonte)); }
          else if (z.remonte == null) z.remonte = 0.2;
        }
      }
      if (amb === 'piscina') {
        const a = metros(zr.prof_min, 6), b = metros(zr.prof_max, 6) || a;
        if (a || b) { z.pmin = Math.min(a || b, b); z.pmax = Math.max(a || b, b); z.prof = round2((z.pmin + z.pmax) / 2); c.push(z.pmin === z.pmax ? 'profundidad ' + fmt(z.prof) : 'profundidad de ' + fmt(z.pmin) + ' a ' + fmt(z.pmax)); }
      }
      if (amb === 'fontaneria') {
        const f = z.f || (z.f = {});
        if (zr.fon_tipo) f.tipo = zr.fon_tipo === 'otra' ? 'otra' : zr.fon_tipo;
        else if (!f.tipo) f.tipo = /bano|aseo/.test(norm(z.nombre)) ? 'bano' : /cocina/.test(norm(z.nombre)) ? 'cocina' : /lavadero|galeria/.test(norm(z.nombre)) ? 'lavadero' : 'otra';
        if (ok(zr.agua_fria)) f.af = Math.round(zr.agua_fria); if (ok(zr.agua_fria_caliente)) f.afc = Math.round(zr.agua_fria_caliente);
        if (zr.inodoro) f.inodoro = zr.inodoro === 'no' ? null : zr.inodoro;
        if (zr.ducha) f.ducha = zr.ducha === 'no' ? null : zr.ducha;
        ['mampara', 'bide', 'lavadora', 'lavavajillas'].forEach((k) => { const v = SN(zr[k]); if (v !== undefined) f[k] = v; });
        const ap = [f.tipo === 'bano' && 'lavabo', f.inodoro && 'inodoro' + (f.inodoro === 'suspendido' ? ' suspendido' : ''), f.ducha && (f.ducha === 'banera' ? 'bañera' : 'plato de ducha'), f.mampara && 'mampara', f.bide && 'bidé', f.tipo === 'cocina' && 'fregadero', f.lavadora && 'lavadora', f.lavavajillas && 'lavavajillas'].filter(Boolean);
        c.push('fontanería' + (ap.length ? ': ' + ap.join(', ') : ''));
      }
      if (amb === 'electricidad') {
        const e = z.e || (z.e = {});
        const cu = SN(zr.cuadro); if (cu !== undefined) z.cuadro = cu;
        if (SN(zr.segun_norma)) {
          const area = (this.toma.zonas.find((x) => x.ambito === 'interior' && norm(x.nombre) === norm(z.nombre)) || {}).area;
          const r = G.rebt(z.nombre, area || 10);
          if (r) { e.luz = r.luz; e.tomas = r.tomas; if (r.c3) e.c3 = r.c3; e.norma = true; }
        }
        if (ok(zr.puntos_luz)) e.luz = Math.round(zr.puntos_luz); if (ok(zr.tomas)) e.tomas = Math.round(zr.tomas);
        if (SN(zr.horno)) e.c3 = 1;
        c.push('electricidad' + (e.luz != null ? ': ' + e.luz + ' ' + plural(e.luz, 'punto') + ' de luz' : '') + (e.tomas != null ? ', ' + e.tomas + ' ' + plural(e.tomas, 'toma') : ''));
      }
      this.g.cZona = z.id;
      const nueva = z._nueva; delete z._nueva;
      return { z, txt: c.length ? z.nombre + ': ' + c.join(', ') + '.' : nueva ? 'Anoto ' + z.nombre.toLowerCase() + '.' : '' };
    }
    /** Busca la definición del trabajo: catálogo de la app, código de la base o búsqueda. */
    trabajoPara(tr, zonas) {
      const cat = this.dlg.cat;
      let w = tr.id ? G.TRABAJOS.find((t) => t.id === tr.id) : null;
      if (!w && tr.id) w = (this.g.extra || []).find((x) => x.id === tr.id);
      const amb = (w && w.ambito) || tr.ambito || (zonas[0] && zonas[0].ambito) || ((this.toma.zonas.find((z) => z.id === this.g.cZona) || {}).ambito) || 'interior';
      if (w) return w;
      let d = tr.codigo && cat ? cat.byCode.get(tr.codigo) : null;
      if (!d && tr.buscar && cat && cat.index) {
        const res = cat.index.search(tr.buscar).filter((r) => !tr.unidad || r.doc.u === tr.unidad);
        if (res.length && res[0].s >= 0.5) d = res[0].doc;
      }
      const nuevo = (fn) => { const antes = new Set(Object.keys(this.g.sel || {})); const w2 = fn(); if (w2 && !antes.has(w2.id)) this.g.sel[w2.id] = { on: false, zonas: [] }; return w2; };
      if (d) return nuevo(() => G.anadirExtra(this.obra, d, amb));
      if (tr.buscar) return nuevo(() => G.anadirPropia(this.obra, tr.buscar, tr.unidad || 'ud', amb, zonas.map((z) => z.id)));
      return null;
    }
    aplicarTrabajo(tr) {
      const zs = this.toma.zonas;
      const zonas = (tr.zonas || []).map((nm) => zs.find((z) => norm(z.nombre) === norm(nm)) || zs.find((z) => norm(z.nombre).includes(norm(nm)) || norm(nm).includes(norm(z.nombre)))).filter(Boolean);
      let w = this.trabajoPara(tr, zonas);
      if (!w) return null;
      const g = this.g; g.sel = g.sel || {};
      const delAmbito = (zz) => zz.filter((z) => z.ambito === w.ambito);
      const sel = G.seleccion(this.obra);
      if (tr.quitar) {
        const s = sel[w.id]; if (!s) return null;
        if (zonas.length) { s.zonas = s.zonas.filter((id) => !zonas.some((z) => z.id === id)); s.todas = false; if (!s.zonas.length) s.on = false; }
        else s.on = false;
        return { w, quitado: true };
      }
      // Medidas propias del trabajo (no salen de la zona): se guardan como respuesta
      const meds = (tr.medidas || []).filter((m) => ok(m.uds) || ok(m.largo) || ok(m.ancho) || ok(m.alto));
      if (meds.length && w.regla !== 'preguntar') {
        const id = w.id + '_med';
        g.extra = g.extra || [];
        let wm = g.extra.find((x) => x.id === id);
        if (!wm) { wm = Object.assign({}, w, { id, regla: 'preguntar', capitulo: w.capitulo || 'Otras partidas', q: w.q || w.label }); delete wm.auto; g.extra.push(wm); }
        w = wm;
      }
      let ids = delAmbito(zonas).map((z) => z.id);
      if (meds.length) {
        g.resp = g.resp || {};
        const porZona = new Map();
        meds.forEach((m) => {
          let z = (m.zona && (zs.find((x) => norm(x.nombre) === norm(m.zona)) || zs.find((x) => norm(x.nombre).includes(norm(m.zona))))) || zonas[0] || zs.find((x) => x.id === g.cZona);
          if (!z || z.ambito !== w.ambito) {
            // trabajo en una zona de otro ámbito o sin zona: se crea una zona del ámbito del trabajo con ese nombre
            const nom = cap(m.zona || (z && z.nombre) || 'General');
            z = zs.find((x) => x.ambito === w.ambito && norm(x.nombre) === norm(nom)) || this.aplicarZona({ ref: '', ambito: w.ambito, nombre: nom, tramos: [], huecos: [], faldones: [] }).z;
          }
          const L = { com: cap(m.comentario || ''), uds: ok(m.uds) ? m.uds : 1, l: metros(m.largo, 500), a: metros(m.ancho, 500), h: metros(m.alto, 100) };
          if (w.u === 'ud') { L.l = null; L.a = null; L.h = null; }
          if (w.u === 'm') { L.a = null; L.h = null; }
          if (w.u === 'm2' && L.l != null && L.a != null && L.h != null) L.h = null;
          porZona.set(z.id, (porZona.get(z.id) || []).concat([L]));
        });
        porZona.forEach((ls, zid) => { g.resp[w.id + '|' + zid] = ls; if (!ids.includes(zid)) ids.push(zid); });
      }
      const s = sel[w.id] || (g.sel[w.id] = { on: true, zonas: [] });
      s.on = true;
      if (!ids.length && !meds.length) { s.todas = true; s.zonas = G.zonasDe(this.obra, w).map((z) => z.id); }
      else s.zonas = [...new Set((s.todas ? [] : s.zonas).concat(ids))].filter((id) => zs.some((z) => z.id === id)), s.todas = false;
      if (w.zonas) s.zonas = s.zonas.filter((id) => { const z = zs.find((x) => x.id === id); return !s.todas || w.zonas.test(norm(z.nombre)); });
      return { w, zonas: s.zonas.map((id) => zs.find((z) => z.id === id)).filter(Boolean) };
    }
    /** Los trabajos marcados «en todas» se extienden a las zonas nuevas. */
    extender() {
      const sel = G.seleccion(this.obra);
      G.trabajosPara(this.obra).forEach((w) => {
        const s = sel[w.id]; if (!s) return;
        if (s.on && s.todas) s.zonas = G.zonasDe(this.obra, w).filter((z) => !w.zonas || w.zonas.test(norm(z.nombre))).map((z) => z.id);
        // Instalaciones (se marcan solas): se añaden las zonas nuevas que tienen algo que medir
        else if (w.auto && w.ambito !== 'obra' && G.REGLAS[w.regla] && !s.manual) {
          const zs = G.zonasDe(this.obra, w).filter((z) => (w.regla === 'fon_inst' || G.REGLAS[w.regla](z).length));
          s.zonas = zs.map((z) => z.id); s.on = zs.length > 0;
        }
      });
    }
    regenerar() {
      this.extender();
      let r = { partidas: 0, preguntas: [] };
      try { r = G.generar(this.obra, this.dlg.cat); } catch (e) { r = { partidas: 0, preguntas: [] }; }
      this.save();
      return r;
    }
    aplicar(out, text) {
      out = out || {};
      const g = this.g;
      if (out.accion === 'deshacer') return this.deshacer();
      if (out.accion === 'guiado') return this.aGuiado();
      if (out.accion === 'pausa') { this.io.pause && this.io.pause(); return; }
      const hay = (out.zonas || []).length || (out.trabajos || []).length || out.contenedores || out.seguridad_pct;
      if (hay) this.snapshot();
      const frases = [];
      this.sketch = null;
      const hechas = [];
      (out.zonas || []).slice(0, 12).forEach((zr) => { try { const r = this.aplicarZona(zr); if (r.txt) hechas.push(r); } catch (e) { /* zona mal formada: se ignora */ } });
      // «Anoto baño.» sobra si en la misma respuesta se dicen datos del baño
      hechas.forEach((r) => { if (/^Anoto /.test(r.txt) && hechas.some((o) => o !== r && norm(o.z.nombre) === norm(r.z.nombre) && !/^Anoto /.test(o.txt))) return; frases.push(r.txt); });
      const puestos = [], quitados = [];
      (out.trabajos || []).slice(0, 20).forEach((tr) => {
        try {
          const r = this.aplicarTrabajo(tr); if (!r) return;
          (r.quitado ? quitados : puestos).push(r.w.label.replace(/\s*\(.*?\)\s*$/, '').toLowerCase());
        } catch (e) { /* trabajo mal formado */ }
      });
      if (ok(out.contenedores)) { g.contenedores = Math.round(out.contenedores); g.contenedoresOk = true; frases.push(g.contenedores + ' ' + plural(g.contenedores, 'contenedor', 'contenedores') + ' de residuos.'); }
      if (ok(out.seguridad_pct) && out.seguridad_pct < 20) { g.sysPct = out.seguridad_pct; frases.push('Seguridad y salud al ' + fmt(out.seguridad_pct, 1).replace(/,0$/, '') + ' por ciento.'); }
      if (puestos.length) frases.push('Apunto ' + lista(puestos) + '.');
      if (quitados.length) frases.push('Quito ' + lista(quitados) + '.');
      g.contenedoresOk = g.contenedoresOk || false;
      const r = hay || out.accion === 'generar' ? this.regenerar() : null;
      if (this.sketch && this.sketch.planta && this.io.sketch) this.io.sketch(plantaSVG(this.sketch.planta), 'Planta ' + this.sketch.nombre);
      // Lo que dice: lo anotado (fiable, sale de los datos) + el mensaje de la IA + su pregunta
      let txt = frases.join(' ');
      const msg = (out.mensaje || '').trim();
      if (msg && (!txt || !/\d/.test(msg))) txt = (txt ? txt + ' ' : '') + msg;
      let preg = (out.pregunta || '').trim();
      if (out.accion === 'generar') {
        const f = this.faltan();
        if (!preg && f.length) preg = preguntaDe(this._faltan[0]);
        if (!f.length) {
          const n = this.obra.partidas.length;
          txt = (txt ? txt + ' ' : '') + 'Mediciones generadas: ' + n + ' ' + plural(n, 'partida') + '. Puedes revisarlas en pantalla, exportar el PDF o seguir contándome.';
          g.cPregunta = '';
          return this.ask(txt, [{ label: 'Exportar PDF', value: 'exporta el pdf' }, { label: 'Compartir archivos', value: 'compartir los archivos' }, { label: 'Ver trabajos', value: 'ver trabajos' }]);
        }
      }
      g.cPregunta = preg || '';
      this.save();
      if (preg) return this.ask((txt ? txt + ' ' : '') + preg, this.chips(out.opciones));
      if (!txt) txt = hay ? 'Anotado.' : 'Vale.';
      return this.ask(txt, this.chips(out.opciones), { breve: true });
    }
    aGuiado() {
      this.obra.modo = 'guiado';
      this.save();
      const gu = this.dlg.guia; if (!gu) return;
      if (this.toma.zonas.length) { gu.g.fin = false; return gu.say('mas_zona', {}, 'Vale, te pregunto yo. Lo anotado se queda.'); }
      this.obra.ambito = null; return gu.start('Vale, te pregunto yo.');
    }
  }
  function art(nom) { const n = norm(nom), w0 = n.split(' ')[0]; return ((/(a|ion|ad)$/.test(w0) && !/^(dia|sofa|clima|sistema|tema|programa)$/.test(w0)) || /^(cocina|terraza|galeria|entrada|habitacion|escalera|cubierta|fachada|piscina|zona|planta|sala|despensa|bodega|nave|oficina)/.test(n) ? 'la ' : 'el ') + nom.toLowerCase(); }
  /** Pregunta natural para un dato que falta. */
  function preguntaDe(f) {
    if (!f) return '';
    if (f.preg) return f.preg;
    const a = art(f.z.nombre);
    if (/altura/.test(f.falta)) return '¿Qué altura tiene ' + a + '?';
    if (/planta|largo y el ancho|^las medidas$/.test(f.falta)) return '¿Qué medidas tiene ' + a + '? Largo por ancho, o pared a pared.';
    if (/ancho y el alto/.test(f.falta)) return '¿Qué ancho y qué alto tiene ' + a + '?';
    if (/profundidad/.test(f.falta)) return '¿Qué profundidad tiene ' + a + '?';
    if (/faldones/.test(f.falta)) return '¿Cuánto miden los faldones de ' + a + '? Ancho por largo de cada uno.';
    if (/hueco/.test(f.falta)) return '¿Qué medidas tienen las puertas y ventanas de ' + a + '?';
    return '¿' + cap(f.falta) + ' de ' + a + '?';
  }
  function lista(xs) { xs = [...new Set(xs)]; if (xs.length <= 1) return xs[0] || ''; if (xs.length > 4) return xs.slice(0, 3).join(', ') + ' y ' + (xs.length - 3) + ' trabajos más'; return xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]; }

  const api = { Conversa };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Conversa = api;
})(typeof self !== 'undefined' ? self : this);
