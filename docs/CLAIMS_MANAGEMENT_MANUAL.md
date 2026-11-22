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

## 6. Notificaciones Automáticas
* Cuando el administrador resuelve un reclamo, **tanto el cliente como el socio reciben una notificación push en sus teléfonos móviles** (`Reclamación Resuelta`).
* Al pulsar la notificación, la app móvil se abre directamente en los detalles del servicio mostrando el veredicto final.
