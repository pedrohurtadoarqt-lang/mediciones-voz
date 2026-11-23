// ============================================================
// Mediciona · Nota de audio de la visita
// POST { modo: 'transcribir', audio (base64), mime }       → { texto }
// POST { modo: 'procesar', transcripcion, zonas, trabajos } → { result } (mismo formato que el modo conversación)
// Solo usuarios con sesión. Secretos: GEMINI_API_KEY, ANTHROPIC_API_KEY.
// Opcionales: VISITA_MODELO (Claude), TRANSCRIBE_MODELOS (Gemini, separados por comas).
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0';
import { cors } from '../_shared/cors.ts';
import '../ai-interpret/conversa-core.js';
import '../ai-interpret/trabajos.js';

const CONV = (globalThis as any).ConvAI;
const GKEY = Deno.env.get('GEMINI_API_KEY') || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TRANSCRIBE = (Deno.env.get('TRANSCRIBE_MODELOS') || 'gemini-flash-latest,gemini-3.8-flash,gemini-flash-lite-latest').split(',').map((x) => x.trim()).filter(Boolean);
const CKEY = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('anthroic-api-key') || Deno.env.get('anthropic-api-key') || '';
const anthropic = CKEY ? new Anthropic({ apiKey: CKEY, timeout: 120000, maxRetries: 1 }) : null;
const MODELOS_CLAUDE = [Deno.env.get('VISITA_MODELO') || 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const SISTEMA = CONV.convSystem((globalThis as any).MEDICIONA_TRABAJOS || []);
let ultimoError = '';

const PROMPT_TRANSCRIBIR = 'Transcribe literalmente este audio en español de España. Es un técnico o constructor recorriendo una obra y dictando medidas y trabajos. ' +
  'Escribe los números con cifras y coma decimal tal como se dicen («dos sesenta» → 2,60; «ochenta» en una puerta → 80; «cuatro por tres» → 4 por 3). ' +
  'Mantén las correcciones tal como se dicen («no, perdón, eran 3,20»). Separa en párrafos cuando cambie de estancia o de tema. ' +
  'Si habla más de una persona, distingue quién habla al principio de cada intervención: «Técnico:» para quien dicta las medidas y los trabajos, y «Otra persona:» para los demás (cliente, operarios…); si hay varias, «Otra persona 1:», «Otra persona 2:». Si solo habla una persona, no pongas etiquetas. ' +
  'No resumas, no añadas nada, no expliques. Si no se oye nada útil, responde con una cadena vacía.';

async function transcribir(audio: string, mime: string) {
  for (const m of TRANSCRIBE) {
    const r = await fetch(BASE + '/models/' + m + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: mime, data: audio } }, { text: PROMPT_TRANSCRIBIR }] }], generationConfig: { temperature: 0 } })
    });
    if (!r.ok) { ultimoError = m + ': ' + r.status + ' ' + (await r.text()).slice(0, 200); continue; }
    const j = await r.json().catch(() => null);
    const texto = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    return { texto, modelo: m, tin: j?.usageMetadata?.promptTokenCount || 0, tout: j?.usageMetadata?.candidatesTokenCount || 0 };
  }
  return null;
}

function usuarioVisita(ctx: any) {
  const zs = (ctx.zonas || []).map((z: any) => z.ref + ' | ' + z.ambito + ' | ' + z.nombre + (z.datos ? ' | ' + z.datos : '')).join('\n');
  return [
    'TRANSCRIPCIÓN COMPLETA DE LA VISITA (dictada por voz recorriendo la obra; puede tener errores de reconocimiento y correcciones sobre la marcha):',
    '«' + ctx.transcripcion + '»',
    'TOMA ACTUAL (ref | ámbito | nombre | datos):\n' + (zs || '(nada todavía)'),
    'INSTRUCCIONES PARA ESTA VISITA: devuelve en "zonas" TODAS las estancias y zonas que se mencionan, cada una con todos sus datos (planta, altura, huecos, fontanería, electricidad…), y en "trabajos" TODOS los trabajos con sus zonas. ' +
    'Si algo se corrige más adelante en la grabación («no, perdón…», «me he equivocado, eran…»), quédate solo con la versión final. Si la toma actual ya tiene una zona, usa su ref. ' +
    'Si hay varias personas («Técnico:», «Otra persona:»), quien manda es el técnico: anota lo que él dice; lo que pida o comente otra persona, solo si el técnico lo acepta o lo repite («vale, eso también», «sí, lo ponemos»). Las medidas que dé otra persona, solo si el técnico no las contradice. ' +
    'Si un trabajo se dice para «toda la casa» o «todo», pon "zonas" vacío. Deja "pregunta" vacía: la app preguntará después lo que falte. En "mensaje", una frase con lo que NO has podido entender, si hay algo.'
  ].join('\n\n');
}

async function procesar(ctx: any) {
  if (!anthropic) { ultimoError = 'sin clave de Anthropic'; return null; }
  for (const modelo of MODELOS_CLAUDE) {
    try {
      const params: any = {
        model: modelo,
        max_tokens: 16000,
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: usuarioVisita(ctx) }],
        output_config: { effort: 'low' }
      };
      if (/haiku/.test(modelo)) params.thinking = { type: 'disabled' };
      const r = await anthropic.messages.create(params);
      if (r.stop_reason === 'refusal') { ultimoError = modelo + ': refusal'; continue; }
      const txt = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const out = CONV.normaliza(txt);
      if (!out) { ultimoError = modelo + ': respuesta no JSON ' + txt.slice(0, 120); continue; }
      return { out, modelo, tin: r.usage?.input_tokens || 0, tout: r.usage?.output_tokens || 0 };
    } catch (e) {
      ultimoError = modelo + ': ' + (e instanceof Anthropic.APIError ? e.status + ' ' + e.message : String(e));
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const h = { ...cors(req), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: h });
  const url = Deno.env.get('SUPABASE_URL')!;
  const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: { user } } = await usuario.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Inicia sesión para procesar la visita' }), { status: 401, headers: h });
  const b = await req.json().catch(() => ({}));
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const anota = (modelo: string, tin: number, tout: number, ms: number, intent: string) => {
    const p = (async () => { await admin.from('ia_uso').insert({ user_id: user.id, obra_id: typeof b?.obra_id === 'string' ? b.obra_id.slice(0, 60) : null, modelo, tokens_entrada: tin, tokens_salida: tout, ms, intent }); })();
    const ER = (globalThis as any).EdgeRuntime; if (ER && ER.waitUntil) ER.waitUntil(p);
  };
  const t0 = Date.now();
  if (b?.modo === 'transcribir') {
    const audio = typeof b.audio === 'string' ? b.audio : '';
    const mime = typeof b.mime === 'string' && /^audio\//.test(b.mime) ? b.mime.split(';')[0] : 'audio/webm';
    if (!audio || audio.length > 18_000_000) return new Response(JSON.stringify({ error: 'Audio vacío o demasiado largo' }), { status: 400, headers: h });
    const r = await transcribir(audio, mime);
    if (!r) return new Response(JSON.stringify({ error: 'No he podido transcribir el audio', detalle: ultimoError }), { status: 502, headers: h });
    anota(r.modelo, r.tin, r.tout, Date.now() - t0, 'transcribir');
    return new Response(JSON.stringify({ texto: r.texto, modelo: r.modelo }), { headers: h });
  }
  if (b?.modo === 'procesar') {
    const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
    const ctx = {
      transcripcion: s(b.transcripcion, 80000),
      zonas: (Array.isArray(b.zonas) ? b.zonas.slice(0, 80) : []).map((z: any) => ({ ref: s(z?.ref, 20), ambito: s(z?.ambito, 20), nombre: s(z?.nombre, 60), datos: s(z?.datos, 400) }))
    };
    if (!ctx.transcripcion.trim()) return new Response(JSON.stringify({ error: 'La transcripción está vacía' }), { status: 400, headers: h });
    const r = await procesar(ctx);
    if (!r) return new Response(JSON.stringify({ error: 'No he podido procesar la visita', detalle: ultimoError }), { status: 502, headers: h });
    anota(r.modelo, r.tin, r.tout, Date.now() - t0, 'visita');
    return new Response(JSON.stringify({ result: r.out, modelo: r.modelo, ms: Date.now() - t0 }), { headers: h });
  }
  return new Response(JSON.stringify({ error: 'Modo no válido' }), { status: 400, headers: h });
});
