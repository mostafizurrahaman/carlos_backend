# Manual de Gestión de Reclamaciones y Disputas (Claims Management Manual)
**XM Carlos Transport Platform — Panel de Operaciones y Administración**

---

## 1. Resumen Ejecutivo
El módulo de **Gestión de Reclamaciones (Claims Management)** permite a los administradores y al equipo de operaciones supervisar, auditar y resolver de manera formal cualquier controversia o desacuerdo surgido entre Clientes y Socios Transportistas durante la prestación de un servicio.

---

## 2. Flujo de Vida de una Reclamación (Lifecycle)

```
[Cliente o Socio presenta Reclamación]
                  │
                  ▼
      [Estado: PENDING / Pendiente]
      (Se congela el pago del socio: Payout on Hold)
                  │
                  ▼
     [Estado: IN-PROGRESS / En Revisión]
     (Administración investiga fotos, notas y chat)
                  │
                  ▼
        [Decisión Formal de Resolución]
       ┌──────────┴──────────┐
       ▼                     ▼
  [RESOLVED]             [REJECTED]
 (Aprobado)             (Desestimado)
       │                     │
       ▼                     ▼
[Ejecución Financiera]   [Se Descongela Pago]
(Reembolso / Multa)      (Socio puede cobrar)
```

---

## 3. Estados de la Reclamación (Claim Statuses)

| Estado | Significado Operativo | Acción del Administrador | Estado del Pago al Socio |
|---|---|---|---|
| **Pending (Pendiente)** | La reclamación acaba de ser enviada por el usuario o socio. | Revisar la evidencia adjunta y cambiar a *In-Progress*. | **Congelado (Hold)**: No se puede confirmar entrega ni pagar. |
| **In-Progress (En Revisión)** | Operaciones está investigando activamente el caso (fotos, trazabilidad, notas). | Añadir notas internas y formular la propuesta de resolución. | **Congelado (Hold)**. |
| **Resolved (Resuelto)** | El administrador tomó una decisión formal (Reembolso, Penalización, etc.). | Hacer clic en "Ejecutar Decisión" si implica movimiento de dinero. | Depende del veredicto dictado. |
| **Rejected / Dismissed (Desestimado)** | La reclamación no procedió o carecía de evidencia legítima. | El caso se cierra sin penalización. | **Descongelado**: El socio puede confirmar y cobrar su servicio. |

---

## 4. Tipos de Disputa (Claim Types)
1. **Incumplimiento del Servicio (`SERVICE_NON_COMPLIANCE`)**: El vehículo no cumplió con las especificaciones, o no se presentó en la fecha y hora acordada.
2. **Daños a la Propiedad o Bienes (`DAMAGES`)**: Mercancía golpeada, rota o dañada durante la carga, traslado o descarga.
3. **Problema de Cancelación (`CANCELLATION_ISSUE`)**: Cancelación tardía injustificada o cobro de tarifa sin viaje realizado.
4. **Discrepancia de Precio o Cobro (`PRICE_DISCREPANCY`)**: Desacuerdo sobre la tarifa pactada frente al monto cobrado.
5. **Problema de Ubicación (`LOCATION_PROBLEM`)**: Entrega en dirección incorrecta o inaccesibilidad del punto de carga/descarga.
6. **Falta de Respuesta (`LACK_OF_RESPONSE`)**: El transportista o cliente no responde mensajes ni llamadas.
7. **Problema en la Entrega o Descarga (`DELIVERY_PROBLEM`)**: El socio se negó a descargar o abandonó la carga.
8. **Otro Desacuerdo (`OTHER`)**: Incidentes atípicos.

---

## 5. Procedimiento Paso a Paso en el Panel de Administración

### Paso 1: Localización del Caso
1. Acceda a la sección **File Claim / Claims Management** en el menú lateral.
2. Utilice los **chips de filtro de categoría** (Daños, Discrepancia de Precio, etc.) o la **barra de búsqueda** para ubicar el ID de Servicio o nombre del usuario.

### Paso 2: Inspección de Evidencias y Notas Internas
1. Haga clic en el botón con ícono de **Ojo (Ver Detalles)**.
2. Revise:
   - Fotos de evidencia subidas por el reclamante.
   - Perfil del Cliente y del Socio involucrado.
   - Sección de **Notas Internas de Administración**: Puede redactar bitácoras de investigación (estas notas están estrictamente protegidas y **nunca** son visibles para los usuarios ni socios en las apps).

### Paso 3: Emitir Resolución Formal
1. Haga clic en **Resolve Claim (Resolver Reclamación)**.
2. Seleccione el tipo de decisión:
   * **REFUND (Reembolso)**: Se devolverá un monto parcial o total al cliente vía Stripe. Ingrese el monto en MXN.
   * **PENALTY_APPLIED (Penalización al Socio)**: Se deducirá un porcentaje o monto específico de la billetera del socio.
   * **NO_ACTION (Sin Acción Monetaria)**: Se da por resuelto el reclamo mediante acuerdo mutuo sin impacto económico.
   * **DISMISSED (Desestimar)**: Se rechaza la queja por falta de pruebas.
3. Redacte las **Notas de Decisión (Decision Notes)** que justifican el fallo y confirme.

### Paso 4: Ejecución Financiera Segura (Execute Decision)
* **Importante:** Por seguridad contable, dictar la resolución no mueve el dinero de inmediato. 
* Cuando esté listo para procesar el reembolso en Stripe o la deducción en billetera, presione el botón **Execute Decision (Ejecutar Decisión)**.
* El sistema procesará la transacción con Stripe o la Billetera y registrará un **log inmutable de trazabilidad digital** (`CLAIM_DECISION_EXECUTED`).

---

## 6. Impugnación de una Reclamación (Contest)
La parte que **no** presentó la reclamación puede impugnarla desde la app (pestaña *Reclamaciones*), explicando su versión de los hechos.

| Regla | Detalle |
|---|---|
| ¿Quién puede impugnar? | Solo la otra parte: si el cliente presentó la reclamación, la impugna el socio, y al revés. |
| ¿Cuándo? | Solo mientras la reclamación está abierta (*Pending* o *In-Progress*). |
| ¿Cuántas veces? | Una sola vez por reclamación. |
| Motivo | Entre 10 y 1000 caracteres. |

**En el panel:** en **Ver Detalles** de la reclamación aparece el bloque **Impugnación** con el motivo, la fecha y quién la presentó (`contest.reason`, `contest.createdAt`, `contest.byRole`). Si no hay impugnación, el bloque no aparece.

**Qué hacer como administrador:**
1. Lea la reclamación original y la impugnación como dos versiones del mismo hecho.
2. Compare ambas con las fotos de evidencia, el chat del servicio y el registro de trazabilidad (`CLAIM_CONTESTED`).
3. Registre su análisis en las **Notas Internas** y emita la resolución formal (Paso 3). Impugnar **no** cambia el estado de la reclamación: la decisión sigue siendo del administrador.

---

## 7. Notificaciones Automáticas
| Evento | Quién recibe la notificación |
|---|---|
| Se presenta una reclamación | La **otra** parte (cliente → socio, socio → cliente) y el panel de administración. |
| La reclamación pasa a *In-Progress*, *Resolved* o *Rejected* | **Ambas** partes. |
| Se impugna una reclamación | Quien la presentó y el panel de administración. |

* Al pulsar la notificación, la app abre directamente la reclamación del servicio en la pestaña *Reclamaciones*.

---

## 8. Regla de Precio (Recargo)
El precio que ve el cliente en **Ofertas**, el de la pantalla de **Pago** y el monto que cobra Stripe se calculan con la misma regla, configurada en **Variable Management**:

| Campo | Valores | Efecto |
|---|---|---|
| `markupSource` | `category` (por defecto) | Usa el recargo de *Category Management*; si la categoría no tiene uno, usa el % de *Variable Management*. |
| | `variable` | Usa siempre el % de *Variable Management*. |
| | `higher` | Usa el mayor de los dos. |
| `markupScope` | `all` (por defecto) | Aplica a fletes y a ventas. |
| | `freight` | Solo a fletes (mudanzas); las ventas no llevan recargo. |

El monto que cobra Stripe se calcula siempre en el servidor a partir de la oferta guardada; nunca se usa el precio que envía la app.
