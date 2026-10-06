# El laboratorio de las cosas cotidianas

Aventura interactiva sobre la curiosidad: una sala compartida con turnos. Vanessa Estrada administra la sala desde la
computadora proyectada; solo la persona con el turno usa el mapa y los experimentos en su celular; el resto sigue la
proyección y participa en voz alta.

Práctica pedagógica 5 · Licenciatura en Educación Infantil · Universidad de Antioquia.

**Documentos rectores:** [`.claude/SPECS.md`](.claude/SPECS.md) (qué construir y cómo se acepta) y
[`.claude/PLAN.md`](.claude/PLAN.md) (orden de construcción, evidencias y registro de ejecución). Si algo de este README
contradice a SPECS, manda SPECS.

## Estado

Construido y verificado: fases 0 a 6 de PLAN (base, contratos/dominio/Tiled directo, sala con control exclusivo y persistencia,
movimiento compartido, las tres mesas, el cuaderno, las piezas y el inventor, y la continuidad: detección de cortes, reinicio real
del servicio, vencimiento y limpieza de salas, y la demostración local de respaldo). El recorrido completo funciona de punta a punta
en Chromium. **Todavía no existe**: el arte final, el audio y el ensayo de capacidad con celulares reales (fases 7–8). El dibujo de
las mesas y del inventor es procedimental y los textos de cada paso son de prototipo. Detalle y evidencias en PLAN §5.

## Requisitos

- **Node.js ≥ 22.12** (`better-sqlite3` 13 exige ≥ 22; Vite exige ^20.19 o ≥ 22.12). Verificado con 24.20.
- Tiled de escritorio solo para **editar** el mapa; no hace falta para ejecutar, probar ni compilar.

## Puesta en marcha

```bash
npm install
npm run dev          # servidor (3001) + Vite (5173) con proxy de /api y /socket.io
```

Abre <http://localhost:5173>, pulsa **Crear sala** y escanea el QR (o entra con el código) desde otro dispositivo o ventana.
Cada persona usa su propio navegador/contexto: la credencial se guarda por sala en el almacenamiento local.

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor y frontend de desarrollo. |
| `npm run validate:project` | Valida `laboratorio.json`, `assets.json`, el TMJ y los frames contra la imagen real, sin escribir nada. |
| `npm run typecheck` | Tipos de frontend, `shared/` y servidor. |
| `npm test` | Dominio, contratos, servidor con Socket.IO real y SQLite temporal, cliente y componentes. |
| `npm run test:e2e` | Compila y ejecuta los 7 e2e en Chromium (uno de ellos reinicia de verdad el proceso del servidor) con identidades independientes (ver «Pruebas»). Las capturas de evidencia solo se escriben en `docs/` con `E2E_EVIDENCE=1`. |
| `npm run build` | Valida, comprueba tipos y compila el frontend en `dist/`. |
| `npm start` | Servicio de producción: sirve `dist/`, la API y Socket.IO desde el mismo origen. |
| `npm run preview:demo` | Compila y sirve SOLO el frontend en <http://127.0.0.1:4173/demo>, sin servidor de salas ni base de datos: la demostración de respaldo (ver «Respaldo»). |

Aún no existe `test:load` (fase 7).

## Estructura

```
.claude/        SPECS.md, PLAN.md (y, pendiente, la copia del PRD v2.0)
public/config/  laboratorio.json                              contenido, recorrido y parámetros
public/maps/    laboratorio.tmj                              ÚNICA fuente de geometría (se edita en Tiled)
public/assets/  assets.json + recursos                       catálogo (subconjunto de Bitácora Amorcito)
tools/tiled/    laboratorio.tiled-project + README           flujo de edición
shared/         contracts/ domain/ config/ (+ schemas/)      TypeScript puro compartido servidor ↔ navegador;
                esquemas JSON de configuración y catálogo
server/src/     HTTP, Socket.IO, RoomService, SQLite
src/            React + Phaser (app, network, config, components, game)
scripts/        validación, e2e
```

El dominio (`shared/domain/`) es el único lugar con las reglas de las mesas, los turnos, las piezas y los modelos de
sombra y rampa. Sin React, Phaser, sockets ni almacenamiento: son funciones puras que no mutan su entrada.

## Editar el mapa (Tiled directo)

1. Abre `tools/tiled/laboratorio.tiled-project` en Tiled y luego `public/maps/laboratorio.tmj`.
2. Edita y guarda. Phaser lee ese mismo archivo; **no hay importación, exportación ni copia de coordenadas**.
3. `npm run validate:project` (o recargar con `npm run dev`, que valida y recarga) indica archivo, capa, objeto y propiedad
   de cualquier problema.

Las reglas del perfil y de las clases (`Spawn`, `Station`, `Inventor`, `Decoration`, `Collision`, `SoundEmitter`,
`EditorOnly`) están en [`tools/tiled/README.md`](tools/tiled/README.md). Una sala ya iniciada **no** adopta un mapa editado:
crea una sala nueva para probar un cambio.

## Operación

- **Una sola instancia** con proceso persistente y un **volumen** para SQLite (`DATABASE_PATH`). No es una arquitectura
  distribuida: más de una réplica exige cambiar persistencia y adaptador de Socket.IO.
- El proxy debe admitir conexiones persistentes y la negociación HTTP de Socket.IO. Usa HTTPS en producción.
- Variables en [`.env.example`](.env.example). La base y las credenciales **no** van en Git (`.gitignore`).
- `PUBLIC_ORIGIN` fija el origen de los enlaces de entrada; si hay prefijo, compila con `VITE_BASE=/prefijo/`.
- Un reinicio recupera las salas pausadas y sin controlador; Vanessa recupera la administración con su credencial y elige
  cómo continuar. El tiempo con el servidor apagado no cuenta.
- **Vencimiento y limpieza** (`ADMIN_IDLE_TTL_MS`, `TERMINAL_RETENTION_MS`, `SWEEP_INTERVAL_MS`): una sala cuya administradora lleva
  2 horas sin dar señales (comandos o la señal periódica del navegador abierto; las participantes no cuentan) **vence**: se avisa y se
  cierran las conexiones. Una sala terminal (cerrada o vencida) se **elimina por completo** (sala, identidades y comandos) 24 horas
  después. El plazo de inactividad se cuenta con la hora guardada: si el servicio estuvo apagado más tiempo, vence al volver.
- Detección de cortes: `PING_INTERVAL_MS=4000` y `PING_TIMEOUT_MS=5000`. Un corte de red silencioso se detectó en ~8,6 s en las pruebas
  (objetivo ≤ 10 s; peor caso teórico 9 s). No se han medido falsos cortes en celulares reales (fase 7).
- Las credenciales se guardan como hash. **No** se registran tokens ni textos del público.
- El proveedor de hosting sigue **sin elegir** (PLAN P8-03).

## Respaldo: la demostración local

`/demo` es la misma aventura (mismo dominio, reglas, escenas y formularios) **sin servidor ni red**. Vanessa explora y modera sola. Siempre
muestra el rótulo «Demostración». Su estado vive en el navegador, en un espacio propio (`…:demo:estado`), sin credenciales ni IDs de
sala: **nunca se mezcla ni se sincroniza con una sala**. Si se recarga, vuelve en pausa con lo confirmado. «Reiniciar la demostración»
solo borra el avance de la demostración.

**Antes de exponer** (hacerlo con la sala funcionando):

1. `npm run build` y `npm start` (o el servicio desplegado). Abre la sala como Vanessa y espera unos segundos: la consola descarga sola el
   módulo de la demostración y calienta la caché con los recursos del catálogo.
2. Abre `/demo` una vez en esa computadora y recorre una mesa. Así queda comprobado que funciona ahí.

**Si el servidor deja de responder con la página ya abierta** (backend caído): a los ~5 s aparece «La conexión con la sala no vuelve»
con el botón **Usar la demostración**. No se activa sola: decide Vanessa. Desde la demostración, **Volver a la sala** retoma la sala con su
estado propio (si el servicio se reinició, la encuentra pausada y elige cuándo continuar). Los celulares de las personas no tienen
demostración: siguen la proyección.

**Si la computadora se queda sin red o sin servidor y hay que abrir la página de nuevo**: una página que nunca se descargó o que se
recargó con el servidor apagado no se puede abrir. Por eso se prepara el build local: `npm run preview:demo` lo sirve desde la propia
computadora (no necesita internet) y abre `/demo`. No es obligatorio ningún service worker. Ensayar ambos casos antes del día.

## Pruebas

`npm test` incluye pruebas de integración con **Socket.IO real y SQLite en archivo temporal**: fallo real de SQLite
(`PRAGMA query_only`), reinicio del proceso con el mismo archivo, pestañas sustituidas, salas aisladas, idempotencia por
`requestId`. `npm run test:e2e` usa el Chromium que Playwright ya tenga instalado (revisión 1243 para Playwright 1.63; si falta,
`npx playwright install chromium`).

Además: `server/src/detection.test.ts` usa relojes reales y un proxy que corta el tráfico sin cerrar nada (un corte silencioso) para medir
cuánto tarda en detectarse; `scripts/e2e/restart.ts` arranca el servidor como proceso aparte, lo mata con `SIGKILL` a mitad de una prueba
de rampa y lo vuelve a arrancar con el mismo archivo SQLite.

Los e2e actuales cubren: ciclo de vida de Phaser bajo StrictMode (CT-04), administradora + dos participantes en contextos
independientes (capturas en `docs/evidencia/fase2/`), movimiento compartido con toque real, cambio de turno en pleno
movimiento, pausa, redimensionado y pestaña congelada (capturas en `docs/evidencia/fase3/`), las tres mesas completas desde dos
teléfonos y la proyección, con borradores, teclado reducido, pausa con la pelota rodando y la caja personal, y después el cuaderno
(panel de Vanessa y corrección desde el teléfono), el inventor, la pregunta final, la revisita en `finished` y el reinicio de sala
(capturas en `docs/evidencia/fase4/`), el reinicio real del servicio y la demostración local con el servidor apagado y con la red
cortada (capturas en `docs/evidencia/fase6/`), y edición directa del TMJ (CT-01).
`?debug` en la URL de la sala superpone colisiones y radios; `?hooks` solo expone el juego para las pruebas. **No** sustituyen el ensayo en
Safari/iPhone, Chrome/Android y el equipo proyectado (PLAN fase 7).

## Recursos provisionales

Las mesas, el tileset y el inventor son arte **provisional** generado para el prototipo, marcado `placeholder: true` en
`assets.json`. `mode: "presentation"` en `laboratorio.json` rechaza cualquier recurso provisional. Sonidos finales: pendientes.
Vanessa, Jerry, los botones/paneles crema y las margaritas son recursos reales del catálogo de Bitácora Amorcito.

## Pendientes conocidos

- El **PRD v2.0** no está en el proyecto; SPECS lo cita como fuente de guiones y requisitos RF/CA. Los textos que SPECS no fija
  (p. ej. `ideaSuggestions` de Sombras y las descripciones de los objetos de la caja) son de prototipo y requieren revisión de
  Vanessa. Ver PLAN §5.
- Medición formal de latencia, FPS y carga con celulares reales y 50 participantes: fase 7 (la latencia preliminar de la fase 3 es de localhost).
- El teclado real de iOS y Android no se ha probado: el e2e simula un teléfono con la ventana reducida (fase 7).
- Los textos de cada paso (`prompts`), las sugerencias y las descripciones de los objetos son de prototipo: requieren revisión de
  Vanessa y una prueba de claridad con niñas y niños (fase 8).
- Falsos cortes de conexión con celulares reales (pantalla que se apaga, cambio de wifi a datos) y el comportamiento en segundo plano
  de Safari/iPhone: fase 7. Los cortes de las pruebas son de red simulada en la misma computadora.
- La demostración exige que la página **ya esté abierta** o que se sirva el build local; no hay service worker ni modo sin conexión
  para una web que nunca se descargó (decisión de SPECS 6.4).
- Audio de Phaser desactivado hasta la fase 7 (ver PLAN §5, decisiones).
