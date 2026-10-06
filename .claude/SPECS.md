# SPECS.md — El laboratorio de las cosas cotidianas

## Una aventura interactiva sobre la curiosidad

**Expositora:** Vanessa Estrada.  
**Asignatura:** Práctica pedagógica 5 · Licenciatura en Educación Infantil · Universidad de Antioquia.  
**Versión documental:** 1.0 · 5 de octubre de 2026.  
**Fuente de producto:** PRD suministrado, versión 2.0: sala compartida y turnos.  
**Stack:** React + Vite + TypeScript + Phaser; servidor Node.js + TypeScript + Socket.IO; SQLite.  
**Estado:** especificación para construir. Este documento no acredita código implementado ni pruebas ejecutadas.

<a id="spec-0"></a>

## 0. Autoridad, fuentes y decisiones

Este archivo define el comportamiento, la arquitectura, los contratos y las condiciones de aceptación. [PLAN.md](PLAN.md) define el orden de construcción y las evidencias de ejecución. Los ejemplos ayudan a implementar; no sustituyen los requisitos.

La referencia técnica es [Juanes-22/bitacora-amorcito](https://github.com/Juanes-22/bitacora-amorcito), rama main, commit **041d326f1f0b9e30b2d0de816cb7bb986e542d50**, consultado el 5 de octubre de 2026. Sus documentos reales se llaman **.claude/SPEC.md** y **.claude/PLAN.md**, con SPEC en singular. En esta aventura se usa el nombre solicitado **SPECS.md**.

| Documento o recurso | Responsabilidad |
| --- | --- |
| `.claude/SPECS.md` | Requisitos funcionales y técnicos; contratos; criterios de aceptación. |
| `.claude/PLAN.md` | Fases, tareas, dependencias, pruebas y evidencias. |
| PRD versión 2.0 | Intención pedagógica, escenas, guiones y experiencia compartida. |
| `public/config/laboratorio.json` | Recorrido, contenidos, diálogos, parámetros de experimentos y referencias a assets. Su esquema vive en `shared/config/schemas/`. |
| `public/maps/laboratorio.tmj` | Única fuente editable de geometría, ubicaciones y composición del laboratorio. |
| `public/assets/assets.json` | Catálogo de recursos, rutas, atlas y metadatos. |
| SQLite del servidor | Estado autorizado y cambios confirmados de cada sala. |
| `README.md` | Instalación, ejecución, edición en Tiled, ensayo y operación del código construido. |

Ante un cambio del usuario, actualizar SPECS y después PLAN. Si una decisión técnica impide cumplir el PRD, resolver esa incompatibilidad explícitamente; no reducir el producto para cerrar una tarea. Guardar estos dos documentos en `.claude/` en el nuevo proyecto y pedir a la IA de implementación que los lea en ese orden.

### 0.1. Decisiones de esta propuesta

| Aspecto | Decisión |
| --- | --- |
| Producto inicial | Sala compartida, administradora, único controlador y progreso colectivo. La conexión por turnos es parte de la primera versión. |
| Base tecnológica | Conservar React, Vite, TypeScript y Phaser de la referencia. Agregar el servidor necesario para la sala. |
| Tiled | Guardar directamente un mapa JSON `.tmj` dentro de `public/maps/` y consumirlo con el soporte nativo de Phaser. |
| Datos espaciales | No generar `maps.json`, `placements` ni otra copia editable de las coordenadas. |
| Recursos existentes | Reutilizar PNG, atlas, fuentes y componentes pertinentes mediante `assetId`; no exigir un tileset para empezar. |
| Tiles, si se incorporan | Una imagen de tiles y definición incrustada en el TMJ; mantener el mapa dentro del perfil compatible de la sección 8. |
| Dominio | Funciones TypeScript puras compartidas entre servidor y demostración local. |
| Sincronización | Enviar intenciones y estados; dibujar localmente la misma escena en proyección y teléfono activo. |
| Persistencia inicial | Una instancia de servidor con SQLite en volumen persistente; sin Redis, microservicios ni varias réplicas. |
| Demostración | Misma aventura con controlador local y estado separado; no reemplaza la implementación de salas. |
| Organización | Un repositorio y un package.json/lockfile; frontend en `src/`, servidor en `server/` y dominio en `shared/`. |

### 0.2. Qué se conserva y qué se simplifica de Bitácora Amorcito

| Referencia revisada | Uso en la aventura |
| --- | --- |
| `src/config/assetRegistry.ts` | Conservar resolución central de URLs, IDs y metadatos. |
| `src/game/bridge/GameBridge.ts` | Adaptar el puente tipado y su último snapshot retenido. |
| `src/game/createGame.ts` y host React | Conservar una instancia por host y limpieza de listeners. |
| `src/domain/pathfinding.ts` | Evaluar reutilización de su búsqueda de caminos pura; desacoplarla de tipos de bitácora. |
| `src/assets/frameDefinitions.ts` | Revisar las definiciones de frames antes de reutilizar las hojas de Vanessa y Jerry. |
| Paneles crema, botones verdes y fuentes | Reutilizar únicamente componentes y recursos útiles para esta exposición. |
| `tools/tiled/maps/*.tmj → importador → public/config/maps.json` | Sustituir por consumo directo del TMJ. |
| `WorldBuilder` dependiente de `config.maps` y `placements` | Adaptar a Tilemap nativo y objetos del mapa. |
| Progreso individual, XP y localStorage | Sustituir por progreso colectivo autorizado por servidor. |
| Seis aprendizajes, portales, insignias y animales | No trasladar esos requisitos a esta aventura. |

No copiar todo el repositorio para conservar características ajenas al producto. Usarlo como referencia y reutilizar piezas identificadas. Si se parte de una copia, retirar lo innecesario en el proyecto nuevo, conservando intacta la bitácora original.

<a id="spec-1"></a>

## 1. Producto, propósito y alcance pedagógico

El salón recorre una aventura de aproximadamente **18 minutos**: bienvenida, Sombras, Rampas, La caja de las sorpresas e inventor de preguntas. Vanessa administra los turnos desde la computadora proyectada. Solo el jugador activo usa el mapa y los experimentos en su celular. Los demás ven su silueta, color, nombre y estado, y participan oralmente siguiendo la proyección.

El personaje controlable siempre es **Vanessa con Jerry**, independientemente de quién tenga el turno. Las siluetas identifican a las personas del público; no son personajes adicionales en el mapa.

| Momento | Tiempo orientativo | Propósito | Pieza colectiva |
| --- | --- | --- | --- |
| Bienvenida | 2 min | Entrar, explicar los turnos y presentar el inventor. | — |
| Sombras | 5 min | Pasar de una primera idea a observar, probar y comparar. | Lupa. |
| Rampas | 5 min | Abrir una pregunta, contrastar una predicción y dialogar. | Bocadillo de conversación. |
| Cajas | 3 min | Pedir permiso, respetar una negativa y seguir investigando. | Corazón. |
| Inventor y reflexión | 3 min | Elegir una nueva pregunta y relacionar lo vivido con Freire. | Cierre. |

Las pausas para conversar están incluidas en esos tiempos. No hay límite automático por turno, puntos por rapidez, ranking ni evaluación automática de respuestas.

La base es el apartado **«Enseñar exige curiosidad»** de *Pedagogía de la autonomía*, según la delimitación del PRD. Los diálogos son paráfrasis y ejemplos creados para la exposición. Mantener las precisiones del PRD:

- La curiosidad espontánea puede volverse más rigurosa al observar, probar y buscar razones.
- La curiosidad «domesticada» no es una etapa obligatoria de ese recorrido.
- Dialogar también implica escuchar y atender las explicaciones del docente.
- El desafío de la clase consiste en pensar y comprender.
- La tercera mesa trata de privacidad y respeto. La relación entre autoridad y libertad queda fuera de esta versión.

La aplicación organiza acciones y registra ideas; no juzga si una reflexión es correcta.

<a id="spec-2"></a>

## 2. Pantallas, navegación y reglas de sala

### 2.1. Entrada y vistas

Usar rutas sencillas, por ejemplo `/`, `/sala/:code` y `/demo`. La URL pública de entrada contiene únicamente el código; nunca una credencial privada. El servidor debe devolver la aplicación en las rutas del frontend.

| Vista | Contenido y comportamiento |
| --- | --- |
| Entrada | Título; Crear sala; Unirse; acceso al respaldo local para Vanessa. |
| Entrada a sala | Nombre de 1–20 caracteres Unicode, color de una paleta definida y silueta. Sin cuenta ni fotografía. |
| Bienvenida de Vanessa | QR, código, cantidad conectada y tarjetas de participantes. Seleccionar turno y comenzar. |
| Espera | Silueta propia, nombre y «Estás en la sala. Sigue la aventura en la proyección». Estado de conexión. Sin canvas del mapa. |
| Aventura de Vanessa | Escena compartida; «Explora: [nombre]»; pausa, turno, tomar control, QR, participantes y guía plegables. |
| Jugador activo | Misma actividad y estado; «Es tu turno»; controles habilitados tras recibir snapshot y cargar recursos. |
| Actividad | Escena cercana y controles HTML grandes; pasos y registros compartidos. |
| Cuaderno | Ideas confirmadas y pruebas, agrupadas por mesa; autor y distinción entre primera idea y observación. |
| Final | Inventor, piezas y pregunta elegida; reflexión; acceso al cuaderno y mesas completadas. |
| Cerrada o vencida | Mensaje de finalización o sala no disponible; sin controles ni reconexión indefinida. |
| Demostración | Aventura local con rótulo persistente «Demostración» y estado independiente. |

El panel de participantes y la guía se muestran en la misma computadora proyectada; cualquier panel abierto puede verlo el público. Una segunda ventana de proyección separada queda para después.

Los nombres repetidos conservan identidades distintas. El servidor añade una distinción visible estable, como «Laura · 2». El color no es el identificador.

### 2.2. Permisos

| Acción | Administradora | Controlador participante | Participante en espera |
| --- | --- | --- | --- |
| Ver aventura y cuaderno | Siempre mientras la sala esté disponible. | Durante su turno. | Sigue la proyección presencial. |
| Ver listado completo | Sí. | No es necesario. | No es necesario. |
| Mover, experimentar y confirmar respuestas | Cuando tiene el control. | Con permiso vigente. | No. |
| Dar, retirar o tomar control | Sí. | No. | No. |
| Comenzar, pausar y reanudar | Sí. | No. | No. |
| Reiniciar avance o cerrar | Sí, con confirmación. | No. | No. |
| Preguntar en voz alta | Sí. | Sí. | Sí. |

La administradora que observa no puede manipular el experimento sin usar **Tomar control**. Puede consultar el cuaderno y abrir sus paneles localmente sin cambiar la escena del jugador.

### 2.3. Ciclo de sala y control

Fases de sala: `welcome`, `running`, `paused`, `finished`, `closed` y `expired`. En pausa conservar `resumePhase`, que indica si se regresa a `running` o `finished`.

Propietario del control: participante, administradora o ninguno. **Pausar conserva al propietario; retirar control lo elimina.** Dar o tomar control mientras hay pausa no reanuda.

| Operación | Efecto autorizado |
| --- | --- |
| Comenzar | Desde bienvenida, con administradora conectada y un controlador elegido. |
| Dar control | Reemplazar atómicamente al propietario por un participante conectado. |
| Tomar control | Reemplazarlo por la administradora. |
| Pausar | Detener reloj, movimiento y controles; conservar propietario. |
| Reanudar | Continuar desde el instante congelado; requiere administradora y controlador conectados. |
| Retirar control | Dejar propietario vacío y pausar una aventura en curso. |
| Reiniciar avance | Borrar aventura, registros y piezas; volver a bienvenida. Conservar participantes y credenciales de esa sala. |
| Finalizar aventura | Confirmar pregunta final; permitir consultas y revisitas controladas. |
| Cerrar | Revocar control y credenciales de uso; todas las vistas muestran que terminó. |
| Vencer | Igual bloqueo; limpieza conforme a la política de retención. |

Reiniciar y cerrar requieren un diálogo que explica su efecto. Reiniciar incrementa `roomGeneration` para invalidar mensajes del recorrido anterior.

### 2.4. Recorrido y desplazamiento

El orden inicial es `sombras → rampas → cajas → inventor`. La siguiente mesa se habilita al completar la anterior. Las ya completadas se pueden revisitar sin perder registros ni piezas.

Tocar un punto solicita un destino; tocar una mesa solicita acercarse y abrirla. Una lista de mesas accesible permite llegar y abrir la misma actividad sin manejar el personaje. Esa alternativa conserva el orden y los permisos, pero no exige proximidad.

El servidor valida destinos, límites y trayectos. Un punto inaccesible muestra una explicación breve y no deja al personaje atrapado. Las coordenadas de pantalla se convierten a coordenadas de mundo antes de enviar la intención.

Una mesa ocupada detiene la navegación del mapa y abre su vista cercana. No se sincronizan los píxeles del teléfono: cada dispositivo adapta cámara y composición a su tamaño.

<a id="spec-3"></a>

## 3. Actividades, registros y cierre

### 3.1. Reglas comunes del cuaderno

Una respuesta puede confirmarse como `written`, `suggested`, `oral` o `uncertain`. Un texto escrito admite hasta 280 caracteres Unicode después de recortar espacios; no se exige acertar.

| Modalidad | Datos | Representación compartida |
| --- | --- | --- |
| Escrita | Texto no vacío. | Texto confirmado. |
| Sugerida | ID de una opción existente del proyecto. | El servidor resuelve su texto. |
| Oral | Sin texto obligatorio. | «Lo compartiremos en voz alta». |
| Incertidumbre | Sin explicación obligatoria. | «Todavía no tenemos una explicación». |

La modalidad incertidumbre satisface un registro de idea, predicción u observación cuando el paso lo permita; una nueva pregunta admite escritura, sugerencia o participación oral. Las combinaciones válidas se definen por campo.

Antes del primer formulario mostrar **«Esta idea se compartirá con el grupo»**. Los borradores permanecen en el dispositivo, no se proyectan letra por letra y no se transfieren al nuevo jugador. Cambiar de turno los separa del registro confirmado y avisa si quedó texto sin compartir.

Cada registro tiene ID, campo, autor, marcas temporales del servidor y revisión. Una edición conserva el valor inicial o historial de versiones. La **primera idea de Sombras permanece identificable** aunque después se añada una explicación revisada.

Completar mesas y conceder piezas ocurre en una sola transición del dominio. No existe un comando del cliente para «otorgar pieza».

### 3.2. Sombras

Pasos: `surprise → firstIdea → explore → observation → nextQuestion → completed`.

| Paso | Acción y condición para continuar |
| --- | --- |
| Sorpresa | Clic opcional y texto equivalente. «El objeto es pequeño. ¿Por qué su sombra se ve tan grande?». |
| Primera idea | Confirmar idea escrita, sugerida, oral o incertidumbre. |
| Explorar | Mover la linterna; confirmar al menos dos posiciones distintas. |
| Observación | Confirmar lo observado; mantener visible la primera idea. |
| Nueva pregunta | Escribir, elegir un ejemplo o indicar participación oral. |
| Completar | Registrar condiciones y conceder la lupa una vez. |

Mantener fijos objeto y pantalla. La linterna no atraviesa el objeto. Ofrecer un slider con «Más lejos del objeto» y «Más cerca del objeto», además de botones −/+.

Modelo de referencia para desarrolladores: fuente puntual ideal; distancia linterna–objeto `d`; distancia objeto–pantalla `b`; altura del objeto `h`. Usar `alturaSombra = h × (d + b) / d`. Valores iniciales propuestos: `d = 10…60 cm`, `b = 25 cm`, `h = 8 cm`. Acercar la linterna aumenta la sombra y alejarla la reduce. La linterna empieza en el extremo cercano del rango (`d` mínimo): la sombra grande de un objeto pequeño es la sorpresa del primer paso.

La separación mínima entre dos muestras que cuentan para completar es configurable; valor inicial **5 cm**. Un cambio continuo se comparte, pero una muestra de exploración se registra al terminar el gesto o confirmar la posición. No contar cada mensaje de arrastre como una exploración distinta.

La representación y descripción textual usan el mismo valor calculado. No sustituir el modelo por tamaños aleatorios o dos imágenes fijas.

Preguntas sugeridas: «¿Qué pasaría si movemos el objeto?» y «¿Todas las formas producen la misma sombra?».

Guía breve de Vanessa: antes, escuchar la primera explicación y relacionar la sorpresa con curiosidad espontánea; después, preguntar qué cambió al probar y conectar observación, comparación y revisión de ideas con curiosidad epistemológica.

### 3.3. Rampas

Pasos: `closedAnswer → question → prediction → trials → observation → completed`.

1. Docente ficticio: «Copia el resultado de la guía. No hagas preguntas».
2. Guía: «En este montaje, al aumentar la inclinación la pelota llega antes al final de la rampa».
3. Controles desactivados. **Tengo una pregunta** abre el siguiente paso sin temporizador ni transcripción obligatoria.
4. Elegir «¿Qué pasaría si aumentamos la inclinación?» o escribir una pregunta sobre el montaje.
5. Docente: «Exploremos esa pregunta. ¿Cómo podríamos comprobarlo?».
6. Confirmar predicción; permitir incertidumbre o participación oral.
7. Soltar una pelota desde reposo, cambiar solo la inclinación y repetir.
8. Comparar al menos dos pruebas terminadas con inclinaciones distintas y confirmar observación.
9. Conceder el bocadillo una sola vez, aunque la predicción no se haya cumplido.

Misma pelota, superficie y longitud. Rango inicial **15°–45°**, paso de **5°**, diferencia mínima para comparar **5°**. Cada prueba dura aproximadamente **2–4 segundos de animación activa**. Desactivar nueva suelta y cambio de inclinación durante una prueba.

**Modelo compartido propuesto:** esfera homogénea ideal rodando sin deslizar, sin pérdidas disipativas. `a = (5/7) × 9.81 × sin(θ)`; recorrido `L = 2 m`; duración visual `T = 2.4 × sqrt(2L/a)`. Da aproximadamente 3.56 s a 15° y 2.16 s a 45°. La posición sobre la rampa usa `s/L = min(1, (t/T)²)`.

El factor 2.4 se aplica a todas las pruebas. El tiempo mostrado es el de esa **simulación visual**, no una medición real de laboratorio; debe corresponder al movimiento que se observa. El cálculo se implementa una sola vez en el dominio TypeScript, con grados convertidos a radianes.

El servidor asigna `trialId`, calcula duración y congela parámetros. El cliente no decide cuándo una prueba terminó ni envía su resultado como autoridad. Una pausa conserva `elapsedMs`; el tiempo de conversación no se suma. La presentación puede dibujar a 60 FPS aunque reciba menos actualizaciones.

Cada resultado conserva inclinación, condiciones, tiempo y modelo usado. El registro «Probé…» se deriva de esos resultados. Nuevas pruebas pueden ampliar la comparación, sin borrar las anteriores.

Guía de Vanessa: durante la escena inicial, conversar sobre tener una respuesta sin poder investigar; después, pedir razones apoyadas en los resultados y relacionar preguntar, escuchar y comprender con las ideas de Freire.

### 3.4. La caja de las sorpresas

Pasos: `exploreShared → askPermission → refusal → respect → nextQuestion → completed`.

- Caja **Para explorar**: campanita, lupa y piedra. Abrir y explorar al menos un objeto.
- Campanita: sonido opcional y descripción; lupa: detalle ampliado; piedra: vista cercana.
- Caja **Personal**: pertenece a una compañera ficticia y siempre permanece cerrada.
- Pedir permiso: «Prefiero guardar esas cosas para mí».
- Elegir **Respetar y seguir explorando**.
- Volver a elegir un objeto compartido y registrar una pregunta.
- Conceder el corazón una sola vez.

Después de la negativa, un nuevo toque muestra: «Su contenido es personal. Podemos seguir explorando los objetos compartidos». No incluir una acción de abrir la caja personal, un asset de su contenido, un dato oculto con su contenido ni una recompensa que lo revele.

Preguntas sugeridas: «¿Qué hace que la campanita suene?», «¿Por qué la lupa hace que algo se vea más grande?» y «¿Cómo habrá adquirido esta forma la piedra?».

Cambiar de jugador entre negativa y respeto conserva ese paso. El registro final vincula objeto compartido y pregunta. La interacción se puede resolver en 1–2 minutos.

Guía de Vanessa: sentir curiosidad no da permiso para revisar algo personal; pedir permiso, respetar y continuar investigando. Preguntar: «¿Cómo acompañaríamos a un niño que quiere revisar las cosas personales de un compañero?».

### 3.5. Inventor, revisitas y reinicios

Con las tres piezas, el controlador pulsa **Colocar las piezas**. Una animación breve identifica:

| Pieza | Mensaje |
| --- | --- |
| Lupa | Observar y probar. |
| Bocadillo | Preguntar y escuchar. |
| Corazón | Investigar con respeto. |

El grupo elige una pregunta guardada, una sugerencia o una nueva. La modalidad oral muestra «Compartamos nuestra próxima pregunta en voz alta». No hay generación de respuestas con IA.

Confirmar la pregunta final cambia la fase a `finished` y muestra «Cada descubrimiento puede abrir otra pregunta». La administradora aún puede pausar, cambiar turno, tomar control, cerrar o reiniciar.

En `finished` se permiten consultas, revisitas y nuevas exploraciones de mesas completadas. No se vuelve a conceder una pieza ni se borra la pregunta final. El servidor habilita únicamente las acciones de revisita pertinentes, no reinicia silenciosamente los pasos del recorrido.

**Reiniciar experimento** repone sus controles; no borra cuaderno, primera idea, pruebas terminadas ni piezas. Si hay una prueba de rampa en curso, el reinicio explícito la marca cancelada; no cuenta como prueba completada. **Reiniciar sala** sí borra el avance y requiere confirmación de Vanessa.

Reflexión de cierre: aprender comienza con preguntas; observar, probar y escuchar puede cambiar lo que pensábamos; las preguntas de los niños importan y deben acompañarse con respeto por los demás.

<a id="spec-4"></a>

## 4. Modelo compartido y fuentes de verdad

### 4.1. Entidades

| Entidad | Datos mínimos |
| --- | --- |
| Sala | `roomId`, código público, versión de configuración, fase, generación, propietario, versión de turno, versión de estado, fechas y vencimiento. |
| Identidad | `principalId`, papel, nombre, color y número de distinción. Credencial privada almacenada como hash en servidor. |
| Presencia | Conexión vigente, `connectionEpoch` y estado conectado/desconectado. Se reconstruye al arrancar. |
| Aventura | Mapa, posición/pies, plan de movimiento, vista compartida, mesa y pasos, cuaderno, piezas, inventor y reloj. |
| Registro | Campo, modalidad, texto/opción confirmada, autor, revisión y fechas del servidor. |
| Prueba de rampa | `trialId`, inclinación, condiciones, duración, tiempo activo, estado y resultado. |
| Comando procesado | Identificador, identidad, generación, huella del payload y respuesta definitiva. |

Tipos orientativos; generar o contrastar los tipos finales con los esquemas:

~~~ts
type ControlOwner =
  | { role: "admin"; principalId: string }
  | { role: "participant"; principalId: string }
  | null;

type RoomPhase =
  | "welcome" | "running" | "paused"
  | "finished" | "closed" | "expired";

interface RoomState {
  roomId: string;
  code: string;
  contentSetId: string;
  configRevision: string;
  configHash: string;
  mapHash: string;
  roomGeneration: number;
  stateVersion: number;
  turnVersion: number;
  phase: RoomPhase;
  resumePhase: "running" | "finished" | null;
  controlOwner: ControlOwner;
  adventure: AdventureState;
}
~~~

`AdventureState` contiene:

- `mapId` y `player`: posición segura y plan aceptado de movimiento.
- `view`: `map`, `activity` o `final`; `activityId` cuando corresponde.
- `activities`: estado específico de Sombras, Rampas y Cajas.
- `notebook`: registros confirmados, con revisiones.
- `pieces`: conjunto de IDs derivado de mesas completadas.
- `inventor`: piezas colocadas y registro de pregunta final.
- `timeline`: tiempo activo acumulado, muestra del reloj del servidor y estado de simulación.

Las interfaces definitivas de actividades son uniones discriminadas por `type` y paso. Evitar un diccionario arbitrario de variables de juego.

### 4.2. Versiones e invariantes

| Campo | Uso |
| --- | --- |
| `schemaVersion` | Versión del contrato de configuración. |
| `contentSetId` | Identifica esta exposición; no reutilizar el ID de Bitácora Amorcito. |
| `configRevision` | Edición del contenido, sin borrar progreso automáticamente. |
| `configHash / mapHash` | Comprobar que cliente y servidor usan los mismos datos. |
| `roomGeneration` | Distinguir recorridos antes/después de un reinicio de avance. |
| `turnVersion` | Invalidar entradas de permisos anteriores. |
| `stateVersion` | Ordenar transiciones confirmadas y snapshots. |
| `connectionEpoch` | Rechazar una pestaña sustituida. |
| `frameSeq` | Ordenar muestras visuales entre transiciones; no equivale a una respuesta confirmada. |

Invariantes:

1. Una sala tiene cero o un propietario.
2. Solo la conexión vigente de ese propietario puede jugar.
3. Un cambio de propietario, pausa, reanudación, revocación o recuperación invalida entradas anteriores mediante `turnVersion`.
4. El conjunto de piezas se deriva del dominio, no del payload del cliente.
5. Una respuesta confirmada queda guardada antes de anunciarse como aceptada.
6. El reloj de simulación avanza únicamente mientras la sala puede jugar.
7. Los borradores, sprites, sockets y credenciales nunca forman parte del snapshot público de aventura.
8. Un mapa o contenido nuevo no modifica a mitad de exposición una sala iniciada.

<a id="spec-5"></a>

## 5. Identidad, API y sincronización

### 5.1. Alta y recuperación

Usar HTTP para obtener credenciales y Socket.IO para la sesión autenticada. Esto concreta la propuesta `room.create / room.join` del PRD; esos nombres no son una API ya existente.

| Endpoint propuesto | Solicitud | Respuesta |
| --- | --- | --- |
| `POST /api/rooms` | `contentSetId` permitido. | Sala, código, enlace público, `adminId` y credencial privada de administradora. |
| `POST /api/rooms/:code/join` | Nombre y color válidos. | Identidad participante, nombre distinguido y credencial propia. |
| `GET /api/rooms/:code` | Sin credencial. | Código, fase y título públicos; la pantalla de entrada confirma que la sala existe y sigue disponible sin entrar. *(Añadido al implementar la fase 2.)* |
| `GET /api/health` | Sin datos de sala. | Disponibilidad básica del servicio. |

La creación de sala no exige cuenta en la primera versión. Emitir tokens opacos aleatorios de al menos 32 bytes; verificar por hash. Al reconectar, enviar la credencial en el `auth` de Socket.IO, sin query string. El servidor resuelve sala, identidad y papel: no confiar en un `role` enviado por el navegador.

Conservar la credencial en almacenamiento local con claves propias por proyecto y sala. Usar HTTPS, permitir solo el origen del frontend y no registrar tokens ni incluirlos en logs, QR, capturas o snapshots. Escapar textos con React; no renderizar contenido del público mediante HTML arbitrario.

Limitar creación/entrada, tamaño de mensajes y frecuencia de acciones. Color debe pertenecer a la paleta; nombre, código y texto se validan en servidor. El código de entrada permite unirse, no recuperar administración.

La nueva conexión de una identidad sustituye a la anterior y aumenta `connectionEpoch`. Ignorar la desconexión posterior del socket viejo. Si se sustituye un controlador, pausar y retirar su control; el participante nuevo vuelve en espera. Una administradora que sustituye su conexión recupera administración, con la aventura pausada.

### 5.2. Sobres de comandos

~~~ts
interface AdventureCommand {
  requestId: string;
  roomGeneration: number;
  turnVersion: number;
  connectionEpoch: number;
  action: AdventureAction;
}

interface AdminCommand {
  requestId: string;
  roomGeneration: number;
  connectionEpoch: number;
  commandSeq: number;
  action: AdminAction;
}
~~~

La identidad y la sala proceden de la conexión autenticada. `requestId` es único por comando, por ejemplo UUID. `commandSeq` aumenta en la conexión administrativa vigente; serializar cambios de turno para que una asignación vieja no reemplace otra posterior.

`AdventureAction` es una unión tipada. Catálogo mínimo:

| Acción | Payload y validación de dominio |
| --- | --- |
| `player.moveTo` | Destino de mundo; mapa, camino y permisos. |
| `station.open` | ID y origen `map` o `quickNav`; orden y proximidad cuando se usa el mapa. |
| `adventure.returnToMap` | Cerrar actividad; conservar su avance. |
| `shadows.light.set` | Distancia dentro de rango y `commitSample` booleano. |
| `shadows.surprise.ack` | Marcar la sorpresa como vista. Opcional: la primera idea también puede confirmarse directamente en el paso `surprise`. *(Añadida al implementar el dominio; el catálogo es «mínimo».)* |
| `record.confirm` | Mesa/campo/modalidad/valor permitidos en el paso actual. |
| `record.edit` | ID, revisión esperada y nuevo valor; conservar valor previo. |
| `ramps.question.open` | Abrir pregunta desde la respuesta cerrada. |
| `ramps.angle.set` | Inclinación válida; ninguna prueba en marcha. |
| `ramps.trial.start` | Sin resultado del cliente; el servidor crea la prueba. |
| `boxes.shared.open` | Abrir la caja compartida. |
| `boxes.object.inspect` | ID de un objeto compartido existente. |
| `boxes.permission.ask` | Solicitar permiso en el paso correspondiente. |
| `boxes.refusal.ack` | Confirmar que se leyó la negativa. |
| `boxes.refusal.respect` | Registrar el respeto y habilitar la nueva pregunta. |
| `experiment.reset` | Mesa actual; efectos definidos en 3.5. |
| `inventor.placePieces` | Tres piezas derivadas ya disponibles. |
| `inventor.question.confirm` | Pregunta válida o referencia a registro existente. |

No aceptar acciones libres como `setState`, `grantPiece`, `setResult` o `openPersonalBox`.

`AdminAction` incluye `room.start`, `control.assign`, `control.revoke`, `control.take`, `room.pause`, `room.resume`, `room.reset` y `room.close`.

### 5.3. Eventos del transporte

| Evento propuesto | Dirección | Contenido |
| --- | --- | --- |
| `admin.command` | Administradora → servidor | Sobre y acción de moderación. |
| `adventure.action` | Controlador → servidor | Sobre y acción de aventura. |
| `room.sync` | Cliente → servidor | Solicitar estado permitido para su papel. |
| `room.summary` | Servidor → todos | Fase, versiones, propietario, `configMismatch` y estado propio; sin cuaderno ni credenciales. |
| `presence.updated` | Servidor → administradora | Listado necesario para moderar. |
| `room.snapshot` | Servidor → administradora y controlador | Estado completo autorizado de aventura. |
| `simulation.frame` | Servidor → esas dos vistas | Reloj, movimiento/prueba actual, versión y secuencia. |
| `control.changed` | Servidor → afectados | Propietario, versión y cambio de vista. |
| `session.replaced` | Servidor → socket sustituido | Deshabilitar esa pestaña. |

Responder cada comando mediante acknowledgment de Socket.IO:

~~~ts
type CommandResult =
  | { ok: true; requestId: string; stateVersion: number; turnVersion: number }
  | { ok: false; requestId: string; code: string; message: string };
~~~

Errores estables: `NOT_AUTHORIZED`, `STALE_CONNECTION`, `STALE_TURN`, `STALE_GENERATION`, `ROOM_PAUSED`, `INVALID_STEP`, `INVALID_PAYLOAD`, `ROOM_UNAVAILABLE`, `REVISION_CONFLICT`, `CONFIG_MISMATCH`, `RATE_LIMITED` y `PERSISTENCE_FAILED`.

Una denegación desbloquea el botón pendiente y muestra una razón comprensible; no concede piezas ni modifica progreso.

### 5.4. Procesamiento e idempotencia

Cada sala tiene una cola serial de mutaciones. Cada comando que recibe confirmación de éxito sigue este flujo:

1. Verificar conexión vigente y credencial.
2. Detectar un `requestId` procesado para esa identidad y generación; si coincide su huella, devolver la respuesta guardada sin repetir la mutación.
3. Rechazar reutilización del ID con otro payload.
4. Verificar generación, papel, turno, fase, paso, rangos y referencias.
5. Calcular la transición mediante dominio puro.
6. Guardar estado y respuesta del comando en la misma transacción.
7. Actualizar memoria y emitir estado/acknowledgment después del commit.

Si la persistencia falla, no anunciar éxito; bloquear la continuación con mensaje de recuperación. Un cliente no puede escribir directamente en SQLite ni autorizarse cambiando variables del navegador.

Socket.IO no garantiza por sí solo persistencia ni entrega de cada evento. [T4] Si un acknowledgment se pierde, el cliente puede consultar sincronización o reintentar **el mismo comando discreto con el mismo ID**, únicamente mientras siga conectado y con permisos vigentes.

No activar una reproducción automática de entradas acumuladas tras reconectar. Antes de `emit` comprobar conexión y permisos; los controles continuos pueden enviarse como eventos volátiles. Al perder conexión, cancelar gestos y pendientes; conservar borradores localmente. Al volver, pedir snapshot, verificar permiso y habilitar controles desde el estado actual.

### 5.5. Separación de canales y cambio de turno

Usar agrupaciones de Socket.IO controladas por servidor:

- Canal de sala para información mínima de fase y turno.
- Canal de vista para administradora y controlador actual.
- Presencia administrativa dirigida a la conexión de Vanessa.

Quienes esperan no reciben el cuaderno ni actualizaciones continuas del experimento. Al asignar turno, retirar primero al anterior del canal de vista; actualizar propietario y versiones; añadir al nuevo; enviar snapshot; anunciar el cambio.

El frontend anterior limpia controles, cierra formularios compartidos y desmonta el host de Phaser. El nuevo carga/aplica la instantánea antes de aceptar entradas. Los assets públicos pueden precargarse sin crear canvas ni enviar estado de aventura al participante en espera.

### 5.6. Movimiento, reloj y simulaciones

El servidor calcula un camino transitable desde el estado vigente y emite un **plan de movimiento**: ID, puntos en coordenadas de pies, velocidad y tiempo activo. Cliente y proyección interpolan ese mismo plan; no envían posiciones a 60 FPS.

Usar una cuadrícula de navegación derivada del TMJ, obstáculos ampliados por la huella del personaje y búsqueda de caminos pura. Evitar atravesar esquinas bloqueadas. No ejecutar Phaser, DOM ni una física de navegador en Node para decidir posiciones.

Para rampas, compartir `trialId`, parámetros, duración y tiempo activo. El servidor confirma el final una vez; el cliente solo representa. Un cambio de controlador conserva la prueba en curso. Una pausa o falta de propietario congela el reloj.

Propuesta inicial: muestras del servidor a **10 Hz** y controles de arrastre a **12 Hz**, más la posición final al soltar. Validar/límite de frecuencia en servidor. Renderizar desde `Scene.update(time, delta)` con un reloj local ajustado por las muestras del servidor; el tiempo del dispositivo no decide el resultado.

`simulation.frame` puede ser efímero. Ordenarlo por generación, versiones y `frameSeq`; descartar muestras de planes o pruebas anteriores. Los snapshots siempre permiten reconstruir el estado sin haber recibido todos los frames.

No usar una física Arcade independiente en cada cliente para simular la rampa. Tampoco decidir colisiones autoritarias a partir de la posición enviada por un teléfono. Los cuerpos Arcade, si se conservan, son apoyo visual/debug; la trayectoria compartida procede del dominio.

<a id="spec-6"></a>

## 6. Persistencia, desconexiones y respaldo

### 6.1. SQLite y durabilidad

Usar un repositorio pequeño sobre SQLite, transacciones y disco persistente. Guardar el estado JSON validado de sala; no construir event sourcing para la primera versión.

Tablas mínimas propuestas: `rooms`, `principals` y `processed_commands`. La primera almacena snapshot, versiones y ciclo de vida; la segunda hashes de credenciales e identidades; la tercera respuestas idempotentes. No guardar sockets como si fueran conexiones recuperables.

Guardar cada transición confirmada antes del acknowledgment: formularios, pruebas creadas/terminadas, piezas, turnos, pausa, cierre y reinicio. Los controles continuos pueden agruparse, pero su posición final y cualquier estado anunciado como confirmado deben ser durables.

Agrupar significa reducir muestras antes de procesarlas; no responder éxito a un cambio que aún no se guardó. Para empezar es aceptable guardar cada muestra aceptada a la frecuencia limitada. Un frame de interpolación no es un comando confirmado ni requiere una fila nueva en el registro de comandos.

Durante movimiento o prueba guardar un checkpoint de reloj/posición aproximadamente cada **500 ms**, además de hacerlo al pausar, cambiar turno, parar o completar. Después de una caída abrupta se recupera el último checkpoint; documentar que la animación puede retroceder hasta ese intervalo. Las respuestas y resultados ya confirmados no se pierden.

El reloj usa tiempo monotónico durante el proceso. Un reinicio no suma el tiempo que el servidor estuvo apagado. Recuperar salas en curso como pausadas, aumentar `turnVersion`, retirar control y reconstruir presencia como desconectada. Vanessa debe recuperar administración y elegir cómo continuar.

Si la configuración guardada no coincide con la disponible, conservar datos y mostrar `CONFIG_MISMATCH`; no borrar el cuaderno ni migrarlo silenciosamente. Preparar despliegues entre sesiones o conservar el paquete de configuración compatible.

### 6.2. Reconexión y pestañas

| Situación | Comportamiento |
| --- | --- |
| Espera pierde conexión | Actualizar su presencia; aventura continúa. |
| Controlador pierde conexión | Al detectarlo: pausar, congelar tiempo y retirar control. |
| Controlador regresa | Misma identidad en espera; no recuperar turno automáticamente. |
| Vanessa pierde conexión | Al detectarlo: pausar. No entregar administración a otro usuario. |
| Vanessa recarga | Autenticar credencial, recibir sala pausada y estado vigente. |
| Dos pestañas con una identidad | Nueva conexión sustituye anterior; solo el epoch vigente puede actuar. |
| Se reinicia el servicio | Recuperar datos durables y sala pausada. |
| Sala cerrada/vencida | Detener reconexión operativa y mostrar estado terminal. |

Configurar heartbeat para verificar el objetivo de detectar cortes en **10 s o menos**. Como punto de partida, `pingInterval: 4000` y `pingTimeout: 5000`; medir falsos cortes en celulares. Los valores por defecto de Socket.IO no cumplen ese objetivo sin ajuste. [T6]

No depender de la recuperación automática de Socket.IO. Pedir snapshot y validar credenciales/permisos siempre; la recuperación de conexión es una optimización posterior. [T5]

### 6.3. Vida y aislamiento de sala

Vencimiento inicial: **2 horas sin actividad de la administradora**, configurable en servidor. Una administradora conectada envía una señal de actividad autenticada periódica; no medir únicamente clics de moderación ni permitir que participantes mantengan viva una sala abandonada.

Una sala terminal no admite entradas o acciones. Propuesta inicial de limpieza: eliminar datos de sala, identidades y comandos dentro de las siguientes **24 horas**; plazo operativo configurable. Esa retención es una decisión de implementación, no un requisito pedagógico adicional.

Una credencial está ligada a una sola sala. Probar que códigos y IDs de otra sala no permiten suscribir ni modificar sus datos.

*(Añadido al implementar la fase 6.)* Un barrido del servidor (`SWEEP_INTERVAL_MS`, 30 s) vence las salas cuya administradora lleva más de `ADMIN_IDLE_TTL_MS` sin comandos ni señal periódica, y elimina en cascada (sala, identidades y comandos procesados) las salas terminales pasadas `TERMINAL_RETENTION_MS`. El plazo se calcula con la hora guardada, de modo que un reinicio no «perdona» el tiempo con el servicio apagado.

### 6.4. Demostración local

`DemoController` utiliza el mismo dominio y modelos, sustituyendo solo transporte y persistencia. Mantiene un snapshot local con un espacio de almacenamiento distinto, sin tokens ni IDs de sala compartida.

Vanessa decide entrar al respaldo. Mostrar «Demostración», conservar el último estado confirmado del servidor aparte y no mezclar avances al volver a la conexión.

Preparar el respaldo antes de exponer: cargar recursos mínimos de las tres mesas y guiones, y disponer de una compilación servida localmente en la computadora. Si solo falla el backend, el frontend ya abierto debe poder cambiar a demo. Si falla toda la red o se recarga la página, usar la copia local preparada; una web nunca descargada no puede abrirse mágicamente sin conexión.

No hacer obligatorio un service worker. Documentar y ensayar ambas situaciones: backend caído con frontend cargado; computadora sin red usando el build local.

*(Añadido al implementar la fase 6.)* `DemoController` cumple el mismo contrato que `RoomController` (`RoomPort`) y usa las mismas funciones puras de `shared/domain`; Vanessa es administradora y quien explora, empieza en el mapa y, al recargar, vuelve en pausa con lo confirmado. Su espacio de almacenamiento es `laboratorio-cosas-cotidianas:v1:demo:estado`. La ruta es `/demo`; `/demo?from=CÓDIGO` solo sirve para ofrecer «Volver a la sala». Con la conexión caída más de 5 s, la consola de Vanessa le ofrece pasar a la demostración (nunca lo hace sola) y, con la sala funcionando, ya dejó descargado el módulo y los recursos. `npm run preview:demo` sirve el build local sin servidor.

<a id="spec-7"></a>

## 7. Arquitectura y organización del código

### 7.1. Stack y versiones de referencia

Estas son las versiones efectivamente encontradas en `package-lock.json` del commit revisado; no versiones supuestas:

| Dependencia | Versión observada |
| --- | --- |
| Phaser | 4.2.1 |
| React / React DOM | 19.3.0 |
| Vite | 8.3.1 |
| TypeScript | 7.0.2 |
| Ajv | 8.20.0 |
| Vitest | 5.0.3 |
| Playwright | 1.63.0 |

El proyecto declara Node `^20.19.0 || >=22.12.0`. Para el nuevo servidor elegir una versión soportada compatible con Vite y el driver SQLite, documentarla y fijar el lockfile. Agregar Socket.IO **4.x**, su cliente y un driver SQLite mantenido; fijar sus versiones reales al implementar.

Mantener Phaser 4 y verificar sus tipos/API instalados. La documentación web de algunas APIs consultadas muestra 4.1.0; para diferencias concretas prevalecen el código y tipos de **4.2.1**. No introducir ejemplos de Phaser 2 ni cambiar a otra versión mayor por copiar una plantilla.

Un servidor HTTP pequeño, por ejemplo Express con Socket.IO sobre el mismo servidor, puede servir API y frontend compilado bajo el mismo origen. Elegir una sola biblioteca HTTP. No es necesario agregar un framework backend completo.

### 7.2. Responsabilidades

| Capa | Responsabilidad |
| --- | --- |
| React | Sala, moderación, formularios, sliders, cuaderno, guía y accesibilidad. |
| Phaser | Mapa, sprites, escenas cercanas, cámara y animaciones de los datos recibidos. |
| Controller de aplicación | Solicitudes, snapshots, bloqueos y coordinación entre React, puente y transporte. |
| GameBridge | Eventos tipados, ready de escenas y última instantánea visual retenida. |
| Socket.IO | Transporte autenticado, acknowledgments y canales autorizados. |
| RoomService del servidor | Ordenar comandos, permisos, reloj, persistencia y fan-out de estados. |
| Dominio compartido | Transiciones, prerrequisitos, piezas, geometría y modelos matemáticos puros. |
| RoomRepository | Guardar/recuperar datos con transacciones y versiones. |
| AssetRegistry | Resolver recursos por ID desde el manifiesto. |

~~~mermaid
flowchart TD
  React["React: sala y formularios"] --> Controller["Controller: intenciones y snapshots"]
  Phaser["Phaser: mapa y experimentos"] --> Bridge["GameBridge"]
  Bridge --> Controller
  Controller --> Bridge
  Bridge --> Phaser
  Controller --> Transport["Socket.IO"]
  Transport --> Server["RoomService: permisos y reloj"]
  Server --> Domain["Dominio TypeScript compartido"]
  Server --> DB["RoomRepository: SQLite"]
~~~

En demo el controller invoca el mismo dominio localmente. No hay dos implementaciones distintas de las reglas.

### 7.3. Organización inicial

Los nombres siguientes son destinos de implementación, no archivos existentes:

| Ubicación | Contenido |
| --- | --- |
| `.claude/` | SPECS.md, PLAN.md y copia del PRD para trabajo de implementación. |
| `public/config/` | laboratorio.json. |
| `shared/config/schemas/` | laboratorio.schema.json y assets.schema.json: son código de validación, no archivos servidos (Vite no admite importar desde `public/`). `$schema` de laboratorio.json los referencia por ruta relativa. |
| `public/maps/` | laboratorio.tmj; futuros mapas del mismo perfil. |
| `public/assets/` | assets.json; recursos organizados por categoría como en la referencia. |
| `tools/tiled/` | laboratorio.tiled-project y README del flujo de edición. |
| `shared/domain/` | adventureReducer, reglas de mesas, modelos, geometría y navegación. |
| `shared/contracts/` | Eventos, acciones, estados y esquemas de mensajes. |
| `shared/config/` | Validación Ajv, referencias cruzadas y lectura semántica del TMJ. |
| `src/app/` | RoomProvider/controller, DemoController y navegación de vistas. |
| `src/network/` | Adaptador Socket.IO, autenticación, sincronización y reloj cliente. |
| `src/config/` | Carga y AssetRegistry adaptado. |
| `src/components/room/` | Bienvenida, espera, participantes y moderación. |
| `src/components/activities/` | Formularios y controles HTML por mesa. |
| `src/components/ui/` | Paneles, botones, cuaderno y confirmaciones. |
| `src/game/bridge/` | Puente tipado por host. |
| `src/game/scenes/` | BootScene, LaboratoryScene y escenas de las tres mesas. |
| `src/game/tiled/` | Factories de objetos y composición visual desde TMJ. |
| `server/src/` | HTTP, Socket.IO, RoomService, reloj y RoomRepository. |
| `server/data/` | SQLite de desarrollo, ignorado por Git; en producción usar volumen externo. |
| `scripts/` | Validación, build y ensayo de carga; sin importador de mapas. |

Separar módulos por responsabilidad cuando haya código real, sin crear decenas de abstracciones vacías. Una sola store/Context de sala es suficiente; no agregar Redux o Zustand si el estado existente no lo requiere.

### 7.4. Despliegue previsto

Primera versión: una instancia persistente que sirve frontend, API y Socket.IO. SQLite necesita volumen que sobreviva a reinicios. El proxy debe admitir conexiones persistentes y la negociación HTTP de Socket.IO.

Durante desarrollo, Vite puede usar proxy para `/api` y `/socket.io`. En producción no depender del servidor de desarrollo.

El frontend de la bitácora está pensado para publicación estática, pero la sala nueva requiere proceso backend. Un despliegue exclusivamente estático no implementa turnos ni persistencia. La elección de proveedor queda pendiente; documentar requisitos y no publicar por redactar estos archivos.

Para crecer posteriormente a varias instancias, cambiar persistencia y coordinación/adapter de Socket.IO; SQLite con un volumen local y colas en memoria no se presenta como arquitectura distribuida.

<a id="spec-8"></a>

## 8. Tiled directo y contrato del mapa

### 8.1. Flujo de edición

**Abrir Tiled → editar public/maps/laboratorio.tmj → guardar → validar/recargar → Phaser lee ese mismo TMJ.**

Guardar el mapa en formato **Tiled JSON map (.tmj)** desde el inicio. No trabajar con una fuente TMX que requiera exportación obligatoria. El `.tiled-project` vive en `tools/tiled/` y referencia el mapa; no contiene una copia de él.

El build valida el TMJ y lo copia como recurso público sin transformarlo a un esquema espacial propio. No ejecutar `tiled:generate`, `tiled:import`, `tiled:catalog` ni una comparación con `maps.json`. Los esquemas y el índice temporal de navegación no son archivos de coordenadas editables.

Sí se necesita una lectura semántica pequeña en memoria: interpretar qué objeto es una estación, un spawn o una colisión. Eso conecta datos de Tiled con reglas del juego; no elimina la necesidad de código de integración. **Directo no significa que Phaser conozca automáticamente los experimentos o dibuje todos los objetos.**

### 8.2. Perfil compatible de la primera versión

| Propiedad | Convención |
| --- | --- |
| Orientación | `orthogonal`. |
| Dimensiones | Mapa finito, `infinite: false`; tamaño en píxeles = columnas/filas × tamaño de tile. |
| Cuadrícula inicial | 32 × 32 px como propuesta, configurable. No exige arte dividido en tiles. |
| Capas | Tile layers opcionales, image layers y object layers, sin grupos anidados inicialmente. |
| Datos de tiles | Array JSON numérico, sin compresión ni chunks. |
| Tileset de terreno | Una imagen por tileset; definición incrustada en `tilesets[]`, sin `source` externo. |
| Sprites existentes | PNG/atlas a través de AssetRegistry; no convertirlos a tiles. |
| Geometría de interacción | Puntos y rectángulos sin rotación. |
| Colisiones | Rectángulos explícitos en una capa; no deducirlos del alpha de imágenes. |
| Recursos editoriales | Sin plantillas externas ni propiedades obligatorias presentes solo en el proyecto de Tiled. |
| Efectos avanzados | Sin parallax, tintes, repeat de imágenes ni shaders obligatorios. |

El catálogo actual de la bitácora es una colección de imágenes con previews y un importador propio. No trasladarlo al tilemap nativo suponiendo compatibilidad automática. Para tiles de terreno usar una imagen y definición incrustada; conservar PNG sueltos mediante capas de imagen o factories de puntos. [T1–T3]

El mapa puede empezar solo con una imagen de aula, objetos y colisiones; `tilesets` puede ser vacío. Un tileset resulta útil si se quiere construir piso y paredes por piezas, no es una dependencia de los tres minijuegos.

### 8.3. Capas y objetos

| Capa sugerida | Tipo | Uso |
| --- | --- | --- |
| `floor` | tilelayer opcional | Piso y paredes pintados; composición visual. |
| `room-background` | imagelayer opcional | PNG de aula o fondo por capas. |
| `decorations` | objectgroup | Puntos de sprites/decoraciones con `assetId`. |
| `collisions` | objectgroup | Rectángulos de paredes/muebles sólidos; fuente del índice de obstáculos. |
| `spawns` | objectgroup | Punto Spawn inicial. |
| `stations` | objectgroup | Tres puntos Station y punto Inventor. |
| `foreground` | imagelayer o tilelayer opcional | Elementos que se dibujan delante. |
| `sounds` | objectgroup opcional | Emisores si se incorporan sonidos espaciales. |

Clases semánticas:

| Clase Tiled | Forma | Campos obligatorios | Campos opcionales |
| --- | --- | --- | --- |
| `Spawn` | Punto | `spawnId`. | Etiqueta de editor. |
| `Station` | Punto | `activityId` y `assetId` gráfico. | `interactionRadius`; escala uniforme visual. |
| `Inventor` | Punto | `assetId` gráfico. | `interactionRadius`. Solo uno por mapa inicial. |
| `Decoration` | Punto | `assetId`. | `originX/Y`, `scale`, `depthMode`. |
| `Collision` | Rectángulo | Geometría; clase en capa collisions. | Etiqueta de editor. |
| `SoundEmitter` | Punto, opcional | `soundId` y `assetId` de SFX. | Volumen, radio y modo. |
| `EditorOnly` | Punto/rectángulo | Clase explícita. | Notas de diseño. Se ignora en runtime. |

La clase puede aparecer como `type` o `class` según el objeto/formato. Normalizar esa diferencia en el lector compartido. Los IDs de negocio viven en propiedades explícitas; no usar el entero autoincremental `id` de Tiled como `activityId`.

Coordenadas de Spawn y Station son puntos de mundo; las de Collision son esquina superior izquierda y ancho/alto. Vanessa usa pies como origen. Una estación debe tener su punto de interacción en suelo transitable, frente a la mesa. Mantener la escala del mapa en 1; la cámara gestiona la ampliación.

La huella ocupa `x ± width/2` y `y-height…y` respecto del punto de pies. Derivar navegación y prueba de intersección con esa misma convención en cliente/servidor, no alternar centro del sprite y pies.

`locked` solo afecta edición. Ocultar una capa funcional en Tiled no elimina spawns, estaciones o colisiones; `EditorOnly` indica exclusión explícita. Aplicar visibilidad a las capas decorativas. Retirar una mesa del recorrido exige quitar su ID de route y su objeto funcional en la siguiente configuración, no esconder su capa.

No duplicar posiciones de estación en `laboratorio.json`. La lista `route` indica orden, y `activityId` del objeto enlaza su ubicación con contenido. Los valores obligatorios se serializan en el TMJ; clases/enums de `.tiled-project` ayudan a editar pero no son una dependencia del servidor.

### 8.4. Recursos y paths de Tiled

`assets.json` mantiene la autoridad sobre archivos. Cada image layer y tileset con imagen tiene una propiedad personalizada `assetId` correspondiente a su recurso.

Tiled guarda además su campo nativo `image` para que el editor lo muestre. Tratarlo como referencia editorial necesaria y comprobar que resuelve al mismo archivo registrado. No inventar una segunda ruta editable en el JSON del proyecto.

Ejemplo: mapa `public/maps/laboratorio.tmj`; imagen `public/assets/backgrounds/laboratorio/sala.png`; Tiled guarda `../assets/backgrounds/laboratorio/sala.png`; manifiesto guarda `backgrounds/laboratorio/sala.png`. Ambas resoluciones deben apuntar al mismo recurso. Vite no reescribe cadenas interiores del TMJ. [T7]

Las fábricas cargan las imágenes por `AssetRegistry.url(assetId)`. Los atlas de animación siguen usando sus metadatos originales. No regenerar ni reempaquetar todas las hojas para empezar el mapa.

### 8.5. Phaser nativo y factories pequeñas

La ruta nativa de carga es `load.tilemapTiledJSON` y creación con `make.tilemap`. Las texturas se cargan aparte: el TMJ no descarga todos los PNG ni los sonidos por sí solo. [T1]

~~~ts
// Ejemplo de API nativa; nombres de aplicación y de assets son ilustrativos.
preload() {
  this.load.tilemapTiledJSON("laboratorio", this.mapUrl);
  this.load.image(this.tilesAssetId, this.assets.url(this.tilesAssetId));
}

create() {
  const map = this.make.tilemap({ key: "laboratorio" });
  const tiles = map.addTilesetImage("laboratorio-tiles", this.tilesAssetId);
  if (tiles) map.createLayer("floor", tiles, 0, 0);
  const objects = map.getObjectLayer("stations")?.objects ?? [];
  // La factory interpreta Station/Inventor y comunica intenciones al controller.
}
~~~

El snippet aplica si se elige terreno con tileset; un mapa basado en imágenes no debe inventar `floor` o `tilesAssetId`.

Para evitar descargar dos veces el TMJ, el cargador central puede validar el JSON y entregarlo al loader nativo como objeto ya parseado. El código de `TilemapJSONFile` y `JSONFile` de Phaser 4.2.1 admite ese objeto en el argumento `url`; verificar los tipos instalados y su uso con una prueba de runtime. No usar un tercer argumento «data» tomado de otra versión de API. [T8]

Responsabilidades del adaptador:

- Crear tile layers con las APIs nativas cuando existan.
- Dibujar image layers y decoraciones explícitamente con los datos originales.
- Construir Station/Inventor, spawns e indicadores.
- Construir en memoria índice de colisiones y navegación compartido con servidor.
- Mantener orden visual: fondo, suelo, objetos ordenados por pies y primer plano.
- Informar referencias desconocidas con archivo, capa, objeto y propiedad.

No escribir un parser completo alternativo de Tiled ni un importador bidireccional. Limitarse al perfil validado.

### 8.6. Validación y guardar en desarrollo

`npm run validate:project` comprueba esquema de configuración/manifiesto, TMJ, referencias cruzadas y alcance espacial, sin escribir ningún archivo.

Validaciones mínimas: un spawn inicial existente y libre; una Station por ID activo de `route`; sin duplicados; un inventor; colisiones dentro del mapa; puntos transitables y alcanzables; assets compatibles; correspondencia de rutas editoriales; tilesets incrustados; ausencia de características no soportadas.

En desarrollo añadir, si hace falta, un observador mínimo de Vite para recargar cuando cambia `public/maps/*.tmj`. Validar y recargar; no importar ni transformar. Recargar una sala conserva identidad y solicita su snapshot; **no aplicar un mapa editado a una sala que usa otra revisión**.

Para probar cambios de mapa crear una nueva sala o entrar a una demo reiniciada con los datos nuevos. En producción publicar configuración, TMJ y assets coherentes; no prometer edición en vivo de sesiones activas.

<a id="spec-9"></a>

## 9. Contrato JSON y catálogo de assets

### 9.1. Qué pertenece a cada archivo

| Dato | Fuente editable única |
| --- | --- |
| Título, asignatura y datos de Vanessa | `laboratorio.json → project`. |
| IDs activos y orden | `laboratorio.json → route`. |
| Tipo de minijuego, preguntas, diálogos y guiones | `laboratorio.json → activities / dialogues / facilitatorNotes`. |
| Parámetros y rangos de experimentos | `laboratorio.json → activities[id].experiment`. |
| Archivo TMJ seleccionado | `laboratorio.json → world.mapPath`. |
| Posiciones, dimensiones y colisiones | TMJ. |
| Archivos gráficos/sonoros, atlas y frames | `assets.json` y definiciones de frame verificadas. |
| Credenciales y parámetros secretos | Servidor/entorno; nunca JSON público. |
| Respuestas, ensayos, turno y piezas | SQLite/snapshot de sala. |
| Borradores, foco, paneles y volumen local | Estado local del navegador. |

`world.mapPath` es una referencia al archivo de mapa relativa a la base pública del sitio; por ejemplo `maps/laboratorio.tmj`. Es la única excepción necesaria a las referencias de recursos por `assetId`: el mapa conserva su formato nativo fuera del catálogo gráfico. **No añadir el TMJ a assets.json con hash obligatorio que deba reescribirse en cada guardado.**

Todos los gráficos y audios de la experiencia se referencian por `assetId`. El JSON no guarda posiciones de mesas, tamaño del mundo, índices GID ni rutas duplicadas de PNG.

### 9.2. Estructura de configuración

| Campo | Regla |
| --- | --- |
| `schemaVersion` | Entero; contrato inicial 1. |
| `contentSetId` | ID propio y estable del laboratorio. |
| `configRevision` | Revisión del paquete de contenido. |
| `mode` | `prototype` o `presentation`; la segunda no admite recursos/textos de prueba como finales. |
| `project` | Datos de exposición; duración orientativa. |
| `world` | mapPath, spawnId inicial, velocidad y huella del personaje. |
| `route` | Array de IDs de actividades existentes, únicos y ordenados. |
| `activities` | Definiciones por ID y tipo `shadows`, `ramps` o `boxes`. |
| `inventor` | Piezas necesarias, instrucciones y pregunta final. |
| `dialogues` | Textos de personajes por ID. |
| `facilitatorNotes` | Guiones del PRD por momento, en texto legible. |
| `ui` | Etiquetas y referencias a recursos de panel/botones. |
| `audio` | Referencias de eventos y valores iniciales, sin guardar volumen de cada dispositivo. |
| `session` | Límite inicial y vencimiento; el servidor valida y aplica esos límites. |

El tipo de actividad elige un módulo implementado. Añadir más mesas de un tipo existente debe requerir contenido y ubicación; introducir un nuevo tipo de experimento sí requiere código. No construir un lenguaje de scripting, un editor visual interno ni un motor genérico de minijuegos.

| Operación editorial | Cambio requerido |
| --- | --- |
| Cambiar un texto o guion | Editar laboratorio.json, validar y publicar una revisión coherente. |
| Mover una mesa o pared | Editar únicamente el TMJ. |
| Reordenar el recorrido | Cambiar route; el orden visual se deriva de él. |
| Añadir una mesa de tipo existente | Definir actividad/pieza/textos, añadir a route y colocar Station en TMJ. |
| Retirar una mesa en una versión futura | Quitarla de route y del mapa activo; no borrar datos de salas anteriores. |
| Cambiar una ilustración o sonido | Incorporar asset real y actualizar su referencia por ID. |

La primera entrega mantiene exactamente las tres mesas del PRD. La capacidad de extender datos no autoriza añadir actividades a esta exposición.

### 9.3. Ejemplo orientativo válido como JSON

**No es configuración final ni evidencia de assets creados.** Los IDs que empiezan por `lab.` son recursos propuestos para registrar durante la construcción. Los IDs de Vanessa y de UI mostrados sí existen en el manifiesto del commit revisado. La validación de entrega debe fallar si cualquier referencia requerida aún no existe.

~~~json
{
  "$schema": "../../shared/config/schemas/laboratorio.schema.json",
  "schemaVersion": 1,
  "contentSetId": "laboratorio-cosas-cotidianas",
  "configRevision": "2026-10-05-v1",
  "mode": "prototype",
  "project": {
    "title": "El laboratorio de las cosas cotidianas",
    "subtitle": "Una aventura interactiva sobre la curiosidad",
    "studentName": "Vanessa Estrada",
    "university": "Universidad de Antioquia",
    "program": "Licenciatura en Educación Infantil",
    "courseName": "Práctica pedagógica 5",
    "durationMinutes": 18
  },
  "world": {
    "mapPath": "maps/laboratorio.tmj",
    "initialSpawnId": "entrada",
    "playerSpeed": 150,
    "player": {
      "assetId": "character.vanessa-jerry.walk.poses-v4",
      "origin": { "x": 0.5, "y": 1 },
      "scale": 0.34,
      "footprint": { "width": 42, "height": 25 }
    }
  },
  "route": ["sombras", "rampas", "cajas"],
  "activities": {
    "sombras": {
      "type": "shadows",
      "title": "Sombras",
      "pieceId": "lupa",
      "firstPrompt": "El objeto es pequeño. ¿Por qué su sombra se ve tan grande?",
      "experiment": {
        "sourceDistanceMinCm": 10,
        "sourceDistanceMaxCm": 60,
        "screenDistanceCm": 25,
        "objectHeightCm": 8,
        "minDistinctDistanceCm": 5,
        "requiredSamples": 2
      },
      "suggestions": [
        { "id": "mover-objeto", "text": "¿Qué pasaría si movemos el objeto?" },
        { "id": "otras-formas", "text": "¿Todas las formas producen la misma sombra?" }
      ]
    },
    "rampas": {
      "type": "ramps",
      "title": "Rampas",
      "pieceId": "dialogo",
      "firstPrompt": "Copia el resultado de la guía. No hagas preguntas.",
      "experiment": {
        "model": "solid-sphere-ideal-v1",
        "minAngleDeg": 15,
        "maxAngleDeg": 45,
        "angleStepDeg": 5,
        "minDistinctAngleDeg": 5,
        "lengthMeters": 2,
        "visualTimeScale": 2.4,
        "requiredTrials": 2
      },
      "suggestions": [
        { "id": "mas-inclinacion", "text": "¿Qué pasaría si aumentamos la inclinación?" }
      ]
    },
    "cajas": {
      "type": "boxes",
      "title": "La caja de las sorpresas",
      "pieceId": "corazon",
      "sharedObjects": ["campanita", "lupa", "piedra"],
      "refusalDialogueId": "caja-negativa",
      "suggestions": [
        { "id": "sonido", "objectId": "campanita", "text": "¿Qué hace que la campanita suene?" },
        { "id": "aumento", "objectId": "lupa", "text": "¿Por qué la lupa hace que algo se vea más grande?" },
        { "id": "forma", "objectId": "piedra", "text": "¿Cómo habrá adquirido esta forma la piedra?" }
      ]
    }
  },
  "inventor": {
    "requiredPieceIds": ["lupa", "dialogo", "corazon"],
    "prompt": "Después de lo que descubrimos, ¿qué nos gustaría seguir investigando?",
    "finalMessage": "Cada descubrimiento puede abrir otra pregunta."
  },
  "dialogues": {
    "caja-negativa": "Prefiero guardar esas cosas para mí",
    "rampa-invitacion": "Exploremos esa pregunta. ¿Cómo podríamos comprobarlo?"
  },
  "facilitatorNotes": {
    "sombras": ["¿Qué cambió cuando movieron la linterna?", "Relacionar observar, probar y comparar con la curiosidad epistemológica."],
    "rampas": ["¿Qué resultado apoya su explicación?", "Invitar a escuchar y añadir ideas del grupo."],
    "cajas": ["¿Tener curiosidad nos permite abrir la caja sin permiso?"],
    "cierre": ["¿Qué les gustaría seguir descubriendo después de esta aventura?"]
  },
  "ui": {
    "assets": {
      "button": "ui.button.green.default",
      "panel": "ui.panel.cream.nine-slice",
      "notebookIcon": "ui.icon.open-book"
    },
    "maxRecordCharacters": 280
  },
  "audio": {
    "phoneInitiallyMuted": true,
    "events": {
      "shadows.click": "lab.audio.click",
      "boxes.bell": "lab.audio.bell",
      "piece.earned": "lab.audio.piece",
      "inventor.activated": "lab.audio.inventor"
    }
  },
  "session": {
    "maxParticipants": 50,
    "adminIdleTtlMs": 7200000
  }
}
~~~

**Campos definidos al implementar la configuración (fase 1).** El esquema real, `shared/config/schemas/laboratorio.schema.json`, es el contrato; añade a este ejemplo: `inventor.activeAssetId` (gráfico de la máquina encendida, por `assetId`), `inventor.pieces[]` (etiqueta y mensaje de cada pieza), `inventor.placePrompt` (indicación antes de colocar las piezas), `inventor.placeButtonLabel`, `oralQuestionText` y `reflection`; en Sombras, `ideaSuggestions` (ideas sugeridas del paso «primera idea») además de `suggestions` (preguntas); en Rampas, `guideLine` e `inviteDialogueId`; en las tres mesas, `prompts` (la indicación de cada paso, por nombre de paso; obligatoria, con las claves de `REQUIRED_PROMPTS` en `shared/contracts/config.ts`: Sombras `firstIdea`, `explore`, `observation`, `nextQuestion`; Rampas `question`, `prediction`, `trials`, `observation`; Cajas `exploreShared`, `askPermission`, `respect`, `nextQuestion`); en Cajas, `sharedObjects` como objetos `{id, label, description}`, `personalTouchDialogueId` y `personalBox` (solo etiquetas: sin contenido, asset ni dato oculto); `ui.assets.buttonHover` y `ui.labels`. Los textos que este documento no fija son **de prototipo** y requieren revisión de Vanessa.

El ejemplo omite parte de los recursos de escenas y de los guiones para mantenerlo legible. Durante la implementación definir sus campos en el esquema e incorporar todo el contenido necesario del PRD; no darlo por listo por copiar este fragmento. Los textos de la sección 3 fijan el comportamiento mínimo de las escenas.

### 9.4. Preservación del manifiesto real

Conservar el formato encontrado en Bitácora Amorcito: `version`, `project`, `basePath`, `pathConvention`, `assetCount`, `categoryCounts`, `assets`, `sourceDocuments` y `notes`.

En cada entrada conservar ID, `path`, `type`, `format`, `category`, `kind`, dimensiones, transparencia, procedencia y metadatos especializados que correspondan. `originalPath` describe procedencia; no se usa para cargar.

Los paths se resuelven respecto del directorio de `assets.json` y `basePath`. Usar la base de Vite para encontrar el manifiesto y después URL relativa para sus recursos. No anteponer dos veces `assets/`.

Copiar al proyecto nuevo solo el subconjunto utilizado si conviene, conservando sus IDs y metadatos; actualizar conteos para que describan ese catálogo. Si se conserva completo, cargar únicamente el cierre de dependencias de los recursos referenciados, no las 199 entradas de la referencia.

El recurso `character.vanessa-jerry.walk.poses-v4` es una **pose-sheet** con `requiresFrameDefinition: true`; no asumir que su cuadrícula visual basta para animarlo. Reutilizar/validar los frames ya definidos en el código de referencia o generar un atlas explícito tras inspección. Mantener escala, origen de pies y diseño aprobado.

Registrar recursos nuevos con IDs como `lab.station.shadows`, `lab.station.ramps`, `lab.station.boxes`, `lab.inventor.off` y `lab.inventor.on`. Son nombres de planificación; no archivos disponibles hoy. Las rutas concretas se asignan al incorporar assets reales.

El núcleo reutilizable del registro admite los tipos/kinds existentes y las extensiones necesarias del nuevo catálogo. No sustituir el manifiesto por un diccionario reducido de nombres/URLs que pierda la metadata de las hojas.

### 9.5. Validación compartida

Usar JSON Schema + Ajv, siguiendo la base existente. Compartir validadores entre CLI y servidor; el frontend valida su paquete antes de inicializar Phaser. Los esquemas de mensajes son públicos, pero los límites se vuelven a comprobar en servidor.

Comprobar:

- Forma y versión; números finitos; rangos seguros; IDs y enum de acciones.
- Referencias de route, piezas, diálogos, sugerencias y assets existentes.
- IDs de piezas únicos por actividad activa y correspondencia del inventor con todas las piezas del recorrido.
- Dependencias de atlas, frames, origin y nine-slice.
- Perfil TMJ, capas, tipos, duplicados, obstáculos y alcanzabilidad.
- Que dos posiciones/pruebas distintas sean posibles dentro de los rangos.
- Que las preguntas de cajas refieran objetos compartidos y no contenido privado.
- Que no haya credenciales ni respuestas de una sala en configuración pública.
- Que `mode: presentation` no conserve guiones incompletos o sonidos de prueba como finales.

Los valores del ejemplo no son límites de seguridad que el cliente pueda ampliar libremente. El servidor carga una configuración permitida y valida también topes operativos.

Crear errores que indiquen archivo, ruta JSON y, para Tiled, capa/objeto/propiedad. La validación nunca reescribe el mapa para «arreglarlo» silenciosamente.

<a id="spec-10"></a>

## 10. Phaser, React, dirección visual y sonido

### 10.1. Escenas y ciclo de vida

Empezar con `BootScene`, `LaboratoryScene` y una escena por experimento: `ShadowsScene`, `RampsScene` y `BoxesScene`. El inventor puede ser una vista de la escena de laboratorio. Compartir helpers concretos de composición y animación; no crear una jerarquía compleja de escenas base.

React monta el host de juego cuando hay administradora, participante activo o demo. Debe existir un solo `Phaser.Game` por host. Cambiar turno, formulario o registro no recrea el juego de Vanessa; perder el turno desmonta el del participante.

Al destruir: retirar suscripciones concretas, entrada, observadores, timers, audio y referencias. Mantener Strict Mode y probar montaje/desmontaje, incluyendo destrucción diferida de Phaser. No ocultar duplicaciones desactivando comprobaciones de React.

Las escenas usan `update(time, delta)` para interpolar/renderizar. No añadir un `requestAnimationFrame` de React ni mover sprites desde el render de componentes.

### 10.2. Puente y bloqueos

| Mensaje interno | Uso |
| --- | --- |
| `game:ready` | Escena y token listos; recibir último snapshot. |
| `game:action-request` | Intención tipada desde mapa/escena. |
| `game:load-progress` | Carga esencial, sin alterar progreso de sala. |
| `game:asset-failures` | IDs que no pudieron cargarse. |
| `app:snapshot` | Aplicar estado vigente a la escena. |
| `app:frame` | Muestra visual/reloj; evitar render del árbol React por cada posición. |
| `app:permissions` | Papel, permiso y motivos de bloqueo. |
| `app:request-result` | Resolver solicitudes pendientes, incluso denegadas. |
| `app:effect` | Animación/sonido tras transición confirmada, con ID de efecto único. |

Retener snapshot y permisos para escenas que arrancan después de emitidos. Usar token de escena para descartar callbacks de escenas sustituidas.

Distinguir bloqueos locales de pausa colectiva. Abrir el cuaderno de Vanessa, cambiar el tamaño de ventana o perder foco de su panel no debe pausar por sí mismo al jugador activo. Los experimentos se detienen por estado autorizado del servidor.

Al volver de una pestaña oculta, aplicar snapshot/tiempo actual; no adelantar la simulación con un delta acumulado. La pausa explícita debe poder recibir estado/reanudación fuera de `update`.

### 10.3. Interfaz y arte

Estilo pixel art cálido: madera, crema, verde, plantas decorativas y luz de ventana, coherente con los recursos aprobados de Vanessa y Jerry.

Paneles, textos, slider, formularios y controles de sala son HTML/React, fuera del canvas. Los textos no se hornean en imágenes. Un título o señal breve del mapa puede dibujarse en Phaser con equivalente accesible.

Usar una misma silueta simple coloreable para los participantes, realizable con SVG/CSS. No generar retratos ni personaje individual por usuario.

Assets nuevos mínimos:

| Grupo | Recursos |
| --- | --- |
| Laboratorio | Aula, mesas, entrada, inventario/inventor y capas pertinentes. |
| Sombras | Linterna, objeto, pantalla y representación dinámica de sombra. |
| Rampas | Rampa, pelota, marcas y docente ficticio. |
| Cajas | Dos cajas diferenciadas, campanita, lupa, piedra y compañera ficticia. |
| Cierre | Lupa, bocadillo, corazón; inventor apagado/encendido. |
| Sala | Señales de conexión, turno y pausa; QR generado por código. |
| Sonido | Clic, campana, pieza y cierre; recursos finales verificables. |

Antes de crear arte, buscar reutilización pertinente en el catálogo. Los modelos precisos de sombra y rampa se dibujan con código y recursos estáticos, conservando coherencia con los cálculos.

### 10.4. Sonido

Los teléfonos comienzan en silencio. Vanessa activa sonido en su computadora mediante un gesto permitido por el navegador. El volumen/mute es preferencia local, no parte del progreso compartido.

La proyección es la salida principal. Identificar efectos por transición para no repetir campanas/piezas después de un snapshot o reconexión. No reproducir celebraciones históricas al reabrir el juego.

Cada señal importante tiene texto equivalente. Un fallo de audio no bloquea la mesa. No copiar los tonos `audio.sfx.test-*` del repositorio como sonidos finales.

Los efectos de interfaz/eventos pertenecen a `laboratorio.json → audio`. Si posteriormente se necesitan sonidos espaciales, sus emisores se colocan en la capa `sounds` del TMJ y se leen directamente; archivos y metadata permanecen en `assets.json`. Un laboratorio de sonidos con escritura de archivos no es dependencia de esta primera versión.

<a id="spec-11"></a>

## 11. Responsive, accesibilidad y objetivos de funcionamiento

### 11.1. Celular y proyección

- Vista activa usable en vertical desde **360 px**; probar también 390 y 430 px.
- Texto base de al menos **16 px**; zonas táctiles de al menos **44 × 44 px**.
- Formularios desplazables con teclado abierto; botón de confirmación alcanzable.
- Cambios de turno anunciados con texto y nombre; espera sin mapa.
- Botones −/+ equivalentes a arrastrar; lista de mesas equivalente a navegar.
- Navegación por teclado en HTML y foco visible; no capturar flechas mientras se escribe.
- Estados reconocibles por texto/iconos además de color.
- Descripción textual del cambio de sombra y resultados numéricos de rampas.
- Respetar reducción de movimiento; sin destellos/sacudidas imprescindibles.
- Controles de moderación plegables sin cubrir resultados en la proyección.
- Fuentes pertinentes servidas con el sitio, sin depender de descargas externas durante la exposición.

La experiencia pedagógica se comprende desde la proyección aunque una persona no tenga teléfono o no tome un turno.

### 11.2. Metas de ensayo

| Aspecto | Meta y condición |
| --- | --- |
| Concurrencia | 50 participantes y una administradora, con un solo controlador. |
| Cambio de turno | Visible en menos de 1 s en conexión estable; medir carga inicial y cambios posteriores por separado. |
| Reflejo de control | Retraso objetivo inferior a 250 ms entre acción aceptada y visualización en proyección. |
| Desconexión abrupta | Detectada en aproximadamente 10 s o menos. |
| Fluidez | Al menos 30 FPS en celulares reales de ensayo. |
| Entrada | Aproximadamente 5 s o menos en conexión estable, con carga/reintento. |
| Recursos esenciales | Presupuesto inicial orientativo de 3 MiB transferidos para primera interacción; medir y ajustar arte/carga. |
| Persistencia | Cero pérdida de respuestas/resultados confirmados después de reinicio. |
| Recuperación visual | Hasta 500 ms de retroceso de movimiento/prueba en caída abrupta, según checkpoint de 6.1. |
| Navegadores | Safari en iPhone, Chrome en Android y navegador del equipo proyectado. |

Son objetivos pendientes de medición. No declarar cumplimiento por pasar typecheck/build ni por un test de escritorio.

Cargar recursos por necesidad: sala/espera, mapa esencial y después mesa actual. Evitar precargar todo el catálogo original. Se puede precargar discretamente el módulo de juego y esenciales mientras se espera, sin crear Phaser ni solicitar datos privados de aventura.

No instrumentar cada fotograma en React. Registrar tiempos, errores y tamaños necesarios para ensayo sin exponer tokens o textos privados en logs técnicos.

<a id="spec-12"></a>

## 12. Trazabilidad y criterios de aceptación

### 12.1. Requisitos del PRD

| IDs del PRD | Implementación definida aquí |
| --- | --- |
| RF-01–RF-04 | Entrada, QR, identidad, presencia y espera: secciones 2 y 5. |
| RF-05–RF-11 | Turno exclusivo, avance colectivo, proyección, pausa y tomar control: 2, 4 y 5. |
| RF-12–RF-15 | Sombras, Rampas, Cajas y privacidad: 3. |
| RF-16–RF-18 | Cuaderno, piezas e inventor: 3 y 4. |
| RF-19–RF-21 | Reconexión, recuperación administrativa, cierre y reinicio: 5 y 6. |
| RF-22 | Audio opcional: 10 y 11. |
| RF-23 | Demostración local: 6.4. |
| RF-24 | Persistencia tras reinicio: 6.1. |

### 12.2. Aceptación funcional

Mantener los IDs CA del PRD para que implementación y ensayo sean trazables:

| ID | Escenario y resultado obligatorio |
| --- | --- |
| CA-01 | Crear sala entrega código y QR públicos sin exponer credencial administrativa. |
| CA-02 | Entrada por QR con nombre/color aparece en el aula administrativa. |
| CA-03 | Nombres repetidos tienen distinción visible e identidades independientes. |
| CA-04 | Participante en espera ve solo tarjeta/estado; no se monta el mapa. |
| CA-05 | Dar turno abre la aventura vigente e identifica al controlador en proyección. |
| CA-06 | Tocar destino representa el mismo movimiento en teléfono y proyección. |
| CA-07 | Cambiar turno conserva estado, devuelve al anterior a espera y habilita a uno solo. |
| CA-08 | Acción tardía del controlador anterior es rechazada sin modificar avance. |
| CA-09 | Espera no puede jugar, darse turno ni emitir moderación autorizada. |
| CA-10 | Selecciones administrativas rápidas conservan la última confirmada, sin doble control. |
| CA-11 | Pausar durante rampa congela tiempo; reanudar no añade la conversación. |
| CA-12 | Cambiar controlador en pausa mantiene esa pausa. |
| CA-13 | Tomar control habilita a Vanessa y revoca al participante. |
| CA-14 | Sombras conserva primera idea, posiciones y observación entre turnos. |
| CA-15 | Rampa no permite experimentar antes de abrir pregunta y confirmar predicción. |
| CA-16 | Dos pruebas comparables con distintas inclinaciones conservan resultados coherentes. |
| CA-17 | Repetir una petición de suelta crea una sola prueba. |
| CA-18 | Pedir permiso muestra negativa y no abre la caja personal. |
| CA-19 | Cajas conserva negativa y respeto al cambiar jugador. |
| CA-20 | Solo respuestas confirmadas aparecen en cuaderno/proyección; borradores permanecen locales. |
| CA-21 | Incertidumbre y participación oral permiten completar los registros correspondientes. |
| CA-22 | Repetir cierre de mesa no duplica pieza ni efecto confirmado. |
| CA-23 | Tres piezas habilitan colocar piezas y registrar pregunta del grupo. |
| CA-24 | Desconectar controlador pausa, retira control y permite elegir reemplazo. |
| CA-25 | Quien regresa recupera identidad en espera, sin desplazar al controlador vigente. |
| CA-26 | Recargar Vanessa recupera administración y sala pausada; decide cuándo continuar. |
| CA-27 | Reiniciar servicio recupera cambios confirmados y deja la sala pausada. |
| CA-28 | Segunda pestaña sustituye primera; solo la conexión vigente puede actuar. |
| CA-29 | Cerrar revoca control y muestra finalización en todos los dispositivos. |
| CA-30 | Credencial/código de otra sala no permite leer o modificar datos ajenos. |
| CA-31 | Ensayo con 50 participantes documenta turnos, sincronización y métricas de 11.2. |
| CA-32 | Demo recorre mesas sin servidor y mantiene estado aislado de la sala. |
| CA-33 | Audio apagado, teclado y alternativas al arrastre permiten comprender/completar. |

### 12.3. Aceptación técnica adicional

| ID | Comprobación |
| --- | --- |
| CT-01 | Editar y guardar el TMJ cambia una sala/demo nueva; no existe maps.json ni importación intermedia. |
| CT-02 | El build usa el mismo TMJ y falla con asset desconocido, estación duplicada/faltante, geometría inválida o característica no soportada. |
| CT-03 | Movimiento y colisiones derivan del mismo mapa en cliente/servidor; no se atraviesan obstáculos ni esquinas bloqueadas. |
| CT-04 | Cargar/cambiar escenas y Strict Mode no duplica canvas, listeners, timers ni audio. |
| CT-05 | Remontar/reconectar recibe snapshot completo; no depende de haber escuchado un evento anterior. |
| CT-06 | Phaser y transporte no hacen renderizar todo React por cada frame de movimiento. |
| CT-07 | Sombras cambia continuamente según el modelo; dos muestras iguales no satisfacen exploración. |
| CT-08 | Rampas usa mismo modelo/escala en ambas vistas; pausa, duplicados y cambio de turno no alteran resultado. |
| CT-09 | Snapshot público, QR y logs no exponen tokens; no existe contenido secreto de la caja personal en assets/datos. |
| CT-10 | Servidor deniega payloads fuera de rango, pasos inválidos, IDs inexistentes y mensajes de generación/epoch antiguos. |
| CT-11 | Fallo simulado de SQLite no produce acknowledgment de éxito ni pieza/registro «confirmado». |
| CT-12 | Reiniciar sala conserva participantes pero invalida comandos y resultados del recorrido anterior. |
| CT-13 | Paquetes config/mapa incompatibles bloquean control sin borrar progreso; no se cambia un mapa en una sala activa. |
| CT-14 | Demo funciona con backend apagado y desde build local preparado sin red; no sincroniza avances al regresar. |
| CT-15 | Catálogo conserva IDs, rutas y metadatos; pose-sheets sin frames no se tratan como spritesheets listas. |
| CT-16 | Pruebas con base URL distinta y rutas de entrada por QR resuelven mapa/assets sin duplicar prefijos. |

### 12.4. Validación pedagógica

Ensayar con Vanessa y una o dos personas. Pedir que expliquen:

1. Qué cambió al pasar de una primera idea a observar/probar en Sombras.
2. Qué ocurrió al abrir espacio para preguntar en Rampas.
3. Por qué se respetó la caja personal y cómo continuó la curiosidad.
4. Qué les gustaría seguir investigando.
5. Si pudieron seguir y aportar aunque no tuvieron el turno.

Registrar duración real, claridad de textos y momentos de pausa. Ajustar redacción y ritmo sin añadir evaluación de «respuestas correctas».

<a id="spec-13"></a>

## 13. Límites, decisiones de implementación pendientes y fuentes

### 13.1. Alcance inicial y extensiones

Indispensable: sala, identidad, presencia, turnos, pausa, proyección, las tres mesas, cuaderno, piezas, inventor, persistencia, recuperación y demo local.

Después: levantar mano, voluntarios, selección aleatoria, reacciones discretas, exportar cuaderno, segunda ventana de proyección y nuevos experimentos. No introducir esas mejoras como dependencias del recorrido inicial.

Fuera de alcance: personajes simultáneos por participante, rankings, cuentas, fotos, evaluador de texto con IA, preguntas respondidas automáticamente, edición de mapa dentro de la aplicación y un sistema distribuido de servidores.

La propuesta de Tiled evita un importador y conserva formatos estándar, a cambio de trabajar con un perfil acotado. Si un mapa futuro necesita tilesets externos, plantillas, polígonos o múltiples mundos, decidir su soporte explícitamente y ampliar lector/validadores/pruebas. No reintroducir una copia editable de coordenadas.

### 13.2. Pendientes que no bloquean el inicio

| Pendiente | Tratamiento |
| --- | --- |
| Arte específico de laboratorio/mesas | Prototipar con formas claras y etiquetadas; incorporar arte real antes de entrega final. |
| Sonidos finales | Mantener silencio/indicador durante prototipo; verificar recursos antes de presentación. |
| Proveedor de hosting | Desarrollar con servidor local; seleccionar uno con proceso persistente, HTTPS y volumen. |
| Driver SQLite y versión Node | Verificar compatibilidad y fijar instalación antes de dar por cerrada la fase de infraestructura. |
| Ajustes de física/tiempos | Adoptar modelos propuestos; medir representación y validar comprensión en ensayo. |
| Tipografía y recursos heredados | Inspeccionar qué se reutiliza; no declarar que todos son necesarios. |

Son decisiones concretas para la implementación; no se debe detener todo el trabajo para pedirlas antes de tener un prototipo verificable.

### 13.3. Fuentes consultadas

**Producto y referencia de código**

- PRD adjunto: *El laboratorio de las cosas cotidianas*, versión 2.0, 922 líneas; base de los requisitos RF y CA.
- PDF de *Pedagogía de la autonomía* compartido en el proyecto. La delimitación y las paráfrasis aquí siguen el PRD; no se incorporan citas nuevas del PDF.
- [SPEC de Bitácora en el commit revisado](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/.claude/SPEC.md).
- [PLAN de Bitácora en el commit revisado](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/.claude/PLAN.md).
- [package-lock.json](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/package-lock.json), [AssetRegistry](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/src/config/assetRegistry.ts), [GameBridge](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/src/game/bridge/GameBridge.ts), [WorldBuilder](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/src/game/systems/WorldBuilder.ts) y [guía Tiled](https://github.com/Juanes-22/bitacora-amorcito/blob/041d326f1f0b9e30b2d0de816cb7bb986e542d50/tools/tiled/README.md).

**Documentación técnica primaria — consulta del 5 de octubre de 2026**

| Ref. | Fuente y uso |
| --- | --- |
| T1 | [Phaser LoaderPlugin](https://docs.phaser.io/api-documentation/class/loader-loaderplugin) y [Tilemap](https://docs.phaser.io/api-documentation/class/tilemaps-tilemap): carga Tiled JSON y creación de capas/objetos. |
| T2 | [Tiled: JSON Map Format](https://doc.mapeditor.org/en/stable/reference/json-map-format/): campos de mapa, capas, objetos y propiedades. |
| T3 | [Tiled: Editing Tilesets](https://doc.mapeditor.org/en/stable/manual/editing-tilesets/): organización de tilesets y recursos. |
| T4 | [Socket.IO: delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/): diferencia entre transporte, reintentos e idempotencia de aplicación. |
| T5 | [Socket.IO: rooms](https://socket.io/docs/v4/rooms/) y [connection state recovery](https://socket.io/docs/v4/connection-state-recovery/): canales y recuperación. |
| T6 | [Socket.IO: server options](https://socket.io/docs/v4/server-options/): heartbeat y límites del transporte. |
| T7 | [Vite: static assets](https://vite.dev/guide/assets.html): publicación de public y resolución de rutas. |
| T8 | [TilemapJSONFile de Phaser 4.2.1](https://github.com/phaserjs/phaser/blob/v4.2.1/src/loader/filetypes/TilemapJSONFile.js) y [JSONFile de Phaser 4.2.1](https://github.com/phaserjs/phaser/blob/v4.2.1/src/loader/filetypes/JSONFile.js): entrada de JSON ya parseado en el loader nativo. |

Los nombres de eventos, archivos del nuevo proyecto, modelos de estado y factories son decisiones de esta especificación; no APIs nativas existentes por aparecer aquí.
