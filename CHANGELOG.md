# Changelog — Panel de Métricas Agencia Legado

Registro vivo de cambios. Cada entrada incluye **fecha**, **PR/commit**, **archivos afectados**, **qué se cambió** y **por qué**.
Empezamos a partir del 2026-05-07 — cambios anteriores ver `git log`.

---

## 🔒 Reglas inviolables del proyecto

> Estas reglas se aplican a TODOS los cambios futuros. Si añades una nueva feature, lee esta sección antes y verifica que la cumples.

### R1 — Admin siempre ve toda nueva feature
**Cualquier nueva sección/página/funcionalidad de UI debe estar visible cuando el usuario es admin (`IS_ADMIN=true`)**, independientemente del cliente que tenga seleccionado en el dropdown. Diego usa el modo admin para inspeccionar, debuguear y soportar — no puede haber features que se le oculten.

Implementación obligatoria: cuando crees una nueva feature flag en `crm_clients` (ej. `has_X`), debes:
1. Cargarla en `loadClientConfig`: `HAS_X = data.has_x || false;`
2. Forzarla a `true` en admin: añadirla al bloque `if (IS_ADMIN) { HAS_X = true; ... }` al final de `loadClientConfig`.
3. Documentar en este CHANGELOG bajo qué condiciones la feature se muestra.

**Excepción**: flags que cambian interpretación de datos (no solo visibilidad), como `HAS_TICKET_MENSUAL`, `SEMANAS_MODO`, `auto_renew` — esos NO se fuerzan en admin porque romperían el render de clientes que no lo tengan.

### R2 — Backups antes de cualquier UPDATE masivo en `crm_data`
Ver `DATA_PROTECTION_RULES.md`. Resumen:
- `INSERT INTO crm_backups (client_id, data) SELECT ...` antes de cualquier UPDATE.
- Per-client UPDATE; nunca subqueries con `FROM crm_data` anidadas.
- SELECT previo con la misma lógica.
- Verificar conteos justo después.

### R3 — PR + merge para todo el código
Nunca commit directo a `main`. Cada cambio: rama → PR → merge. Vercel deploya `main` en cada push.

### R4 — Toda acción se documenta aquí
Tras mergear, añadir entrada al CHANGELOG con: archivos afectados, qué se cambió, por qué.

---

## 2026-05-08

### PR (a abrir) — Vista Global: separadores verticales entre meses
- **Archivo**: `index.html` (renderVistaGlobal)
- **Qué**: añadidas líneas verticales `1px solid var(--border)` entre cada columna de mes para mejorar legibilidad. Línea más fuerte (2px) antes de la columna TOTAL para destacarla. Tabla pasa a `border-collapse: separate; border-spacing: 0` para que los borders no colapsen con los del card contenedor.
- **Por qué**: a Diego le costaba seguir las filas en la tabla sin separadores entre meses.

### PR #31 — Vista Global rediseñada: layout vertical + grupos por color
- **Archivo**: `index.html` (`vistaKpisMes`, `renderVistaGlobal`)
- **Qué**: la Vista Global pasa de tabla horizontal (meses en filas, métricas en columnas) a **vertical** (métricas en filas, meses en columnas). Métricas agrupadas en bandas de color suave:
  - **Publicidad** (azul claro): Inversión · Leads totales · Coste por Lead.
  - **Setting** (violeta claro): Llamadas agendadas · % Agendamiento · Coste por llamada · Llamadas asistidas · % Asistencia · Coste por asistencia.
  - **Closing** (verde claro): % Cierre · Ventas totales.
  - **Retorno** (ámbar claro): Facturación · Caja · ROI · ROAS · CAC.
- **Métricas nuevas**: Coste por Asistencia (`inv/realizadas`) y CAC (`inv/ventas`).
- **Total anual** ahora aparece como **última columna** en lugar de footer (más fácil de leer en vertical).
- **Stripes alternos suaves** dentro de cada grupo + banda de color del grupo en la cabecera.
- **Por qué**: la mirada cubre mejor el conjunto cuando las métricas están listadas verticalmente. Diego lo prefiere así.

### PR #30 — Implementar regla R1: admin ve todas las features
- **Archivo**: `index.html` (loadClientConfig)
- **Qué**: añadido bloque `if(IS_ADMIN){...}` al final de `loadClientConfig` que fuerza a `true` todas las feature flags de visibilidad: `HAS_VISTA_GLOBAL`, `HAS_LANZAMIENTOS`, `HAS_UTMS`, `HAS_ESCALADO`, `SHOW_RENOVACIONES`.
- **Por qué**: Diego usa el modo admin para inspeccionar/debugear/soportar — no puede haber features que se le oculten por estar en otro cliente. Establecida como **Regla R1 inviolable** del proyecto al inicio del CHANGELOG.

### Lucas Rodriguez — import histórico ENE→MAY 2026
- **Tabla**: `crm_data` (record_id `lucas_2026`)
- **Backup pre-import**: id 60.
- **Datos importados** desde `KPIS de Ventas Lucas Rodriguez 2026.xlsx`:
  - 123 llamadas en `S.llamadas['2026-01..05']` (Ene 35 / Feb 27 / Mar 28 / Abr 26 / May 7).
  - 47 cuotas en `S.cuotas` (auto-generadas desde ventas, facturación total **27.454€**).
- **Reglas de cuotas aplicadas**:
  - Facturación < 200€ → 1 cuota.
  - 200€ ≤ Facturación < 500€ → 3 cuotas.
  - Facturación ≥ 500€ → 6 cuotas.
  - `fechaInicio` = primer día del mes de la venta.
- **Mapeo de estados**: "No venta" → estado vacío (no Perdido), "En seguimiento" / "Venta" se preservan.
- **ENE** trae fechas reales del Excel; **FEB-MAY** sin fecha (Excel no la tenía) — se respetan vacías y se colocan en el bucket mensual.

### Migración: `crm_clients.has_vista_global`
- Nueva columna `boolean default false`.
- Activada solo para `lucas_2026` (test).

### Migración: añadir `QUIZ TEMPLADO` a canales de Lucas
- Lucas: `canales` ahora = `['VSL','QUIZ','SOCIAL','REFERIDOS','QUIZ TEMPLADO']`.
- Convención global futura: nombre de campaña con "templado", "warm" o "tofu" → mapea a `QUIZ TEMPLADO`. El default de "QUIZ" se mantiene para campañas frías sin marcador.

### Edge function `sync-meta-ads` v37
- `detectCanal` añade detección de templado vía `isQuizTempladoCampaign(name)`. Si el cliente tiene el canal `QUIZ TEMPLADO`, las campañas con esa palabra van ahí; si no, fallback a `QUIZ`.

### PR (a abrir) — Vista Global + UI QUIZ TEMPLADO
- **Archivos**: `index.html`
- Nueva página **Vista Global** (`vista_global`): KPIs anuales con filtro de embudo (GENERAL · QUIZ · QUIZ TEMPLADO · SOCIAL · REFERIDOS · VSL). Tabla con 12 meses × 16 métricas (Tráfico/Embudo/Conversión/Resultados) + total anual.
- Flag `HAS_VISTA_GLOBAL` lee `crm_clients.has_vista_global`. Sidebar entry oculta si false.
- Click en mes → navega a KPIs por mes de ese mes.

---

## 2026-05-07

### PR #28 — Fix acordeon ADS en KPIs diarios
- **Archivo**: `index.html` (renderKpisD + nueva función `toggleKpidCanal`)
- **Qué**: la flechita ▼ del bloque ADS en la página KPIs diarios no cerraba/abría el acordeón.
- **Causa**: el handler antiguo solo alternaba la clase `.open`, pero un bucle al final de `renderKpisD` forzaba `el.style.display='block'` en TODOS los `.kpid-canal-body`. El inline style ganaba al CSS.
- **Solución**: nueva función `toggleKpidCanal(headerEl)` que alterna directamente `body.style.display` entre `'none'` y `'block'` y rota el chevron 180°. Eliminado el bucle que sobreescribía el inline style.

### Migration `crm_data_anti_rollback_trigger`
- **Tabla**: `crm_data` (Postgres)
- **Qué**: trigger BEFORE UPDATE que rechaza cualquier escritura cuyo `updated_at` sea anterior al actual (con tolerancia 1s).
- **Por qué**: capa defensiva server-side. Si en algún momento un cliente envía un timestamp retrocedente, el servidor lo bloquea con error.

### PR #27 — Optimistic concurrency guard
- **Archivo**: `index.html` (loadData + sbSave)
- **Qué**: antes de cada `sbSave` el browser hace `select updated_at` en Supabase. Si remote > local + 1s, ABORTA el save y dispara `reloadFromSupabase()`. Tras un save exitoso, `lastLoadedTs` avanza al timestamp recién escrito.
- **Por qué**: incidente reproducido — el localStorage `crm_bruno_bk` se mantenía entre pestañas. Si una pestaña tenía datos viejos cacheados, cualquier acción que llamara `save()` upserteaba ese caché stale, machacando los datos buenos. Concretamente: el backfill colocó 558,93€/8 leads en Zerochats mayo, y minutos después una pestaña stale lo sobreescribió a 195€/5.

### PR #26 — Fix definitivo focus al escribir
- **Archivos**: `index.html` (sbSave, realtime listener, focusout handler, varias funciones up*)
- **Qué**:
  1. `sbSave()` limpia `saveTimer` en `finally` → updates externos vuelven a llegar tras un guardado.
  2. Funciones `up*` (`upKD`, `upMetaSeg`, `upAdNum`, `upLanzNum`, `upLanzKDNum` y % impuestos) dejan de re-renderizar; solo `save()` + actualizaciones puntuales por DOM-id (`updateKpiTotalsOnly`).
  3. Realtime listener: si el usuario está editando, no mergea `S`; guarda el payload en `pendingExternalUpdate` y lo aplica al `focusout`.
- **Por qué**: cada keystroke en varios inputs disparaba `save()` + `renderX()` → re-render completo → cursor perdido. Y el listener realtime también re-renderizaba con el eco de nuestras propias escrituras.

### PR #25 — Quitar UI Seguidores en KPIs diarios
- **Archivos**: `index.html`
- **Qué**: las filas META en KPIs diarios siempre muestran número de leads (incluso 0). Antes, una fila con `leads=0` se renderizaba como `<input type="number" placeholder="Seguidores">`. Las agregaciones de leads en dashboard / KPIs por mes / lanzamientos dejan de sumar `seguidores`. Tarjeta superior pasa de "Leads / Seguidores" a "Leads totales". Cabeceras de canal usan siempre "Resultados" / "CPL".
- **Por qué**: Meta = clientes potenciales, todas las campañas que NO son Social Funnel deben contar como leads. La UI confundía "leads=0 hoy" con "campaña social".

### PR #24 — Cuotas editables Zerochats + Excluir Social Funnel + Acordeones funcionales + Admin edición total
- **Archivos**: `index.html`, `supabase/functions/sync-meta-ads/index.ts`
- **Qué**:
  1. **Cuotas Zerochats/GHL editables**: las celdas mensuales de la tabla de cuotas pasan de `<span>` solo-lectura a `<input>` editables. Persisten en `c.pagos[YYYY-MMM]` mediante nueva función `upCuotaPago(i,key,v)`.
  2. **Excluir Social Funnel del cálculo de inversión Meta Ads**: en `applyDayInsights` y `applyTopAds`, las campañas detectadas como social funnel (nombre con `seguidores`, `followers` o `social funnel`) se descartan. No aportan inversión, ni leads, ni canal.
  3. **Acordeones funcionales**: `acordeon()` pasa de `<details>/<summary>` con `display:flex` a `<div>` + `onclick="toggleAcordeon(...)"`. El `display:flex` en `<summary>` rompía el toggle nativo de `<details>` en Chrome/WebKit.
  4. **Admin con edición total**: eliminado el bloque CSS `body.is-admin .ce { pointer-events:none }` y la lógica que añadía/quitaba la clase. Admin edita igual que cualquier cliente; solo se mantiene el badge "ADMIN" en sidebar.

### Migration: `crm_clients.meta_campaign_filter` para Zerochats → NULL
- **Tabla**: `crm_clients`
- **Qué**: `update crm_clients set meta_campaign_filter = null where record_id = 'zerochats_2026';`
- **Por qué**: el filtro `["Clientes potenciales - 02-03-2026"]` solo arrastraba 1 de las 4 campañas activas de Zerochats. Sin filtro, el sync-meta-ads procesa TODAS las campañas y descarta automáticamente las Social Funnel.

### Edge function `sync-meta-ads` v36 — desplegada
- **Archivo**: `supabase/functions/sync-meta-ads/index.ts`
- **Qué**: campañas Social Funnel quedan completamente fuera del agregado de inversión y de Top Ads. Antes la versión vieja las marcaba pero las dejaba pasar.
- **Por qué**: requisito de Diego para que la inversión total NO incluya el gasto de campañas de seguidores.

### Operaciones de datos
- **Backups creados**:
  - id 47 (Zerochats pre-cleanup)
  - ids 50–55 (Bruno, Lucas, María, Quique, Pablo, Paul pre-cleanup)
  - id 56 (Zerochats antes de la 2ª restauración)
- **Limpieza de entradas meta huérfanas** en `crm_data → kpis_diarios → 2026-04 / 2026-05`: una por cliente, preservando entradas manuales.
- **Backfill aplicado** vía `sync-meta-ads` para los 7 clientes con Meta Ads, fechas Abr 1 → hoy. Resultado:
  | Cliente | Abril | Mayo |
  |---|---|---|
  | Bruno Gómez | 0€ / 0 | 0€ / 0 |
  | Lucas Rodriguez | 400,23€ / 37 leads | 0€ / 0 |
  | María Ortega | 497,28€ / 104 leads | 0€ / 0 |
  | Pablo Cristóbal | 569,16€ / 85 leads | 307,58€ / 25 leads |
  | Paul Lázaro | 1.515,37€ / 254 leads | 297,18€ / 32 leads |
  | Quique Brisach | 2.278,64€ / 219 leads | 2.235,70€ / 137 leads |
  | Zerochats | 1.769,07€ / 60 leads | 572,50€ / 10 leads |

---

## Convenciones para próximos cambios

1. **Siempre** crear PR (no commit directo a main).
2. Incluir test plan en el PR body.
3. Antes de cualquier `UPDATE crm_data` masivo:
   - Backup explícito: `insert into crm_backups (client_id, data) select id, data from crm_data where id = '<X>'`
   - Per-client: un UPDATE por cliente, NO masivos con subqueries de crm_data.
   - Verificación de conteos justo después.
4. Después del merge, actualizar este CHANGELOG con la entrada nueva.
5. Si se cambia algo en la edge function `sync-meta-ads`, `sync-ghl-zerochats` u otra: indicar versión post-deploy.

## Cómo continuar en una nueva conversación

Para que un Claude futuro entienda el estado del proyecto sin repetir contexto:
1. Leer `CLAUDE.md` (raíz) — instrucciones generales del proyecto.
2. Leer `DATA_PROTECTION_RULES.md` — reglas inviolables del CRM.
3. Leer este `CHANGELOG.md` — qué se ha tocado y por qué.
4. `git log --oneline -20` — últimos commits.
5. Si la tarea afecta a `crm_data`, leer también el último incidente al final de `DATA_PROTECTION_RULES.md`.
