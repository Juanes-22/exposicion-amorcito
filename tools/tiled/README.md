# Edición del mapa en Tiled

**Abrir Tiled → editar `public/maps/laboratorio.tmj` → guardar → validar/recargar → Phaser lee ese mismo TMJ.**

El proyecto `laboratorio.tiled-project` solo referencia la carpeta `public/maps/` y define las clases de objeto con sus campos;
no contiene una copia del mapa. El servidor no depende de él.

Verificado con Tiled 1.12.2: lee el TMJ, resuelve el tileset por su ruta editorial y lo dibuja (`tmxrasterizer`), acepta este
proyecto y reexporta el mapa; el lector del proyecto valida esa exportación (fixture
`shared/testing/fixtures/laboratorio.exportado-por-tiled-1.12.2.tmj`). **No se ha probado todavía una sesión de edición en la
interfaz gráfica**: queda como comprobación manual (PLAN P1-03).

## Perfil compatible (primera versión)

| Propiedad | Convención |
| --- | --- |
| Orientación y tamaño | `orthogonal`, mapa finito (sin «Infinite»), tiles de 32 × 32 px. |
| Capas | Tile layers, image layers y object layers. **Sin grupos de capas.** |
| Datos de tiles | Arreglo numérico: guardar con compresión «CSV/ninguna», sin chunks. |
| Tileset | Una imagen por tileset, **incrustado** en el TMJ (sin `.tsx` externo, sin colecciones de imágenes). |
| Objetos | Solo **puntos** y **rectángulos** sin rotación. Sin elipses, polígonos, texto, tile-objects ni plantillas. |
| Colisiones | Rectángulos explícitos (clase `Collision`); no se deducen del alpha de las imágenes. |
| Efectos | Sin parallax, tintes ni repetición de imágenes. |

## Clases de objeto

| Clase | Forma | Obligatorio | Opcional |
| --- | --- | --- | --- |
| `Spawn` | Punto | `spawnId` | |
| `Station` | Punto | `activityId`, `assetId` | `interactionRadius` (72), `scale` (1) |
| `Inventor` | Punto | `assetId` | `interactionRadius`, `scale` (solo uno) |
| `Decoration` | Punto | `assetId` | `originX`, `originY`, `scale`, `depthMode` (`feet`/`back`/`front`), `tapEvent` (evento de audio: tocarla en el celular lo suena y Vanessa y Jerry se preguntan qué pasó; la flor de arriba a la izquierda usa `flower.tap`) |
| `Collision` | Rectángulo | — (en la capa `collisions` la clase puede quedar vacía) | |
| `SoundEmitter` | Punto | `soundId`, `assetId` | `volume`, `radius`, `mode` |
| `EditorOnly` | Punto/rectángulo | — | notas; se ignora en el juego |

- Los IDs de negocio viven en propiedades explícitas; el `id` entero de Tiled **no** es el `activityId`.
- **Pies como origen**: una `Station` es el punto de suelo donde se para Vanessa, frente a la mesa. Debe ser transitable y
  alcanzable (la huella es 42 × 25 px: `x ± 21`, `y-25…y`). La colisión de la mesa va aparte, **por encima** de ese punto.
- Cada ID de `route` en `laboratorio.json` necesita exactamente una `Station`; hace falta un `Inventor` y el `Spawn` inicial.
- Ocultar una capa **no** retira un objeto funcional; solo afecta a lo decorativo. Para quitar una mesa: quita su ID de `route`
  **y** su objeto.
- Cada image layer y cada tileset lleva la propiedad personalizada **`assetId`** (de `assets.json`). El campo nativo `image` de
  Tiled es una referencia editorial y debe resolver al mismo archivo.
- Tiled escribe la clase del objeto como `type` (versiones antiguas) o `class`; el lector acepta ambas.

Un mapa nuevo o editado se prueba **creando una sala o una demostración nuevas**: una sala ya iniciada no cambia de mapa.
