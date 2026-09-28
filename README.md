# Kowalski

Kowalski es una aplicación web progresiva de finanzas personales en soles peruanos. Organiza los ingresos entre Necesidad, Ocio y Ahorro con porcentajes configurables. Los montos se calculan en centavos; Necesidad y Ocio tienen topes mensuales, mientras que el ahorro se acumula entre meses.

Versión publicada: [Kowalski en Firebase Hosting](https://kowalski-pwa.web.app/).

## Funciones principales

- Registro de ingresos, aportes directos al ahorro y gastos, con opción de declarar un día pasado del mes actual. El historial permite corregir la fecha de operaciones admitidas y exportar datos a CSV y Excel (.xlsx).
- Panel del mes con ahorro neto mensual, topes, movimientos de excedentes y cierre automático de mes.
- Metas de compra y fondos de ahorro con asignaciones, liberaciones y retiros.
- Objetivos mensuales informativos por subcategoría y avisos al acercarse a ellos o superarlos; no bloquean el gasto ni alteran los saldos.
- Análisis de ingresos y gastos, plantillas de gastos y sugerencias de categoría que requieren confirmación.
- Préstamos con cuotas y pagos confirmados; tarjetas de crédito con compras, estados de cuenta y pagos registrados manualmente. La pantalla de tarjetas muestra el «Exceso» cuando la deuda supera la línea.
- Autenticación, configuración inicial y flujos para reiniciar los datos o eliminar la cuenta.

## Tecnología

React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand, React Hook Form, Zod, Firebase Authentication, Cloud Firestore, Recharts, vite-plugin-pwa y Vitest. El sitio se prepara para Firebase Hosting.

## Requisitos

- Node.js compatible con Vite 8 (`^20.19.0` o `>=22.12.0`) y npm.
- Un proyecto de Firebase con Authentication y Cloud Firestore configurados. Para desplegar o ejecutar la prueba de integración con emuladores, se necesita Firebase CLI.

## Instalación y configuración

```bash
npm ci
```

Copia `.env.example` a `.env` y completa las variables con la configuración de tu proyecto de Firebase. `.env` está ignorado por Git. Los nombres definidos en el ejemplo son:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_ADMIN_UID
```

Las variables `VITE_` se incorporan al código del navegador durante la compilación; no coloques secretos en ellas.

## Comandos

```bash
npm run dev    # servidor local
npm test       # pruebas una vez
npm run lint  # análisis estático
npm run build # TypeScript y compilación para producción
```

## Emuladores de Firebase

`firebase.json` configura los emuladores de Authentication (`9099`) y Firestore (`8080`). La prueba de integración de eliminación de datos los usa y se activa con `RUN_FIREBASE_EMULATOR_TESTS=true`. En PowerShell:

```powershell
$env:RUN_FIREBASE_EMULATOR_TESTS = "true"
firebase.cmd emulators:exec --project demo-kowalski-deletion --only auth,firestore "npm.cmd test"
Remove-Item Env:RUN_FIREBASE_EMULATOR_TESTS
```

El ID `demo-kowalski-deletion` corresponde al proyecto de prueba definido en `accountDataService.integration.test.ts`. La aplicación de desarrollo no se conecta automáticamente a los emuladores: usa el proyecto indicado por las variables `VITE_FIREBASE_*`.

## Despliegue en Firebase Hosting

Con Firebase CLI autenticado y el proyecto de destino seleccionado, configura `.env` para ese proyecto y ejecuta:

```bash
npm test
npm run lint
npm run build
firebase deploy --only hosting
```

`firebase.json` publica `dist` y dirige las rutas de la aplicación a `index.html`. Si un cambio requiere nuevas reglas o índices de Firestore, se deben revisar y desplegar por separado antes de publicar el código que dependa de ellos.
