# El laboratorio de las cosas cotidianas

Aventura interactiva sobre la curiosidad: una sala compartida con **rondas guiadas**. Todas las personas exploran a la vez desde su
celular, cada una con su propio personaje en el laboratorio; Vanessa Estrada conduce desde la computadora proyectada: abre **una mesa
por ronda**, mira cuántas personas ya están listas, reúne al grupo para conversar y decide cuándo seguir. Todas las personas que entran
juegan.

Práctica pedagógica 5 · Licenciatura en Educación Infantil · Universidad de Antioquia.

**Documentos rectores:** [`.claude/SPECS.md`](.claude/SPECS.md) (qué construir y cómo se acepta) y
[`.claude/PLAN.md`](.claude/PLAN.md) (orden de construcción, evidencias y registro de ejecución). Si algo de este README
contradice a SPECS, manda SPECS.

## Estado

Construido y verificado: fases 0 a 6 de PLAN (base, contratos/dominio/Tiled directo, sala y persistencia, movimiento compartido, las
tres mesas, el inventor y la continuidad: detección de cortes, reinicio real del servicio, vencimiento y limpieza de salas; la
demostración local de respaldo se retiró después), de la fase 7 **el audio opcional, el ensayo de capacidad y la prueba en navegadores móviles de
simulador/emulador**, y la **fase 9: participación simultánea y rondas guiadas por Vanessa**, que reemplazó el modelo de un solo
controlador por turnos (formularios y modalidades de respuesta incluidos), y la **fase 10: la tercera mesa es El observatorio**, que
reemplazó La caja de las sorpresas. El recorrido completo funciona de punta a punta en Chromium.
**Todavía no existe**: el arte final, los sonidos finales (los actuales son provisionales), la optimización de carga y render (P7-04)
ni la prueba en celulares físicos y en el equipo proyectado real (fases 7–8). El dibujo de las mesas y del inventor es procedimental y
los textos son de prototipo. Detalle y evidencias en PLAN §5.

## Cómo se juega

1. Vanessa crea la sala; las personas entran con el QR (nombre y color). Cada una aparece como una
   silueta con su nombre encima en el laboratorio compartido.
2. **Preparación:** al comenzar, la proyección muestra solo la pregunta de entrada («¿Recuerdan algo que hayan aprendido porque les dio
   curiosidad?»); las personas pueden caminar. **Abrir mesa:** la pregunta de la mesa aparece junto al laboratorio y todas pueden
   abrirla (menú «Mesas → Ir a la mesa actual» o tocándola en el mapa) y explorar a su ritmo; los resultados se registran solos y cada
   persona queda «Lista para conversar» al cumplir el criterio de la mesa (recién entonces puede volver al mapa). Vanessa ve «N de M listos».
3. **Conversemos:** se cierran las pruebas (las que ruedan se cancelan), los celulares dicen «Ya exploramos: deja los controles y mira la
   proyección para escuchar lo que descubrieron los demás.», la proyección muestra la pregunta de la conversación, Vanessa guarda las ideas del grupo y, cuando quiere, muestra la
   frase de Freire (recién entonces aparece «Abrir siguiente mesa»). Con personas pendientes avisa «Todavía hay personas explorando», nombra a quienes faltan y pide confirmarlo; no les
   concede la mesa por terminada.
4. **Abrir siguiente mesa** incorpora la pieza al inventor y devuelve a todas al mapa.
5. **El inventor es una mesa más.** «Pasar al inventor» devuelve a todas al mapa y caminan hasta la máquina; Vanessa pulsa **Abrir
   inventor** y cada persona entra (tocando la máquina o con «Mesas → Ir al inventor»), elige una de las preguntas sugeridas por mesa o
   escribe la suya y la registra. Vanessa las ve en «Preguntas del inventor», elige con el grupo la pregunta final, la confirma y se
   imprime en el inventor.

Los textos del juego siguen la **Guía para Vanessa** (un documento aparte; la consola ya no tiene «Guía para conversar»). Las preguntas
sugeridas del inventor se editan en `public/config/laboratorio.json → inventor.questions`.

Las mesas son **Sombras** (acercar y alejar una linterna y comparar el tamaño de la sombra, sin centímetros), **Rampas** (soltar una
pelota eligiendo entre seis inclinaciones con nombre; no se muestran grados ni tiempos: cuánto demoró la pelota se pregunta en la
conversación, donde no se proyectan resultados) y **El observatorio**: cada persona mira por su propio telescopio un panorama nocturno, acerca la Luna y encuentra un grupo de estrellas
(arrastrando el visor o con flechas y aumentos, sin atajos); quien explora más allá puede descubrir una galaxia. En el horizonte hay una casa con dos siluetas que discuten; si alguien la mira
de cerca, una silueta cierra la cortina, una sola vez y solo para esa persona. No es un requisito ni da puntos, y la consola nunca dice
quién la miró. En la conversación Vanessa no proyecta la exploración de nadie: al pulsar **Mostrar la frase de Freire**, la proyección muestra
también la casa (las siluetas discuten y una cierra la cortina) para conversar sobre el límite entre la curiosidad y la privacidad.

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
| `npm run test:load` | Ensayo de capacidad: 50 participantes + administradora contra un servidor real en otro proceso (entrada, las tres rondas con todas las personas explorando a la vez, 100 pruebas de rampa simultáneas, entradas tardías, desconexiones y regreso de la administradora). Tarda ~1 min. `LOAD_REPORT=1` escribe el informe en `docs/evidencia/fase7/`. Ver «Capacidad». |
| `npm run ensayo` | Sala preparada para **ensayar en celulares reales** de la red local (puertos 3400/3412; ver «Ensayo en dispositivos»). |
| `npm run build` | Valida, comprueba tipos y compila el frontend en `dist/`. |
| `npm start` | Servicio de producción: sirve `dist/`, la API y Socket.IO desde el mismo origen. |

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

El dominio (`shared/domain/`) es el único lugar con las reglas de las rondas, los resultados personales, las piezas y los modelos de
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
- Un reinicio recupera las salas **pausadas**, con la ronda, la lista de personas, el contador y las pruebas en marcha intactos;
  Vanessa recupera la administración con su credencial y elige cuándo reanudar. El tiempo con el servidor apagado no cuenta.
- La base cambió de esquema (versión 2): una base del modelo anterior se respalda como `….v1.bak` y sus salas se conservan sin cargarse.
- **Vencimiento y limpieza** (`ADMIN_IDLE_TTL_MS`, `TERMINAL_RETENTION_MS`, `SWEEP_INTERVAL_MS`): una sala cuya administradora lleva
  2 horas sin dar señales (comandos o la señal periódica del navegador abierto; las participantes no cuentan) **vence**: se avisa y se
  cierran las conexiones. Una sala terminal (cerrada o vencida) se **elimina por completo** (sala, identidades y comandos) 24 horas
  después. El plazo de inactividad se cuenta con la hora guardada: si el servicio estuvo apagado más tiempo, vence al volver.
- Detección de cortes: `PING_INTERVAL_MS=4000` y `PING_TIMEOUT_MS=5000`. Un corte de red silencioso se detectó en ~8,6 s en las pruebas
  (objetivo ≤ 10 s; peor caso teórico 9 s). No se han medido falsos cortes en celulares reales (fase 7).
- Las credenciales se guardan como hash. **No** se registran tokens ni textos del público.
- El proveedor de hosting sigue **sin elegir** (PLAN P8-03); la imagen de Docker está lista y probada en local (ver «Despliegue con Docker»).

## Despliegue con Docker

El `Dockerfile` construye una sola imagen que sirve el frontend compilado, la API y Socket.IO desde el mismo origen. Compila
`better-sqlite3` (módulo nativo) en la etapa de construcción y corre con un usuario sin privilegios.

```bash
docker build -t laboratorio .
docker run -d --name laboratorio -p 8080:8080 -v laboratorio-datos:/data laboratorio
npm run smoke -- http://127.0.0.1:8080     # prueba de humo en navegador: sala, dos personas y una mesa abierta
```

- **Volumen:** la base SQLite vive en `/data` (`DATABASE_PATH=/data/laboratorio.sqlite`). Sin un volumen persistente se pierde con cada
  reinicio o redespliegue: las salas ya no se recuperan.
- **Variables:** `TRUST_PROXY=1` viene activado en la imagen (detrás de un proxy, sin esto todas las personas parecen venir de la misma IP y
  los límites de entrada se aplican juntos). `PORT` lo respeta el servidor, así que los proveedores que lo asignan funcionan sin tocar
  nada. `PUBLIC_ORIGIN` es opcional: si falta, el QR y los enlaces se construyen con la dirección de la petición.
- **Una sola instancia, siempre encendida.** Las salas viven en memoria; no la dejes escalar a varias réplicas ni a cero mientras haya
  una sesión (SPECS 7.4).
- **Salud:** `GET /api/health`.
- **Comprobar un despliegue ya publicado:** `npm run smoke -- https://tu-dominio` (deja una sala de prueba que vence sola).

Notas por proveedor (precios y límites consultados el 2026-10-07; revísalos antes de contratar):

- *Render, servicio web gratis:* sirve para validar, pero se duerme tras 15 minutos sin tráfico (cuentan también los mensajes de WebSocket;
  despertar tarda cerca de 1 minuto) y **no tiene disco persistente**: la base se borra al reiniciar, redesplegar o dormirse. Con la consola de
  Vanessa abierta el latido de administradora mantiene tráfico.
- *Fly.io:* siempre encendido y con volumen persistente (USD 2,19 al mes con 256 MB, 3,69 con 512 MB, más 0,15 por GB de volumen); no hay
  región en Bogotá (se retira): elige la más cercana con `fly platform regions` y desactiva el apagado automático de la máquina.
- Vercel y similares sin servidor **no sirven**: la aplicación necesita un proceso persistente con WebSockets y disco.

## Si el servidor falla

Ya no hay demostración local de respaldo (`/demo`). Si el servidor deja de responder, las pantallas dicen «Reconectando con la sala…» y
vuelven solas cuando el servicio regresa: la sala reaparece pausada con lo confirmado y Vanessa decide cuándo reanudar.

## Pruebas

`npm test` incluye pruebas de integración con **Socket.IO real y SQLite en archivo temporal**: fallo real de SQLite
(`PRAGMA query_only`), reinicio del proceso con el mismo archivo, pestañas sustituidas, salas aisladas, idempotencia por
`requestId`. `npm run test:e2e` usa el Chromium que Playwright ya tenga instalado (revisión 1243 para Playwright 1.63; si falta,
`npx playwright install chromium`).

Además: `server/src/detection.test.ts` usa relojes reales y un proxy que corta el tráfico sin cerrar nada (un corte silencioso) para medir
cuánto tarda en detectarse; `scripts/e2e/restart.ts` arranca el servidor como proceso aparte, lo mata con `SIGKILL` a mitad de una prueba
de rampa y lo vuelve a arrancar con el mismo archivo SQLite.

Los e2e actuales (`scripts/e2e/`) cubren: ciclo de vida de Phaser bajo StrictMode (`strictmode.ts`, CT-04); sala con administradora y
dos participantes en contextos independientes, nombres repetidos, pausa y recargas (`room-flow.ts`); movimiento compartido con toque
real, planes simultáneos de dos personas, pausa, redimensionado, pestaña congelada, mesas y latencia (`movement.ts`); **las tres rondas
completas con proyección y dos celulares** —contador, «Conversemos» con pendientes, pruebas que se cancelan, frase de Freire
proyectada, notas del grupo, el inventor como mesa (caminar hasta la máquina, abrirla, registrar preguntas y elegir la final), cuaderno y
nombres sobre los avatares— (`rounds.ts`); el reinicio real del servicio con dos
pruebas en marcha (`restart.ts`); y la edición directa del TMJ (`tiled-direct.ts`, CT-01). Las capturas de evidencia de las fases 2 a 6 en `docs/evidencia/`
son del modelo de turnos; las del modelo de rondas solo se escriben con `E2E_EVIDENCE=1` (`docs/evidencia/rondas/`).
`?debug` en la URL de la sala superpone colisiones y radios; `?hooks` solo expone el juego para las pruebas. **No** sustituyen el ensayo en
Safari/iPhone, Chrome/Android y el equipo proyectado (PLAN fase 7).

## Audio y señales

El sonido está **activado por defecto** en el celular y en la proyección. Como los navegadores no dejan sonar antes de un gesto, empieza
con el primer toque o tecla en la página (el `AudioContext` se crea dentro de ese gesto); el botón ya aparece como «Silenciar». Quien lo
silencia lo deja apagado en ese dispositivo (preferencia local). Los efectos salen de **transiciones del
estado** (pieza conseguida, inventor encendido y aventura terminada, que oyen todas las pantallas; el clic de una posición de Sombras,
que oye solo quien lo provoca; El observatorio funciona sin sonido) con un identificador por efecto, así que una reconexión, un estado repetido
o el primero que se recibe no repiten sonidos. Cada evento tiene además su
**señal textual** (`aria-live`), que se muestra siempre, con o sin sonido. Si el audio falla (navegador sin soporte, archivo que no
carga), la actividad sigue sin bloquearse y el control lo dice con texto. Los eventos y sus recursos se configuran en
`audio.events` de `laboratorio.json`; un evento desconocido es un error de validación.

Los cinco sonidos actuales son **provisionales** (`placeholder: true`): se generan con `tools/audio/generate_sfx.py` y
`mode: "presentation"` los rechaza hasta que haya sonidos finales.

## Capacidad

`npm run test:load` ensaya 50 participantes y la administradora **explorando a la vez** y mide la entrada, la apertura y las transiciones
de ronda en todas las pantallas, el reflejo de cada acción en el propio teléfono, el contador de Vanessa, las entradas tardías, las pruebas
de rampa simultáneas con sus muestras de reloj, las desconexiones y que **nadie recibe** el estado personal de otra persona ni el listado
de presencia. El último informe está en [`docs/evidencia/fase7/capacidad.md`](docs/evidencia/fase7/capacidad.md). **Límite:** clientes y servidor comparten
computadora y red de bucle local, y los clientes no dibujan: valida el protocolo y el servidor con 51 conexiones, **no** la red
inalámbrica del lugar ni el rendimiento de los celulares (no se midieron FPS).

## Ensayo en dispositivos

`npm run ensayo` levanta el servidor (puertos 3400/3412) con una sala lista y un panel de control para abrirla desde los
celulares de la red local, conducir las rondas (`/start`, `/open`, `/converse`, `/freire`, `/next`) y simular la proyección. La prueba de la fase 7 se hizo con **Safari de iPhone SE
(iOS 18.2, simulador) y Chrome de Android 15 (emulador, 411 y 360 dp)**; las capturas están en `docs/evidencia/fase7/`. Los
simuladores no son celulares físicos: queda pendiente repetirlo con aparatos reales, con el teclado de iOS en el campo de texto de las
mesas y con el equipo y proyector de la exposición.

## Recursos provisionales

Las mesas, el tileset y el inventor son arte **provisional** generado para el prototipo, marcado `placeholder: true` en
`assets.json`. `mode: "presentation"` en `laboratorio.json` rechaza cualquier recurso provisional. Los cinco sonidos también son provisionales.
Vanessa, Jerry, los botones/paneles crema y las margaritas son recursos reales del catálogo de Bitácora Amorcito.

## Pendientes conocidos

- El **PRD v2.0** no está en el proyecto; SPECS lo cita como fuente de guiones y requisitos RF/CA. Los textos que SPECS no fija
  (p. ej. `ideaSuggestions` de Sombras y los textos de El observatorio) son de prototipo y requieren revisión de
  Vanessa. Ver PLAN §5.
- La capacidad se ensayó con 50 clientes simulados en bucle local; falta medirla con celulares reales en la red del lugar y medir FPS (fase 7/8).
- El teclado de Android se probó en emulador (Chrome); el de **iOS** con el campo de texto de las mesas no se pudo probar (el simulador quedó
  en modo de teclado físico). Faltan celulares físicos.
- Los textos de cada mesa (objetivo, preguntas de apertura y conversación, frases de Freire, guion de El observatorio, frases de
  apoyo) son los de las propuestas de mejora y requieren revisión de Vanessa y una prueba de claridad (fase 8).
- La persistencia guarda un solo JSON por sala. Con 50 personas el servidor midió CPU máx 31 % y 131 MiB en bucle local; falta medirlo con
  varias salas y con disco lento.
- Falsos cortes de conexión con celulares reales (pantalla que se apaga, cambio de wifi a datos) y el comportamiento en segundo plano
  de Safari/iPhone: sin probar en aparatos físicos. Los cortes de las pruebas son de red simulada en la misma computadora.
- El audio no usa el sonido de Phaser (sigue desactivado con `noAudio`): lo reproduce un módulo propio de la aplicación (`src/app/audio/`)
  con `AudioContext` creado bajo gesto (ver PLAN §5, decisiones).
- Phaser vuelve a dibujar a 60 fps aunque no pase nada: en el emulador Android sin GPU pesaba mucho. Se deja para P7-04.
