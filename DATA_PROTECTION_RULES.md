# 🛡 Reglas estrictas de protección de datos del CRM

**Aplica a cualquier operación sobre `crm_data` o `crm_clients` en Supabase.**

Estas reglas se crearon tras un incidente donde un `UPDATE` con cross-join SQL incorrecto combinó las llamadas de 3 clientes (Lucas, Pablo, Paul) entre sí, mezclando 292 llamadas que no les correspondían. El daño se reparó vía backup, pero NUNCA debe volver a ocurrir.

---

## REGLAS INVIOLABLES (en orden de prioridad)

### 1. ❌ Prohibido `FROM crm_data` dentro de una subquery anidada en un `UPDATE crm_data`

Crea ambigüedad: la subquery itera **TODOS los registros**, no la fila actualizada.

```sql
-- ❌ MAL: cross-join silencioso, mezcla datos de TODOS los clientes
UPDATE crm_data
SET data = jsonb_set(data, '{cuotas}', (
  SELECT jsonb_agg(...)
  FROM crm_data, jsonb_array_elements(data->'cuotas') c   -- ← ¡crm_data se itera entero!
  WHERE id = crm_data.id
))
WHERE id IN ('pablo_2026', 'lucas_2026');

-- ✅ BIEN: opera sobre la columna data directamente sin re-FROM
UPDATE crm_data
SET data = jsonb_set(data, '{cuotas}', (
  SELECT jsonb_agg(...)
  FROM jsonb_array_elements(data->'cuotas') c   -- ← sin FROM crm_data
))
WHERE id = 'pablo_2026';
```

### 2. 🔒 Un `UPDATE` masivo solo se ejecuta para UN cliente a la vez

Si hay que tocar varios, **bucle externo** (Bash o JS), nunca `WHERE id IN (...)` con subqueries complejas.

```bash
# ✅ Bien — un cliente a la vez, fácil de auditar
for client in pablo_2026 lucas_2026 paul_2026; do
  psql ... -c "UPDATE crm_data SET data = ... WHERE id = '$client'"
done
```

### 3. 📋 Prohibido `UPDATE` sin `SELECT` previo de validación

Antes de cualquier `UPDATE` que toque `crm_data`, ejecutar exactamente la misma subquery como `SELECT` y verificar que los resultados son los esperados.

```sql
-- ✅ Paso 1: SELECT con la lógica que se aplicará
SELECT jsonb_agg(CASE WHEN ... THEN ... ELSE c END)
FROM jsonb_array_elements(data->'cuotas') c
WHERE id = 'pablo_2026';

-- ✅ Paso 2: solo si el SELECT se ve bien, el UPDATE
UPDATE crm_data SET data = jsonb_set(...) WHERE id = 'pablo_2026';
```

### 4. 🔁 Operaciones masivas → Edge Function con `dry_run`, no SQL

Para cualquier transformación que toque más de una fila:

- **Crear una Edge Function** con parámetro `dry_run: true` por defecto.
- Ejecutar primero en `dry_run`, mostrar al usuario el reporte detallado.
- Solo ejecutar en `dry_run: false` tras confirmación explícita del usuario.

Esto ya existe para `dedupe-cuotas-zerochats`, `reconcile-zerochats-csv`, `migrate-cuotas-pagos`. Ese es el patrón a seguir.

### 5. 💾 Backup explícito antes de cualquier `UPDATE` masivo

El cron de backup diario corre a las 03:00 AM, pero entre backups un error puede mezclar datos. Antes de un `UPDATE` masivo:

```sql
-- Insertar un snapshot manual en crm_daily_backups
INSERT INTO crm_daily_backups (client_id, data)
SELECT id, data FROM crm_data WHERE id = 'pablo_2026';
```

### 6. ✅ Verificación posterior obligatoria

Tras cualquier `UPDATE`, ejecutar inmediatamente un `SELECT` que cuente filas/tamaños y compararlos con los esperados:

```sql
-- Verificar tras UPDATE
SELECT id,
  jsonb_array_length(data->'cuotas') AS cuotas,
  (SELECT SUM(jsonb_array_length(v)) FROM jsonb_each(data->'llamadas') AS m(k,v)) AS llamadas
FROM crm_data WHERE id = 'pablo_2026';
```

Si la cifra es muy distinta a la esperada (ej: 47 → 292), **restaurar inmediatamente** desde `crm_daily_backups`.

### 7. 🚫 Prohibido `WHERE id IN (subquery)` cuando el `SET` también referencia `crm_data`

```sql
-- ❌ MAL: ambigüedad y posible cross-join
UPDATE crm_data
SET data = jsonb_set(data, '{cuotas}', (SELECT ... FROM crm_data ...))
WHERE id IN (SELECT record_id FROM crm_clients WHERE semanas_modo);

-- ✅ BIEN: resolver la lista primero, luego UPDATE explícito
-- Paso 1
SELECT record_id FROM crm_clients WHERE semanas_modo;
-- → ['pablo_2026', 'lucas_2026', 'paul_2026']

-- Paso 2: bucle externo, un UPDATE por cliente
UPDATE crm_data SET data = ... WHERE id = 'pablo_2026';
UPDATE crm_data SET data = ... WHERE id = 'lucas_2026';
UPDATE crm_data SET data = ... WHERE id = 'paul_2026';
```

### 8. 🧪 Para transformaciones complejas usar JS en Edge Function, no SQL anidado

`jsonb_set` con `jsonb_agg` y subqueries anidadas es difícil de auditar. Si la lógica requiere más de 3 niveles de anidación, **migrar a TypeScript** dentro de una Edge Function:

```typescript
// ✅ Mucho más legible y testeable
for (const client of clients) {
  const { data: cd } = await sb.from('crm_data').select('data').eq('id', client.record_id).single();
  const S = cd?.data || {};
  // ... transformación en JS
  if (!dryRun) await sb.from('crm_data').upsert({ id: client.record_id, data: S });
}
```

---

## CHECKLIST OBLIGATORIO ANTES DE CUALQUIER `UPDATE crm_data`

Antes de ejecutar el SQL, verificar mentalmente:

- [ ] ¿Tiene la query `FROM crm_data` dentro de una subquery? → **STOP. Reescribir.**
- [ ] ¿Toca más de un cliente con la misma sentencia? → **STOP. Bucle externo.**
- [ ] ¿He ejecutado el `SELECT` equivalente primero? → **Si no, hacerlo.**
- [ ] ¿He preparado la sentencia de restore desde backup por si falla? → **Sí, siempre.**
- [ ] ¿La operación afecta a más de 5 filas/registros? → **Pasarla a Edge Function con dry_run.**

---

## En caso de incidente

1. **Detener inmediatamente** cualquier nueva escritura.
2. Identificar el alcance: `SELECT id, jsonb_array_length(...) FROM crm_data` para ver qué se rompió.
3. Restaurar desde `crm_daily_backups` con `created_at` anterior al incidente.
4. Verificar restauración con conteos.
5. Documentar la causa raíz en este archivo.

---

## Histórico de incidentes

### 2026-05-05 — Cross-join `UPDATE` mezcló llamadas de Lucas/Pablo/Paul

**Causa**: `UPDATE crm_data SET data = ... (SELECT ... FROM crm_data ... WHERE id = crm_data.id)` con `WHERE id IN (subquery)`. La referencia `crm_data.id` dentro de la subquery resolvió al alias inner (siempre TRUE), iterando todos los clientes de SEMANAS_MODO juntos.

**Daño**: Pablo, Lucas y Paul terminaron con 292 llamadas cada uno (suma de los 3).

**Solución**: Restauración desde backup `crm_daily_backups` `created_at='2026-05-05 03:00'`.

**Lección**: Reglas 1, 2 y 7 de este documento.
