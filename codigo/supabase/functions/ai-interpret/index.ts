// ============================================================
// Mediciona · IA de respaldo
// POST { frase, motivo, estancia, activa, rechazadas, historial, candidatas }
// Solo usuarios con sesión. Límite diario por usuario. El prompt se
// construye aquí (no se acepta texto libre del cliente como prompt).
// Secretos: GEMINI_API_KEY. Opcionales: AI_MODEL, AI_LIMITE_DIA.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0';
import '../_shared/engine-shim.js';
import './ai-core.js';
import './conversa-core.js';
import './trabajos.js';
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
    obra_id: s(b?.obra_id, 60), frase: s(b?.frase, 600), estancia: s(b?.estancia, 80), altura: num(b?.altura), pendiente: s(b?.pendiente, 600), planta: s(b?.planta, 500),
    activa: saneaPartida(b?.activa, 60),
    otras: (Array.isArray(b?.otras) ? b.otras.slice(0, 6) : []).map((p: any) => saneaPartida(p, 15)).filter(Boolean),
    resto: (Array.isArray(b?.resto) ? b.resto.slice(0, 30) : []).map((x: unknown) => s(x, 200)),
    historial: Array.isArray(b?.historial) ? b.historial.slice(-8).map((m: any) => ({ who: m?.who === 'user' ? 'user' : 'app', text: s(m?.text, 500) })) : [],
    candidatas: (Array.isArray(b?.candidatas) ? b.candidatas.slice(0, 60) : []).map((d: any) => ({ c: s(d?.c, 40), u: s(d?.u, 8), r: s(d?.r, 300), path: s(d?.path, 200) })).filter((d: any) => d.c && d.r)
  };
}
// ---------- Claude (Anthropic) ----------
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-5-5';
const CLAUDE_KEY = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('anthroic-api-key') || Deno.env.get('anthropic-api-key') || '';
const anthropic = CLAUDE_KEY ? new Anthropic({ apiKey: CLAUDE_KEY, timeout: 25000, maxRetries: 1 }) : null;
/** El esquema JSON de la app usa "type: [x, 'null']"; para Claude lo expresamos con anyOf. */
function paraClaude(sch: any): any {
  if (Array.isArray(sch)) return sch.map(paraClaude);
  if (!sch || typeof sch !== 'object') return sch;
  const o: any = {};
  for (const [k, v] of Object.entries(sch)) o[k] = (k === 'properties' && v && typeof v === 'object') ? Object.fromEntries(Object.entries(v as any).map(([pk, pv]) => [pk, paraClaude(pv)])) : (k === 'items' ? paraClaude(v) : v);
  // Claude limita los campos opcionales (uniones): sin "null"; vacío = "" en textos y 0 en números
  if (Array.isArray(o.type) && o.type.includes('null')) {
    o.type = o.type.filter((t: string) => t !== 'null')[0];
    if (Array.isArray(o.enum)) o.enum = o.enum.map((x: unknown) => (x === null ? '' : x));
  }
  return o;
}
/** Deshace la convención anterior: "" y 0 vuelven a ser null. */
function normalizaClaude(out: any) {
  const N = (v: unknown) => (v === '' || v === 0 ? null : v);
  for (const a of out?.acciones || []) {
    for (const k of ['codigo', 'descripcion', 'unidad', 'orientacion', 'desde', 'estancia', 'texto', 'altura', 'linea']) a[k] = N(a[k]);
    if (a.campos) { for (const k of Object.keys(a.campos)) a.campos[k] = N(a.campos[k]); if (Object.values(a.campos).every((v) => v == null)) a.campos = null; }
    for (const l of a.lineas_nuevas || []) for (const k of ['comentario', 'uds', 'largo', 'ancho', 'alto']) l[k] = N(l[k]);
  }
  if (out && out.pregunta === '') out.pregunta = null;
  return out;
}
const ESQUEMA_AGENTE_CLAUDE = paraClaude(AI.AGENT_SCHEMA);
let ultimoErrorClaude = '';
// ---------- Modo conversación ----------
const CONV = (globalThis as any).ConvAI;
const CONV_SYSTEM = CONV.convSystem((globalThis as any).MEDICIONA_TRABAJOS || []);
function saneaConversa(b: any) {
  return {
    obra_id: s(b?.obra_id, 60), frase: s(b?.frase, 600), zona: s(b?.zona, 80), esperando: s(b?.esperando, 300),
    zonas: (Array.isArray(b?.zonas) ? b.zonas.slice(0, 60) : []).map((z: any) => ({ ref: s(z?.ref, 20), ambito: s(z?.ambito, 20), nombre: s(z?.nombre, 60), datos: s(z?.datos, 400) })),
    trabajos: (Array.isArray(b?.trabajos) ? b.trabajos.slice(0, 80) : []).map((w: any) => ({ id: s(w?.id, 60), codigo: s(w?.codigo, 40), label: s(w?.label, 200), zonas: (Array.isArray(w?.zonas) ? w.zonas.slice(0, 30) : []).map((x: unknown) => s(x, 60)) })),
    faltan: (Array.isArray(b?.faltan) ? b.faltan.slice(0, 10) : []).map((x: unknown) => s(x, 200)),
    historial: Array.isArray(b?.historial) ? b.historial.slice(-10).map((m: any) => ({ who: m?.who === 'user' ? 'user' : 'app', text: s(m?.text, 400) })) : [],
    candidatas: (Array.isArray(b?.candidatas) ? b.candidatas.slice(0, 30) : []).map((d: any) => ({ c: s(d?.c, 40), u: s(d?.u, 8), r: s(d?.r, 300) })).filter((d: any) => d.c && d.r)
  };
}
async function conversaClaude(ctx: any): Promise<{ out: any; tin: number; tout: number; modelo: string } | null> {
  if (!anthropic) { ultimoErrorClaude = 'sin clave de Anthropic'; return null; }
  try {
    const r = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: CONV_SYSTEM, cache_control: { type: 'ephemeral' } }],
      // Respuesta en JSON compacto (solo los campos con valor); sin esquema estricto, que era demasiado grande
      messages: [{ role: 'user', content: CONV.buildConvUser(ctx) }],
      output_config: { effort: 'low' }
    } as any);
    if (r.stop_reason === 'refusal') { ultimoErrorClaude = 'stop_reason ' + r.stop_reason; return null; }
    const txt = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const out = CONV.normaliza(txt);
    if (!out) { ultimoErrorClaude = 'respuesta no JSON: ' + txt.slice(0, 120); return null; }
    return { out, tin: r.usage?.input_tokens || 0, tout: r.usage?.output_tokens || 0, modelo: CLAUDE_MODEL };
  } catch (e) {
    ultimoErrorClaude = e instanceof Anthropic.APIError ? e.status + ' ' + e.message : String(e);
    console.error('Claude (conversa) no disponible:', ultimoErrorClaude);
    return null;
  }
}
async function agenteClaude(actx: any): Promise<{ out: any; tin: number; tout: number; modelo: string } | null> {
  if (!anthropic) { ultimoErrorClaude = 'sin clave de Anthropic'; return null; }
  try {
    const r = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      // Sin razonamiento previo (responde antes) e instrucciones fijas en caché
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: AI.AGENT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: AI.buildAgentUser(actx) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_AGENTE_CLAUDE } }
    } as any);
    if (r.stop_reason === 'refusal' || r.stop_reason === 'max_tokens') { ultimoErrorClaude = 'stop_reason ' + r.stop_reason; return null; }
    const txt = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const out = normalizaClaude(JSON.parse(txt));
    return { out, tin: r.usage?.input_tokens || 0, tout: r.usage?.output_tokens || 0, modelo: CLAUDE_MODEL };
  } catch (e) {
    ultimoErrorClaude = e instanceof Anthropic.APIError ? e.status + ' ' + e.message : String(e);
    console.error('Claude no disponible:', ultimoErrorClaude);
    return null;
  }
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
  const cuerpo = req.json().catch(() => undefined);
  const { data: { user } } = await usuario.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Inicia sesión para usar la IA' }), { status: 401, headers: h });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ data: esAdmin }, { count: usadas }] = await Promise.all([
    admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle(),
    admin.from('ia_uso').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('creado', desde)
  ]);
  const count = esAdmin ? 0 : usadas;
  if ((count || 0) >= LIMITE) return new Response(JSON.stringify({ error: 'Has llegado al límite diario de consultas a la IA' }), { status: 429, headers: h });

  let raw: any;
  raw = await cuerpo; if (raw === undefined) { return new Response(JSON.stringify({ error: 'Petición no válida' }), { status: 400, headers: h }); }
  if (raw?.modo === 'conversa') {
    const cctx = saneaConversa(raw);
    if (!cctx.frase) return new Response(JSON.stringify({ error: 'Falta la frase' }), { status: 400, headers: h });
    const t0 = Date.now();
    let res = await conversaClaude(cctx);
    if (!res) {
      // Reserva: Gemini con el mismo formato
      for (const m of MODELOS_AGENTE) {
        const r = await llamar({ model: m, temperature: 0, messages: [{ role: 'system', content: CONV_SYSTEM }, { role: 'user', content: CONV.buildConvUser(cctx) }], response_format: { type: 'json_object' } });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        const out = CONV.normaliza(j?.choices?.[0]?.message?.content);
        if (out) { res = { out, tin: j.usage?.prompt_tokens || 0, tout: j.usage?.completion_tokens || 0, modelo: m }; break; }
      }
    }
    if (!res) return new Response(JSON.stringify({ error: 'La IA no está disponible ahora mismo' }), { status: 502, headers: h });
    const ms = Date.now() - t0, c = res;
    const registro = (async () => {
      const { data: precio } = await admin.from('ia_precios').select('entrada_usd_millon, salida_usd_millon').eq('modelo', c.modelo).maybeSingle();
      const coste = precio ? (c.tin * Number(precio.entrada_usd_millon) + c.tout * Number(precio.salida_usd_millon)) / 1e6 : null;
      await admin.from('ia_uso').insert({ user_id: user.id, obra_id: cctx.obra_id || null, modelo: c.modelo, tokens_entrada: c.tin, tokens_salida: c.tout, coste_usd: coste, ms, intent: 'conversa' });
    })();
    const ER = (globalThis as any).EdgeRuntime;
    if (ER && ER.waitUntil) ER.waitUntil(registro); else await registro;
    return new Response(JSON.stringify({ result: c.out, modelo: c.modelo, ms, ...(esAdmin && c.modelo !== CLAUDE_MODEL ? { aviso_claude: ultimoErrorClaude } : {}) }), { headers: h });
  }
  if (raw?.modo === 'agente') {
    const actx = saneaAgente(raw);
    if (!actx.frase) return new Response(JSON.stringify({ error: 'Falta la frase' }), { status: 400, headers: h });
    const t0 = Date.now();
    // 1º Claude; si no responde, Gemini como reserva
    const c = await agenteClaude(actx);
    if (c) {
      const ms = Date.now() - t0;
      // El registro de coste se hace después de responder: no hace esperar al usuario
      const registro = (async () => {
        const { data: precioC } = await admin.from('ia_precios').select('entrada_usd_millon, salida_usd_millon').eq('modelo', c.modelo).maybeSingle();
        const costeC = precioC ? (c.tin * Number(precioC.entrada_usd_millon) + c.tout * Number(precioC.salida_usd_millon)) / 1e6 : null;
        await admin.from('ia_uso').insert({ user_id: user.id, obra_id: actx.obra_id || null, modelo: c.modelo, tokens_entrada: c.tin, tokens_salida: c.tout, coste_usd: costeC, ms, intent: 'agente' });
      })();
      const ER = (globalThis as any).EdgeRuntime;
      if (ER && ER.waitUntil) ER.waitUntil(registro); else await registro;
      return new Response(JSON.stringify({ result: c.out, usage: { prompt_tokens: c.tin, completion_tokens: c.tout }, modelo: c.modelo }), { headers: h });
    }
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
    return new Response(JSON.stringify({ result: out, usage: j.usage, modelo: usado, ...(esAdmin ? { aviso_claude: ultimoErrorClaude } : {}) }), { headers: h });
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
