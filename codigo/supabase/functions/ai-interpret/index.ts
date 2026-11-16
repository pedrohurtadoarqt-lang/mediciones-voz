// ============================================================
// Mediciona · IA de respaldo
// POST { frase, motivo, estancia, activa, rechazadas, historial, candidatas }
// Solo usuarios con sesión. Límite diario por usuario. El prompt se
// construye aquí (no se acepta texto libre del cliente como prompt).
// Secretos: GEMINI_API_KEY. Opcionales: AI_MODEL, AI_LIMITE_DIA.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import '../_shared/engine-shim.js';
import './ai-core.js';
import { cors } from '../_shared/cors.ts';

const AI = (globalThis as any).AI;
const MODEL = Deno.env.get('AI_MODEL') || 'gemini-flash-lite-latest';
// Modo agente: modelo que razona mejor, con alternativas si está saturado
const MODELOS_AGENTE = (Deno.env.get('AI_MODELOS_AGENTE') || 'gemini-flash-latest,gemini-3.8-flash,gemini-flash-lite-latest').split(',').map((x) => x.trim()).filter(Boolean);
const LIMITE = Number(Deno.env.get('AI_LIMITE_DIA') || '300');
const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
function saneaPartida(p: any, maxL: number) {
  if (!p || typeof p !== 'object') return null;
  return {
    ref: s(p.ref, 40), r: s(p.r, 300), u: s(p.u, 8), orient: s(p.orient, 2), total: num(p.total),
    lineas: (Array.isArray(p.lineas) ? p.lineas : []).slice(-maxL).map((l: any) => ({ est: s(l?.est, 60), com: s(l?.com, 120), uds: num(l?.uds), l: num(l?.l), a: num(l?.a), h: num(l?.h), hPend: !!l?.hPend, p: num(l?.p) }))
  };
}
function saneaAgente(b: any) {
  return {
    obra_id: s(b?.obra_id, 60), frase: s(b?.frase, 600), estancia: s(b?.estancia, 80), altura: num(b?.altura), pendiente: s(b?.pendiente, 600),
    activa: saneaPartida(b?.activa, 60),
    otras: (Array.isArray(b?.otras) ? b.otras.slice(0, 6) : []).map((p: any) => saneaPartida(p, 15)).filter(Boolean),
    resto: (Array.isArray(b?.resto) ? b.resto.slice(0, 30) : []).map((x: unknown) => s(x, 200)),
    historial: Array.isArray(b?.historial) ? b.historial.slice(-8).map((m: any) => ({ who: m?.who === 'user' ? 'user' : 'app', text: s(m?.text, 500) })) : [],
    candidatas: (Array.isArray(b?.candidatas) ? b.candidatas.slice(0, 60) : []).map((d: any) => ({ c: s(d?.c, 40), u: s(d?.u, 8), r: s(d?.r, 300), path: s(d?.path, 200) })).filter((d: any) => d.c && d.r)
  };
}
async function llamar(body: unknown) {
  return await fetch(URL_GEMINI, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('GEMINI_API_KEY') }, body: JSON.stringify(body) });
}
function sanea(b: any) {
  const cand = Array.isArray(b?.candidatas) ? b.candidatas.slice(0, 80) : [];
  return {
    obra_id: s(b?.obra_id, 60),
    frase: s(b?.frase, 500),
    motivo: s(b?.motivo, 200),
    estancia: s(b?.estancia, 80),
    activa: b?.activa ? { ref: s(b.activa.ref, 40), r: s(b.activa.r, 300), u: s(b.activa.u, 8) } : null,
    rechazadas: Array.isArray(b?.rechazadas) ? b.rechazadas.slice(0, 20).map((x: unknown) => s(x, 40)) : [],
    historial: Array.isArray(b?.historial) ? b.historial.slice(-6).map((m: any) => ({ who: m?.who === 'user' ? 'user' : 'app', text: s(m?.text, 400) })) : [],
    candidatas: cand.map((d: any) => ({ c: s(d?.c, 40), u: s(d?.u, 8), r: s(d?.r, 300), path: s(d?.path, 200) })).filter((d: any) => d.c && d.r)
  };
}

Deno.serve(async (req) => {
  const h = { ...cors(req), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: h });

  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') || '';
  const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await usuario.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Inicia sesión para usar la IA' }), { status: 401, headers: h });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: esAdmin } = await admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = esAdmin ? { count: 0 } : await admin.from('ia_uso').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('creado', desde);
  if ((count || 0) >= LIMITE) return new Response(JSON.stringify({ error: 'Has llegado al límite diario de consultas a la IA' }), { status: 429, headers: h });

  let raw: any;
  try { raw = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Petición no válida' }), { status: 400, headers: h }); }
  if (raw?.modo === 'agente') {
    const actx = saneaAgente(raw);
    if (!actx.frase) return new Response(JSON.stringify({ error: 'Falta la frase' }), { status: 400, headers: h });
    const t0 = Date.now();
    let j: any = null, usado = '';
    for (const m of MODELOS_AGENTE) {
      const r = await llamar(AI.agentRequestBody(actx, m));
      if (r.ok) { j = await r.json().catch(() => null); if (j?.choices?.[0]) { usado = m; break; } }
      // cualquier error (saturado, cuota, modelo retirado…) → probar el siguiente modelo
    }
    if (!j?.choices?.[0]) return new Response(JSON.stringify({ error: 'La IA no está disponible ahora mismo' }), { status: 502, headers: h });
    let out: any = null;
    try { out = JSON.parse(j.choices[0].message.content); } catch { /* no JSON */ }
    const tin = j.usage?.prompt_tokens || 0, tout = j.usage?.completion_tokens || 0;
    const { data: precio } = await admin.from('ia_precios').select('entrada_usd_millon, salida_usd_millon').eq('modelo', usado).maybeSingle();
    const coste = precio ? (tin * Number(precio.entrada_usd_millon) + tout * Number(precio.salida_usd_millon)) / 1e6 : null;
    await admin.from('ia_uso').insert({ user_id: user.id, obra_id: actx.obra_id || null, modelo: usado, tokens_entrada: tin, tokens_salida: tout, coste_usd: coste, ms: Date.now() - t0, intent: 'agente' });
    return new Response(JSON.stringify({ result: out, usage: j.usage, modelo: usado }), { headers: h });
  }
  let ctx;
  try { ctx = sanea(raw); } catch { return new Response(JSON.stringify({ error: 'Petición no válida' }), { status: 400, headers: h }); }
  if (!ctx.frase) return new Response(JSON.stringify({ error: 'Falta la frase' }), { status: 400, headers: h });

  const t0 = Date.now();
  const r = await fetch(URL_GEMINI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('GEMINI_API_KEY') },
    body: JSON.stringify(AI.requestBody(ctx, MODEL))
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.choices?.[0]) return new Response(JSON.stringify({ error: 'La IA no está disponible ahora mismo', detalle: r.status }), { status: 502, headers: h });
  let out = null;
  try { out = JSON.parse(j.choices[0].message.content); } catch { /* respuesta no JSON */ }
  const res = AI.validate(out, ctx);
  const tin = j.usage?.prompt_tokens || 0, tout = j.usage?.completion_tokens || 0;
  const { data: precio } = await admin.from('ia_precios').select('entrada_usd_millon, salida_usd_millon').eq('modelo', MODEL).maybeSingle();
  const coste = precio ? (tin * Number(precio.entrada_usd_millon) + tout * Number(precio.salida_usd_millon)) / 1e6 : null;
  await admin.from('ia_uso').insert({ user_id: user.id, obra_id: ctx.obra_id || null, modelo: MODEL, tokens_entrada: tin, tokens_salida: tout, coste_usd: coste, ms: Date.now() - t0, intent: res.intent });
  return new Response(JSON.stringify({ result: res, usage: j.usage, modelo: MODEL }), { headers: h });
});
