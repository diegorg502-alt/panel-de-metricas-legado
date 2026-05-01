import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cron diario. Para cada cliente con auto_renew=true, recorre sus suscriptores
// (S.cuotas con plan PRO/BUSINESS no perdidos) y, si el mes actual aún no
// está pagado, registra el pago directamente en cuota.pagos[YYYY-MMM].
// NO se inyecta nada en S.llamadas[mk] — los KPIs del mes solo reflejan altas reales.

const PLAN_AMOUNTS: Record<string, number> = { PRO: 247, BUSINESS: 397 };
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

Deno.serve(async () => {
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: clients } = await sb
      .from('crm_clients')
      .select('*')
      .eq('auto_renew', true);

    if (!clients?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No auto-renew clients' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const today = new Date();
    const results: any[] = [];

    for (const client of clients) {
      const { data: cd } = await sb.from('crm_data').select('data').eq('id', client.record_id).single();
      const S = cd?.data || {};
      if (!S.cuotas) S.cuotas = [];

      let pagosAdded = 0;
      let activeSubscribers = 0;

      for (const cuota of S.cuotas) {
        if (!cuota.plan || !['PRO', 'BUSINESS'].includes(cuota.plan)) continue;
        if (cuota.perdido || cuota.estado === 'Perdido') continue;
        activeSubscribers++;

        if (!cuota.pagos || typeof cuota.pagos !== 'object' || Array.isArray(cuota.pagos)) {
          cuota.pagos = {};
        }

        const amount = PLAN_AMOUNTS[cuota.plan] || Number(cuota.ticket) || 0;
        if (!amount) continue;

        // Fecha tope para registrar pagos: hoy o fechaPerdido (lo que ocurra antes)
        const startDate = new Date(cuota.fechaInicio);
        const endDate = cuota.fechaPerdido ? new Date(cuota.fechaPerdido) : today;
        if (isNaN(startDate.getTime())) continue;
        if (endDate < startDate) continue;

        // Asegura que cada mes desde el inicio hasta hoy tenga su pago.
        // Esto cubre tanto la primera ejecución (backfill) como mensual.
        for (const { y, m } of monthsBetween(startDate, endDate)) {
          const key = `${y}-${MONTHS[m]}`;
          if (!cuota.pagos[key]) {
            cuota.pagos[key] = amount;
            pagosAdded++;
          }
        }
      }

      if (pagosAdded > 0) {
        await sb.from('crm_data').upsert({ id: client.record_id, data: S });
      }

      results.push({
        client: client.record_id,
        active_subscribers: activeSubscribers,
        pagos_added: pagosAdded
      });
    }

    return new Response(JSON.stringify({ success: true, results, date: today.toISOString().split('T')[0] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
