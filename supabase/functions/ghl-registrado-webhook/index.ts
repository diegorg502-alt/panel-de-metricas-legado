import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Webhook real-time desde GHL → CRM Zerochats (y otros clientes en el futuro).
// Cuando un contacto recibe el tag "registrado" (o el que configures), GHL
// envía POST aquí con sus datos. Esta función:
// 1. Valida origen (locationId → record_id del cliente).
// 2. Idempotente: si ya hay una llamada con ese ghl_contact_id no duplica.
// 3. Crea una entrada en S.llamadas[YYYY-MM] del cliente con embudo detectado
//    por tags, datos del contacto y UTMs.
//
// Endpoint: POST /functions/v1/ghl-registrado-webhook

// Mapa locationId → record_id. Añade más clientes aquí.
const LOCATION_TO_RECORD: Record<string, string> = {
  'pJyuDyDmqRLuYm63c6Oj': 'zerochats_2026',
};

function mKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Detecta embudo según los tags del contacto. Default: 'QUIZ'.
function detectEmbudo(tags: string[], utmSource?: string): string {
  const ts = tags.map(t => String(t).toLowerCase());
  const us = String(utmSource || '').toLowerCase();
  // Prioriza por tag explícito
  if (ts.some(t => t.includes('templado') || t.includes('warm') || t.includes('tofu'))) return 'QUIZ TEMPLADO';
  if (ts.some(t => t.includes('vsl'))) return 'VSL';
  if (ts.some(t => t.includes('referido') || t.includes('referral'))) return 'REFERIDOS';
  if (ts.some(t => t.includes('seguidor') || t.includes('social'))) return 'SOCIAL';
  // Fallback por utm_source
  if (us.includes('templado') || us.includes('warm')) return 'QUIZ TEMPLADO';
  if (us.includes('vsl')) return 'VSL';
  if (us.includes('referral') || us.includes('referido')) return 'REFERIDOS';
  if (us.includes('ig') || us.includes('instagram') || us.includes('facebook') || us.includes('fb')) return 'SOCIAL';
  return 'QUIZ';
}

function pickFirst(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = k.split('.').reduce((acc: any, part: string) => (acc == null ? undefined : acc[part]), obj);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-webhook-secret, content-type, x-client-info, apikey',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

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

  // locationId (varios alias)
  const locationId = pickFirst(body, ['location.id', 'locationId', 'location_id', 'locationid']);
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

  // Datos del contacto (múltiples alias)
  const contactId = pickFirst(body, ['contact_id', 'contactId', 'contact.id', 'id']);
  const firstName = pickFirst(body, ['first_name', 'firstName', 'contact.firstName', 'contact.first_name']);
  const lastName  = pickFirst(body, ['last_name', 'lastName', 'contact.lastName', 'contact.last_name']);
  const rawName   = pickFirst(body, ['full_name', 'fullName', 'contact.fullName', 'contact.name', 'name', 'contact_name', 'full_name_lowercase']);
  const fullName = (rawName || `${firstName} ${lastName}`.trim()).toUpperCase();
  const email = pickFirst(body, ['email', 'contact.email']);
  const phone = pickFirst(body, ['phone', 'contact.phone']);
  const tagsRaw = body.tags || body.contact?.tags || [];
  const tags: string[] = Array.isArray(tagsRaw)
    ? tagsRaw.map((t: any) => String(t))
    : (typeof tagsRaw === 'string' ? tagsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []);

  // UTMs (múltiples alias — GHL las puede mandar como flat o anidadas en attributionSource)
  const utm_source   = pickFirst(body, ['utm_source', 'utmSource', 'contact.attributionSource.utmSource', 'attributionSource.utmSource']);
  const utm_medium   = pickFirst(body, ['utm_medium', 'utmMedium', 'contact.attributionSource.utmMedium', 'attributionSource.utmMedium', 'medium']);
  const utm_campaign = pickFirst(body, ['utm_campaign', 'utmCampaign', 'contact.attributionSource.campaign', 'attributionSource.campaign', 'campaign']);
  const utm_content  = pickFirst(body, ['utm_content', 'utmContent', 'contact.attributionSource.utmContent', 'attributionSource.utmContent']);
  const utm_term     = pickFirst(body, ['utm_term', 'utmTerm', 'contact.attributionSource.utmTerm', 'attributionSource.utmTerm']);

  if (!fullName) {
    return new Response(JSON.stringify({ error: 'sin_nombre' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }

  const embudo = detectEmbudo(tags, utm_source);

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
  // del año actual, no duplicar (pero sí actualizar campos vacíos).
  if (contactId) {
    for (const k of Object.keys(S.llamadas)) {
      if (!k.startsWith(String(today.getFullYear()))) continue;
      const list = S.llamadas[k];
      if (Array.isArray(list)) {
        const idx = list.findIndex((r: any) => r.ghl_contact_id === contactId);
        if (idx >= 0) {
          // Update campos vacíos con datos nuevos (no pisa lo que ya tenga valor)
          const r = list[idx];
          if (!r.email && email) r.email = email;
          if (!r.telefono && phone) r.telefono = phone;
          if (!r.utm_source && utm_source) r.utm_source = utm_source;
          if (!r.utm_medium && utm_medium) r.utm_medium = utm_medium;
          if (!r.utm_campaign && utm_campaign) r.utm_campaign = utm_campaign;
          if (!r.utm_content && utm_content) r.utm_content = utm_content;
          if (!r.utm_term && utm_term) r.utm_term = utm_term;
          // Si los tags se actualizaron en GHL, fusionar
          if (tags.length) {
            const existing: string[] = Array.isArray(r.ghl_tags) ? r.ghl_tags : [];
            const merged = Array.from(new Set([...existing.map(String), ...tags.map(String)]));
            r.ghl_tags = merged;
          }
          const ts = new Date().toISOString();
          const { error: upErr } = await sb.from('crm_data').upsert({ id: recordId, data: S, updated_at: ts });
          return new Response(JSON.stringify({ success: true, updated: true, ghl_contact_id: contactId, mes: k, upsert_error: upErr?.message || null }), {
            status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
          });
        }
      }
    }
  }

  // Crear la fila de llamada
  const row: any = {
    nombre: fullName,
    fecha: today.toISOString().split('T')[0],
    telefono: phone,
    email,
    embudo,
    agendaLlamada: '',
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
  if (utm_source)   row.utm_source = utm_source;
  if (utm_medium)   row.utm_medium = utm_medium;
  if (utm_campaign) row.utm_campaign = utm_campaign;
  if (utm_content)  row.utm_content = utm_content;
  if (utm_term)     row.utm_term = utm_term;
  S.llamadas[mk].push(row);

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
    utm: { utm_source, utm_medium, utm_campaign, utm_content, utm_term },
  }), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
});
