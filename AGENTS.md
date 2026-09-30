# Kowalski — guía de trabajo

## Qué es el proyecto

Kowalski es una PWA de finanzas personales en soles peruanos basada en un presupuesto por sobres: Necesidad, Ocio y Ahorro. Reparte los ingresos según porcentajes configurables, controla los topes del mes y conserva el ahorro acumulado entre meses. Usa React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand, react-hook-form con zod, Firebase Auth y Firestore, Recharts y vite-plugin-pwa. Las pruebas usan Vitest.

## Convenciones no negociables

- **Dinero:** persistir y calcular montos como enteros en centavos (`*Cents`); convertir a soles solo para entrada y presentación. El reparto debe conservar exactamente el total y asignar a Ahorro el residuo de redondeo. No introducir saldos espejo: el ahorro sin asignar se calcula desde `savingsTotalCents` y las asignaciones a metas. No mover ni corregir dinero en silencio.
- **Categorías:** usar el conjunto cerrado `"necesidad" | "ocio" | "ahorro"` definido en `src/types/transaction.ts`. Los topes y el gasto mensual de `Month` corresponden a Necesidad y Ocio; Ahorro se gestiona como acumulado. No aceptar categorías arbitrarias ni convertir saldo prestado en ahorro.
- **Fechas:** ID de mes `YYYY-MM`; `transactionDate` `YYYY-MM-DD` como día declarado, por defecto hoy y seleccionable solo para un día pasado del mes actual. `localDate` (ISO) y `serverDate` (Timestamp de Firestore) registran el momento de creación. `transactionTime` puede existir en datos anteriores, pero no se captura ni guarda en registros nuevos ni se usa para mostrar una segunda hora. Las correcciones de fecha pertenecen al mes actual abierto y deben respetar las restricciones de operaciones vinculadas.
- **Firestore:** al añadir o modificar reglas, validar estrictamente la creación (propietario, forma, tipos, montos, fechas y estado del mes). En actualizaciones, conservar identidad y campos inmutables y limitar los campos mutables a los necesarios; las bitácoras de movimientos y asignaciones no admiten edición ordinaria. Mantener la autorización por `uid` y las excepciones explícitas del flujo de eliminación de datos. Revisar `firestore.rules` junto con cada cambio de esquema.
- **Responsabilidades:** `src/services/` concentra las operaciones y escrituras de Firestore; `src/utils/` contiene cálculos y formatos puros; `src/pages/` compone las pantallas y llama a esas capas. Hay escrituras históricas en línea en `RegisterIncome.tsx` y `RegisterExpense.tsx`: no extender ese patrón. Los modelos compartidos viven en `src/types/`.
- **Integridad:** los meses cerrados no se reabren por operaciones normales. Una operación financiera y su registro de historial relacionado se escriben de forma atómica. Antes de cambiar montos, revisar las interacciones entre mes, ahorro, metas, préstamos y tarjetas. Si un dato no se puede determinar, mostrarlo como tal en lugar de sustituirlo por cero. Para cambios de comportamiento, ejecutar pruebas, lint y build.

## Estado actual

- **Implementado en el código:** autenticación y onboarding; reparto de ingresos, egresos y presupuestos; historial y exportación CSV; análisis; cierre automático de mes y movimientos de excedentes; metas y fondos de ahorro; préstamos con cuotas y pagos confirmados; plantillas de gastos y flujos de reinicio o eliminación de datos. El Dashboard presenta el ahorro neto mensual. Los registros nuevos permiten elegir un día pasado del mes actual como fecha de operación y ya no capturan ni guardan una hora declarada; el Historial permite corregir fechas en operaciones admitidas. Ver [ahorro mensual y fechas](docs/ahorro-mensual-fechas.md). Los objetivos mensuales por subcategoría son informativos y muestran avisos sin bloquear gastos ni alterar saldos.
- **Publicación comprobada:** la versión de Firebase Hosting sirve los textos de ahorro neto mensual, selección de un día pasado, objetivos mensuales por subcategoría y «Exceso» de línea de tarjeta. No se ha validado manualmente el funcionamiento tras iniciar sesión.
- **Tarjetas revolventes:** existe seguimiento manual de compras, estados de cuenta y pagos. Una compra aumenta la deuda; el usuario confirma el mínimo, el total y los intereses del estado de cuenta; un pago total, mínimo u otro reduce la deuda dejando el resto pendiente. Si la deuda supera la línea, se muestra un aviso al registrar la compra y «Exceso» en la pantalla de tarjetas, sin bloquear la operación. Falta automatizar el cálculo de interés del siguiente ciclo y la generación de un plan de cuotas a partir de la deuda revolvente.
- **Reglas endurecidas, aún no desplegadas a producción:** `firestore.rules` valida estrictamente la creación de `months` y `transactions` y limita las actualizaciones a los campos que cambian, conservando los campos legacy que no se modifican. Las fechas tienen una tolerancia de 3 días respecto a la hora del servidor, sin zona horaria fija. Las reglas se probaron con 143 pruebas de emulador y con la app completa en local contra emulador: los flujos normales no presentaron errores de permisos y una escritura manipulada fue rechazada.
- **Reglas pendientes:** aplicar el mismo endurecimiento a `users`, `loans` y `creditCards`.

## Decisiones de diseño acordadas

- **Objetivos mensuales por subcategoría:** es el término visible para los límites opcionales e informativos; suman consumo propio, con préstamo y con tarjeta, sin volver a contar pagos de deuda. Alertan sin bloquear ni cambiar porcentajes, topes o saldos.
- **Línea de tarjeta:** es independiente del disponible de Necesidad y Ocio; excederla genera un aviso y no bloquea la compra. Los intereses y cargos son gasto de Necesidad; pagar la tarjeta solo reduce deuda, sin volver a contar el gasto.
- **Plantillas y sugerencias:** las plantillas solo rellenan el formulario y nunca predeterminan un préstamo o tarjeta; las sugerencias de categoría requieren confirmación del usuario. Ninguna registra gastos automáticamente.
- **Etiquetas:** son opcionales y deben aportar filtros útiles en Historial y Análisis.
- **Períodos personalizados:** quincenas o rangos según fecha de pago solo cambian la vista de Análisis; el mes contable permanece igual.
- **Geolocalización:** no se incorpora al registro de gastos.
- **Onboarding:** basta una fuente de ingresos, aunque no sea fija. Sin ingresos fijos, la referencia estimada es opcional, solo calcula el mínimo de Necesidad y no se guarda; sin base, el mínimo figura como no calculable.
- **Temas:** Claro, Oscuro neutro y Oscuro azulado se eligen manualmente; no hay selección automática por dispositivo.
- **Tono de avisos:** ámbar indica una advertencia que no bloquea el registro; rojo se reserva para errores o bloqueos reales.
- **Claridad de avisos:** los avisos informativos deben aclarar que el objetivo o aviso en sí no afecta saldos ni bloquea la operación.

## Documentación de referencia

- [Arquitectura y decisiones técnicas](docs/ARQUITECTURA.md): modelo de datos, invariantes financieras, responsabilidades de servicios, pantallas, reglas y despliegue. Consultar su sección de invariantes antes de tocar dinero; comprobar los detalles contra el código actual.
- [Requisitos completos](docs/requisitos_completos.txt): requisitos y propuestas históricas, incluido un diseño alternativo de cierre de mes. Usarlo como antecedente funcional y verificar qué parte existe antes de implementarla o describirla como terminada.
