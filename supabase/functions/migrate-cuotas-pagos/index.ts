import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Migración una vez. Para cada cliente con auto_renew=true:
// 1. Recorre S.llamadas por todos los meses
// 2. Toma las llamadas con source='auto-renew' (renovaciones inyectadas por la edge function antigua)
// 3. Las suma al cuota.pagos[YYYY-MMM] del cliente correspondiente
// 4. Borra esas llamadas de S.llamadas[mk]
//
// Es idempotente: si ya está migrado (o nuevo registro auto-renew aparece), vuelve a procesar sin duplicar.

const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

function pagoKeyFromMk(mk: string): string {
  // mk = 'YYYY-MM' → 'YYYY-MMM' (ej '2026-04' → '2026-ABR')
  const [y, m] = mk.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return '';
  return `${y}-${MONTHS[idx]}`;
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

    const results: any[] = [];

    for (const client of clients) {
      const { data: cd } = await sb.from('crm_data').select('data').eq('id', client.record_id).single();
      const S = cd?.data || {};
      if (!S.llamadas || !S.cuotas) {
        results.push({ client: client.record_id, skipped: true, reason: 'no llamadas o cuotas' });
        continue;
      }

      let migratedRows = 0;
      let pagosWritten = 0;
      let removedRows = 0;
      const noMatch: string[] = [];

      for (const mk of Object.keys(S.llamadas)) {
        const list: any[] = S.llamadas[mk] || [];
        const autoRenewRows = list.filter(l => l && l.source === 'auto-renew');
        if (!autoRenewRows.length) continue;

        const pagoKey = pagoKeyFromMk(mk);
        if (!pagoKey) continue;

        for (const row of autoRenewRows) {
          const nombre = String(row.nombre || '').trim().toUpperCase();
          if (!nombre) continue;

          const cuota = S.cuotas.find((c: any) => String(c.nombre || '').trim().toUpperCase() === nombre);
          if (!cuota) {
            noMatch.push(`${mk} :: ${nombre}`);
            continue;
          }

          if (!cuota.pagos || typeof cuota.pagos !== 'object' || Array.isArray(cuota.pagos)) {
            cuota.pagos = {};
          }

          const amount = Number(row.facturacion || row.caja || 0);
          if (!cuota.pagos[pagoKey] && amount > 0) {
            cuota.pagos[pagoKey] = amount;
            pagosWritten++;
          }
          migratedRows++;
        }

        // Limpia las filas auto-renew del mes
        const cleaned = list.filter(l => !(l && l.source === 'auto-renew'));
        removedRows += list.length - cleaned.length;
        S.llamadas[mk] = cleaned;
      }

      if (migratedRows > 0) {
        await sb.from('crm_data').upsert({ id: client.record_id, data: S });
      }

      results.push({
        client: client.record_id,
        migrated_rows: migratedRows,
        pagos_written: pagosWritten,
        removed_rows: removedRows,
        no_match: noMatch,
      });
    }

    return new Response(JSON.stringify({ success: true, results, date: new Date().toISOString() }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
