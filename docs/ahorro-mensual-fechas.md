# Ahorro mensual y fechas de operaciones

## Comportamiento

El Dashboard muestra como principal el ahorro neto del mes seleccionado:
aportes del mes (incluidos los directos y transferencias entrantes), menos
transferencias salientes y egresos desde Ahorro (metas, retiros y pagos de deuda).
En un mes cerrado se suma el excedente de Ocio documentado en su cierre.
Un neto negativo significa que se utilizó ahorro acumulado anteriormente.
No es el saldo disponible para gastar. El acumulado actual y su parte sin
asignar se muestran aparte, incluso al consultar un mes antiguo.
No se reabre ni se elimina ningún mes.

Ingresos, egresos y compras con tarjeta usan hoy como fecha por defecto. Solo
aparece un selector de fecha si el usuario elige «Registrar un día pasado»;
el día elegido debe pertenecer al mes actual y no estar en el futuro. Se
conserva `transactionDate` como día declarado. No se pide ni se guarda
`transactionTime` en operaciones nuevas. `serverDate` y `localDate` registran
el momento de creación. El Historial muestra ese único momento de registro
con hora local de 24 horas; si el día declarado difiere del día de creación,
muestra el día de la operación como principal y «Registrado el DD/MM HH:mm»
debajo.
Los registros antiguos con `transactionTime` siguen leyéndose, pero esa hora
legada no se muestra ni se usa para ordenar. El CSV separa el día declarado
(solo cuando difiere), el día local de registro y su hora local de 24 horas;
cada sección se ordena por el momento de registro.

La acción Fecha del Historial solo corrige `transactionDate` en el mes actual
abierto. Conserva el momento de creación y cualquier `transactionTime` legado;
no toca importes, repartos o saldos. Una compra de meta también
actualiza su etiqueta de última compra. Las compras de tarjeta no pueden
atravesar un corte confirmado; los gastos prestados no pueden preceder a la
recepción del préstamo. Recepciones de préstamos, pagos de deuda, movimientos
de excedentes y cargos de estados de cuenta conservan sus flujos y restricciones
existentes; esta acción no permite editarlos.

## Reversión

La presentación del ahorro se puede quitar independientemente: es un cálculo
de lectura y no modifica las cifras almacenadas.

La selección de un día pasado se puede retirar sin borrar operaciones. Los
campos `transactionTime` anteriores siguen almacenados; esta función ya no
los escribe ni los borra, y los lectores actuales los ignoran.

Las fechas que los usuarios corrijan permanecerán corregidas si se retira la
función. Volver al código anterior no restaura automáticamente sus fechas
previas ni la etiqueta de última compra de una meta. Antes de una reversión se
debe advertir al usuario y decidir si quiere conservar esas correcciones.
`serverDate` y `localDate` conservan el momento de registro, no el día de una
operación pasada declarada por el usuario. Una reversión de datos requiere
evidencia o respaldo.

No hay migración masiva, nuevas colecciones ni cambios de reglas de Firestore.
Las pruebas visuales aisladas usan datos simulados y no escriben en producción.
