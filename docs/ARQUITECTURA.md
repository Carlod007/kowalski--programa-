# Kowalski — Documentación técnica

Documento de referencia para retomar el proyecto sin contexto previo. Describe
qué hace la aplicación, cómo está construida, y **por qué** cada decisión
importante se tomó así. La sección de invariantes es la más valiosa: explica
las reglas que no se deben romper.

Última actualización: noviembre 2026.

---

## 1. Qué es

PWA de finanzas personales que aplica **presupuesto por sobres** con tres
categorías de porcentaje configurable:

| Categoría | Qué es | Tope mensual y cierre |
|---|---|---|
| **Necesidad** | Gastos indispensables | Sí; al cerrar el mes, el excedente propio neto no usado se hereda al tope de Necesidad del mes siguiente |
| **Ocio** | Gasto discrecional | Sí; al cerrar el mes, el excedente propio neto no usado pasa al acumulado de Ahorro |
| **Ahorro** | Acumulación | No; es acumulado entre meses |

Cada ingreso se reparte automáticamente entre las tres según los porcentajes
del usuario (por ejemplo 50/30/20 o 18/47/35). Necesidad y Ocio funcionan como
topes de gasto del mes; Ahorro se acumula indefinidamente y solo baja al comprar
una meta, retirar de un fondo, trasladar excedente o pagar deuda desde Ahorro.
En el cierre de mes, los déficits propios entre Necesidad y Ocio se compensan
entre sí antes de heredar excedente o enviar sobrante de Ocio a Ahorro (y el
remanente prestado continúa separado en su misma categoría).

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
npm test         # pruebas unitarias una vez
npm run test:watch
npm run lint
npm run build    # tsc -b && vite build
```

### Desarrollo manual contra Firebase Emulators

`src/lib/firebase.ts` incluye soporte opcional de emulador controlado por
`VITE_USE_EMULATOR=true`, activo **únicamente** cuando `import.meta.env.DEV` es
verdadero (nunca se activa en el build de producción).

Comandos en dos terminales (PowerShell en Windows):

```powershell
# Terminal 1 — Levantar emuladores de Auth (9099) y Firestore (8080)
$env:JAVA_TOOL_OPTIONS="-Duser.language=en -Duser.country=US"
npx firebase emulators:start --only auth,firestore --project kowalski-pwa

# Terminal 2 — Levantar la PWA conectada a los emuladores locales
$env:VITE_USE_EMULATOR="true"
npm run dev
```

### Estructura

```
src/
  components/    Piezas reutilizables de UI
  hooks/         useAhorroBreakdown
  lib/           firebase.ts (inicialización y conexión opcional a emuladores)
  pages/         Una pantalla por archivo
    auth/        Login
    onboarding/  Pasos del registro inicial
  services/      Toda la escritura a Firestore
  store/         authStore (Zustand)
  types/         Modelos de datos
  utils/         Funciones puras (cálculo, formato)
docs/            Documentación del proyecto
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
    transactions/{txId}                      Ingresos, egresos y recibos de préstamo
    movements/{movementId}                   Traslados entre categorías
  goalAllocations/{allocationId}             Asignaciones a metas
  loans/{loanId}                             Préstamos recibidos y sus cuotas
    payments/{paymentId}                     Pagos confirmados por el usuario
    fundMovements/{movementId}               Reasignaciones históricas (solo lectura/limpieza)
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
  savingsTotalCents: number                  Ahorro acumulado global (>= 0)
  savingsGoals: SavingsGoal[]
  fixedIncomes?: { id, name, monthlyAmountCents }[]
  essentialNeeds?: { id, name, monthlyAmountCents }[]
  subcategoryBudgets?: { category, subcategory, monthlyLimitCents }[]
}
```

`fixedIncomes` y `essentialNeeds` son **declaraciones**, no dinero real. Sirven
para calcular el porcentaje mínimo recomendado de Necesidad y para autocompletar
montos en los formularios.

`subcategoryBudgets` guarda objetivos mensuales opcionales para subcategorías
de Necesidad y Ocio. Se compara cada objetivo con el consumo de esa
subcategoría, incluido el financiado con préstamo o tarjeta, sin contar de
nuevo pagos de deuda. Los avisos son informativos: no modifican porcentajes,
topes ni saldos y no bloquean el registro.

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
  remainder?: {
    ocioToAhorroCents: number
    necesidadToNextMonthCents?: number
    netDeficitCents?: number
    borrowedNecesidadCents?: number
    borrowedOcioCents?: number
    deficitResolution?: "covered_by_savings" | "carried_forward" | "none"
    closedAt?: Timestamp | null
  }
  inheritedNecesidadCents?: number            Excedente propio heredado del mes previo
  directSavingsCents?: number                 Aportes directos, sin repartir
  borrowedCapsCents?: { necesidad, ocio }     Parte del tope que es prestada
  loanFundedSpentCents?: { necesidad, ocio }  Gasto ligado a esos fondos
  createdAt
}
```

### `transactions/{txId}`

`transactionDate` es el día declarado (`YYYY-MM-DD`): hoy por defecto o un día
pasado del mes actual. `localDate` y `serverDate` registran el momento real de
creación. Ya no se solicita ni se escribe una hora declarada en operaciones
nuevas; `transactionTime` solo puede persistir en registros antiguos y no se
usa para mostrar otra hora ni para ordenar. El Historial permite corregir el
día declarado en operaciones admitidas del mes actual abierto, sin cambiar el
momento de registro.

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
  goalId?: string,              Solo en compras de meta o retiros de fondo
  fundedByLoanId?: string,      Si se pagó explícitamente con un préstamo
  fundedByLoanName?: string,
  loanPaymentId?: string,       Si es una devolución de préstamo
  loanId?: string,
  creditCardId?: string,        Si se compró con tarjeta o corresponde a un cargo
  creditCardName?: string,
  creditCardStatementId?: string,
  creditCardChargeKind?: "interest-fees",
  tags?: string[]
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
Necesidad y cuánto en Ocio. Los documentos `fundMovements` solo se conservan
para registros históricos previos (las reglas actuales ya no admiten crear
nuevos `fundMovements`).

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
múltiples operaciones (registrar/editar/borrar ingreso, borrar egreso de ahorro,
cierre de mes, mover excedente, comprar meta, retirar de fondo, pagar préstamo
desde ahorro). Si existiera un campo espejo, todas tendrían que actualizarlo y
una sola omisión corrompería dinero en silencio.

Asignar y liberar **no mueven dinero**: solo cambian a qué meta está
etiquetado. Por eso ninguna de las dos toca `savingsTotalCents`.

### 4.3 El progreso de una meta se mide contra lo asignado a ella

Antes se medía contra el ahorro total, lo que hacía que **el mismo dinero
habilitara todas las metas a la vez**: con S/2.000 ahorrados, un colchón de
S/2.000 y una compu de S/1.500 aparecían ambos como alcanzables, aunque solo
alcanzara para uno.

Comprar valida `goal.allocatedCents >= goal.targetCents` y además verifica que
`savingsTotalCents >= goal.targetCents` (y en retiros de fondos,
`savingsTotalCents >= amountCents`).

### 4.4 El reparto de un mes se congela… salvo que el mes esté vacío

`month.distribution` es una copia del perfil hecha al crear el mes. Se congela
para que los topes ya calculados no cambien a mitad de camino.

**Excepción actual:** si `incomeCount === 0` no hay ingresos registrados en el
mes y se sincroniza automáticamente (`syncDistributionIfUnused`, llamada desde
`checkAndCloseMonth` y `updateDistributionNow`). Las reglas de Firestore
permiten actualizar `month.distribution` cuando `incomeCount == 0` (nota: hoy
los aportes directos incrementan `incomeCount`, por lo que también congelan la
distribución del mes hasta que se separe el contador en una fase posterior).

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

### 4.6 Nunca dejar saldos negativos ni crear estados sobreasignados

Revertir o reducir un ingreso descuenta de ahorro y de los topes. Si ese dinero
ya se gastó en Necesidad/Ocio o está asignado a metas de ahorro, la resta
dejaría disponibles negativos o metas prometiendo dinero inexistente.

`assertRevertible` (en `deleteTransaction`) y las validaciones equivalentes en
`updateIncome` **bloquean la operación**:
- En Necesidad y Ocio validan contra el disponible propio real
  (`ownedCap − ownedSpent`).
- En Ahorro validan tanto contra `savingsTotalCents` como contra el ahorro sin
  asignar (`getUnassignedCents`), indicando exactamente cuánto liberar de las
  metas primero (`"Libera S/ X.XX de tus metas primero"`).
- `withdrawFromFund` y `purchaseGoalExpense` validan también contra
  `savingsTotalCents`, impidiendo que una cuenta histórica sobreasignada deje
  `savingsTotalCents < 0`.

Estados que sí pueden existir en datos históricos y se muestran con honestidad,
sin corregirse solos:
- **Sobreasignado histórico**: `savingsTotalCents < Σ allocatedCents`. Se
  muestra el monto exacto a liberar; las operaciones nuevas nunca crean este
  estado.
- **No determinable**: cuando un dato no se pudo leer o no cuadra. **Nunca se
  muestra "0" o "no hay nada" en lugar de "no se pudo leer"** — son cosas
  distintas y confundirlas es mentirle al usuario sobre su propio dinero.

### 4.7 Los historiales son inmutables

`movements` y `goalAllocations` no se pueden editar ni borrar durante el uso
normal. Se escriben **dentro de la misma transacción** que el cambio que
registran: o pasan las dos cosas o no pasa ninguna. La única excepción de
borrado es el proceso explícito "Reiniciar todos mis datos" o "Eliminar mi
cuenta", iniciado y confirmado por el propietario.

### 4.8 Nunca mover dinero en silencio

Si algo no cuadra, se muestra y se le pide al usuario que decida. No se
rebalancea automáticamente, no se reparte de nuevo, no se "arregla" solo.
Única excepción: la sincronización del punto 4.4, que no mueve dinero (el mes
está vacío) sino que corrige una etiqueta.

### 4.9 El dinero prestado nunca se convierte en ahorro y los déficits propios se netean al cierre

Un préstamo no suma a `totalIncomeCents`, `incomeCount`, los porcentajes ni
`savingsTotalCents`. El gasto debe seleccionar explícitamente qué préstamo usa.
En el cierre (`getMonthRemainders`):
- Se separa el saldo propio (`ownedCap − ownedSpent`) del prestado
  (`borrowedCaps − loanFundedSpent`).
- Si Necesidad propia tiene déficit, se cubre primero con el sobrante propio de
  Ocio antes de enviar nada a Ahorro; si Ocio propio tiene déficit, se cubre con
  el sobrante propio de Necesidad antes de heredar al mes siguiente.
- Si ambas categorías combinadas dejan un faltante propio, `ocioToAhorroCents` y
  `necesidadToNextMonthCents` quedan en `0` y el exceso se registra en
  `remainder.netDeficitCents`, mostrándose en el resumen de cierre.
- El remanente prestado nunca absorbe déficits propios ni va a Ahorro: continúa
  íntegro en la misma categoría al mes siguiente.

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

---

## 5. Servicios

### `monthService.ts`

- **`checkAndCloseMonth(userId)`** — Se ejecuta al abrir el Dashboard y
  RegisterExpense. Cierra el mes anterior si quedó abierto usando el cálculo
  neteado (`getMonthRemainders`), guarda `remainder` (`ocioToAhorroCents`,
  `necesidadToNextMonthCents`, `netDeficitCents`), traspasa `ocioToAhorroCents`
  al Ahorro, hereda el excedente de Necesidad al mes nuevo registrando
  `inheritedNecesidadCents`, y crea el mes actual si no existe. Además
  sincroniza el reparto si el mes está vacío. Sale temprano si el mes ya fue
  procesado, **pero la sincronización va antes de esa salida** (si no, los meses
  ya creados nunca se corregirían).
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
  Bloquea si dejaría disponibles propios negativos o ahorro sobreasignado. Si
  era la compra de una meta, decrementa su contador de compras usando `goalId`
  (no el nombre, que puede cambiar).
- **`updateExpense`** — El monto de un egreso de Ahorro o vinculado a un
  préstamo no se puede cambiar (lanza error si `delta !== 0`).
- **`updateIncome`** — Reescala el reparto proporcionalmente
  (`calculateProportionalSplit`). Bloquea si bajar el monto dejaría disponibles
  propios negativos o ahorro sobreasignado.
- **`purchaseGoalExpense`** — Valida contra lo asignado a esa meta y contra
  `savingsTotalCents`. Con `allowAutoAssign` asigna lo que falta y compra en un
  paso (el "atajo"), pero **nunca por su cuenta**: la pantalla tiene que
  pedirlo.
- **`withdrawFromFund`** — Retiro parcial, solo en metas tipo `fondo`, con tope
  en lo asignado a ese fondo y en `savingsTotalCents`.
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
| `/close-month/:monthId?` | CloseMonth | Resumen del cierre o proyección en vivo (incluye déficit neto). **Solo informa, no ejecuta** |
| `/settings` | Settings | Perfil, reparto, fuentes, subcategorías, metas, métodos |
| `/subcategory-budgets` | SubcategoryBudgets | Objetivos mensuales informativos por subcategoría |
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
- **`users/{uid}`**: valida transiciones de `lastClosedMonth` con `getAfter()`
  contra el cierre real del mes previo y la existencia del mes nuevo, y exige
  que `savingsTotalCents` (al crearse o modificarse) sea entero `>= 0`. Conserva
  campos legacy no modificados.
- **`months`**: creación validada estrictamente (forma, porcentajes que suman
  100, montos enteros en cero o heredados exactamente desde el mes previo con
  `getAfter()`, `inheritedNecesidadCents` opcional coherente). Actualizaciones
  limitadas a los campos permitidos; `distribution` solo cambia si
  `incomeCount == 0`. Al cerrar un mes se valida `remainder` aceptando tanto el
  formato nuevo neteado (`ocioToAhorroCents`, `necesidadToNextMonthCents`,
  `netDeficitCents` y campos opcionales de cierre) como el formato legacy
  (`{ ocioToAhorroCents }`) para compatibilidad durante despliegues.
- **`transactions`**: creación, edición y borrado solo con mes abierto
  (`get` y `getAfter`). Valida forma, tipos, montos positivos, fechas dentro del
  mes con tolerancia de 3 días respecto a `request.time`, reparto exacto de
  ingresos y contrapartidas de préstamos y tarjetas con `getAfter()`. En egresos
  de `category == 'ahorro'`, prohíbe modificar `amountCents`.
- **`loans` y `loans/{loanId}/payments`**: valida creación, pagos y cancelación
  con sus recibos, egresos y ajustes de topes mediante `getAfter()`. No admite
  nuevos `fundMovements`.
- **`creditCards`, `statements` y `payments`**: valida creación, confirmación y
  cancelación de estados de cuenta y pagos con sus contrapartidas.
- **`movements`** y **`goalAllocations`**: crear con validación de forma
  (tipos, montos positivos, fechas `YYYY-MM-DD`, `serverDate == request.time`);
  **nunca editar ni borrar** fuera del flujo de eliminación de datos.

---

## 8. Pruebas

Hay pruebas de funciones puras en `src/utils/*.test.ts` y componentes:

- `distribution.test.ts` — reparto, mínimo recomendado, reescalado proporcional
- `savings.test.ts` — asignado, sin asignar, sobreasignado, fondo vs compra,
  compatibilidad con metas antiguas
- `category.test.ts` — disponible, excedido, aviso de tope bajo, barra
- `loans.test.ts` — calendario mensual, residuo, pagos parciales, adelantos,
  reversión exacta y reasignación conservando el total prestado
- `monthRemainders.test.ts` — neteo de déficits propios entre Necesidad y Ocio,
  cálculo de `netDeficitCents` y separación intacta del dinero prestado
- `MonthClosingSummary.test.ts` — proyección y resumen cerrado con déficit neto

También hay pruebas de servicios y suites de integración contra emuladores en
`src/services/`:
- Pruebas sin emulador: `exportService.test.ts`, `historyXlsxService.test.ts`,
  `transactionTimingService.test.ts`, `creditCardService.test.ts`,
  `monthClosingNoticeService.test.ts`.
- Pruebas con emulador de Auth + Firestore (`RUN_FIREBASE_EMULATOR_TESTS=true`):
  `accountDataService.integration.test.ts`.
- Pruebas de reglas y servicios contra el emulador de Firestore en puerto 8180
  (`RUN_MONTH_RULES_TESTS=true`):
  `monthTransactionRules.integration.test.ts`,
  `userLastClosedMonthRules.integration.test.ts`,
  `loanCardLocalRules.integration.test.ts`,
  `loanCardLinkedRules.integration.test.ts`.

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
todavía rechazan, la operación falla entera. Las reglas nuevas mantienen
compatibilidad hacia atrás con el formato anterior de `remainder` mientras el
cliente previo siga abierto en algún navegador.

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
- **Desplegar a producción las reglas endurecidas de `firestore.rules`** cuando
  se publique la versión correspondiente.
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
