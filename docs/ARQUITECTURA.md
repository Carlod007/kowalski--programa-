# Kowalski — Documentación técnica

Documento de referencia para retomar el proyecto sin contexto previo. Describe
qué hace la aplicación, cómo está construida, y **por qué** cada decisión
importante se tomó así. La sección de invariantes es la más valiosa: explica
las reglas que no se deben romper.

Última actualización: agosto 2026.

---

## 1. Qué es

PWA de finanzas personales que aplica **presupuesto por sobres** con tres
categorías de porcentaje configurable:

| Categoría | Qué es | Tope mensual |
|---|---|---|
| **Necesidad** | Gastos indispensables | Sí, se reinicia cada mes |
| **Ocio** | Gasto discrecional | Sí, se reinicia cada mes |
| **Ahorro** | Acumulación | No, es acumulado entre meses |

Cada ingreso se reparte automáticamente entre las tres según los porcentajes
del usuario (por ejemplo 18/47/35). Necesidad y Ocio funcionan como topes de
gasto del mes; Ahorro se acumula indefinidamente y solo baja al comprar una
meta o retirar de un fondo.

Moneda: soles peruanos (S/). **Todo el dinero se guarda como enteros en
centavos**, nunca como decimales.

---

## 2. Stack

- **React 19** + **TypeScript** + **Vite 8**
- **Tailwind CSS v4** (sin archivo de configuración; se usa `@import "tailwindcss"`)
- **Firebase**: Auth (email/contraseña) + Firestore
- **Zustand** para el estado de sesión (`authStore`)
- **react-hook-form** + **zod** en formularios
- **Recharts** para gráficos
- **vite-plugin-pwa** (Workbox) para la instalación y actualizaciones
- **Vitest** para pruebas
- **lucide-react** para algunos iconos (el resto son SVG propios)

### Comandos

```bash
npm run dev      # desarrollo
npm test         # pruebas (43, una vez)
npm run test:watch
npm run lint
npm run build    # tsc -b && vite build
```

### Estructura

```
src/
  components/    Piezas reutilizables de UI
  hooks/         useAhorroBreakdown
  lib/           firebase.ts (inicialización)
  pages/         Una pantalla por archivo
    auth/        Login
    onboarding/  Pasos del registro inicial
  services/      Toda la escritura a Firestore
  store/         authStore (Zustand)
  types/         Modelos de datos
  utils/         Funciones puras (cálculo, formato)
docs/            Este documento (ignorado por git)
scripts/         Migraciones puntuales (Node + firebase-admin)
```

**Regla de organización:** las pantallas no escriben en Firestore
directamente, salvo dos excepciones históricas (`RegisterIncome` y
`RegisterExpense`, que usan `writeBatch` en línea). Todo lo demás pasa por
`services/`.

---

## 3. Modelo de datos (Firestore)

```
users/{uid}                                  Perfil
  months/{monthId}                           Mes, id "YYYY-MM"
    transactions/{txId}                      Ingresos y egresos
    movements/{movementId}                   Traslados entre categorías
  goalAllocations/{allocationId}             Asignaciones a metas
  loans/{loanId}                             Préstamos recibidos y sus cuotas
    payments/{paymentId}                     Pagos confirmados por el usuario
    fundMovements/{movementId}               Reasignaciones de saldo prestado
  creditCards/{cardId}                       Tarjetas de crédito registradas
    statements/{statementId}                 Estados de cuenta confirmados
    payments/{paymentId}                     Pagos de tarjeta confirmados
migrationBackups/{...}                       Respaldos de migraciones
```

### `users/{uid}` — perfil

```ts
{
  name, email
  sources: { id, name }[]                    Fuentes de ingreso
  distribution: { necesidad, ocio, ahorro }  Porcentajes actuales, suman 100
  subcategories: { necesidad: string[], ocio: string[] }
  paymentMethods: { id, name, type }[]
  closingNotification: { day, time }         Declarado, sin uso todavía
  onboardingCompleted: boolean
  lastClosedMonth: string | null
  savingsTotalCents: number                  Ahorro acumulado global
  savingsGoals: SavingsGoal[]
  fixedIncomes?: { id, name, monthlyAmountCents }[]
  essentialNeeds?: { id, name, monthlyAmountCents }[]
}
```

`fixedIncomes` y `essentialNeeds` son **declaraciones**, no dinero real. Sirven
para calcular el porcentaje mínimo recomendado de Necesidad y para autocompletar
montos en los formularios.

### `SavingsGoal`

```ts
{
  id, name
  targetCents: number
  createdAt: Timestamp | null
  kind?: "fondo" | "compra"      Sin valor = "compra"
  allocatedCents?: number        Sin valor = 0
  purchaseCount?: number         Sin valor = 0
  lastPurchasedAt?: string       "YYYY-MM-DD"
}
```

Los campos opcionales existen para que las metas creadas antes de cada
funcionalidad sigan funcionando. **Nunca asumir que están presentes**: usar
siempre los helpers de `utils/savings.ts`.

**Dos tipos de meta, con comportamiento distinto:**

- **`compra`** (predeterminado): adquisiciones. Solo se puede gastar cuando
  `allocatedCents >= targetCents`, y se gasta completa.
- **`fondo`**: colchón de emergencia. Permite retiros parciales y no exige
  haber llegado al objetivo. **Nunca se ofrece un botón de "usar" al
  completarse**: un fondo completo significa estar cubierto, no que toque
  gastarlo.

### `months/{monthId}` — mes

```ts
{
  totalIncomeCents: number       Solo el ingreso QUE SE REPARTIÓ
  distribution: Distribution     Copia congelada del perfil al crearse
  capsCents: { necesidad, ocio } Topes disponibles del mes
  spentCents: { necesidad, ocio }
  ahorroContributedCents: number Todo lo que entró a ahorro este mes
  incomeCount: number
  closed: boolean
  remainder?: { ocioToAhorroCents }
  directSavingsCents?: number    Aportes directos, sin repartir
  borrowedCapsCents?: { necesidad, ocio }     Parte del tope que es prestada
  loanFundedSpentCents?: { necesidad, ocio }  Gasto ligado a esos fondos
  createdAt
}
```

### `transactions/{txId}`

```ts
// Ingreso
{
  type: "income", amountCents, transactionDate, localDate, serverDate,
  description?,
  source: string,               Nombre, o "Aporte directo"
  sourceId?: string,            Id de la fuente; ausente en aportes directos
  distribution: Distribution,   Cuánto fue a cada categoría, en centavos
  isDirectSavings?: boolean
}

// Egreso
{
  type: "expense", amountCents, transactionDate, localDate, serverDate,
  description?,
  category: "necesidad" | "ocio" | "ahorro",
  subcategory: string,          En ahorro, el nombre de la meta
  paymentMethod: string,
  goalId?: string,              Solo en compras de meta
  fundedByLoanId?: string,      Si se pagó explícitamente con un préstamo
  fundedByLoanName?: string,
  loanPaymentId?: string,       Si es una devolución de préstamo
  loanId?: string
}

// Préstamo recibido (no es ingreso)
{
  type: "loan", loanId, lender?, destinationCategory,
  amountCents, transactionDate, localDate, serverDate
}
```

Ojo: en un ingreso, `distribution` guarda **montos en centavos**, no
porcentajes. En el perfil y en el mes, `distribution` guarda **porcentajes**.
Mismo nombre, significados distintos.

### `movements/{movementId}` — inmutable

```ts
{ userId, monthId, origin, destination, amountCents, reason?,
  transactionDate, serverDate }
```

Registra traslados de excedente entre categorías. Solo existen los hechos
desde que se creó esta funcionalidad; los anteriores no quedaron guardados.

### `goalAllocations/{allocationId}` — inmutable

```ts
{ userId, goalId, goalName, direction: "assign" | "release",
  amountCents, transactionDate, serverDate }
```

`goalName` es una copia del nombre al momento de la operación, para que el
historial siga siendo legible si la meta se renombra o se borra.

**No registra compras ni retiros**: esos ya dejan rastro como egreso en el
historial, y duplicarlos sería mostrar lo mismo dos veces.

### `loans/{loanId}` y `payments/{paymentId}`

El préstamo guarda por separado `amountReceivedCents` y `totalToRepayCents`.
El primero aumenta el disponible de Necesidad u Ocio; el segundo es la deuda
real. También conserva `borrowedAvailableCents`, `paidCents` y un calendario de
cuotas mensuales fijas. Si la división deja centavos, el residuo va a la última
cuota.

El calendario se puede crear de tres formas: con una cuota fija conocida, con
un total conocido que se divide entre las cuotas, o introduciendo manualmente
fechas y montos variables. En los tres casos se guarda el total real y el
calendario original; la deuda revolvente de tarjetas no pertenece a este módulo.

Un préstamo que ya existía antes de empezar a usar la aplicación se puede
incorporar como **préstamo anterior**. Conserva su fecha real y su calendario,
pero su saldo se incorpora al mes actual: no crea, reabre ni modifica meses
pasados. El registro tampoco cuenta como ingreso ni altera los porcentajes.

`borrowedAvailableByCategory` separa cuánto saldo prestado sigue disponible en
Necesidad y cuánto en Ocio. La acción **Reasignar fondos del préstamo** mueve
solo ese saldo entre ambas categorías y escribe un `fundMovement` inmutable. No
es un movimiento de excedente, no toca dinero propio y nunca permite Ahorro.

Los pagos nunca se ejecutan automáticamente. Cada confirmación crea un egreso y
un `payment` enlazados. Un pago parcial o adelantado cubre primero la cuota
pendiente más antigua y después las siguientes, sin cambiar fechas ni montos.

---

## 4. Invariantes — lo que no se debe romper

Esta sección es la más importante del documento.

### 4.1 El dinero se guarda en centavos enteros

Nunca decimales. `calculateDistribution` trunca Necesidad y Ocio hacia abajo y
**deja el residuo en Ahorro**, garantizando que la suma dé exactamente el monto
original. Hay una prueba que verifica esto para 2.000 montos distintos.

### 4.2 Una sola fuente de verdad por dato; el resto se calcula

El caso central es el ahorro:

```
sin asignar = savingsTotalCents − Σ(goal.allocatedCents)
```

**"Sin asignar" nunca se guarda.** Razón: `savingsTotalCents` se modifica desde
nueve lugares distintos (registrar/editar/borrar ingreso, editar/borrar egreso
de ahorro, cierre de mes, mover excedente, comprar meta, retirar de fondo). Si
existiera un campo espejo, esos nueve tendrían que actualizarlo y una sola
omisión corrompería dinero en silencio.

Asignar y liberar **no mueven dinero**: solo cambian a qué meta está
etiquetado. Por eso ninguna de las dos toca `savingsTotalCents`.

### 4.3 El progreso de una meta se mide contra lo asignado a ella

Antes se medía contra el ahorro total, lo que hacía que **el mismo dinero
habilitara todas las metas a la vez**: con S/2.000 ahorrados, un colchón de
S/2.000 y una compu de S/1.500 aparecían ambos como alcanzables, aunque solo
alcanzara para uno.

Comprar valida `goal.allocatedCents >= goal.targetCents`, nunca el total.

### 4.4 El reparto de un mes se congela… salvo que el mes esté vacío

`month.distribution` es una copia del perfil hecha al crear el mes. Se congela
para que los topes ya calculados no cambien a mitad de camino.

**Excepción:** si `incomeCount === 0` no hay nada repartido que proteger, y un
mes congelado con un valor que el usuario ya cambió mostraría un porcentaje
distinto al de Ajustes. En ese caso se sincroniza automáticamente
(`syncDistributionIfUnused`, llamada desde `checkAndCloseMonth` y
`updateDistributionNow`). Las reglas de Firestore permiten el cambio solo bajo
esa condición.

### 4.5 Los aportes directos no entran en la base de los porcentajes

Un aporte directo (dinero que va entero al ahorro: una venta, un regalo) suma a
`directSavingsCents`, **no a `totalIncomeCents`**.

Si contara como ingreso repartido, los porcentajes mentirían: con S/3.000 de
ingreso y S/500 directos, Necesidad pasaría de mostrar 18% a 15,4% sin que el
usuario hiciera nada mal.

Consecuencias que hay que respetar al tocar esto:
- `getMonthInitialSplit` **excluye** los aportes directos (si no, inflarían el
  "reparto inicial" con dinero que nunca pasó por los porcentajes).
- `useAhorroBreakdown` los descuenta de `untrackedCents`, o aparecerían como
  "ajuste no registrado" estando perfectamente identificados.
- Borrarlos revierte `directSavingsCents`, no `totalIncomeCents` ni los topes.
- Su monto **no se puede editar**; hay que borrar y registrar de nuevo.

### 4.6 Nunca dejar saldos negativos

Revertir un ingreso descuenta de ahorro y de los topes. Si ese dinero ya se
gastó, la resta dejaría saldos negativos: dinero que la app afirma tener en
contra, lo cual es imposible.

`assertRevertible` (en `deleteTransaction`) y las validaciones equivalentes en
`updateIncome` **bloquean la operación** y explican qué deshacer primero.

Estados que sí pueden ocurrir y se muestran con honestidad, sin corregirse
solos:
- **Sobreasignado**: `savingsTotalCents < Σ allocatedCents`. Pasa al corregir un
  ingreso ya registrado. Se muestra el monto exacto a liberar.
- **No determinable**: cuando un dato no se pudo leer o no cuadra. **Nunca se
  muestra "0" o "no hay nada" en lugar de "no se pudo leer"** — son cosas
  distintas y confundirlas es mentirle al usuario sobre su propio dinero.

### 4.7 Los historiales son inmutables

`movements` y `goalAllocations` no se pueden editar ni borrar durante el uso
normal. Se escriben **dentro de la misma transacción** que el cambio que
registran: o pasan las dos cosas o no pasa ninguna. La única excepción de
borrado es el proceso explícito "Reiniciar todos mis datos" o "Eliminar mi
cuenta", iniciado y confirmado por el propietario.

### 4.10 Eliminación completa y reanudable

La limpieza se ejecuta en el cliente, sin Cloud Functions. Antes de borrar se
guarda `dataDeletionMode` en `users/{uid}`; mientras está activo, las reglas
bloquean nuevas operaciones financieras y permiten eliminar incluso meses
cerrados e historiales inmutables del mismo usuario. Las subcolecciones se
borran antes que sus documentos padre y en lotes de hasta 400 operaciones.

Si falla la conexión, el marcador permanece y Ajustes obliga a reanudar. Un
reinicio conserva únicamente la identidad de acceso y vuelve al onboarding.
La eliminación de cuenta limpia también `migrationBackups`, borra el perfil y
finalmente elimina al usuario de Firebase Authentication después de volver a
comprobar su contraseña.

### 4.8 Nunca mover dinero en silencio

Si algo no cuadra, se muestra y se le pide al usuario que decida. No se
rebalancea automáticamente, no se reparte de nuevo, no se "arregla" solo.
Única excepción: la sincronización del punto 4.4, que no mueve dinero (el mes
está vacío) sino que corrige una etiqueta.

### 4.9 El dinero prestado nunca se convierte en ahorro

Un préstamo no suma a `totalIncomeCents`, `incomeCount`, los porcentajes ni
`savingsTotalCents`. El gasto debe seleccionar explícitamente qué préstamo usa.
En el cierre se separa el remanente propio del prestado: solo el Ocio propio va
a Ahorro; el prestado continúa en la misma categoría al mes siguiente. Los
movimientos de excedentes solo pueden usar saldo propio.

---

## 5. Servicios

### `monthService.ts`

- **`checkAndCloseMonth(userId)`** — Se ejecuta al abrir el Dashboard y
  RegisterExpense. Cierra el mes anterior si quedó abierto, traspasa el
  excedente de Ocio al Ahorro, hereda el excedente de Necesidad al mes nuevo, y
  crea el mes actual si no existe. Además sincroniza el reparto si el mes está
  vacío. Sale temprano si el mes ya fue procesado, **pero la sincronización va
  antes de esa salida** (si no, los meses ya creados nunca se corregirían).
- **`updateDistributionNow(userId, dist)`** — Cambia el reparto del perfil. Lo
  aplica también al mes actual si está vacío.
- **`moveSurplus(userId, monthId, cents, origin, destination, reason?)`** —
  Traslada entre categorías en una sola transacción atómica y escribe su
  `Movement`. Sacar de Ahorro está limitado a lo **sin asignar**.
- ⚠️ **`getOrCreateMonth` y `registerIncomeSplit` son código muerto**: están
  exportados pero nadie los llama. El registro de ingresos ocurre en línea
  dentro de `RegisterIncome.tsx`.

### `transactionService.ts`

- **`deleteTransaction`** — Revierte todo lo que la transacción generó.
  Bloquea si dejaría saldos negativos. Si era la compra de una meta, decrementa
  su contador de compras usando `goalId` (no el nombre, que puede cambiar).
- **`updateExpense`** — El monto de un egreso de ahorro no se puede cambiar.
- **`updateIncome`** — Reescala el reparto proporcionalmente
  (`calculateProportionalSplit`). Bloquea si bajar el monto dejaría negativos.
- **`purchaseGoalExpense`** — Valida contra lo asignado a esa meta. Con
  `allowAutoAssign` asigna lo que falta y compra en un paso (el "atajo"), pero
  **nunca por su cuenta**: la pantalla tiene que pedirlo.
- **`withdrawFromFund`** — Retiro parcial, solo en metas tipo `fondo`, con tope
  en lo asignado a ese fondo.
- Al borrar un gasto financiado o un pago de préstamo, revierte también el saldo
  del préstamo y las cuotas afectadas. Sus montos no se editan: se borran y se
  registran nuevamente mientras el mes siga abierto.

### `loanService.ts`

- **`createLoan`** — Crea el préstamo, sus cuotas y el registro de recepción;
  aumenta el tope elegido sin tratarlo como ingreso.
- **`registerLoanFundedExpense`** — Exige selección explícita y descuenta del
  saldo prestado disponible.
- **`recordLoanPayment`** — Admite pagos parciales y adelantados; distribuye el
  monto desde la cuota pendiente más antigua. Si sale de Ahorro, solo permite
  usar lo no asignado a metas.
- **`cancelUnusedLoan`** — Solo elimina préstamos sin usos ni pagos y cuyo mes
  de recepción continúa abierto.
- **`watchLoans`** — Suscripción en vivo para Dashboard, formulario y detalle.
- **`reassignLoanFunds`** — Traslada saldo prestado entre Necesidad y Ocio sin
  modificar el total del préstamo; registra el movimiento en la misma
  transacción.

### `savingsGoalService.ts`

- **`assignToGoal` / `unassignFromGoal`** — Cambian `allocatedCents` y escriben
  su `GoalAllocation` en la misma transacción.
- **`saveGoalDefinitions(userId, drafts)`** — Guardado desde Ajustes. **Solo
  escribe nombre, objetivo y tipo**; `allocatedCents`, `purchaseCount` y
  `lastPurchasedAt` se releen del servidor. Sin esto, un borrador abierto antes
  de asignar dinero pisaría la asignación al guardar.
- **`getGoalAllocations`** — Devuelve `null` si falla, para distinguir "no hay"
  de "no se pudo leer".

### `movementService.ts`

- **`getMonthMovements`** — Suscripción en vivo a los movimientos del mes.
- **`getMonthInitialSplit`** — Suma el reparto real guardado en cada ingreso.
  **No se infiere por resta**, porque eso atribuiría mal cualquier ajuste que no
  haya pasado por `moveSurplus`. Valida que cada reparto sea entero, no negativo
  y que sume exactamente el monto del ingreso; si algo falla devuelve `null`.

### `analyticsService.ts`

`formatCategoryBreakdown`, `getMonthExpenses`, `computeTopSubcategories`,
`computeTopPaymentMethods`, `watchTrailingMonths`.

Las funciones de agregación **no excluyen categorías por su cuenta**: quien
llama decide qué mirar. En el gráfico de barras, ambas series (ingresos y
egresos) miran el mismo universo — el presupuesto repartido — y los movimientos
de ahorro quedan fuera de las dos, porque sumarlos solo de un lado daría una
comparación falsa.

### `exportService.ts`

CSV del historial por rango de meses, con secciones separadas de ingresos y
egresos. Incluye BOM para que Excel respete los acentos.

### `userService.ts`

`createUserProfile` (reparto inicial 50/30/20), `updateUserProfile`.
⚠️ `getUserProfile` es código muerto: el perfil llega por la suscripción en vivo
de `App.tsx`.

---

## 6. Pantallas

| Ruta | Pantalla | Qué muestra |
|---|---|---|
| `/dashboard` | Dashboard | Estado del mes: ingreso, topes, ahorro, deuda y mover excedente |
| `/income/new` | RegisterIncome | Registrar ingreso, o aporte directo a Ahorro |
| `/expense/new` | RegisterExpense | Elegir categoría → detalle, o meta/fondo si es Ahorro |
| `/history` | History | Todas las transacciones, editar, borrar, exportar CSV |
| `/history/edit/:monthId/:txId` | EditTransaction | Editar una transacción |
| `/charts` | ChartsScreen | Análisis: distribución, top gastos, ingresos vs egresos |
| `/movements` | Movements | Desglose del ahorro del mes y sus movimientos |
| `/goals` | SavingsGoals | Metas: asignar, liberar, historial de asignaciones |
| `/loans` | Loans | Préstamos, cuotas, vencimientos y pagos confirmados |
| `/close-month/:monthId?` | CloseMonth | Resumen del cierre. **Solo informa, no ejecuta** |
| `/settings` | Settings | Perfil, reparto, fuentes, subcategorías, metas, métodos |
| `/admin` | AdminOnboarding | Reeditar el perfil. Restringido por `VITE_ADMIN_UID` |

**Reparto de responsabilidades entre pantallas de ahorro** (para no duplicar):
Dashboard muestra el estado actual, `/movements` explica de dónde salió el
ahorro del mes, `/goals` cómo está repartido el acumulado, y Análisis en qué se
usó.

### Detalles de comportamiento no obvios

- **`BackButton`** vuelve a la pantalla anterior real (`navigate(-1)`), con el
  destino fijo como respaldo si no hay historial. History usa `fixed` para
  volver siempre al Dashboard, porque se llega desde la barra inferior.
- **Selección de chips**: pulsar un elemento ya seleccionado lo deselecciona.
  Al cambiar de subcategoría o meta, el monto se recalcula desde cero (se llena
  si la nueva tiene monto declarado, se vacía si no).
- **Bordes**: siempre `border-2`, cambiando solo el color al seleccionar. Con
  grosor variable la caja crece y empuja el contenido de abajo.
- **Botones sin fondos disponibles**: se muestran igualmente y explican al
  pulsarlos, en vez de desaparecer sin motivo aparente.

---

## 7. Reglas de Firestore (`firestore.rules`)

- Todo exige `request.auth.uid == userId`. Sin acceso entre cuentas.
- **`months`**: no se pueden borrar. El reparto solo cambia si `incomeCount ==
  0`. Un mes cerrado solo admite escribir `remainder`, y una sola vez.
- **`transactions`**: crear, editar y borrar solo si el mes no está cerrado.
- **`loans`**: crear y actualizar con montos enteros, fechas y categorías
  válidas. Solo se elimina si nunca se usó ni pagó y el mes sigue abierto.
- **`loans/{loanId}/payments`**: crear pagos positivos en meses abiertos; no se
  editan y solo se borran al revertir su egreso desde un mes abierto.
- **`movements`** y **`goalAllocations`**: crear con validación de forma
  (tipos, montos positivos, fechas `YYYY-MM-DD`, `serverDate == request.time`);
  **nunca editar ni borrar**.
- **`users/{uid}`**: escritura libre para el dueño, sin validación de campos.
  Por eso agregar campos al perfil o a las metas **no requiere desplegar
  reglas**.

Se evaluó usar `getAfter()` para validación cruzada entre documentos y se
descartó: alto costo de complejidad y bajo valor en una app donde cada usuario
solo puede tocar sus propios datos.

---

## 8. Pruebas

52 pruebas en `src/utils/*.test.ts`, sobre **funciones puras** (sin Firebase):

- `distribution.test.ts` — reparto, mínimo recomendado, reescalado proporcional
- `savings.test.ts` — asignado, sin asignar, sobreasignado, fondo vs compra,
  compatibilidad con metas antiguas
- `category.test.ts` — disponible, excedido, aviso de tope bajo, barra
- `loans.test.ts` — calendario mensual, residuo, pagos parciales, adelantos,
  reversión exacta y reasignación conservando el total prestado
- `monthRemainders.test.ts` — separación entre excedente propio y prestado,
  incluida la compatibilidad con meses antiguos

Las más valiosas son los bucles que verifican que la suma del reparto dé
exactamente el monto original para miles de valores: ese es el invariante que
garantiza que no se pierde ni se inventa un centavo.

**Sin cubrir todavía:** los servicios que escriben en Firestore. Requiere el
emulador de Firebase; es una fase aparte y más pesada.

---

## 9. Despliegue

```bash
npm test && npm run lint && npm run build
firebase deploy --only hosting
```

**Si `firestore.rules` cambió, las reglas van PRIMERO:**

```bash
firebase deploy --only firestore:rules
```

Razón: si el código nuevo escribe en una colección o campo que las reglas
todavía rechazan, la operación falla entera. Al revés no hay riesgo, porque la
app vieja no conoce lo nuevo.

### Actualización de la PWA

`registerType: "prompt"` con `skipWaiting: false`: el service worker nuevo queda
esperando hasta que el usuario acepta el aviso (`UpdatePrompt`). Es deliberado —
recargar solo podría perder un formulario a medio llenar. En una pestaña ya
abierta no se detecta la actualización; hay que cerrar todas y volver a entrar.

### Variables de entorno

En `.env` (ignorado por git): configuración de Firebase y `VITE_ADMIN_UID`.
Vite las incrusta **al compilar**, así que cambiarlas exige rehacer el build.
Estas variables **son visibles** en el código del navegador; no son secretos.
Que el UID de admin se vea no es un riesgo: las reglas impiden tocar datos
ajenos, y la pantalla de admin solo edita el propio perfil.

---

## 10. Migraciones (`scripts/`)

`migrate-caps-ahorro.mjs` — Corrige cuentas antiguas que guardaron ahorro en un
campo muerto (`capsCents.ahorro`) que el esquema actual no lee. Ejecutado en
producción para una cuenta real, recuperando S/1.320 que la app no mostraba.

Diseño a imitar en futuras migraciones:
- **Simulación por defecto**; escribe solo con `--apply`
- Nunca opera sobre todas las cuentas: exige `--uid` explícito
- Respalda el estado previo en `migrationBackups/`
- Idempotente, con marca de versión
- **No borra el campo viejo**: eso exige un `--cleanup` aparte, después de
  verificar visualmente el resultado
- Credenciales por `GOOGLE_APPLICATION_CREDENTIALS`, nunca dentro del repo

---

## 11. Limitaciones conocidas y pendientes

### Deuda técnica

- **Código muerto**: `getOrCreateMonth`, `registerIncomeSplit`, `getUserProfile`
- `RegisterIncome` y `RegisterExpense` escriben a Firestore en línea en vez de
  pasar por `services/`
- Comentarios en código: los antiguos mezclan regionalismos. El estándar actual
  es **español neutro** y comentar solo lo que explica un *porqué* no evidente
- El paquete supera 1 MB; no se ha hecho división de código salvo `ChartsScreen`

### Funcionalidad pendiente

- **Monitoreo de errores** (Sentry) — media hora de trabajo, alto valor
- **Borrar cuenta** — requiere Cloud Functions para borrado en cascada, y eso
  exige el plan Blaze. Las reglas actuales impiden a propósito que el navegador
  borre historiales
- **Pruebas con emulador** para los servicios
- `closingNotification` se guarda en el perfil pero no se usa

### Límites de la plataforma

- El plan **Spark** limita lecturas y escrituras diarias. Con varios usuarios
  activos hay que pasar a **Blaze** y configurar alertas de presupuesto: la app
  mantiene varias suscripciones en vivo por pantalla

---

## 12. Cómo trabajar en este proyecto

1. **Antes de tocar dinero, leer la sección 4.** Casi todos los errores serios
   de este proyecto vinieron de romper un invariante sin darse cuenta.
2. **Buscar las interacciones.** Un campo nuevo casi nunca vive solo: el aporte
   directo obligó a tocar cinco lugares que no eran evidentes. Preguntarse
   siempre quién más lee ese dato.
3. **Verificar con `npm test && npm run lint && npm run build`** después de cada
   cambio.
4. **Preferir mostrar la verdad antes que un número bonito.** Si un dato no se
   puede determinar, decirlo. Si algo no cuadra, mostrarlo. El usuario confía en
   estos números para decidir sobre su dinero.
