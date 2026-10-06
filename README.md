# El laboratorio de las cosas cotidianas

Aventura interactiva sobre la curiosidad: una sala compartida con turnos. Vanessa Estrada administra la sala desde la
computadora proyectada; solo la persona con el turno usa el mapa y los experimentos en su celular; el resto sigue la
proyección y participa en voz alta.

Práctica pedagógica 5 · Licenciatura en Educación Infantil · Universidad de Antioquia.

**Documentos rectores:** [`.claude/SPECS.md`](.claude/SPECS.md) (qué construir y cómo se acepta) y
[`.claude/PLAN.md`](.claude/PLAN.md) (orden de construcción, evidencias y registro de ejecución). Si algo de este README
contradice a SPECS, manda SPECS.

## Estado

Construido y verificado: fases 0 a 5 de PLAN (base, contratos/dominio/Tiled directo, sala con control exclusivo y
persistencia, movimiento compartido, las tres mesas con estado compartido, y el cuaderno, las piezas, el inventor y el final).
El recorrido completo funciona de punta a punta en Chromium: Sombras, Rampas, La caja de las sorpresas, colocar las tres piezas,
elegir la pregunta final, revisar mesas ya completadas y reiniciar la sala. **Todavía no existe**: la demostración local y el
vencimiento y limpieza de salas (fase 6), el arte final, el audio y el ensayo de capacidad (fases 7–8). El dibujo de las mesas y del
inventor es procedimental y los textos de cada paso son de prototipo. Detalle y evidencias en PLAN §5.

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
| `npm run test:e2e` | Compila y ejecuta los 5 e2e en Chromium con identidades independientes (ver «Pruebas»). Las capturas de evidencia solo se escriben en `docs/` con `E2E_EVIDENCE=1`. |
| `npm run build` | Valida, comprueba tipos y compila el frontend en `dist/`. |
| `npm start` | Servicio de producción: sirve `dist/`, la API y Socket.IO desde el mismo origen. |

Aún no existen `test:load` ni `preview:demo` (fases 6–7).

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
- Las credenciales se guardan como hash. **No** se registran tokens ni textos del público.
- El proveedor de hosting sigue **sin elegir** (PLAN P8-03).

## Pruebas

`npm test` incluye pruebas de integración con **Socket.IO real y SQLite en archivo temporal**: fallo real de SQLite
(`PRAGMA query_only`), reinicio del proceso con el mismo archivo, pestañas sustituidas, salas aisladas, idempotencia por
`requestId`. `npm run test:e2e` usa el Chromium que Playwright ya tenga instalado (revisión 1243 para Playwright 1.63; si falta,
`npx playwright install chromium`).

Los e2e actuales cubren: ciclo de vida de Phaser bajo StrictMode (CT-04), administradora + dos participantes en contextos
independientes (capturas en `docs/evidencia/fase2/`), movimiento compartido con toque real, cambio de turno en pleno
movimiento, pausa, redimensionado y pestaña congelada (capturas en `docs/evidencia/fase3/`), las tres mesas completas desde dos
teléfonos y la proyección, con borradores, teclado reducido, pausa con la pelota rodando y la caja personal, y después el cuaderno
(panel de Vanessa y corrección desde el teléfono), el inventor, la pregunta final, la revisita en `finished` y el reinicio de sala
(capturas en `docs/evidencia/fase4/`), y edición directa del TMJ (CT-01).
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
- Audio de Phaser desactivado hasta la fase 7 (ver PLAN §5, decisiones).
