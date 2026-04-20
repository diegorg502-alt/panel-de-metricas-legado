import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function pick(obj: any, ...keys: string[]): string {
  if (!obj) return '';
  for (const key of keys) {
    const parts = key.split('.');
    let v: any = obj;
    for (const p of parts) {
      if (v && typeof v === 'object' && p in v) v = v[p];
      else { v = undefined; break; }
    }
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function normalizePhone(p: string): string {
  return (p || '').replace(/[\s\-()]/g, '');
}

function normalizeName(n: string): string {
  return (n || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let body: any = {};
    const rawText = await req.text();
    try {
      body = JSON.parse(rawText);
    } catch {
      try {
        const params = new URLSearchParams(rawText);
        body = Object.fromEntries(params.entries());
      } catch {
        body = { _raw: rawText };
      }
    }

    const clientId = pick(body, 'client_id', 'clientId', 'customData.client_id');
    const clientEmail = pick(body, 'client_email', 'clientEmail');
    const contactId = pick(body, 'contact_id', 'contactId', 'contact.id', 'id');

    let name = pick(body, 'name', 'full_name', 'fullName', 'contact.name', 'contact.full_name');
    if (!name) {
      const firstName = pick(body, 'first_name', 'firstName', 'contact.first_name', 'contact.firstName');
      const lastName = pick(body, 'last_name', 'lastName', 'contact.last_name', 'contact.lastName');
      name = [firstName, lastName].filter(Boolean).join(' ').trim();
    }
    const email = pick(body, 'email', 'contact.email');
    const phone = pick(body, 'phone', 'contact.phone');

    let recordId = clientId;
    if (!recordId && clientEmail) {
      const { data: c } = await sb.from('crm_clients').select('record_id').eq('email', clientEmail).single();
      recordId = c?.record_id;
    }
    if (!recordId) {
      return new Response(JSON.stringify({
        error: 'client_id or client_email required',
        received_keys: Object.keys(body)
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: cd } = await sb.from('crm_data').select('data').eq('id', recordId).single();
    if (!cd) {
      return new Response(JSON.stringify({ error: 'Record not found' }), { status: 404 });
    }

    const S = cd.data || {};
    if (!S.cuotas) S.cuotas = [];

    const searchPhone = normalizePhone(phone);
    const searchEmail = (email || '').toLowerCase().trim();
    const searchName = normalizeName(name);
    const today = new Date().toISOString().split('T')[0];

    // Matching priority: contact_id > phone exact > email exact > full name exact
    // NO includes - too risky
    let marked: any[] = [];
    let matchType = '';

    for (const c of S.cuotas) {
      if (c.perdido) continue;
      let match = false;

      // 1. GHL contact ID (if stored)
      if (contactId && c.contact_id && c.contact_id === contactId) {
        match = true; matchType = 'contact_id';
      }
      // 2. Phone exact match (normalized)
      else if (searchPhone && normalizePhone(c.telefono || '') && normalizePhone(c.telefono || '') === searchPhone) {
        match = true; matchType = 'phone';
      }
      // 3. Email exact match
      else if (searchEmail && (c.email || '').toLowerCase().trim() === searchEmail) {
        match = true; matchType = 'email';
      }
      // 4. Full name exact match (case-insensitive, whitespace normalized)
      else if (searchName && normalizeName(c.nombre || '') === searchName) {
        match = true; matchType = 'name';
      }

      if (match) {
        c.perdido = true;
        c.fechaPerdido = today;
        if (contactId && !c.contact_id) c.contact_id = contactId; // store for next time
        marked.push({ nombre: c.nombre, matched_by: matchType });
      }
    }

    // Also mark in llamadas
    if (marked.length && S.llamadas) {
      const markedNames = new Set(marked.map(m => normalizeName(m.nombre)));
      for (const mk of Object.keys(S.llamadas)) {
        S.llamadas[mk] = (S.llamadas[mk] || []).map((l: any) => {
          if (!l.nombre) return l;
          if (markedNames.has(normalizeName(l.nombre))) {
            return { ...l, perdido: true, fechaPerdido: today };
          }
          return l;
        });
      }
    }

    if (!marked.length) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No exact match found in cuotas',
        hint: 'Make sure name/phone/email in GHL matches exactly with CRM',
        searched: { name, email, phone, contactId }
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    await sb.from('crm_data').upsert({ id: recordId, data: S });

    return new Response(JSON.stringify({
      success: true,
      marked_as_perdido: marked,
      match_type: matchType,
      record_id: recordId
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
