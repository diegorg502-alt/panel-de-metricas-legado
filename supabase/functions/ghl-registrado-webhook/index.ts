import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Webhook real-time desde GHL → CRM Zerochats (y otros clientes en el futuro).
// Cuando un contacto recibe el tag "registrado" (o el que configures), GHL
// envía POST aquí con sus datos. Esta función:
// 1. Valida origen (locationId → record_id del cliente).
// 2. Valida secret opcional (X-Webhook-Secret == env var GHL_WEBHOOK_SECRET).
// 3. Idempotente: si ya hay una llamada con ese ghl_contact_id no duplica.
// 4. Crea una entrada en S.llamadas[YYYY-MM] del cliente con embudo detectado
//    por tags y los datos del contacto.
//
// Endpoint: POST /functions/v1/ghl-registrado-webhook
//
// Body esperado (cualquier formato GHL, robusto a múltiples alias):
// {
//   "location": {"id": "pJyuDyDmqRLuYm63c6Oj"},   // o "locationId"
//   "contact_id": "abc123",                       // o "id"
//   "first_name": "...", "last_name": "...",      // o "full_name"
//   "email": "...", "phone": "...",
//   "tags": ["registrado", ...]
// }
//
// Headers:
//   X-Webhook-Secret: <secret>     (opcional; obligatorio si env var presente)

// Mapa locationId → record_id. Añade más clientes aquí.
const LOCATION_TO_RECORD: Record<string, string> = {
  'pJyuDyDmqRLuYm63c6Oj': 'zerochats_2026',
};

const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

function mKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Detecta embudo según los tags del contacto. Default: 'QUIZ'.
function detectEmbudo(tags: string[]): string {
  const ts = tags.map(t => String(t).toLowerCase());
  if (ts.some(t => t.includes('templado') || t.includes('warm') || t.includes('tofu'))) return 'QUIZ TEMPLADO';
  if (ts.some(t => t.includes('vsl'))) return 'VSL';
  if (ts.some(t => t.includes('referido') || t.includes('referral'))) return 'REFERIDOS';
  if (ts.some(t => t.includes('seguidor') || t.includes('social'))) return 'SOCIAL';
  return 'QUIZ';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-webhook-secret, content-type, x-client-info, apikey',
  };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  // Auth opcional: si env var GHL_WEBHOOK_SECRET está definida, exigirla en header.
  const expected = Deno.env.get('GHL_WEBHOOK_SECRET');
  if (expected) {
    const got = req.headers.get('x-webhook-secret') || '';
    if (got !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  // Extraer locationId (varios alias posibles)
  const locationId =
    body.location?.id ||
    body.locationId ||
    body.location_id ||
    body.locationid;

  if (!locationId) {
    return new Response(JSON.stringify({ error: 'sin_location_id', body_keys: Object.keys(body) }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  const recordId = LOCATION_TO_RECORD[locationId];
  if (!recordId) {
    return new Response(JSON.stringify({ error: 'location_no_mapeada', locationId, hint: 'Añadir a LOCATION_TO_RECORD en la edge function.' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  // Extraer datos del contacto (varios alias)
  const contactId = body.contact_id || body.contactId || body.contact?.id || body.id;
  const firstName = String(body.first_name || body.firstName || body.contact?.firstName || '').trim();
  const lastName  = String(body.last_name  || body.lastName  || body.contact?.lastName  || '').trim();
  const rawName   = body.full_name || body.fullName || body.contact?.fullName || body.name || body.contact_name;
  const fullName = String(rawName || `${firstName} ${lastName}`.trim()).trim().toUpperCase();
  const email = body.email || body.contact?.email || '';
  const phone = body.phone || body.contact?.phone || '';
  const tagsRaw = body.tags || body.contact?.tags || [];
  const tags: string[] = Array.isArray(tagsRaw)
    ? tagsRaw
    : (typeof tagsRaw === 'string' ? tagsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []);

  if (!fullName) {
    return new Response(JSON.stringify({ error: 'sin_nombre' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  const embudo = detectEmbudo(tags);

  // Cargar S del cliente
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cd, error } = await sb.from('crm_data').select('data').eq('id', recordId).single();
  if (error || !cd) {
    return new Response(JSON.stringify({ error: 'crm_data_no_encontrada', recordId }), {
      status: 404, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  const S = cd.data || {};
  if (!S.llamadas || typeof S.llamadas !== 'object') S.llamadas = {};

  const today = new Date();
  const mk = mKey(today);
  if (!Array.isArray(S.llamadas[mk])) S.llamadas[mk] = [];

  // Idempotencia: si ya existe llamada con este ghl_contact_id en cualquier mes
  // del año actual, no duplicar.
  if (contactId) {
    for (const k of Object.keys(S.llamadas)) {
      if (!k.startsWith(String(today.getFullYear()))) continue;
      const list = S.llamadas[k];
      if (Array.isArray(list) && list.some((r: any) => r.ghl_contact_id === contactId)) {
        return new Response(JSON.stringify({ success: true, skipped: 'duplicate', ghl_contact_id: contactId, mes: k }), {
          status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
        });
      }
    }
  }

  // Crear la fila de llamada
  const row = {
    nombre: fullName,
    fecha: today.toISOString().split('T')[0],
    telefono: phone,
    email,
    embudo,
    agendaLlamada: '',     // se actualizará si agenda llamada
    closer: '',
    asistencia: 'PENDIENTE',
    incidencia: '',
    estado: '',
    facturacion: 0,
    caja: 0,
    nCuotas: 1,
    mesesServicio: 0,
    comentarios: 'Registro vía GHL',
    entrenador: '',
    year: today.getFullYear(),
    source: 'ghl-webhook-registrado',
    ghl_contact_id: contactId,
    ghl_tags: tags,
  };
  S.llamadas[mk].push(row);

  // Upsert con updated_at explícito para que el trigger anti-rollback no bloquee.
  const ts = new Date().toISOString();
  const { error: upErr } = await sb.from('crm_data').upsert({ id: recordId, data: S, updated_at: ts });
  if (upErr) {
    return new Response(JSON.stringify({ error: 'upsert_failed', detail: upErr.message }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    success: true,
    record_id: recordId,
    mes: mk,
    nombre: fullName,
    embudo,
    ghl_contact_id: contactId,
  }), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
});
