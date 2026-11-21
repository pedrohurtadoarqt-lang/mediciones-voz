// ============================================================
// Mediciona · Voz natural (texto a voz con Gemini)
// POST { texto, voz? } → { audio: base64 PCM 16 bits mono, rate, modelo }
// Solo usuarios con sesión. El modelo de voz se elige solo (el más
// reciente con «tts» en el nombre) para no depender de un nombre fijo.
// Secretos: GEMINI_API_KEY. Opcionales: TTS_MODELO, TTS_VOZ, TTS_ESTILO.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { cors } from '../_shared/cors.ts';

const KEY = Deno.env.get('GEMINI_API_KEY') || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VOCES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'];
const ESTILO = Deno.env.get('TTS_ESTILO') || 'Say in Spanish from Spain (Castilian accent), in a natural, warm and brisk conversational tone, like a colleague on a building site: ';
let modelos: string[] | null = null;
let ultimoError = '';

/** Modelos de voz disponibles, el preferido primero. */
async function modelosTTS(): Promise<string[]> {
  if (modelos) return modelos;
  const fijo = Deno.env.get('TTS_MODELO');
  const lista: string[] = [];
  try {
    const r = await fetch(BASE + '/models?pageSize=200', { headers: { 'x-goog-api-key': KEY } });
    const j = await r.json();
    for (const m of j.models || []) {
      const n = String(m.name || '').replace(/^models\//, '');
      if (/tts/i.test(n) && (m.supportedGenerationMethods || []).includes('generateContent')) lista.push(n);
    }
  } catch (e) { ultimoError = 'lista de modelos: ' + String(e); }
  // Preferencia: flash (rápido) antes que pro; los no «preview» antes
  const peso = (n: string) => (/flash/.test(n) ? 0 : 10) + (/preview/.test(n) ? 1 : 0) + (/lite/.test(n) ? -1 : 0);
  lista.sort((a, b) => peso(a) - peso(b) || b.localeCompare(a));
  modelos = [...new Set([fijo, ...lista, 'gemini-2.5-flash-preview-tts'].filter(Boolean) as string[])];
  return modelos;
}

async function sintetiza(texto: string, voz: string) {
  for (const m of await modelosTTS()) {
    const r = await fetch(BASE + '/models/' + m + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: ESTILO + texto }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } }
      })
    });
    if (!r.ok) { ultimoError = m + ': ' + r.status + ' ' + (await r.text()).slice(0, 200); continue; }
    const j = await r.json().catch(() => null);
    const part = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
    if (!part) { ultimoError = m + ': sin audio'; continue; }
    const mime = String(part.inlineData.mimeType || '');
    const rate = Number((mime.match(/rate=(\d+)/) || [])[1] || 24000);
    // El primero que funciona pasa a ser el preferido
    modelos = [m, ...(modelos || []).filter((x) => x !== m)];
    return { audio: part.inlineData.data as string, rate, mime, modelo: m, tin: j?.usageMetadata?.promptTokenCount || 0, tout: j?.usageMetadata?.candidatesTokenCount || 0 };
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
  if (!user) return new Response(JSON.stringify({ error: 'Inicia sesión para usar la voz natural' }), { status: 401, headers: h });
  const b = await req.json().catch(() => ({}));
  const texto = typeof b?.texto === 'string' ? b.texto.replace(/[«»]/g, '').slice(0, 700).trim() : '';
  if (!texto) return new Response(JSON.stringify({ error: 'Falta el texto' }), { status: 400, headers: h });
  const voz = VOCES.includes(b?.voz) ? b.voz : (Deno.env.get('TTS_VOZ') || 'Kore');
  const t0 = Date.now();
  const r = await sintetiza(texto, voz);
  if (!r) return new Response(JSON.stringify({ error: 'La voz natural no está disponible', detalle: ultimoError }), { status: 502, headers: h });
  const ms = Date.now() - t0;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const registro = admin.from('ia_uso').insert({ user_id: user.id, modelo: r.modelo, tokens_entrada: r.tin, tokens_salida: r.tout, ms, intent: 'voz' });
  const ER = (globalThis as any).EdgeRuntime;
  if (ER && ER.waitUntil) ER.waitUntil(registro); else await registro;
  return new Response(JSON.stringify({ audio: r.audio, rate: r.rate, modelo: r.modelo, ms }), { headers: h });
});
