/* ============================================================
 * CLOUD — conexión con el servidor (Supabase)
 *  - Cuentas (correo + contraseña; perfil profesional)
 *  - Copia de las obras en la nube (sin conexión sigue funcionando:
 *    se sincroniza al volver la red; gana la versión más reciente)
 *  - IA de respaldo (función ai-interpret)
 *  - Buzón de sugerencias y panel de administración
 * ============================================================ */
(function (root) {
  'use strict';
  const CFG = root.MEDICIONA_CLOUD || null;
  let sb = null, user = null, perfil = null, admin = false;
  const listeners = [];
  const pending = new Map(); // obras pendientes de subir
  let flushTimer = null;

  function available() { return !!(CFG && root.supabase && root.supabase.createClient); }
  function init() {
    if (!available() || sb) return !!sb;
    sb = root.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mediciona-auth' } });
    sb.auth.onAuthStateChange(async (ev, session) => {
      const was = user && user.id;
      user = session ? session.user : null;
      if (!user) { perfil = null; admin = false; }
      if (user && user.id !== was) await loadProfile();
      listeners.forEach((f) => { try { f(ev, user); } catch (e) {} });
    });
    window.addEventListener('online', () => flush());
    return true;
  }
  async function loadProfile() {
    if (!user) return null;
    try {
      const { data } = await sb.from('perfiles').select('*').eq('id', user.id).maybeSingle();
      perfil = data || null;
      const a = await sb.from('admins').select('user_id').eq('user_id', user.id);
      admin = !!(a.data && a.data.length);
    } catch (e) { /* sin conexión */ }
    return perfil;
  }
  const errMsg = (e) => {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/Email not confirmed/i.test(m)) return 'Tienes que confirmar tu correo: busca un mensaje de Mediciona con el asunto «Confirma tu cuenta de Mediciona», también en Spam o Promociones.';
    if (/already registered|already been registered/i.test(m)) return 'Ya existe una cuenta con ese correo. Prueba a entrar o a recuperar la contraseña.';
    if (/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
    if (/rate limit/i.test(m)) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No hay conexión con el servidor. Comprueba tu cobertura.';
    return m;
  };

  /* ---------------- Cuentas ---------------- */
  async function signUp({ email, password, nombre, empresa, nif }) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nombre, empresa, nif }, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(errMsg(error));
    return { needsConfirm: !data.session };
  }
  async function resendConfirmation(email) {
    const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(errMsg(error));
  }
  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(errMsg(error));
  }
  async function signOut() { await sb.auth.signOut(); }
  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw new Error(errMsg(error));
  }
  async function updatePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(errMsg(error));
  }
  async function updateProfile(f) {
    const { error } = await sb.from('perfiles').update({ nombre: f.nombre, empresa: f.empresa, nif: f.nif, actualizado: new Date().toISOString() }).eq('id', user.id);
    if (error) throw new Error(errMsg(error));
    await loadProfile();
  }

  /* ---------------- Obras ---------------- */
  const stamp = (o) => o.updated || o.created || 0;
  /** Sincroniza: baja las de la nube, sube las locales más nuevas. Devuelve la lista combinada. */
  async function syncObras(local) {
    if (!user) return local;
    const { data, error } = await sb.from('obras').select('id, datos, actualizada, desbloqueada, borrada').eq('user_id', user.id);
    if (error) throw new Error(errMsg(error));
    const remote = new Map((data || []).map((r) => [r.id, r]));
    const out = [];
    const seen = new Set();
    for (const o of local) {
      if (o.ejemplo) { out.push(o); continue; }
      if (o.owner && o.owner !== user.id) continue; // obra de otra cuenta en este dispositivo: ni se sube ni se muestra
      if (!o.owner) o.owner = user.id; // obra hecha sin cuenta: pasa a esta cuenta
      seen.add(o.id);
      const r = remote.get(o.id);
      if (!r) { queue(o); out.push(o); continue; }
      if (r.borrada) continue;
      const rTime = new Date(r.actualizada).getTime();
      const ro = Object.assign({}, r.datos, { unlocked: r.desbloqueada || r.datos.unlocked });
      if (rTime > stamp(o) + 1000) out.push(ro); else { if (stamp(o) > rTime + 1000) queue(o); out.push(Object.assign(o, { unlocked: r.desbloqueada || o.unlocked })); }
    }
    for (const [id, r] of remote) if (!seen.has(id) && !r.borrada) out.push(Object.assign({}, r.datos, { unlocked: r.desbloqueada, owner: user.id }));
    await flush();
    return out;
  }
  function queue(obra) {
    if (!user || !obra || obra.ejemplo) return;
    pending.set(obra.id, JSON.parse(JSON.stringify(obra)));
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 2500);
  }
  async function flush() {
    if (!user || !pending.size) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    for (const [id, o] of [...pending]) {
      const row = { titulo: (o.titulo || '').slice(0, 200), datos: o, actualizada: new Date(stamp(o) || Date.now()).toISOString() };
      try {
        const up = await sb.from('obras').update(row).eq('id', id).select('id');
        if (up.error) throw up.error;
        if (!up.data || !up.data.length) {
          const ins = await sb.from('obras').insert(Object.assign({ id, user_id: user.id, creada: new Date(o.created || Date.now()).toISOString() }, row));
          if (ins.error) throw ins.error;
        }
        pending.delete(id);
      } catch (e) { break; /* se reintenta con la próxima modificación o al volver la red */ }
    }
    return pending.size === 0;
  }
  async function deleteObra(id) {
    pending.delete(id);
    if (!user) return;
    try { await sb.from('obras').update({ borrada: true, actualizada: new Date().toISOString() }).eq('id', id); } catch (e) {}
  }

  /* ---------------- IA ---------------- */
  async function ai(ctx) {
    if (!user) throw new Error('sin sesión');
    const { data, error } = await sb.functions.invoke('ai-interpret', { body: ctx });
    if (error) throw new Error(errMsg(error));
    return data;
  }

  async function agent(ctx) {
    if (!user) throw new Error('sin sesión');
    const { data, error } = await sb.functions.invoke('ai-interpret', { body: Object.assign({ modo: 'agente' }, ctx) });
    if (error) throw new Error(errMsg(error));
    return data;
  }
  /* ---------------- Envío de archivos al correo ---------------- */
  async function sendFiles(body) {
    if (!user) throw new Error('Entra en tu cuenta para enviar archivos.');
    const { data, error } = await sb.functions.invoke('enviar-archivos', { body });
    if (error) {
      let msg = errMsg(error);
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return data || {};
  }
  /* ---------------- Sugerencias ---------------- */
  async function suggestion(s) {
    const { error } = await sb.from('sugerencias').insert({ user_id: user.id, tipo: s.tipo, mensaje: s.mensaje, conversacion: s.conversacion || null, dispositivo: (s.dispositivo || '').slice(0, 300) });
    if (error) throw new Error(errMsg(error));
  }

  /* ---------------- Administración ---------------- */
  async function adminData() {
    const desde = new Date(Date.now() - 30 * 864e5).toISOString();
    const [u, s, i, io, it, ip] = await Promise.all([
      sb.rpc('admin_usuarios'),
      sb.from('sugerencias').select('*').order('creada', { ascending: false }).limit(200),
      sb.from('ia_uso').select('user_id, modelo, tokens_entrada, tokens_salida, ms, intent, creado').gte('creado', desde).order('creado', { ascending: false }).limit(5000),
      sb.rpc('admin_ia_obras'),
      sb.rpc('admin_ia_totales'),
      sb.from('ia_precios').select('*')
    ]);
    if (u.error) throw new Error(errMsg(u.error));
    return { usuarios: u.data || [], sugerencias: s.data || [], ia: i.data || [], iaObras: io.data || [], iaTotales: it.data || [], precios: ip.data || [] };
  }
  async function newSuggestions() {
    if (!admin) return 0;
    const { count } = await sb.from('sugerencias').select('id', { count: 'exact', head: true }).eq('estado', 'nueva');
    return count || 0;
  }
  async function savePrice(modelo, entrada, salida) {
    const { error } = await sb.from('ia_precios').upsert({ modelo, entrada_usd_millon: entrada, salida_usd_millon: salida, actualizado: new Date().toISOString() });
    if (error) throw new Error(errMsg(error));
  }
  async function setSuggestionState(id, estado) {
    const { error } = await sb.from('sugerencias').update({ estado }).eq('id', id);
    if (error) throw new Error(errMsg(error));
  }

  root.Cloud = {
    available, init, onAuth: (f) => listeners.push(f),
    get user() { return user; }, get perfil() { return perfil; }, get isAdmin() { return admin; },
    signUp, resendConfirmation, signIn, signOut, resetPassword, updatePassword, updateProfile, loadProfile,
    get pendingCount() { return pending.size; },
    syncObras, queue, flush, deleteObra, ai, agent, sendFiles, suggestion, adminData, setSuggestionState, savePrice, newSuggestions
  };
})(typeof self !== 'undefined' ? self : this);
