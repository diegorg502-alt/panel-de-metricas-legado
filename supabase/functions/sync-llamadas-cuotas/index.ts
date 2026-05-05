import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Sync masivo de S.llamadas → S.cuotas para cualquier cliente.
// Idempotente: si la cuota ya existe (por nombre normalizado), la actualiza.
// Si no, la crea. nCuotas se infiere de facturacion/caja cuando no es explícito.
//
// POST body: { record_id: 'bruno_2026' } (o sin body para todos los clientes con auto_renew=false)
//
// Útil tras importar llamadas en bulk (Excel, CSV) que no pasaron por la UI.

function inferirNCuotas(r: any): number {
  const explicit = Number(r.nCuotas);
  if (explicit && explicit > 1) return explicit;
  const fact = Number(r.facturacion) || 0;
  const caja = Number(r.caja) || 0;
  if (caja > 0 && caja < fact) return Math.max(1, Math.round(fact / caja));
  return explicit || 1;
}

function processClient(S: any): { creadas: number; actualizadas: number; total: number } {
  if (!S.cuotas) S.cuotas = [];
  let creadas = 0, actualizadas = 0;

  for (const [mk, llamadas] of Object.entries(S.llamadas || {})) {
    if (!Array.isArray(llamadas)) continue;
    for (const r of llamadas as any[]) {
      if (r.estado !== 'Venta') continue;
      const key = String(r.nombre || '').toUpperCase().trim();
      if (!key) continue;

      const fechaI = r.fecha || `${mk}-01`;
      const q = inferirNCuotas(r);
      const meses = Number(r.mesesServicio) || q || 1;

      const existing = S.cuotas.find((c: any) => String(c.nombre || '').toUpperCase().trim() === key);
      if (existing) {
        existing.ticket = r.facturacion || 0;
        existing.nCuotas = q;
        existing.fechaInicio = fechaI;
        existing.embudo = r.embudo || existing.embudo;
        existing.entrenador = r.entrenador || existing.entrenador;
        existing.mesesServicio = meses;
        actualizadas++;
      } else {
        S.cuotas.push({
          nombre: key,
          fechaInicio: fechaI,
          ticket: r.facturacion || 0,
          nCuotas: q,
          mesesServicio: meses,
          pagos: {},
          embudo: r.embudo || 'YOUTUBE',
          entrenador: r.entrenador || '',
          comentarios: r.comentarios || '',
          _source: 'sync-llamadas-cuotas',
        });
        creadas++;
      }
    }
  }

  return { creadas, actualizadas, total: S.cuotas.length };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const targetRecordId: string | undefined = body.record_id;

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let query = sb.from('crm_clients').select('record_id, auto_renew');
    if (targetRecordId) query = query.eq('record_id', targetRecordId);
    const { data: clients } = await query;

    if (!clients?.length) {
      return new Response(JSON.stringify({ success: false, error: 'no clients found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    const results: any[] = [];
    for (const cl of clients) {
      // Skip clientes con auto_renew=true (Zerochats) porque tienen su propio modelo de pagos persistentes
      if (cl.auto_renew && !targetRecordId) {
        results.push({ client: cl.record_id, skipped: true, reason: 'auto_renew' });
        continue;
      }
      const { data: cd } = await sb.from('crm_data').select('data').eq('id', cl.record_id).single();
      const S = cd?.data || {};
      const r = processClient(S);
      await sb.from('crm_data').upsert({ id: cl.record_id, data: S });
      results.push({ client: cl.record_id, ...r });
    }

    return new Response(JSON.stringify({ success: true, results }, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
