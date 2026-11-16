// ============================================================
// Mediciona · enviar los archivos de una medición al correo del usuario
// POST { obra_id, titulo, archivos: [{ nombre, base64 }] }
// Solo al correo registrado (y confirmado) del usuario. Límite diario.
// Secreto: RESEND_API_KEY. Opcional: ENVIOS_LIMITE_DIA, ENVIOS_REMITENTE.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { cors } from '../_shared/cors.ts';

const LIMITE = Number(Deno.env.get('ENVIOS_LIMITE_DIA') || '20');
const REMITENTE = Deno.env.get('ENVIOS_REMITENTE') || 'Mediciona <hola@mediciona.es>';
const MAX_BYTES = 15 * 1024 * 1024;
const EXT = /\.(pdf|xlsx|bc3)$/i;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

Deno.serve(async (req) => {
  const h = { ...cors(req), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: h });
  const url = Deno.env.get('SUPABASE_URL')!;
  const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: { user } } = await usuario.auth.getUser();
  if (!user || !user.email) return new Response(JSON.stringify({ error: 'Inicia sesión para enviar archivos' }), { status: 401, headers: h });
  if (!user.email_confirmed_at) return new Response(JSON.stringify({ error: 'Confirma primero tu correo' }), { status: 403, headers: h });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: esAdmin } = await admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!esAdmin) {
    const { count } = await admin.from('envios').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('creado', new Date(Date.now() - 864e5).toISOString());
    if ((count || 0) >= LIMITE) return new Response(JSON.stringify({ error: 'Has llegado al límite de envíos por hoy' }), { status: 429, headers: h });
  }

  let b: any;
  try { b = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Petición no válida' }), { status: 400, headers: h }); }
  const archivos = (Array.isArray(b?.archivos) ? b.archivos : []).slice(0, 5)
    .map((a: any) => ({ filename: String(a?.nombre || '').replace(/[^\w.áéíóúñÁÉÍÓÚÑ-]+/g, '_').slice(0, 120), content: String(a?.base64 || '') }))
    .filter((a: any) => EXT.test(a.filename) && /^[A-Za-z0-9+/=]+$/.test(a.content));
  if (!archivos.length) return new Response(JSON.stringify({ error: 'No hay archivos válidos que enviar' }), { status: 400, headers: h });
  const bytes = archivos.reduce((n: number, a: any) => n + Math.floor(a.content.length * 3 / 4), 0);
  if (bytes > MAX_BYTES) return new Response(JSON.stringify({ error: 'Los archivos son demasiado grandes para enviarlos por correo' }), { status: 413, headers: h });

  const titulo = esc(String(b?.titulo || 'tu medición').slice(0, 150));
  const lista = archivos.map((a: any) => '<li>' + esc(a.filename) + '</li>').join('');
  const html = `<div style="background:#1A2231;padding:32px 16px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:520px;margin:0 auto;background:#232D3F;border-radius:14px;padding:28px;color:#EEF1F7">
<div style="font-size:22px;font-weight:800;margin-bottom:4px">Mediciona</div><div style="font-size:13px;color:#9AA8BF;margin-bottom:24px">Mediciones de obra con IA</div>
<h1 style="font-size:20px;margin:0 0 12px;color:#EEF1F7">Archivos de «${titulo}»</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 12px">Aquí tienes los archivos de tu medición:</p><ul style="font-size:15px;line-height:1.7;margin:0 0 16px;padding-left:20px">${lista}</ul>
<p style="font-size:13px;line-height:1.6;color:#9AA8BF;margin:0">El BC3 se importa en Presto, Arquímedes y otros programas de presupuestos. El Excel recalcula los totales si cambias una medida.</p></div>
<p style="max-width:520px;margin:12px auto 0;font-size:12px;color:#9AA8BF;text-align:center">Este es un mensaje automático: por favor, no respondas a este correo. Si necesitas ayuda, escríbenos desde el buzón de sugerencias de la app.</p>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#9AA8BF;text-align:center">Mediciona · mediciona.es</p></div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Deno.env.get('RESEND_API_KEY') || Deno.env.get('Resend-api-key') || Deno.env.get('resend-api-key') || '') },
    body: JSON.stringify({ from: REMITENTE, to: [user.email], subject: 'Mediciona · Archivos de «' + String(b?.titulo || 'tu medición').slice(0, 100) + '»', html, attachments: archivos })
  });
  const j = await r.json().catch(() => null);
  await admin.from('envios').insert({ user_id: user.id, obra_id: String(b?.obra_id || '').slice(0, 60) || null, archivos: archivos.map((a: any) => a.filename), bytes, estado: r.ok ? 'enviado' : 'error ' + r.status });
  if (!r.ok) return new Response(JSON.stringify({ error: 'No se pudo enviar el correo ahora mismo', detalle: j?.message || r.status }), { status: 502, headers: h });
  return new Response(JSON.stringify({ ok: true, a: user.email }), { headers: h });
});
