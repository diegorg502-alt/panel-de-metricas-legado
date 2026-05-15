import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cron diario. Sincroniza suscriptores de Zerochats desde GoHighLevel hacia
// S.cuotas del CRM (record_id = zerochats_2026).
//
// Reglas:
// - Solo se traen contactos con tag: "plan pro", "plan bussiness", "plan anual".
// - Si el contacto NO existe en S.cuotas → se crea como ALTA.
//   - Primera ejecución (S.ghl_first_sync_at vacío): fechaInicio = dateAdded del contacto, fecha_estimada = true.
//   - Ejecuciones posteriores: fechaInicio = hoy, fecha_estimada = false.
// - Si tiene varios tags de plan, gana el de mayor jerarquía: ANUAL > BUSINESS > PRO.
// - Si tiene tag "perdido" y no está marcado → se marca perdido = true, fechaPerdido = hoy (o dateUpdated en primer sync).
// - Si tiene tag "perdido" pero ya estaba marcado → no se toca.
// - Plan ANUAL: ticket = 0 (Diego lo rellena manual; importes variables).
// - Plan PRO/BUSINESS: ticket = 247 / 397.
// - El primer pago del mes de alta se registra directamente en cuota.pagos[YYYY-MMM].

const ZEROCHATS_LOCATION_ID = 'pJyuDyDmqRLuYm63c6Oj';
const ZEROCHATS_RECORD_ID = 'zerochats_2026';

const PLAN_TAGS: Record<string, string> = {
  'plan pro': 'PRO',
  'plan bussiness': 'BUSINESS',
  'plan anual': 'ANUAL',
};
// Distinguimos ticket (precio del plan / facturación) y caja (neto que entra
// después de comisión Stripe). BUSINESS: 397€ facturación, 374€ caja (23€ comisión).
// PRO: igual sin comisión registrada. ANUAL: variable, Diego rellena manualmente.
const PLAN_TICKETS: Record<string, number> = { PRO: 247, BUSINESS: 397, ANUAL: 0 };
const PLAN_CAJAS:   Record<string, number> = { PRO: 247, BUSINESS: 374, ANUAL: 0 };
const PLAN_PRIORITY: Record<string, number> = { ANUAL: 3, BUSINESS: 2, PRO: 1 };
const PERDIDO_TAG = 'perdido';
const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

function getPagoKey(d: Date): string {
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}`;
}

function monthsBetween(from: Date, to: Date): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    out.push({ y: cur.getFullYear(), m: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function pickPlan(tags: string[]): string | null {
  let best: string | null = null;
  let bestPrio = 0;
  for (const t of tags) {
    const lt = t.toLowerCase();
    const plan = PLAN_TAGS[lt];
    if (!plan) continue;
    if (PLAN_PRIORITY[plan] > bestPrio) {
      best = plan;
      bestPrio = PLAN_PRIORITY[plan];
    }
  }
  return best;
}

async function ghlSearchAll(token: string, tag: string): Promise<any[]> {
  const out: any[] = [];
  let startAfter: number | null = null;
  let startAfterId: string | null = null;
  for (let i = 0; i < 20; i++) { // hard cap 20 páginas (5000 contactos)
    const body: any = {
      locationId: ZEROCHATS_LOCATION_ID,
      pageLimit: 250,
      filters: [{ field: 'tags', operator: 'contains', value: tag }],
    };
    if (startAfter && startAfterId) {
      body.startAfter = startAfter;
      body.startAfterId = startAfterId;
    }
    const res = await fetch('https://services.leadconnectorhq.com/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL search failed (${tag}): ${res.status} ${text}`);
    }
    const data = await res.json();
    const contacts = data.contacts || [];
    out.push(...contacts);
    if (contacts.length < 250) break; // última página
    const last = contacts[contacts.length - 1];
    startAfterId = last.id;
    startAfter = last.startAfter?.[0] || data.meta?.startAfter || null;
    if (!startAfter || !startAfterId) break;
  }
  return out;
}

Deno.serve(async () => {
  try {
    const token = Deno.env.get('GHL_TOKEN_ZEROCHATS');
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'GHL_TOKEN_ZEROCHATS no configurado' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Cargar S de Zerochats
    const { data: cd, error: cdErr } = await sb.from('crm_data').select('data').eq('id', ZEROCHATS_RECORD_ID).single();
    if (cdErr) throw new Error(`No se encontró crm_data para ${ZEROCHATS_RECORD_ID}: ${cdErr.message}`);
    const S = cd?.data || {};
    if (!S.cuotas) S.cuotas = [];

    const isFirstSync = !S.ghl_first_sync_at;
    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];

    // Traer todos los contactos con planes (deduplicar por id)
    const seenIds = new Set<string>();
    const contacts: any[] = [];
    for (const tag of Object.keys(PLAN_TAGS)) {
      const list = await ghlSearchAll(token, tag);
      for (const c of list) {
        if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          contacts.push(c);
        }
      }
    }

    let altasNuevas = 0;
    let bajasNuevas = 0;
    let pagosBackfill = 0;

    for (const ct of contacts) {
      const tags: string[] = (ct.tags || []).map((t: string) => String(t).toLowerCase());
      const plan = pickPlan(tags);
      if (!plan) continue;

      const isPerdido = tags.includes(PERDIDO_TAG);
      const nombre = String(ct.contactName || `${ct.firstName || ''} ${ct.lastName || ''}`).trim().toUpperCase();
      if (!nombre) continue;

      // Buscar cuota existente: primero por ghl_contact_id, luego por nombre
      let cuota = S.cuotas.find((c: any) => c.ghl_contact_id === ct.id);
      if (!cuota) cuota = S.cuotas.find((c: any) => String(c.nombre || '').toUpperCase() === nombre);

      if (!cuota) {
        // ALTA NUEVA
        const dateAdded = ct.dateAdded ? new Date(ct.dateAdded) : today;
        const fechaInicio = isFirstSync && !isNaN(dateAdded.getTime()) ? dateAdded : today;
        const fechaInicioISO = fechaInicio.toISOString().split('T')[0];

        const ticket = PLAN_TICKETS[plan]; // precio del plan (facturación)
        const cajaMes = PLAN_CAJAS[plan];   // caja neta mensual tras comisión

        const newCuota: any = {
          ghl_contact_id: ct.id,
          nombre,
          email: ct.email || '',
          telefono: ct.phone || '',
          plan,
          fechaInicio: fechaInicioISO,
          fecha_estimada: isFirstSync,
          ticket,
          nCuotas: 1,
          mesesServicio: 1,
          pagos: {},
          embudo: 'VSL ADS',
          source: 'ghl',
          ghl_synced_at: today.toISOString(),
        };

        // Si está perdido al alta, marcarlo
        if (isPerdido) {
          newCuota.perdido = true;
          newCuota.estado = 'Perdido';
          const dateUpdated = ct.dateUpdated ? new Date(ct.dateUpdated) : today;
          newCuota.fechaPerdido = (isFirstSync && !isNaN(dateUpdated.getTime()) ? dateUpdated : today).toISOString().split('T')[0];
          bajasNuevas++;
        }

        // Backfill de pagos: pagos[mes] = caja NETA del mes (no facturación).
        // El ticket queda como referencia del precio del plan (397/247).
        if (cajaMes > 0) {
          const endDate = newCuota.fechaPerdido ? new Date(newCuota.fechaPerdido) : today;
          if (endDate >= fechaInicio) {
            for (const { y, m } of monthsBetween(fechaInicio, endDate)) {
              const key = `${y}-${MONTHS[m]}`;
              if (!newCuota.pagos[key]) {
                newCuota.pagos[key] = cajaMes;
                pagosBackfill++;
              }
            }
          }
        }

        S.cuotas.push(newCuota);
        altasNuevas++;
      } else {
        // YA EXISTE: actualizar metadatos y revisar baja
        if (!cuota.ghl_contact_id) cuota.ghl_contact_id = ct.id;
        if (!cuota.email && ct.email) cuota.email = ct.email;
        if (!cuota.telefono && ct.phone) cuota.telefono = ct.phone;
        cuota.ghl_synced_at = today.toISOString();

        // Si el plan en GHL es mayor jerarquía y la cuota actual no, actualizar
        // (caso: cliente subió de PRO a BUSINESS)
        if (cuota.plan && PLAN_PRIORITY[plan] > (PLAN_PRIORITY[cuota.plan] || 0)) {
          cuota.plan = plan;
          cuota.ticket = PLAN_TICKETS[plan] || cuota.ticket;
        } else if (!cuota.plan) {
          cuota.plan = plan;
          cuota.ticket = PLAN_TICKETS[plan] || cuota.ticket || 0;
        }

        // Marcar baja si tag perdido apareció
        if (isPerdido && !cuota.perdido) {
          cuota.perdido = true;
          cuota.estado = 'Perdido';
          cuota.fechaPerdido = todayISO;
          bajasNuevas++;
        }
      }
    }

    if (isFirstSync) S.ghl_first_sync_at = today.toISOString();
    S.ghl_last_sync_at = today.toISOString();

    await sb.from('crm_data').upsert({ id: ZEROCHATS_RECORD_ID, data: S });

    return new Response(JSON.stringify({
      success: true,
      first_sync: isFirstSync,
      contactos_ghl: contacts.length,
      altas_nuevas: altasNuevas,
      bajas_nuevas: bajasNuevas,
      pagos_backfill: pagosBackfill,
      total_cuotas: S.cuotas.length,
      date: todayISO,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
