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
    ask(text, chips, opts) {
      const c = (chips || []).slice();
      if (this.undo.length && !c.some((x) => /atras/.test(norm(x.value || '')))) c.push({ label: '↩ Atrás', value: 'atrás' });
      this.ultima = { text, chips: c }; this.dlg.ask(text, c, opts);
    }
    chips(extra) {
      const c = (extra || []).slice(0, 4).map((o) => ({ label: o, value: o }));
      if (this.toma.zonas.length) c.push({ label: 'Generar mediciones', value: 'genera las mediciones' });
      return c;
    }

    /* ---- inicio ---- */
    get guiado() { return !this.g.cLibre; }
    start(pre) {
      this.obra.modo = 'conversa';
      if (!this.obra.ambito) this.obra.ambito = 'conversa';
      this.g.fin = true; // el asistente guiado clásico queda parado
      this.save();
      if (this.guiado) return this.siguiente(pre);
      this.ask((pre ? pre + ' ' : '') + 'Cuéntame la obra a tu manera: por dónde empezamos, las medidas y qué hay que hacer. Yo voy tomando nota y te pregunto lo que falte.',
        [{ label: 'Prefiero que me preguntes tú', value: 'preguntame tu' }]);
    }
    resume() {
      if (this.guiado) return this.siguiente(this.toma.zonas.length ? 'Seguimos.' : '');
      const n = this.toma.zonas.length;
      this.ask(n ? 'Seguimos. Llevo ' + n + ' ' + plural(n, 'zona anotada', 'zonas anotadas') + '. Cuéntame.' : 'Cuéntame la obra: por dónde empezamos y qué hay que hacer.', this.chips());
    }

    /* ---- entrada ---- */
    handle(text, n, input) {
      if (!text) return;
      // Órdenes locales (rápidas, sin IA)
      if (/^(para|parar|stop|basta|calla|callate|silencio|espera|pausa|para de escuchar|deja de escuchar)$/.test(n)) { this.tok++; this.io.pause && this.io.pause(); return; }
      if (/^(repite|repitelo|que has dicho|como dices)$/.test(n) && this.ultima) return this.ask(this.ultima.text, this.ultima.chips);
      if (/^(deshaz|deshacer|anula|atras|vuelve atras|volver atras|vamos atras|borra lo ultimo|quita lo ultimo|me he equivocado)\b/.test(n) && n.split(' ').length <= 6 && !/planta|paredes|medidas|croquis/.test(n)) return this.deshacer();
      if (this.rehacerPlanta(n)) return;
      if (/^(preguntame tu|prefiero que me preguntes tu|pregunta tu|hazme las preguntas)\b/.test(n)) { this.g.cLibre = false; this.save(); return this.siguiente('Vale, te pregunto yo.'); }
      if (/^(te lo cuento yo|te cuento yo|dejame contartelo|modo libre|conversacion libre)\b/.test(n)) { this.g.cLibre = true; this.save(); return this.ask('Vale, cuéntamelo a tu manera; te pregunto solo lo que falte.', this.chips()); }
      if (/^(modo guiado clasico|asistente clasico|sin ia)\b/.test(n)) return this.aGuiado();
      if (this.guiado && this.atajo(text, n) !== false) return;
      if (/^(elegir trabajos|elige trabajos|ver trabajos|pantalla de trabajos|ver los trabajos)\b/.test(n) && this.toma.zonas.length) { this.io.trabajos && this.io.trabajos(true); return this.ask('Aquí tienes los trabajos anotados. Puedes marcar o desmarcar los que quieras y seguir hablando.', this.chips()); }
      if (this.esConsulta(n)) return this.responderConsulta(text, n);
      // Exportar, compartir, correo: los atiende el motor
      if (/\b(exporta|exportar|pdf|excel|bc3|comparte|compartir|correo|envia|enviame)\b/.test(n) && !/\b(hay|tiene|pared|suelo|techo)\b/.test(n)) return false;
      if (!this.aiOk()) {
        return this.ask('Para la conversación libre necesito la IA: entra en tu cuenta y comprueba la conexión. Mientras tanto puedo preguntarte yo paso a paso.', [{ label: 'Medición guiada', value: 'modo guiado' }]);
      }
      return this.consultar(text);
    }

    /** «La planta está mal», «volver a empezar la planta», «las medidas están mal»: se borra la planta y se vuelve a pedir. */
    rehacerPlanta(n) {
      if (!(/(planta|paredes|croquis|medidas|recorrido|dibujo)\b.*\b(mal|equivocad|incorrect|corregir|modificar|rehacer|cambiar|repetir|de nuevo)|\b(rehacer|repetir|corregir|modificar|empezar de nuevo|volver a empezar|empezar otra vez|borra)\b.*\b(planta|paredes|croquis|medidas|recorrido)|^(esta mal|estan mal|eso esta mal|no es asi|mal)\b/.test(n))) return false;
      if (/\b(altura|alto|puerta|ventana)\b/.test(n) && !/planta|paredes|croquis/.test(n)) return false;
      const P = this.g.cPaso, zs = this.toma.zonas;
      // «está mal» a secas solo vale justo después de dictar la planta
      if (/^(esta mal|estan mal|eso esta mal|no es asi|mal)\b/.test(n) && !/planta|paredes|croquis|medidas/.test(n) && !(P && P.campo === 'altura')) return false;
      let z = G.buscarZona(this.obra, n) || zs.find((x) => x.id === ((P && P.zid) || this.g.cFoco || this.g.cZona));
      if (!z || !/^(interior|cubierta|piscina)$/.test(z.ambito)) return false;
      if (z.area == null && !(z.tramos || []).length) return false;
      this.snapshot();
      z.area = null; z.perimetro = null; z.tramos = []; delete z.rect; delete z.planta;
      if (this.obra.plantas) delete this.obra.plantas[norm(z.nombre)];
      this.g.cFoco = z.id; this.g.cPaso = null;
      this.regenerar();
      this.siguiente('Vale, borro la planta ' + (art(z.nombre).startsWith('el ') ? 'del ' + art(z.nombre).slice(3) : 'de ' + art(z.nombre)) + ' y la hacemos de nuevo.');
      return true;
    }
    /* ============ MODO GUIADO CON IA ============
     * La app pregunta paso a paso (como el asistente guiado), pero cada respuesta
     * la interpreta la IA: lo que el usuario diga de más o en desorden se anota
     * igualmente, y la siguiente pregunta se salta lo que ya se sabe.
     */
    /** Siguiente dato que hace falta, por orden: la zona en curso primero. */
    agenda() {
      const zs = this.toma.zonas, g = this.g;
      if (g.cFin) return { campo: 'fin' };
      if (!zs.length) return { campo: 'inicio' };
      const cur = zs.find((z) => z.id === (g.cFoco || g.cZona));
      const orden = (cur ? [cur] : []).concat(zs.filter((z) => z !== cur));
      const sk = (z, c) => z.skip && z.skip[c];
      for (const z of orden) {
        const a = z.ambito;
        const p = (campo) => ({ campo, z });
        if (a === 'interior') {
          if (z.area == null && !sk(z, 'planta')) return p('planta');
          if (!z.altura && !sk(z, 'altura')) return p('altura');
          if (!z.huecosOk && !sk(z, 'huecos')) return p('huecos');
          if ((z.huecos || []).some((h) => !h.an || !h.al) && !sk(z, 'huecosMed')) return p('huecosMed');
          if (!z.trabajosOk && !sk(z, 'trabajos')) return p('trabajos');
        } else if (a === 'fachada') {
          if ((!z.ancho || !z.alto) && !sk(z, 'fachada')) return p('fachada');
          if (!z.huecosOk && !sk(z, 'ventanas')) return p('ventanas');
          if (!z.trabajosOk && !sk(z, 'trabajos')) return p('trabajos');
        } else if (a === 'cubierta') {
          if (!z.tipo && !sk(z, 'cubTipo')) return p('cubTipo');
          if (z.tipo === 'inclinada' ? !(z.faldones || []).length && !sk(z, 'faldones') : z.area == null && !sk(z, 'planta')) return p(z.tipo === 'inclinada' ? 'faldones' : 'planta');
          if (!z.trabajosOk && !sk(z, 'trabajos')) return p('trabajos');
        } else if (a === 'piscina') {
          if (z.area == null && !sk(z, 'planta')) return p('planta');
          if (!z.prof && !sk(z, 'prof')) return p('prof');
          if (!z.trabajosOk && !sk(z, 'trabajos')) return p('trabajos');
        } else if (a === 'fontaneria') {
          if (!z.fOk && !sk(z, 'fon')) return p('fon');
        } else if (a === 'electricidad') {
          if (!z.eOk && !sk(z, 'ele')) return p('ele');
        }
        // Medidas propias de los trabajos anotados en la zona («¿cuántos sumideros?»)
        this.faltan();
        const f = (this._faltan || []).find((x) => x.z === z && x.preg && !sk(z, 'med:' + x.preg));
        if (f) return { campo: 'med', z, preg: f.preg };
      }
      return { campo: 'mas' };
    }
    textoPaso(a) {
      const z = a.z, A = z ? art(z.nombre) : '', breve = this.io.breve && this.io.breve();
      const de = z ? (A.startsWith('el ') ? 'del ' + A.slice(3) : 'de ' + A) : '';
      switch (a.campo) {
        case 'inicio': return breve ? '¿Qué medimos?' : '¿Qué vamos a medir? Dime por dónde empezamos: una estancia, la fachada, la cubierta, una piscina… y cuéntame lo que veas.';
        case 'planta': return z.ambito === 'piscina' ? '¿Qué medidas interiores tiene ' + A + '? Largo por ancho.' : breve ? '¿Medidas ' + de + '?' : '¿Qué medidas tiene ' + A + '? Largo por ancho, o pared a pared con los giros.';
        case 'altura': return '¿Qué altura tiene ' + A + '?';
        case 'huecos': return breve ? '¿Puertas y ventanas?' : '¿Qué puertas y ventanas tiene ' + A + ', con sus medidas?';
        case 'huecosMed': { const h = (z.huecos || []).find((x) => !x.an || !x.al); return '¿Qué medidas tiene la ' + (h.bal ? 'balconera' : h.tipo) + ' ' + de + '?'; }
        case 'trabajos': return breve ? '¿Qué se hace en ' + A + '?' : '¿Qué hay que hacer en ' + A + '?';
        case 'fachada': return '¿Qué ancho y qué alto tiene ' + A + '?';
        case 'ventanas': return '¿Qué ventanas tiene ' + A + '? Dime cuántas de cada tipo y sus medidas, o «ninguna».';
        case 'cubTipo': return '¿' + cap(A) + ' es plana o inclinada?';
        case 'faldones': return 'Dime los faldones ' + de + ': ancho por largo de cada uno, medidos en planta.';
        case 'prof': return '¿Qué profundidad tiene ' + A + '? Si varía, la menor y la mayor.';
        case 'fon': return '¿Qué aparatos lleva ' + A + '? Inodoro, lavabo, ducha o bañera, fregadero, lavadora…';
        case 'ele': return '¿Cuántos puntos de luz y enchufes lleva ' + A + '? O dime «según normativa».';
        case 'med': return a.preg;
        case 'mas': return breve ? '¿Algo más, o generamos las mediciones?' : '¿Qué más medimos? Otra estancia, la fachada, la cubierta, las instalaciones… o dime «genera las mediciones».';
        default: return '';
      }
    }
    chipsPaso(a) {
      const C = (xs) => xs.map((x) => (typeof x === 'string' ? { label: x, value: x } : x));
      switch (a.campo) {
        case 'inicio': return C(['Salón', 'Cocina', 'Baño', 'Fachada', 'Cubierta', 'Piscina']);
        case 'huecos': case 'ventanas': return C([{ label: 'Ninguna', value: 'ninguna' }]);
        case 'trabajos': return C([{ label: 'Nada', value: 'nada' }, { label: 'Lo elijo en pantalla', value: 'lo elijo en pantalla' }]);
        case 'cubTipo': return C(['Plana', 'Inclinada']);
        case 'ele': return C([{ label: 'Según normativa', value: 'según normativa' }]);
        case 'mas': return C(['Otra estancia', 'Instalaciones', 'Fachada', { label: 'Generar mediciones', value: 'genera las mediciones' }]);
        default: return [];
      }
    }
    /** Visita grabada: aplica de una vez todo lo que la IA ha sacado de la transcripción. */
    aplicarVisita(out, transcripcion) {
      out = out || {};
      const g = this.g;
      this.snapshot();
      this.obra.modo = 'conversa'; if (!this.obra.ambito) this.obra.ambito = 'conversa';
      g.cLibre = false; g.cFin = false; g.cPaso = null; g.fin = true;
      // Sin las comprobaciones pensadas para una sola frase (recorridos, alturas…): la IA ya ha leído todo el texto
      this.textoN = norm(transcripcion || ''); this.textoOrig = ''; this.nums = [];
      let nz = 0, nt = 0;
      (out.zonas || []).slice(0, 60).forEach((zr) => { try { this.aplicarZona(zr); nz++; } catch (e) { /* zona mal formada */ } });
      (out.trabajos || []).slice(0, 120).forEach((tr) => {
        try {
          if (this.trabajoFontaneria(tr)) return;
          const r = this.aplicarTrabajo(tr);
          if (r && !r.quitado) { nt++; (r.zonas || []).forEach((z) => { z.trabajosOk = true; }); }
        } catch (e) { /* trabajo mal formado */ }
      });
      if (ok(out.contenedores)) { g.contenedores = Math.round(out.contenedores); g.contenedoresOk = true; }
      if (ok(out.seguridad_pct) && out.seguridad_pct < 20) g.sysPct = out.seguridad_pct;
      this.textoN = '';
      g.cFoco = (this.toma.zonas[0] || {}).id;
      this.regenerar();
      const zs = this.toma.zonas.filter((z) => z.ambito === 'interior').length;
      return { zonas: nz, estancias: zs, trabajos: nt, partidas: this.obra.partidas.length, mensaje: (out.mensaje || '').trim() };
    }
    /** Nota de corrección grabada tras revisar las mediciones: se aplican solo los cambios. */
    aplicarCorreccion(out, texto) {
      this.textoLargo = true;
      try { this.obra.modo = 'conversa'; this.g.cLibre = false; this.g.cFin = false; this.g.cPaso = null; return this.aplicar(out, texto); }
      finally { this.textoLargo = false; }
    }
    /** Pregunta lo siguiente que falta (o genera, si se ha pedido terminar). */
    siguiente(pre, opt) {
      const g = this.g;
      const avanza = !!(opt && opt.avanza); // la respuesta aportó datos (no cuenta como fallo aunque se repita la pregunta)
      let a = this.agenda();
      if (a.campo === 'fin') {
        this.faltan();
        const f = (this._faltan || []).find((x) => !(x.z.skip && x.z.skip['med:' + preguntaDe(x)]));
        if (f) a = { campo: 'med', z: f.z, preg: preguntaDe(f) };
        else return this.terminar(pre);
      }
      const k = a.campo + '|' + (a.z ? a.z.id : '');
      const repe = g.cPaso && g.cPaso.k === k && !avanza;
      g.cFails = repe ? (g.cFails || 0) + 1 : 0;
      let q = this.textoPaso(a);
      const chips = this.chipsPaso(a);
      if (repe && g.cFails >= 1 && a.z) {
        q = (g.cFails === 1 ? 'No me ha quedado claro. ' : 'Sigo sin tenerlo. ') + q;
        chips.push({ label: 'Saltar', value: 'saltar' });
        if (g.cFails >= 3) { // nunca atascarse: se salta y se sigue
          a.z.skip = Object.assign({}, a.z.skip, { [a.campo === 'med' ? 'med:' + a.preg : a.campo]: true });
          g.cPaso = null; this.save();
          return this.siguiente((pre ? pre + ' ' : '') + 'Lo dejo pendiente y seguimos.');
        }
      }
      g.cPaso = { k, campo: a.campo, zid: a.z ? a.z.id : '', texto: q, preg: a.preg || '' };
      if (a.z) { g.cZona = a.z.id; g.cFoco = a.z.id; }
      this.save();
      const t = (pre ? pre + ' ' : '') + q;
      const vp = opt && opt.vozPre != null ? opt.vozPre : pre;
      return this.ask(t, chips.concat(this.toma.zonas.length && a.campo !== 'mas' ? [{ label: 'Generar mediciones', value: 'genera las mediciones' }] : []), { voz: (vp ? vp + ' ' : '') + q });
    }
    terminar(pre) {
      const g = this.g;
      g.cFin = false; g.cPaso = null;
      this.regenerar();
      const n = this.obra.partidas.length;
      return this.ask((pre ? pre + ' ' : '') + 'Mediciones generadas: ' + n + ' ' + plural(n, 'partida') + '. Revísalas en pantalla, exporta el PDF o dime qué más medimos.',
        [{ label: 'Exportar PDF', value: 'exporta el pdf' }, { label: 'Compartir archivos', value: 'compartir los archivos' }, { label: 'Ver trabajos', value: 'ver trabajos' }, { label: 'Medir algo más', value: 'medir algo mas' }]);
    }
    /** Respuestas simples a la pregunta en curso: sin esperar a la IA. */
    atajo(text, n) {
      const g = this.g, P = g.cPaso, z = P && P.zid ? this.toma.zonas.find((x) => x.id === P.zid) : null;
      const corta = n.split(' ').length <= 6;
      const NEG = /^(no|ninguna|ninguno|nada|no hay|no tiene|no lleva|sin huecos|ni puertas ni ventanas|nada mas|ninguna mas)\b/;
      if (/^(saltar|salta|siguiente|pasa|no lo se|no se|luego te lo digo|despues)$/.test(n) && P) {
        if (z) z.skip = Object.assign({}, z.skip, { [P.campo === 'med' ? 'med:' + P.preg : P.campo]: true });
        g.cPaso = null; this.save(); return this.siguiente('Vale, lo dejo pendiente.');
      }
      if (/^(genera|generar|general|terminar|termina|terminamos|ya esta|eso es todo|saca las mediciones|vamos a sacar|acabamos|finaliza)\b|genera(r)? (las )?mediciones/.test(n) && n.split(' ').length <= 8) {
        // Si ya se estaba terminando y lo vuelve a pedir, se genera con lo que haya
        if (g.cFin || (P && P.campo === 'med')) { if (z && P) z.skip = Object.assign({}, z.skip, { ['med:' + P.preg]: true }); return this.terminar('Genero con lo que tengo; lo que falte lo puedes completar después.'); }
        this.snapshot(); g.cFin = true; return this.siguiente();
      }
      if (/^(medir algo mas|medir otra|otra estancia|seguimos midiendo)$/.test(n)) { g.cFin = false; g.cPaso = { k: 'nueva', campo: 'nueva', texto: '¿Qué estancia o zona medimos ahora?' }; this.save(); return this.ask('¿Qué estancia o zona medimos ahora?', this.chipsPaso({ campo: 'inicio' })); }
      if (P && P.campo === 'inicio' && /^(una |la |un |el )?(vivienda|piso|casa|reforma( integral)?|chalet|apartamento|toda la casa|todo el piso)$/.test(n)) {
        this.g.cTipo = 'vivienda'; g.cPaso = { k: 'nueva', campo: 'nueva', texto: '¿Por qué estancia empezamos?' }; this.save();
        return this.ask('Perfecto, una vivienda. ¿Por qué estancia empezamos?', this.chipsPaso({ campo: 'inicio' }));
      }
      if (!P || !corta) return false;
      const nums = (G.numeros ? G.numeros(text) : []);
      if (z && (P.campo === 'altura' || P.campo === 'prof') && nums.length === 1 && !/[a-z]{4,}/.test(n.replace(/\b(metros?|de|alto|altura|son|es|tiene|pues|unos|unas|y|medio|con|centimetros|profundidad)\b/g, '').replace(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\b/g, ''))) {
        this.snapshot();
        let v = nums[0]; if (v >= 5) v = round2(v / 100);
        if (P.campo === 'altura') { if (!(v > 1.5 && v < 15)) return false; z.altura = v; this.regenerar(); return this.siguiente(z.nombre + ': altura ' + fmt(v) + '.', { avanza: true }); }
        z.pmin = z.pmax = z.prof = v; this.regenerar(); return this.siguiente('Profundidad ' + fmt(v) + '.', { avanza: true });
      }
      if (z && P.campo === 'planta') {
        const w = G.parseWalk(text);
        if (w && w.rect && !/[a-z]{4,}/.test(n.replace(/\b(por|x|metros?|de|con|mide|son|es|y|medio|rectangular|cuadrad[oa])\b/g, '').replace(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/g, ''))) {
          this.snapshot(); const c = []; this.planta(z, { largo: w.rect[0], ancho: w.rect[1], tramos: [] }, c); this.regenerar();
          if (this.sketch && this.sketch.planta && this.io.sketch) this.io.sketch(plantaSVG(this.sketch.planta), 'Planta ' + this.sketch.nombre);
          return this.siguiente(z.nombre + ': ' + c.join(', ') + '.', { avanza: true });
        }
      }
      if (z && /^(huecos|ventanas)$/.test(P.campo) && NEG.test(n)) { this.snapshot(); z.huecosOk = true; if (z.ambito === 'interior') z.huecos = []; else z.ventanas = []; this.save(); return this.siguiente('Sin huecos.'); }
      if (z && P.campo === 'trabajos' && (NEG.test(n) || /pantalla|luego lo elijo|despues lo elijo/.test(n))) {
        this.snapshot(); z.trabajosOk = true; this.save();
        if (/pantalla/.test(n)) { this.io.trabajos && this.io.trabajos(true); return this.siguiente('Te los dejo en pantalla para que los marques.'); }
        return this.siguiente('');
      }
      if (z && P.campo === 'med' && NEG.test(n)) {
        this.snapshot(); this.faltan();
        const f = (this._faltan || []).find((x) => x.z === z && (x.preg === P.preg || preguntaDe(x) === P.preg));
        if (f && f.w) { g.resp = g.resp || {}; g.resp[f.w.id + '|' + z.id] = []; } // contestado: no hay
        z.skip = Object.assign({}, z.skip, { ['med:' + P.preg]: true });
        this.regenerar(); return this.siguiente('Vale, no hay.', { avanza: true });
      }
      if (P.campo === 'mas' && NEG.test(n)) { this.snapshot(); g.cFin = true; return this.siguiente(); }
      if (z && P.campo === 'ele' && /(normativa|reglamento|minimo|lo normal)/.test(n)) return false; // lo resuelve la IA con segun_norma
      return false;
    }
    /** Tras aplicar la respuesta: lo preguntado queda contestado si la respuesta lo cubre. */
    marcarPaso(out, text) {
      const g = this.g, P = g.cPaso; if (!P || !P.zid) return;
      const z = this.toma.zonas.find((x) => x.id === P.zid); if (!z) return;
      const n = norm(text || ''), toca = (out.zonas || []).some((x) => x.ref === z.id || norm(x.nombre) === norm(z.nombre));
      const NEG = /^(no|ninguna|ninguno|nada|no hay|no tiene|no lleva)\b/.test(n);
      if (P.campo === 'huecos' || P.campo === 'ventanas') { if ((out.zonas || []).some((x) => (x.ref === z.id || norm(x.nombre) === norm(z.nombre)) && ((x.huecos || []).length || x.huecos_modo === 'reemplazar')) || NEG) z.huecosOk = true; }
      if (P.campo === 'trabajos') { if ((out.trabajos || []).length || NEG) z.trabajosOk = true; }
      if (P.campo === 'fon' && (toca || (out.trabajos || []).length || NEG)) z.fOk = true;
      if (P.campo === 'ele' && (toca || NEG)) z.eOk = true;
      if (P.campo === 'med' && NEG) z.skip = Object.assign({}, z.skip, { ['med:' + P.preg]: true });
    }

    /* ---- preguntas sobre lo anotado (sin IA) ---- */
    esConsulta(n) {
      if (/\b(hay que|vamos a|pon|poner|quita|cambia|anota|apunta|son|es de|mide \d)\b/.test(n) && !/^(como|cuanto|cuantos|que|cuales|dime|lee|repasa|resumen)/.test(n)) return false;
      return /^(y )?(como (quedan|queda|van|va)|cuanto (mide|miden|tiene|tienen|sale|salen|da|dan)|cuantos metros|que medidas|cuales son las medidas|que (llevo|llevamos|tenemos|hay) (anotad|medid|apuntad)|que llevamos|dime (las )?medidas|lee (las )?medidas|repasa|resumen|que trabajos)/.test(n);
    }
    responderConsulta(text, n) {
      const zs = this.toma.zonas;
      if (!zs.length) return this.ask('Todavía no tengo nada anotado. Cuéntame por dónde empezamos.', this.chips());
      let z = G.buscarZona(this.obra, text);
      const sel = G.seleccion(this.obra);
      if (/trabajos/.test(n)) {
        const ws = G.trabajosPara(this.obra).filter((w) => sel[w.id] && sel[w.id].on && w.ambito !== 'obra' && (!z || sel[w.id].zonas.includes(z.id)));
        return this.ask(ws.length ? (z ? 'En ' + art(z.nombre) + ': ' : 'Trabajos anotados: ') + lista(ws.map((w) => w.label.replace(/\s*\(.*?\)\s*$/, '').toLowerCase())) + '.' : 'No hay trabajos anotados' + (z ? ' en ' + art(z.nombre) : '') + '.', this.chips());
      }
      if (!z) z = /\b(todo|toda|obra|llevamos|resumen)\b/.test(n) ? null : zs.find((x) => x.id === this.g.cZona);
      const lst = z ? [z] : zs;
      return this.ask(lst.map((x) => this.resumenZona(x)).join(' '), this.chips());
    }
    /** Resumen hablado de una zona, con las paredes ya calculadas. */
    resumenZona(z) {
      const f = fmt, p = [];
      if (z.rect) p.push(f(z.rect[0]) + ' por ' + f(z.rect[1]));
      if (z.area != null) p.push(f(z.area) + ' metros cuadrados de suelo');
      if (z.perimetro != null && z.ambito !== 'fachada') p.push(f(z.perimetro) + ' de perímetro');
      if (z.altura) p.push('altura ' + f(z.altura));
      if (z.ambito === 'interior' && z.perimetro && z.altura) {
        const ded = (z.huecos || []).reduce((a, x) => a + (x.uds || 1) * (x.an || 0) * (x.al || 0), 0);
        p.push('paredes ' + f(round2(z.perimetro * z.altura - ded)) + ' metros cuadrados' + (ded ? ' descontando huecos' : ''));
      }
      const np = (z.huecos || []).filter((x) => x.tipo === 'puerta').reduce((a, x) => a + (x.uds || 1), 0), nv = (z.huecos || []).filter((x) => x.tipo === 'ventana').reduce((a, x) => a + (x.uds || 1), 0);
      if (np || nv) p.push([np && np + ' ' + plural(np, 'puerta'), nv && nv + ' ' + plural(nv, 'ventana')].filter(Boolean).join(' y '));
      if (z.ambito === 'fachada' && z.ancho) p.push(f(z.ancho) + ' por ' + f(z.alto));
      if (z.prof) p.push('profundidad ' + f(z.prof));
      const d = p.length ? p.join(', ') : (this.datosZona(z) || 'sin medidas todavía');
      return cap(art(z.nombre)) + (z.ambito === 'fontaneria' ? ' (fontanería)' : z.ambito === 'electricidad' ? ' (electricidad)' : '') + ': ' + d + '.';
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
          if (falta && !vistos.has(k)) { vistos.add(k); out.push(z.nombre + ': ' + falta + ' (para ' + w.label.toLowerCase() + ')'); this._faltan.push({ z, w, falta, preg: w.regla === 'preguntar' && w.pide ? w.pide.replace('{zona}', art(z.nombre)) : null }); }
        });
      });
      return out.slice(0, 8);
    }
    contexto(text) {
      const g = this.g, sel = G.seleccion(this.obra);
      const trabajos = G.trabajosPara(this.obra).filter((w) => sel[w.id] && sel[w.id].on && w.ambito !== 'obra').map((w) => ({
        id: w.id, codigo: w.c || '', label: w.label,
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
        trabajos, faltan: this.faltan(), esperando: this.guiado && g.cPaso ? g.cPaso.texto + (g.cPaso.zid ? ' [zona: ' + ((this.toma.zonas.find((z) => z.id === g.cPaso.zid) || {}).nombre || '') + ']' : '') : (g.cPregunta || ''), guiado: this.guiado, historial: log, candidatas
      };
    }

    /* ---- consulta ---- */
    consultar(text) {
      const tk = ++this.tok, obraId = this.obra.id;
      this.io.note && this.io.note('Tomando nota…');
      const ctx = this.contexto(text);
      const t0 = Date.now();
      let tLim = null;
      const lim = new Promise((r) => { tLim = setTimeout(() => r({ timeout: true }), 45000); });
      // Si tarda, que se note que sigue trabajando
      const aviso = setTimeout(() => { if (tk === this.tok) this.io.note && this.io.note('Sigo con ello…'); }, 7000);
      return Promise.race([Promise.resolve().then(() => this.io.conversa(ctx)), lim]).then((res) => {
        clearTimeout(aviso); clearTimeout(tLim);
        if (tk !== this.tok || !this.obra || this.obra.id !== obraId) return;
        if (res && res.timeout) throw new Error('la IA no ha contestado a tiempo');
        if (!res || !res.result) throw new Error((res && res.error) || 'sin respuesta');
        if (res.aviso_claude) try { console.info('IA', res.modelo, Date.now() - t0, res.aviso_claude); } catch (e) { /* solo diagnóstico */ }
        return this.aplicar(res.result, text);
      }).catch((e) => {
        clearTimeout(aviso); clearTimeout(tLim);
        if (tk !== this.tok) return;
        this.ask('No he podido consultarlo ahora mismo (' + (e && e.message ? e.message : 'error') + '). Repítemelo, o si prefieres te pregunto yo paso a paso.', [{ label: 'Repetir', value: text }, { label: 'Medición guiada', value: 'modo guiado' }]);
      });
    }

    /* ---- aplicar la respuesta ---- */
    snapshot() {
      const g = this.g;
      this.undo.push(JSON.stringify({ toma: this.toma, sel: g.sel || {}, resp: g.resp || {}, extra: g.extra || [], plantas: this.obra.plantas || {}, cont: g.contenedores, contOk: g.contenedoresOk, sys: g.sysPct, est: this.obra.estancias || [], estAct: this.obra.estActiva || '', paso: g.cPaso || null, fin: !!g.cFin }));
      if (this.undo.length > 30) this.undo.shift();
    }
    deshacer() {
      const s = this.undo.pop();
      if (!s) return this.ask('No hay nada que deshacer.', this.chips());
      const o = JSON.parse(s), g = this.g;
      this.obra.toma = o.toma; g.sel = o.sel; g.resp = o.resp; g.extra = o.extra; this.obra.plantas = o.plantas; g.contenedores = o.cont; g.contenedoresOk = o.contOk; g.sysPct = o.sys; this.obra.estancias = o.est; this.obra.estActiva = o.estAct;
      if (o.paso !== undefined) { g.cPaso = o.paso; g.cFin = o.fin; }
      this.regenerar();
      if (this.guiado) { g.cPaso = null; return this.siguiente('Vale, lo quito.'); }
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
      let tr = (zr.tramos || []).map((t) => ({ l: metros(t.largo), giro: t.giro || '', ang: ok(t.angulo) ? t.angulo : 90 })).filter((t) => t.l);
      if (tr.length >= 2 && this.textoOrig && !this.textoLargo) { try { const w = G.parseWalk(this.textoOrig); if (w && w.tramos && w.tramos.length >= 3) tr = w.tramos.map((t) => ({ l: t.l, giro: t.giro || '', ang: t.ang || 90 })); } catch (e) { /* se queda la de la IA */ } }
      let L = metros(zr.largo, 200), A = metros(zr.ancho, 200);
      // La IA no debe calcular: si da superficie y perímetro de un rectángulo dicho con dos números, se usan esos números
      const nums = this.nums || [];
      if (!L && !A && !tr.length && ok(zr.superficie)) {
        for (let i = 0; i < nums.length && !L; i++) for (let j = i + 1; j < nums.length; j++) if (Math.abs(nums[i] * nums[j] - zr.superficie) < 0.06) { L = nums[i]; A = nums[j]; break; }
      }
      // Si la frase trae justo dos medidas y la IA ha puesto otras, mandan las dichas
      const pl = nums.filter((v) => v >= 0.5 && v <= 60);
      if (L && A && pl.length === 2 && !this.textoRef && !(near(L, pl[0]) && near(A, pl[1])) && !(near(L, pl[1]) && near(A, pl[0])) && !/(altura|alto)/.test(this.textoN || '')) { L = pl[0]; A = pl[1]; }
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
        let h = metros(zr.altura, 15);
        // «la altura son dos veinte»: si la frase habla de altura y trae un solo número, manda ese número
        const nh = (this.nums || []).filter((v) => v > 0.5 && v < 15);
        if (h && !this.textoLargo && /(altura|alto|techo)/.test(this.textoN || '') && nh.length === 1 && !near(h, nh[0])) h = nh[0];
        if (h) { z.altura = h; c.push('altura ' + fmt(h)); }
        const hs = (zr.huecos || []).map((x) => ({ tipo: x.tipo === 'ventana' ? 'ventana' : 'puerta', bal: x.tipo === 'balconera', uds: Math.max(1, Math.round(x.uds || 1)), an: metros(x.ancho, 10), al: metros(x.alto, 10) || (x.tipo === 'puerta' ? 2.03 : null) }));
        const niega = /\b(no hay|no tiene|ninguna|ninguno|sin (puertas|ventanas|huecos)|ni puertas|ni ventanas)\b/.test(this.textoN || '');
        if (hs.length || (zr.huecos_modo === 'reemplazar' && niega)) {
          z.huecos = zr.huecos_modo === 'reemplazar' ? hs : (z.huecos || []).concat(hs);
          z.huecosOk = true;
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
        if (vs.length || zr.huecos_modo === 'reemplazar') { z.ventanas = zr.huecos_modo === 'reemplazar' ? vs : (z.ventanas || []).concat(vs); z.descontar = true; z.huecosOk = true; const nv = vs.reduce((a, v) => a + v.uds, 0); if (nv) c.push(nv + ' ' + plural(nv, 'ventana')); }
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
        else if (!f.tipo) f.tipo = /bano|aseo/.test(norm(z.nombre)) ? 'bano' : /cocina/.test(norm(z.nombre)) ? 'cocina' : /lavadero|galeria|coladuria|colada|lavanderia/.test(norm(z.nombre)) ? 'lavadero' : 'otra';
        if (ok(zr.agua_fria)) f.af = Math.round(zr.agua_fria); if (ok(zr.agua_fria_caliente)) f.afc = Math.round(zr.agua_fria_caliente);
        if (zr.inodoro) f.inodoro = zr.inodoro === 'no' ? null : zr.inodoro;
        if (zr.ducha) f.ducha = zr.ducha === 'no' ? null : zr.ducha;
        ['mampara', 'bide', 'lavadora', 'lavavajillas'].forEach((k) => { const v = SN(zr[k]); if (v !== undefined) f[k] = v; });
        const ap = [f.tipo === 'bano' && 'lavabo', f.inodoro && 'inodoro' + (f.inodoro === 'suspendido' ? ' suspendido' : ''), f.ducha && (f.ducha === 'banera' ? 'bañera' : 'plato de ducha'), f.mampara && 'mampara', f.bide && 'bidé', f.tipo === 'cocina' && 'fregadero', f.lavadora && 'lavadora', f.lavavajillas && 'lavavajillas'].filter(Boolean);
        c.push('fontanería' + (ap.length ? ': ' + ap.join(', ') : ''));
        if (ap.length || f.af || f.afc) z.fOk = true;
      }
      if (amb === 'electricidad') {
        const e = z.e || (z.e = {});
        const cu = SN(zr.cuadro); if (cu !== undefined) z.cuadro = cu;
        if (SN(zr.segun_norma)) {
          const area = (this.toma.zonas.find((x) => x.ambito === 'interior' && norm(x.nombre) === norm(z.nombre)) || {}).area;
          const r = G.rebt(z.nombre, area || 10);
          if (r) { e.luz = r.luz; e.tomas = r.tomas; if (r.c3) e.c3 = r.c3; e.norma = true; }
        }
        if (e.norma && e.tomasBase == null) e.tomasBase = e.tomas;
        if (SN(zr.segun_norma)) e.tomasBase = e.tomas;
        if (ok(zr.puntos_luz)) e.luz = Math.round(zr.puntos_luz); if (ok(zr.tomas)) { e.tomas = Math.round(zr.tomas); e.tomasBase = e.tomas; }
        if (SN(zr.horno)) e.c3 = 1;
        // Equipos: horno/placa → toma de 25 A; termo, lavadora, lavavajillas → circuito propio; microondas, nevera… → una toma más cada uno
        const eq = (zr.equipos || []).map((x) => norm(x)).filter(Boolean);
        if (eq.length) {
          e.equipos = [...new Set((e.equipos || []).concat(eq))];
          const c4 = new Set(e.c4 || []); let mas = 0;
          e.equipos.forEach((x) => {
            if (/horno|placa|vitro|induccion|cocina|fogon/.test(x)) e.c3 = 1;
            else if (/termo|calentador|acumulador/.test(x)) c4.add('termo');
            else if (/lavadora|lavavajillas|secadora/.test(x)) c4.add(x.match(/lavadora|lavavajillas|secadora/)[0]);
            else mas++;
          });
          e.c4 = [...c4];
          if (e.tomasBase == null) e.tomasBase = e.tomas || 0;
          e.tomas = e.tomasBase + mas;
          c.push('equipos: ' + e.equipos.join(', '));
        }
        if (e.luz != null || e.tomas != null) z.eOk = true;
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
      if (tr.codigo) { const wc = G.TRABAJOS.find((t) => t.c === tr.codigo && (!tr.ambito || t.ambito === tr.ambito)); if (wc) return wc; }
      if (/(residu|escombr|contenedor)/.test(norm(tr.buscar || '') + ' ' + norm(tr.id || ''))) return G.TRABAJOS.find((t) => t.id === 'gen_residuos');
      if (tr.buscar) {
        const pal = (t) => norm(t.replace(/\(.*?\)/g, '')).split(' ').filter((x) => x.length > 3);
        const b = pal(tr.buscar);
        let mejor = null, nota = 0;
        G.TRABAJOS.filter((t) => t.ambito !== 'obra' && (!tr.ambito || t.ambito === tr.ambito) && (!tr.unidad || t.u === tr.unidad)).forEach((t) => {
          const l = pal(t.label); if (!l.length || !b.length) return;
          const comun = l.filter((x) => b.some((y) => y.slice(0, 5) === x.slice(0, 5))).length;
          const n = comun / Math.max(l.length, b.length);
          if (n > nota) { nota = n; mejor = t; }
        });
        if (mejor && nota >= 0.6) return mejor;
      }
      let d = tr.codigo && cat ? cat.byCode.get(tr.codigo) : null;
      if (!d && tr.buscar && cat && cat.index) {
        const ajeno = amb === 'interior' ? /CUBIERT|FACHAD|PISCIN|URBANIZ|JARDIN|CIMENTAC|ESTRUCTUR/i : amb === 'fachada' ? /CUBIERT|PISCIN|SOLADO|URBANIZ/i : amb === 'cubierta' ? /PISCIN|FACHAD|URBANIZ/i : /^$/;
        const res = cat.index.search(tr.buscar).filter((r) => (!tr.unidad || r.doc.u === tr.unidad) && !ajeno.test(r.doc.chapTitle || ''));
        if (res.length && res[0].s >= 0.6) d = res[0].doc;
      }
      const nuevo = (fn) => { const antes = new Set(Object.keys(this.g.sel || {})); const w2 = fn(); if (w2 && !antes.has(w2.id)) this.g.sel[w2.id] = { on: false, zonas: [] }; return w2; };
      if (d) return nuevo(() => G.anadirExtra(this.obra, d, amb));
      if (tr.buscar) {
        // Partida nueva: solo si tiene que ver con lo dicho y con el sitio (nada de «azotea» en un dormitorio)
        const b = norm(tr.buscar), dicho = this.textoN || '';
        const ajenaZona = amb === 'interior' && /(azotea|cubierta|tejado|fachada|piscina|faldon)/.test(b) && !/(azotea|cubierta|tejado|fachada|piscina|faldon)/.test(dicho);
        const algoDicho = b.split(' ').filter((x) => x.length > 4).some((x) => dicho.includes(x.slice(0, 5)));
        if (ajenaZona || (dicho && !algoDicho)) return null;
        const wp = nuevo(() => G.anadirPropia(this.obra, tr.buscar, tr.unidad || 'ud', amb, zonas.map((z) => z.id)));
        // Si es de suelo, paredes o techo se mide sola con la planta
        if (wp && amb === 'interior' && !(tr.medidas || []).length) {
          const r = wp.u === 'm2' ? (/(suelo|pavimento|solado|solera|embaldos|baldosa|tarima|parquet|recrecido|nivelac)/.test(b) ? 'suelo' : /(techo)/.test(b) ? 'techo' : /(pared|paramento|alicat|enfosc|yeso|guarnec|pintura|revest)/.test(b) ? 'paredes' : null) : wp.u === 'm' && /(rodapi|zocalo)/.test(b) ? 'rodapie' : null;
          if (r) wp.regla = r;
        }
        return wp;
      }
      return null;
    }
    /** Sanitarios o instalación pedidos como trabajos: se anotan en la fontanería de la estancia. */
    trabajoFontaneria(tr) {
      const MAP = { fon_ino: { inodoro: 'normal' }, fon_ino_sus: { inodoro: 'suspendido' }, fon_lavabo: { tipo: 'bano' }, fon_plato: { ducha: 'plato' }, fon_banera: { ducha: 'banera' }, fon_mampara: { mampara: true }, fon_bide: { bide: true }, fon_inst: {}, san_32: {}, san_40: {}, san_110: {} };
      const esInst = /^IFI0/.test(tr.codigo || '') || /^x_IFI0/.test(tr.id || '');
      if (!(tr.id in MAP) && !esInst) return null;
      const cur = this.toma.zonas.find((x) => x.id === this.g.cZona);
      const nom = (tr.zonas && tr.zonas[0]) || (cur && cur.nombre) || 'Baño';
      if (tr.quitar) {
        const z = this.toma.zonas.find((x) => x.ambito === 'fontaneria' && norm(x.nombre) === norm(nom));
        if (z && z.f) { const m = MAP[tr.id] || {}; Object.keys(m).forEach((k) => { if (k !== 'tipo') z.f[k] = k === 'inodoro' || k === 'ducha' ? null : false; }); }
        return { txt: '' };
      }
      const m = Object.assign({}, MAP[tr.id] || {});
      const r = this.aplicarZona({ ref: '', ambito: 'fontaneria', nombre: nom, tramos: [], huecos: [], faldones: [], fon_tipo: m.tipo || '' });
      const f = r.z.f || (r.z.f = {});
      if (m.inodoro) f.inodoro = m.inodoro; if (m.ducha) f.ducha = m.ducha;
      if (m.mampara) { f.mampara = true; if (!f.ducha) f.ducha = 'plato'; }
      if (m.bide) f.bide = true;
      return { txt: r.z.nombre };
    }
    aplicarTrabajo(tr) {
      const zs = this.toma.zonas;
      let zonas = (tr.zonas || []).map((nm) => zs.find((z) => norm(z.nombre) === norm(nm)) || zs.find((z) => norm(z.nombre).includes(norm(nm)) || norm(nm).includes(norm(z.nombre)))).filter(Boolean);
      let w = this.trabajoPara(tr, zonas);
      if (!w) return null;
      const g = this.g; g.sel = g.sel || {};
      // Trabajo de instalaciones dicho sobre una estancia: va a la fontanería/electricidad de esa estancia
      if (/^(fontaneria|electricidad)$/.test(w.ambito) && zonas.some((z) => z.ambito !== w.ambito)) {
        zonas = zonas.map((z) => (z.ambito === w.ambito ? z : zs.find((x) => x.ambito === w.ambito && norm(x.nombre) === norm(z.nombre)) || this.aplicarZona({ ref: '', ambito: w.ambito, nombre: z.nombre, tramos: [], huecos: [], faldones: [], equipos: [] }).z));
      }
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
      if (!s.on) { s.zonas = []; s.todas = false; } // recién marcado: no hereda las zonas por defecto
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
      const sel = G.seleccion(this.obra);
      // Si hay demoliciones, siempre hay residuos
      if (sel.gen_residuos && !sel.gen_residuos.on && G.trabajosPara(this.obra).some((w) => sel[w.id] && sel[w.id].on && /^(dem_|fon_dem|ele_dem)|demolic|levantad|desmont|picad/.test(w.id + ' ' + norm(w.label)))) sel.gen_residuos.on = true;
      (this.g.extra || []).forEach((x) => {
        const s = sel[x.id]; if (!s || !s.on || !x.c) return;
        G.TRABAJOS.filter((t) => t.c === x.c && sel[t.id] && sel[t.id].on).forEach((t) => { s.zonas = s.zonas.filter((z) => !sel[t.id].zonas.includes(z)); if (!s.zonas.length) s.on = false; });
      });
      let r = { partidas: 0, preguntas: [] };
      try { r = G.generar(this.obra, this.dlg.cat); } catch (e) { r = { partidas: 0, preguntas: [] }; }
      this.save();
      return r;
    }
    aplicar(out, text) {
      out = out || {};
      const g = this.g;
      if (out.accion === 'deshacer') {
        if (/\b(deshac|deshaz|atras|anula|borra|quita|elimina|equivocad|no era|no es)/.test(norm(text || ''))) return this.deshacer();
        out.accion = ''; // ruido o frase sin sentido: no se deshace nada
      }
      if (out.accion === 'guiado') { g.cLibre = false; return this.siguiente('Vale, te pregunto yo.'); }
      if (out.accion === 'pausa') { this.io.pause && this.io.pause(); return; }
      const hay = (out.zonas || []).length || (out.trabajos || []).length || out.contenedores || out.seguridad_pct;
      if (hay) this.snapshot();
      this.textoN = norm(text || ''); this.textoOrig = text || ''; this.textoRef = /(igual|mismo|misma|como el|como la|que el|que la)\b/.test(this.textoN);
      try { this.nums = this.textoLargo ? [] : G.numeros ? G.numeros(text || '') : []; } catch (e) { this.nums = []; }
      const antes = new Set(Object.entries(G.seleccion(this.obra)).filter(([, v]) => v.on).map(([k]) => k));
      const frases = [];
      this.sketch = null;
      const hechas = [];
      (out.zonas || []).slice(0, 12).forEach((zr) => { try { const r = this.aplicarZona(zr); if (r.txt) hechas.push(r); } catch (e) { /* zona mal formada: se ignora */ } });
      // «Anoto baño.» sobra si en la misma respuesta se dicen datos del baño
      hechas.forEach((r) => { if (/^Anoto /.test(r.txt) && hechas.some((o) => o !== r && norm(o.z.nombre) === norm(r.z.nombre) && !/^Anoto /.test(o.txt))) return; frases.push(r.txt); });
      const puestos = [], quitados = [], fon = new Set();
      const pideQuitar = this.textoLargo || /\b(quita|quitar|quitalo|quitala|elimina|eliminar|borra|borrar|no se hace|no hace falta|no hay que|sin|descarta|fuera|cambia|cambiar|en lugar|en vez|mejor|sustituye|no es|no son|no lleva|tampoco)\b/.test(this.textoN);
      (out.trabajos || []).slice(0, 20).forEach((tr) => {
        try {
          if (tr.quitar && !pideQuitar) return; // la IA no puede quitar lo que el usuario no ha pedido quitar
          const rf = this.trabajoFontaneria(tr); if (rf) { if (rf.txt) fon.add(rf.txt); return; }
          const r = this.aplicarTrabajo(tr); if (!r) return;
          if (r.quitado || !antes.has(r.w.id)) (r.quitado ? quitados : puestos).push(r.w.label.replace(/\s*\(.*?\)\s*$/, '').toLowerCase());
          if (!r.quitado) (r.zonas || []).forEach((z) => { z.trabajosOk = true; });
        } catch (e) { /* trabajo mal formado */ }
      });
      if (ok(out.contenedores)) { g.contenedores = Math.round(out.contenedores); g.contenedoresOk = true; frases.push(g.contenedores + ' ' + plural(g.contenedores, 'contenedor', 'contenedores') + ' de residuos.'); }
      if (ok(out.seguridad_pct) && out.seguridad_pct < 20) { g.sysPct = out.seguridad_pct; frases.push('Seguridad y salud al ' + fmt(out.seguridad_pct, 1).replace(/,0$/, '') + ' por ciento.'); }
      fon.forEach((nom) => { const z = this.toma.zonas.find((x) => x.ambito === 'fontaneria' && x.nombre === nom); if (z && !frases.some((f) => f.startsWith(nom + ': fontanería'))) frases.push(this.aplicarZona({ ref: z.id, ambito: 'fontaneria', nombre: nom, tramos: [], huecos: [], faldones: [] }).txt); });
      // Cambio de idea («mejor que sea…», «en lugar de…»): si la IA no quitó el anterior, se quita el parecido anotado hace poco
      const cambio = /(en lugar de|en vez de|mejor que sea|mejor una|mejor un|no hace falta que sea|me lo he pensado|cambialo por|cambiala por|sustituye|basta (con|que sea))/.test(this.textoN);
      const sel2 = G.seleccion(this.obra), recientes = (g.cRecientes || []).flat();
      const nuevos = Object.entries(sel2).filter(([k, v]) => v.on && !antes.has(k)).map(([k]) => k);
      if (cambio && !quitados.length && nuevos.length) {
        const todos = G.trabajosPara(this.obra);
        nuevos.forEach((idN) => {
          const wn = todos.find((w) => w.id === idN); if (!wn) return;
          // Familia del trabajo: soleras, bases y recrecidos son intercambiables; si no, la primera palabra
          const tipo = (w) => { const l = norm(w.label); return /^(solera|base|recrecido|nivelac|autonivel|mortero de nivel)/.test(l) ? 'base' : /^(enfoscado|guarnecido|revoco|enlucido)/.test(l) ? 'revest' : l.split(' ')[0].slice(0, 5); };
          todos.filter((w) => w.id !== idN && antes.has(w.id) && recientes.includes(w.id) && w.ambito === wn.ambito && w.u === wn.u && w.regla === wn.regla && tipo(w) === tipo(wn) && sel2[w.id].zonas.some((z) => sel2[idN].zonas.includes(z))).forEach((w) => {
            sel2[w.id].zonas = sel2[w.id].zonas.filter((z) => !sel2[idN].zonas.includes(z)); sel2[w.id].todas = false;
            if (!sel2[w.id].zonas.length) sel2[w.id].on = false;
            quitados.push(w.label.replace(/\s*\(.*?\)\s*$/, '').toLowerCase());
          });
        });
      }
      // «Picar las paredes»: una sola demolición de revestimiento, la que corresponde al nuevo
      const dosDem = nuevos.includes('dem_enfosc') && nuevos.includes('dem_yeso') && !(/enfoscad/.test(this.textoN) && /yeso|guarnec/.test(this.textoN.replace(/(poner|pondremos|volver a hacer|nuevo|nueva)[^,.]*(yeso|guarnec)\w*/g, '')));
      if (dosDem) {
        const quita = sel2.rev_enfosc && sel2.rev_enfosc.on && !(sel2.rev_yeso && sel2.rev_yeso.on) ? 'dem_yeso' : 'dem_enfosc';
        sel2[quita].on = false; nuevos.splice(nuevos.indexOf(quita), 1);
        const i = puestos.indexOf((G.TRABAJOS.find((w) => w.id === quita) || {}).label.toLowerCase()); if (i >= 0) puestos.splice(i, 1);
      }
      g.cRecientes = (g.cRecientes || []).concat([nuevos]).slice(-4);
      let voz = null;
      if (puestos.length) { frases.push('Apunto ' + lista(puestos) + '.'); if (puestos.length > 2) voz = 'Apunto ' + puestos.length + ' trabajos.'; }
      if (quitados.length) { frases.push('Quito ' + lista(quitados) + '.'); if (voz) voz += ' Quito ' + lista(quitados) + '.'; }
      const vozDe = (t) => (voz ? t.replace('Apunto ' + lista(puestos) + '.', voz.replace(/ Quito .*$/, '')) : t);
      g.contenedoresOk = g.contenedoresOk || false;
      const r = hay || out.accion === 'generar' ? this.regenerar() : null;
      if (this.sketch && this.sketch.planta && this.io.sketch) this.io.sketch(plantaSVG(this.sketch.planta), 'Planta ' + this.sketch.nombre);
      // Lo que dice: lo anotado (fiable, sale de los datos) + el mensaje de la IA + su pregunta
      let txt = frases.join(' ');
      const msg = (out.mensaje || '').trim();
      if (msg && (!txt || !/\d/.test(msg))) txt = (txt ? txt + ' ' : '') + msg;
      // Si preguntaba algo y la IA no ha contestado, contesta la app con lo anotado
      if (!hay && !msg && !(out.pregunta || '').trim() && /^(y )?(como|cuanto|cuantos|cuantas|que|cuales|donde|dime)\b/.test(this.textoN)) return this.responderConsulta(text, this.textoN);
      let preg = (out.pregunta || '').trim();
      if (out.accion === 'generar' && this.guiado) { g.cFin = true; return this.siguiente(txt); }
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
      if (this.guiado && out.accion !== 'generar') {
        this.marcarPaso(out, text);
        // El foco sigue en la zona que se estaba midiendo, salvo que el usuario cambie de sitio
        const P = g.cPaso, cambiaSitio = /^(vamos|pasamos|ahora|seguimos|empezamos|nos vamos|vamonos)\b/.test(this.textoN) || (P && /^(inicio|nueva|mas)$/.test(P.campo));
        if (cambiaSitio && g.cZona) g.cFoco = g.cZona;
        // La IA solo pregunta si algo es ambiguo; si no, pregunta la app lo siguiente
        if (preg && !hay) return this.ask((txt && txt !== 'Vale.' ? txt + ' ' : '') + preg, this.chips(out.opciones));
        const pre = txt && !/^(vale|anotado)\.?$/i.test(txt) ? txt : '';
        return this.siguiente(pre, { avanza: !!hay, vozPre: pre ? vozDe(pre) : '' });
      }
      this.save();
      if (preg) return this.ask((txt ? txt + ' ' : '') + preg, this.chips(out.opciones), { voz: vozDe((txt ? txt + ' ' : '') + preg) });
      if (!txt) txt = hay ? 'Anotado.' : 'Vale.';
      return this.ask(txt, this.chips(out.opciones), { voz: vozDe(txt) });
    }
    aGuiado() {
      this.obra.modo = 'guiado';
      this.save();
      const gu = this.dlg.guia; if (!gu) return;
      if (this.toma.zonas.length) { gu.g.fin = false; return gu.say('mas_zona', {}, 'Vale, te pregunto yo. Lo anotado se queda.'); }
      this.obra.ambito = null; return gu.start('Vale, te pregunto yo.');
    }
  }
  const near = (a, b) => Math.abs(a - b) < 0.011;
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
