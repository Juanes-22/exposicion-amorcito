# El laboratorio de las cosas cotidianas

Aventura interactiva sobre la curiosidad: una sala compartida con turnos. Vanessa Estrada administra la sala desde la
computadora proyectada; solo la persona con el turno usa el mapa y los experimentos en su celular; el resto sigue la
proyección y participa en voz alta.

Práctica pedagógica 5 · Licenciatura en Educación Infantil · Universidad de Antioquia.

**Documentos rectores:** [`.claude/SPECS.md`](.claude/SPECS.md) (qué construir y cómo se acepta) y
[`.claude/PLAN.md`](.claude/PLAN.md) (orden de construcción, evidencias y registro de ejecución). Si algo de este README
contradice a SPECS, manda SPECS.

## Estado

Construido y verificado: fases 0, 1 y 2 de PLAN (base, contratos/dominio/Tiled directo, sala con control exclusivo y
persistencia). **Todavía no existe**: tocar el mapa para mover a Vanessa (fase 3), las tres mesas jugables en pantalla
(fase 4; sus reglas ya están en el dominio y probadas), cuaderno y final en pantalla (fase 5), demostración local (fase 6),
arte, audio y ensayo de capacidad (fases 7–8). Detalle y evidencias en PLAN §5.

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
| `npm run test:e2e` | Compila y ejecuta los e2e en Chromium con identidades independientes (ver «Pruebas»). |
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
independientes (capturas en `docs/evidencia/fase2/`) y edición directa del TMJ (CT-01). **No** sustituyen el ensayo en
Safari/iPhone, Chrome/Android y el equipo proyectado (PLAN fase 7).

## Recursos provisionales

Las mesas, el tileset y el inventor son arte **provisional** generado para el prototipo, marcado `placeholder: true` en
`assets.json`. `mode: "presentation"` en `laboratorio.json` rechaza cualquier recurso provisional. Sonidos finales: pendientes.
Vanessa, Jerry, los botones/paneles crema y las margaritas son recursos reales del catálogo de Bitácora Amorcito.

## Pendientes conocidos

- El **PRD v2.0** no está en el proyecto; SPECS lo cita como fuente de guiones y requisitos RF/CA. Los textos que SPECS no fija
  (p. ej. `ideaSuggestions` de Sombras y las descripciones de los objetos de la caja) son de prototipo y requieren revisión de
  Vanessa. Ver PLAN §5.
- Cámara de seguimiento para teléfono vertical (hoy el mapa completo queda pequeño): fase 3.
- Audio de Phaser desactivado hasta la fase 7 (ver PLAN §5, decisiones).
