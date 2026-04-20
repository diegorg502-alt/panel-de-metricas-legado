import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Runs on day 1 of each month. For each client with auto_renew=true,
// processes active clients (PRO/BUSINESS monthly plans) and adds a renewal entry.
// Clients marked as "Perdido" are skipped.

const PLAN_AMOUNTS: Record<string, number> = { PRO: 247, BUSINESS: 397 };
const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

function getCurrentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

Deno.serve(async () => {
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get all clients with auto_renew enabled
    const { data: clients } = await sb
      .from('crm_clients')
      .select('*')
      .eq('auto_renew', true);

    if (!clients?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No auto-renew clients' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const results = [];
    const today = getToday();
    const mk = getCurrentMonthKey();

    for (const client of clients) {
      const { data: cd } = await sb.from('crm_data').select('data').eq('id', client.record_id).single();
      const S = cd?.data || {};
      if (!S.llamadas) S.llamadas = {};
      if (!S.llamadas[mk]) S.llamadas[mk] = [];
      if (!S.cuotas) S.cuotas = [];

      let renewedCount = 0;

      // Find all active monthly subscribers (plan PRO or BUSINESS, not marked Perdido)
      const activeClients = S.cuotas.filter((c: any) => {
        if (!c.plan || !['PRO', 'BUSINESS'].includes(c.plan)) return false;
        if (c.estado === 'Perdido' || c.perdido) return false;
        return true;
      });

      for (const cuota of activeClients) {
        // Check if this month already has a renewal entry for this client
        const alreadyRenewed = S.llamadas[mk].some(
          (l: any) => l.nombre === cuota.nombre && l.source === 'auto-renew'
        );
        if (alreadyRenewed) continue;

        const amount = PLAN_AMOUNTS[cuota.plan] || cuota.ticket || 0;

        S.llamadas[mk].push({
          nombre: cuota.nombre,
          fecha: today,
          telefono: cuota.telefono || '',
          embudo: cuota.embudo || '',
          closer: cuota.closer || 'Jordi',
          asistencia: 'SI',
          incidencia: '',
          estado: 'Venta',
          facturacion: amount,
          caja: amount,
          nCuotas: 1,
          mesesServicio: 1,
          comentarios: `Renovación automática ${cuota.plan}`,
          plan: cuota.plan,
          source: 'auto-renew',
          year: new Date().getFullYear()
        });
        renewedCount++;
      }

      if (renewedCount > 0) {
        await sb.from('crm_data').upsert({ id: client.record_id, data: S });
      }

      results.push({
        client: client.record_id,
        renewed: renewedCount,
        active_subscribers: activeClients.length
      });
    }

    return new Response(JSON.stringify({ success: true, results, date: today }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
