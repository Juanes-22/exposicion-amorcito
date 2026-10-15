# SPECS.md — El laboratorio de las cosas cotidianas

## Una aventura interactiva sobre la curiosidad

**Expositora:** Vanessa Estrada.  
**Asignatura:** Práctica pedagógica 5 · Licenciatura en Educación Infantil · Universidad de Antioquia.  
**Versión documental:** 2.0 · 6 de octubre de 2026 (1.0 era del 5 de octubre).  
**Fuente de producto:** PRD suministrado, versión 2.0, **modificado por la «Propuesta de mejora: participación simultánea y rondas guiadas por Vanessa» (v1, 6 de octubre de 2026)**, que sustituye la sala de un solo controlador por la exploración simultánea de todas las personas; por la propuesta **«Mesa 3 · El observatorio»** (14 de octubre de 2026), que reemplaza La caja de las sorpresas; por la decisión del 15 de octubre de 2026 de quitar las **medidas** de Sombras (sin centímetros) y Rampas (sin grados ni tiempos, seis inclinaciones con nombre); y por la **Guía para Vanessa** (actualizada, 15 de octubre de 2026), de la que salen la pregunta de entrada, las preguntas de cada mesa y los textos del cierre. Esa guía vive fuera del juego: la consola ya no tiene «Guía para conversar».  
**Stack:** React + Vite + TypeScript + Phaser; servidor Node.js + TypeScript + Socket.IO; SQLite.  
**Estado:** especificación **y** descripción de lo construido. Este documento no acredita por sí mismo pruebas ejecutadas: las evidencias están en [PLAN.md](PLAN.md) y en `docs/evidencia/`.

<a id="spec-0"></a>

## 0. Autoridad, fuentes y decisiones

Este archivo define el comportamiento, la arquitectura, los contratos y las condiciones de aceptación. [PLAN.md](PLAN.md) define el orden de construcción y las evidencias de ejecución. Los ejemplos ayudan a implementar; no sustituyen los requisitos.

La referencia técnica es [Juanes-22/bitacora-amorcito](https://github.com/Juanes-22/bitacora-amorcito), rama main, commit **041d326f1f0b9e30b2d0de816cb7bb986e542d50**, consultado el 5 de octubre de 2026. Sus documentos reales se llaman **.claude/SPEC.md** y **.claude/PLAN.md**, con SPEC en singular. En esta aventura se usa el nombre solicitado **SPECS.md**.

| Documento o recurso | Responsabilidad |
| --- | --- |
| `.claude/SPECS.md` | Requisitos funcionales y técnicos; contratos; criterios de aceptación. |
| `.claude/PLAN.md` | Fases, tareas, dependencias, pruebas y evidencias. |
| PRD versión 2.0 | Intención pedagógica, escenas, guiones y experiencia compartida. |
| Guía para Vanessa (PDF, 15 de octubre de 2026) | Guion de la exposición: lo que Vanessa dice, las preguntas y las transiciones. Los textos del juego la siguen; los nombres de botones son orientativos. |
| `public/config/laboratorio.json` | Recorrido, contenidos, diálogos, parámetros de experimentos y referencias a assets. Su esquema vive en `shared/config/schemas/`. |
| `public/maps/laboratorio.tmj` | Única fuente editable de geometría, ubicaciones y composición del laboratorio. |
| `public/assets/assets.json` | Catálogo de recursos, rutas, atlas y metadatos. |
| SQLite del servidor | Estado autorizado y cambios confirmados de cada sala. |
| `README.md` | Instalación, ejecución, edición en Tiled, ensayo y operación del código construido. |

Ante un cambio del usuario, actualizar SPECS y después PLAN. Si una decisión técnica impide cumplir el PRD, resolver esa incompatibilidad explícitamente; no reducir el producto para cerrar una tarea. Guardar estos dos documentos en `.claude/` en el nuevo proyecto y pedir a la IA de implementación que los lea en ese orden.

### 0.1. Decisiones de esta propuesta

| Aspecto | Decisión |
| --- | --- |
| Producto | Sala compartida con administradora y **rondas guiadas**: todas las personas exploran a la vez con su propio personaje, una mesa por ronda; Vanessa abre, reúne, conversa y avanza. Progreso colectivo y resultados personales. Reemplaza el modelo de un solo controlador por turnos. |
| Base tecnológica | Conservar React, Vite, TypeScript y Phaser de la referencia. Agregar el servidor necesario para la sala. |
| Tiled | Guardar directamente un mapa JSON `.tmj` dentro de `public/maps/` y consumirlo con el soporte nativo de Phaser. |
| Datos espaciales | No generar `maps.json`, `placements` ni otra copia editable de las coordenadas. |
| Recursos existentes | Reutilizar PNG, atlas, fuentes y componentes pertinentes mediante `assetId`; no exigir un tileset para empezar. |
| Tiles, si se incorporan | Una imagen de tiles y definición incrustada en el TMJ; mantener el mapa dentro del perfil compatible de la sección 8. |
| Dominio | Funciones TypeScript puras del servidor, compartidas con el cliente y las pruebas. |
| Sincronización | Enviar intenciones y estados; cada pantalla dibuja localmente a todos los personajes desde sus planes y un reloj interpolado. Cada persona recibe solo su estado personal. |
| Persistencia inicial | Una instancia de servidor con SQLite en volumen persistente; sin Redis, microservicios ni varias réplicas. |
| Demostración | **Retirada** (15 de octubre de 2026): ya no existe la demostración local de respaldo (`/demo`). Solo hay salas reales. |
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
| Progreso individual, XP y localStorage | Sustituir por progreso colectivo y resultados personales autorizados por servidor. |
| Seis aprendizajes, portales, insignias y animales | No trasladar esos requisitos a esta aventura. |

No copiar todo el repositorio para conservar características ajenas al producto. Usarlo como referencia y reutilizar piezas identificadas. Si se parte de una copia, retirar lo innecesario en el proyecto nuevo, conservando intacta la bitácora original.

<a id="spec-1"></a>

## 1. Producto, propósito y alcance pedagógico

El salón recorre una aventura de aproximadamente **18 minutos**: bienvenida, Sombras, Rampas, El observatorio e inventor de preguntas. **Todas las personas exploran a la vez desde su celular**, cada una con su propio personaje en un laboratorio compartido. Vanessa conduce el grupo desde la computadora proyectada: habilita **una mesa por ronda**, mira cuántas personas ya están listas, reúne al grupo para conversar y decide cuándo seguir. La proyección es el lugar donde se conversa; el celular es el lugar donde se explora.

Cada persona experimenta por su cuenta y sus pruebas son suyas: nadie manipula el experimento de otra ni espera un turno. Los resultados se **registran solos** y la persona queda «lista para conversar» cuando cumple el criterio de la mesa; no hay formularios de respuesta. Lo que se escribe es de **Vanessa**: la idea inicial del grupo, la síntesis de la conversación, las preguntas que el grupo quiere conservar y la pregunta final. La única excepción es el **inventor**: allí cada persona registra su pregunta (una sugerida por las mesas o una que escribe) y solo Vanessa la ve (3.5).

Los personajes de las personas son siluetas coloreadas con su nombre encima; Vanessa y Jerry son la guía visual del laboratorio (acompañan la mesa habilitada) y no son el personaje de nadie.

| Momento | Tiempo orientativo | Propósito | Pieza colectiva |
| --- | --- | --- | --- |
| Bienvenida | 2 min | Entrar, explicar cómo se explora y presentar el inventor. | — |
| Sombras | 5 min | Pasar de una primera idea del grupo a observar, probar y comparar. Preparación ≈ 1 min · exploración ≈ 2 min · conversación ≈ 2 min. | Lupa — «Observar y comparar». |
| Rampas | 5 min | Contrastar una predicción con pruebas propias y dialogar. Mismos tiempos. | Diálogo — «Preguntar y escuchar». |
| El observatorio | 3 min | Explorar el cielo con un telescopio y encontrarse con un límite: la curiosidad no autoriza a invadir ni exponer la privacidad de otras personas. Presentación ≈ 20 s · exploración ≈ 1 min 20 s · conversación ≈ 1 min 20 s. | Corazón — «Investigar con respeto». |
| Inventor y reflexión | 3 min | Caminar hasta el inventor, registrar cada quien su pregunta, elegir con el grupo la pregunta final y relacionar lo vivido con Freire. | Cierre. |

Las pausas para conversar están incluidas en esos tiempos. No hay límite automático por ronda, puntos por rapidez, ranking ni evaluación automática de respuestas. Cada fase la decide Vanessa.

La base es el apartado **«Enseñar exige curiosidad»** de *Pedagogía de la autonomía*, según la delimitación del PRD. Los diálogos son paráfrasis y ejemplos creados para la exposición. Mantener las precisiones del PRD:

- La curiosidad espontánea puede volverse más rigurosa al observar, probar y buscar razones.
- La curiosidad «domesticada» no es una etapa obligatoria de ese recorrido.
- Dialogar también implica escuchar y atender las explicaciones del docente.
- El desafío de la clase consiste en pensar y comprender.
- La tercera mesa trata de privacidad y respeto. La relación entre autoridad y libertad queda fuera de esta versión.

La aplicación organiza acciones y registra resultados; no juzga si una reflexión es correcta. La frase de Freire de cada mesa es una paráfrasis breve que Vanessa decide mostrar en la proyección cuando conversa; no se muestra en los celulares.

<a id="spec-2"></a>

## 2. Pantallas, navegación y reglas de sala

### 2.1. Entrada y vistas

Usar rutas sencillas: `/` y `/sala/:code`. La URL pública de entrada contiene únicamente el código; nunca una credencial privada. El servidor debe devolver la aplicación en las rutas del frontend.

| Vista | Contenido y comportamiento |
| --- | --- |
| Entrada | Título; Crear sala; Unirse. |
| Entrada a sala | Nombre de 1–20 caracteres Unicode, color de una paleta definida y silueta. Sin cuenta ni fotografía. Todas las personas que entran juegan: desde el 15 de octubre de 2026 la pantalla ya no ofrece «Solo quiero acompañar»; el servidor conserva el soporte de observadoras (`observer` en la API), sin uso desde la aplicación. |
| Bienvenida de Vanessa | QR, código, cuántas personas están conectadas (y cuántas observan), tarjetas de participantes y **Comenzar la aventura**. No se elige quién empieza. |
| Celular de quien juega | Laboratorio compartido con su personaje y los de las demás personas (cada nombre encima de su avatar). Barra «Mesas · piezas · Cuaderno». Un texto dice qué toca en cada fase. Al abrir la mesa habilitada aparece el panel de su experimento. **La flor de arriba a la izquierda** (15 de octubre de 2026): tocarla suena (`flower.tap`, sonido entregado por la persona usuaria) y aparece un «?» sobre Vanessa y otro sobre Jerry; no mueve al personaje, no viaja al servidor y solo lo ve y oye quien la toca. La decoración lo declara en Tiled con la propiedad `tapEvent`. |
| Mesa abierta | Escena cercana de la mesa y panel HTML con el objetivo, los controles y «Listo para conversar». Los resultados se registran solos. **«Volver al mapa» aparece recién al completar la mesa** (15 de octubre de 2026): antes, la mesa queda abierta hasta terminarla. En el celular la escena ocupa todo el ancho y hasta la mitad del alto, y la cámara se acerca a la actividad (la linterna y la pantalla, la rampa, el visor, la máquina); en pantallas anchas se ve el escenario entero. |
| Observadora | Silueta, nombre y el texto de la fase. Sin mapa ni personaje: sigue la proyección. |
| Aventura de Vanessa | Laboratorio compartido a pantalla completa; barra con la mesa, la fase de la ronda, el paso siguiente («Abrir mesa: …», «Conversemos», «Mostrar la frase de Freire», «Abrir siguiente mesa: …», «Abrir inventor») y el contador «N de M listos» (en el inventor, «N de M preguntas registradas»). Mientras se explora, en lugar del laboratorio se ve **la actividad de la mesa abierta** (la linterna, la rampa o el telescopio en su estado inicial, sin las pruebas de nadie) y **Vanessa también puede hacerla**: bajo la pregunta tiene los mismos controles que los celulares (linterna, inclinación y «Soltar la pelota», flechas, aumentos y arrastre del visor). Es su propio experimento, local a la consola, con las reglas del dominio compartido y el reloj de la sala: no pasa por el servidor, no cuenta en «N de M listos», no va al cuaderno y no toca el de nadie; empieza de cero en cada mesa y desaparece al conversar. Junto a la escena: al comenzar, solo la **pregunta de entrada**; al abrir cada mesa, **su pregunta**; en la conversación, la pregunta de conversación y la frase de Freire; en el cierre, el inventor. Antes de abrir la segunda y la tercera mesa no se proyecta nada: el laboratorio ocupa toda la pantalla. Paneles plegables: participantes («N conectados»), preguntas del inventor (aparece al abrirlo, cerrado), cuaderno del grupo y QR. |
| Cuaderno (celular) | «Mis resultados» (los que el juego registró) y «Lo que anotó el grupo» (solo lectura). Sin formularios. |
| Cierre | El inventor es una mesa más: todas las personas caminan hasta la máquina, Vanessa la abre y cada persona entra y registra su pregunta. Después, la pregunta final del grupo impresa en el inventor y la reflexión. |
| Cerrada o vencida | Mensaje de finalización o sala no disponible; sin controles ni reconexión indefinida. |

El panel de participantes y las preguntas del inventor se muestran en la misma computadora proyectada; cualquier panel abierto puede verlo el público. Una segunda ventana de proyección separada queda para después.

Los nombres repetidos conservan identidades distintas. El servidor añade una distinción visible estable, como «Laura · 2». El color no es el identificador.

**Nombres sobre los avatares.** Cada personaje lleva siempre su nombre encima, en el celular de cada persona y en la proyección; el propio lleva «(tú)» y quien perdió la conexión lo dice con texto. Si dos personajes se cruzan, sus nombres simplemente se superponen: en el celular el propio queda por encima de todos; en la proyección se ve encima el del personaje que está más abajo en el mapa. En la proyección el rótulo crece un poco (hasta 1,3 veces) al ver el laboratorio entero; no se reacomoda.

### 2.2. Permisos

| Acción | Administradora | Participante que juega | Observadora |
| --- | --- | --- | --- |
| Ver el laboratorio, los demás personajes y el cuaderno del grupo | Siempre mientras la sala esté disponible. | Sí. | Solo la proyección y el texto de la fase. |
| Ver su propio avance y resultados | — | Solo los suyos. | No tiene. |
| Ver el listado completo y el contador de la ronda | Sí. | No. | No. |
| Mover su personaje, abrir la mesa habilitada y experimentar | No. | Sí, según la fase de la ronda. | No. |
| Entrar al inventor abierto y registrar su pregunta | No (la ve en «Preguntas del inventor»). | Sí, la suya; puede cambiarla mientras el inventor siga abierto. | No. |
| Abrir, reunir, avanzar la ronda, mostrar la frase de Freire | Sí. | No. | No. |
| Escribir las notas del grupo, abrir el inventor y confirmar la pregunta final | Sí. | No. | No. |
| Comenzar, pausar y reanudar | Sí. | No. | No. |
| Incluir en la ronda a quien llegó tarde | Sí. | No. | No. |
| Reiniciar avance o cerrar | Sí, con confirmación. | No. | No. |
| Preguntar en voz alta | Sí. | Sí. | Sí. |

Nadie puede actuar sobre las pruebas de otra persona: cada acción personal se aplica solo al estado de quien la envía. La administradora no manipula el experimento de nadie.

### 2.3. Ciclo de sala

Fases de sala: `welcome`, `running`, `paused`, `finished`, `closed` y `expired`. En pausa conservar `resumePhase`, que indica si se regresa a `running` o `finished`. Ya no existe un «propietario del control»: todas las personas juegan a la vez.

| Operación | Efecto autorizado |
| --- | --- |
| Comenzar | Desde bienvenida, con la administradora conectada. La primera mesa queda en **preparación**. |
| Pausar | Detener reloj, movimiento y pruebas; se ve «En pausa» en todas las pantallas. |
| Reanudar | Continuar desde el instante congelado; requiere la administradora conectada. |
| Reiniciar avance | Borrar aventura, pruebas de todas las personas, notas y piezas; volver a bienvenida. Conservar participantes y credenciales; sus personajes vuelven a la entrada. |
| Finalizar aventura | Confirmar la pregunta final (fase `finished`); permite consultas. |
| Cerrar | Revocar credenciales de uso; todas las vistas muestran que terminó. |
| Vencer | Igual bloqueo; limpieza conforme a la política de retención. |

Reiniciar y cerrar requieren un diálogo que explica su efecto. Reiniciar incrementa `roomGeneration` para invalidar mensajes del recorrido anterior.

Si la administradora pierde la conexión, la sala se **pausa** para todas las personas; al volver recupera la conducción con la sala todavía pausada y decide cuándo reanudar.

### 2.4. Rondas

La aventura avanza por **rondas**, una por mesa, en el orden `sombras → rampas → cajas` (el identificador `cajas` se conserva para El observatorio), seguidas del cierre con el inventor. Cada ronda tiene cuatro fases comunes que solo Vanessa avanza:

| Fase | Qué pasa | Qué ven las personas | Acción de Vanessa que la termina |
| --- | --- | --- | --- |
| **Preparación** | La mesa todavía no se abre. Las personas pueden caminar por el laboratorio. | «Escucha la pregunta de Vanessa. Pronto se abre la mesa.» Al comenzar, la proyección muestra solo la **pregunta de entrada** («¿Recuerdan algo que hayan aprendido porque les dio curiosidad?»); antes de la segunda y la tercera mesa no muestra nada. | **Abrir mesa: [mesa]** |
| **Exploración** | Todas las personas pueden abrir la mesa habilitada y explorar a la vez. Se fija la lista de la ronda. | «La mesa está abierta: explora a tu ritmo.» La proyección muestra **la actividad de la mesa** en lugar del mapa (su estado inicial: nadie la maneja y no sigue la exploración de nadie), la **pregunta de la mesa** a la derecha y «[mesa] · N de M listos» en una esquina. Al conversar vuelve el laboratorio. | **Conversemos** |
| **Conversación** | Las pruebas nuevas se cierran (las que ruedan se cancelan). Los controles se detienen. | «Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.» La proyección muestra la pregunta de conversación y, cuando ella decide, la frase de Freire (en El observatorio, con la frase llega la casa y la pregunta pasa a ser la de la cortina). | **Mostrar la frase de Freire** y, ya mostrada, **Abrir siguiente mesa** (o **Pasar al inventor**), que aparece en su lugar |
| **Cierre: hacia el inventor** | Tras la última mesa todas las personas vuelven al mapa y **caminan hasta la máquina del inventor**; todavía no se entra. | «Ya pasamos por las tres mesas. Camina hasta el inventor de preguntas: Vanessa lo abrirá en un momento.» La proyección sigue en el laboratorio, con la pregunta del inventor al lado. | **Abrir inventor** |
| **Cierre: inventor abierto** | Cada persona entra al inventor (tocando la máquina o con «Ir al inventor») y registra su pregunta. La proyección muestra la máquina: las piezas viajan a sus espacios. | «El inventor está abierto: acércate a la máquina, entra y registra tu pregunta.» | **Confirmar la pregunta final** |

**Una mesa a la vez.** Solo la mesa de la ronda actual se puede abrir; tocar otra explica «Esa mesa se habilitará más adelante» o «Esa mesa ya terminó». En preparación, conversación y cierre nadie puede abrir mesas ni experimentar; en el cierre se camina, y tocar una mesa explica «Ya pasamos por todas las mesas: ve al inventor de preguntas». Quien ya tenía la mesa abierta al reunir al grupo la sigue viendo, con los controles detenidos, hasta que se abre la siguiente.

**Lista de la ronda.** Al abrir la mesa se fija quiénes cuentan: todas las personas que juegan (las observadoras no). Una desconexión no reduce el total: el contador «N de M listos» conserva M. Quien llegue después de abrir la mesa **acompaña sin contar**; Vanessa puede **incluirla en la ronda** mientras la mesa esté abierta. En la ronda siguiente la lista vuelve a fijarse con todas las personas presentes.

**Conversemos.** Con todas las personas listas, pasa directo a la conversación (la consola avisa «✓ Todas las personas están listas»). Con personas pendientes abre un diálogo, **«Todavía hay personas explorando»**, que dice cuántas terminaron, nombra a quienes faltan y explica el efecto; se confirma con **«Conversar ahora»** o se cancela con «Esperar un poco más»: se conserva lo que hicieron, se registra quiénes no terminaron y **no se les concede la finalización**. Las pruebas de rampa en marcha se cancelan y no cuentan como terminadas.

**Abrir siguiente mesa.** Incorpora al inventor la pieza de la mesa que termina, en esa transición y una sola vez, y devuelve a todas las personas al mapa. Tras la última mesa pasa al cierre.

**Un paso a la vez en la conversación.** *(15 de octubre de 2026.)* Primero solo se ofrece «Mostrar la frase de Freire»; al pulsarlo, ese botón desaparece y en su lugar aparece «Abrir siguiente mesa: …» (o «Pasar al inventor»). Así la frase siempre se muestra antes de avanzar. Es una regla de la consola: el dominio no la exige.

**Sin proyección de resultados.** *(Retirada el 15 de octubre de 2026.)* Vanessa ya no proyecta los resultados de una persona ni se guardan comparaciones en el cuaderno: la conversación parte de lo que el grupo observó y de la pregunta proyectada. En El observatorio, Vanessa muestra la casa con su propia demostración (3.4).

### 2.5. Desplazamiento y demostración de Vanessa

Tocar un punto del laboratorio solicita un destino; tocar la mesa habilitada solicita acercarse y abrirla al llegar. **Ir a la mesa actual** (menú «Mesas») abre la mesa sin manejar el personaje: es el equivalente accesible y no exige proximidad. Los personajes no se bloquean entre sí.

El servidor valida destinos, límites y trayectos. Un punto inaccesible muestra una explicación breve y no deja al personaje atrapado. Las coordenadas de pantalla se convierten a coordenadas de mundo antes de enviar la intención. Tocar la mesa habilitada fuera de la exploración explica que Vanessa todavía no la abre; una pausa o «Conversemos» antes de llegar cancelan la apertura pendiente.

No se sincronizan los píxeles del teléfono: cada dispositivo adapta cámara y composición a su tamaño. El celular sigue a su personaje con una ampliación legible; la proyección encuadra el laboratorio entero.

**Sin demostración dentro de la sala.** Se retiró el botón «Probar la mesa yo misma»: Vanessa solo conduce la ronda y no explora en una sala real. Desde el 15 de octubre de 2026 tampoco hay demostración de respaldo (6.4); su código se retiró.

<a id="spec-3"></a>

## 3. Actividades, resultados y cierre

### 3.1. Resultados personales y cuaderno

**No hay formularios de respuesta.** Se eliminan las modalidades escrita, sugerida, oral e incertidumbre; «Anotar esta posición», «Tengo una pregunta», «Entendido», «Respetar y seguir explorando» y «Colocar las piezas» no existen. El juego registra lo que cada persona hace:

| Mesa | Qué se registra solo |
| --- | --- |
| Sombras | Cada posición de la linterna y la sombra que produjo, al **terminar** el ajuste (soltar el slider o una pausa breve tras −/+). No se describe en pantalla: la persona lo observa en la escena; el cuaderno dice cuántas posiciones probó. |
| Rampas | Cada prueba terminada: inclinación, tiempo de la simulación y condiciones congeladas. Se muestra solo el nombre de la inclinación («Prueba 2: muy empinada»): ni grados ni tiempos. |
| El observatorio | «Luna observada» y «Estrellas observadas» (sin duplicados). Nunca la ventana, la cortina ni quién se acercó a la casa. |

**Listo para conversar.** Se deduce de lo registrado; nadie lo marca ni lo confirma, y seguir probando no lo quita:

| Mesa | Criterio |
| --- | --- |
| Sombras | Dos posiciones de la linterna separadas al menos **5 cm** (configurable, interno: en pantalla se pide «una más cerca y otra más lejos»). Una posición muy parecida a otra se registra pero no cuenta. |
| Rampas | Dos pruebas **terminadas** con **inclinaciones distintas** (internamente, que difieran al menos 5°: cualquier par de las seis). Una prueba en marcha o cancelada no cuenta. Mientras falta la diferencia, el avance dice «1 de 2». |
| El observatorio | La **Luna** centrada con el **aumento cercano** y el **grupo de estrellas** centrado (con cualquier aumento), en cualquier orden. Acercarse a la casa no es un requisito ni suma nada. |

El panel de cada persona muestra «Explorando · N de M» o «✓ Listo para conversar» y el texto correspondiente; no hay puntos ni comparación entre personas.

**Cuaderno.** Dos partes, ambas de solo lectura para quien juega: **«Mis resultados»** (lo que el juego registró de esa persona) y **«Lo que anotó el grupo»**: las notas que Vanessa guarda —idea inicial del grupo (solo en Sombras, **conservada aparte** de la síntesis), idea del grupo (síntesis), preguntas que el grupo quiere conservar y la pregunta final. Las ideas de Vanessa se identifican siempre como del grupo. Una corrección conserva la versión anterior a la vista. Nunca hay borradores ni texto de las personas del público en el cuaderno ni en el estado de grupo: la pregunta que cada persona registra en el inventor vive en su estado personal y solo la ve Vanessa (3.5).

Completar mesas y conceder piezas ocurre en una sola transición del dominio (**Abrir siguiente mesa**). No existe un comando del cliente para «otorgar pieza» ni para fijar un resultado.

### 3.2. Sombras

Pregunta de entrada de la aventura (se proyecta al comenzar, mientras las personas caminan hacia la mesa): «¿Recuerdan algo que hayan aprendido porque les dio curiosidad?». Pregunta de la mesa (se proyecta al abrirla): «¿Qué cambiará si acercamos o alejamos la linterna?». La pregunta «el objeto es pequeño, pero su sombra se ve grande: ¿por qué creen que pasa?» la plantea Vanessa en voz alta (guía). Objetivo en el celular: «Acerca y aleja la linterna y compara la sombra en dos posiciones distintas.»

**Se comparan tamaños, sin medidas ni conclusiones escritas.** Ni el celular, ni la escena, ni la proyección, ni el cuaderno muestran centímetros, cotas ni proporciones. El celular **no dice** qué tan grande es la sombra ni lista las posiciones: cada persona hace sus observaciones mirando la escena, donde cada posición registrada deja una marca de color a la altura de su sombra para compararlas a simple vista. Solo quien usa lector de pantalla recibe una descripción con palabras (linterna «muy cerca»…«muy lejos»; sombra «muy grande»…«pequeña»), porque no puede ver la escena. El cuaderno dice cuántas posiciones probó, no cómo fue la sombra.

Mantener fijos objeto y pantalla. La linterna no atraviesa el objeto. Ofrecer un slider con «Más lejos del objeto» y «Más cerca del objeto», además de botones −/+. El ajuste es **local** (la escena lo dibuja al instante) y solo el resultado ya terminado viaja al servidor.

Modelo de referencia para desarrolladores: fuente puntual ideal; distancia linterna–objeto `d`; distancia objeto–pantalla `b`; altura del objeto `h`. Usar `alturaSombra = h × (d + b) / d`. Valores iniciales propuestos: `d = 10…60 cm`, `b = 25 cm`, `h = 8 cm`. Acercar la linterna aumenta la sombra y alejarla la reduce. La linterna empieza en el extremo cercano del rango (`d` mínimo): la sombra grande de un objeto pequeño es la sorpresa.

La separación mínima entre dos muestras que cuentan es configurable; valor inicial **5 cm**. No contar cada mensaje de arrastre como una exploración distinta: la muestra se registra al terminar el gesto. La misma posición no se registra dos veces seguidas.

La representación y la descripción textual usan el mismo valor calculado: las palabras salen del modelo, relativas al rango de la mesa. No sustituir el modelo por tamaños aleatorios o dos imágenes fijas.

Pregunta de conversación: «¿Qué cambió cuando movieron la linterna? ¿Qué observación nos ayuda a revisar la primera explicación?». Frase de Freire: «Freire propone volver más rigurosa nuestra curiosidad al observar, comparar y buscar razones.»

Guía de Vanessa (el PDF): antes, escuchar una o dos ideas; después, preguntar qué cambió y qué observación ayuda a revisar la primera explicación, y, si quiere, guardar una síntesis «Pensábamos… / Observamos…».

### 3.3. Rampas

Pregunta de la mesa (se proyecta al abrirla): «¿Qué creen que cambiará si inclinamos más esta rampa? ¿Cómo podríamos comprobarlo?». Objetivo en el celular: «Elige una inclinación y suelta la pelota; luego cambia la inclinación y repite.» No hay escena de docente ni respuesta cerrada: cada persona elige una inclinación, suelta la pelota y mira cómo baja.

**Sin grados ni tiempos.** La mesa no muestra grados, segundos ni cronómetro: cuánto demoró la pelota en caer es la pregunta que las personas se hacen y conversan. Hay **seis inclinaciones** que se eligen por su nombre (`angleLabels`): «La menos empinada», «Poco empinada», «Algo empinada», «Bastante empinada», «Muy empinada» y «La más empinada».

Misma pelota, superficie y longitud. Internamente: **20°–45°**, paso de **5°** (seis inclinaciones), diferencia mínima para comparar **5°**. Cada prueba dura aproximadamente **2–3 segundos de animación activa**. Mientras la pelota rueda se bloquean la nueva suelta y el cambio de inclinación **de esa persona**; las demás siguen a su ritmo.

**Modelo compartido propuesto:** esfera homogénea ideal rodando sin deslizar, sin pérdidas disipativas. `a = (5/7) × 9.81 × sin(θ)`; recorrido `L = 2 m`; duración visual `T = 2.4 × sqrt(2L/a)`. Da aproximadamente 3.10 s a 20° y 2.16 s a 45°. La posición sobre la rampa usa `s/L = min(1, (t/T)²)`.

El factor 2.4 se aplica a todas las pruebas. El tiempo es el de esa **simulación visual** (no se muestra); el movimiento que se observa le corresponde. El cálculo se implementa una sola vez en el dominio TypeScript, con grados convertidos a radianes.

El servidor asigna `trialId`, calcula duración y congela parámetros. El cliente no decide cuándo una prueba terminó ni envía su resultado: **el servidor la termina en su instante exacto** (inicio + duración). Una pausa conserva el tiempo transcurrido; el tiempo de conversación no se suma. Varias personas pueden tener pruebas en marcha a la vez. «Conversemos» cancela las que sigan rodando.

Cada resultado conserva inclinación, condiciones, tiempo y modelo usado, pero solo el servidor los conoce. En la conversación la proyección muestra la pregunta y la respuesta sale del grupo.

Pregunta de conversación (de la guía): «¿Qué observaron y qué resultado apoya su explicación? ¿Alguien quiere añadir algo a lo que dijo su compañero?». En el celular, la mesa sigue invitando a preguntarse cuánto demora la pelota en caer. Frase de Freire: «Para Freire, dialogar incluye preguntar y escuchar las explicaciones con una actitud curiosa.»

Guía de Vanessa (el PDF): antes, escuchar dos predicciones y preguntar cómo comprobarlas; después, apoyar la explicación en lo que vieron (qué cambiaron y qué se mantuvo igual) y conservar como pregunta lo que el juego no permite probar.

### 3.4. El observatorio

Reemplaza a «La caja de las sorpresas» (propuesta «Mesa 3 · El observatorio»). Conserva el identificador `cajas`, el tercer lugar del recorrido y la pieza Corazón. Idea central: la curiosidad puede llevarnos a descubrir el mundo con una herramienta, pero no nos da derecho a invadir ni exponer la intimidad de otras personas. La lección **no se anuncia antes**: aparece al encontrarse con un límite y se conversa después.

Pregunta de la mesa (se proyecta al abrirla): «Tenemos un telescopio para mirar el cielo. Exploren la Luna y las estrellas: ¿qué detalles aparecen cuando acercan la vista?». Objetivo en el celular: «Mueve el visor y cambia el aumento: observa la Luna con aumento y un grupo de estrellas.» No se menciona la casa.

**Escena.** En el mapa, un telescopio sobre trípode ocupa la tercera estación. Al abrir la mesa, cada persona mira por **su propio visor** un panorama nocturno 2D ilustrado (no un cielo astronómico real): la Luna, un grupo de estrellas, una **galaxia** en espiral (arriba a la derecha, más allá de las estrellas), tejados y, en una casa del horizonte, una ventana iluminada con **dos siluetas que discuten con gestos**. No hay audio ni texto de esa conversación, ni pistas, puntos o recompensas en la casa.

**Controles.** Arrastrar dentro del visor; flechas para mirar arriba, abajo, a la izquierda y a la derecha; dos aumentos (general y cercano); y «Volver al mapa» (al quedar lista). **No hay atajos** (15 de octubre de 2026: se retiraron «Luna», «Estrellas», «Horizonte» y «Volver al cielo»): cada persona encuentra las cosas moviendo el telescopio con libertad. Las flechas y los aumentos recorren todo el panorama. La pantalla **no describe** lo que se ve: cada persona hace sus propias observaciones mirando el visor. Solo quien usa lector de pantalla recibe la descripción («La Luna de cerca: zonas claras y oscuras…», «Ventana iluminada; dos siluetas gesticulan como si discutieran», «Una persona cierra la cortina»), anunciada cuando la vista queda quieta. Los controles alternativos permiten completar toda la exploración.

**Observaciones.** Mover el visor es local (la escena lo dibuja al instante). Cuando la vista queda quieta con algo nuevo centrado durante la pausa de observación (`dwellMs`, 0,8 s) se envía `telescope.aim` y el **servidor** decide qué quedó centrado con la geometría compartida (`shared/domain/telescope.ts`): la Luna exige el aumento cercano; el grupo de estrellas, cualquiera. La **galaxia** se registra al centrarla con el aumento cercano como un **hallazgo**: no se pide para quedar lista ni se anuncia (en la lista aparece «✓ Galaxia observada» solo si alguien la encuentra), y queda en el cuaderno. Sin observación nueva, la vista quieta se guarda a los 2 s para reabrir la mesa en el mismo lugar.

**La casa.** Centrar la ventana con el aumento cercano (≈ 1 s, `curtainDelayMs`) hace que una silueta se gire y **cierre la cortina** (≈ 1 s, `curtainCloseMs`). Ocurre **una sola vez por persona**: la cortina queda cerrada al alejarse, cerrar el panel o reconectar; solo reiniciar la sala la abre. La cortina de una persona no cierra la casa de las demás. Con reducción de movimiento, los gestos y el cierre se simplifican sin perder su significado. La pausa congela gestos y temporizadores.

**Consola y proyección.** La consola muestra el avance de exploración («N de M listos» y «✓ Todas las personas están listas»), nunca quién miró la casa; la dirección del visor de las personas no se transmite a la proyección y no se proyecta la exploración de nadie. En la conversación, **«Mostrar la frase de Freire»** proyecta a la vez la frase y la casa: la ventana de cerca con las siluetas discutiendo y, a los pocos segundos, el cierre de la cortina (15 de octubre de 2026: se retiraron «Mostrar la casa» y «Volver al laboratorio»). Es una demostración con su propio estado, local a la consola, que no cuenta para nadie ni se puede explorar; se queda en la proyección hasta «Pasar al inventor» y, si la consola se recarga con la frase ya mostrada, vuelve a empezar.

Pregunta de conversación: primero, «¿Qué descubrieron en el cielo al acercar la vista?»; al mostrar la frase de Freire (y la casa) pasa a ser la de la guía, «¿Qué nos hizo entender el gesto de cerrar la cortina? ¿Qué podíamos seguir investigando con el telescopio?» (`freireQuestion`): así no se adelanta a la demostración. Frase de Freire: «Freire nos recuerda que la curiosidad no nos da derecho a invadir la privacidad de alguien ni a exponerla ante los demás.» Al quedar lista: «Ya observaste la Luna y un grupo de estrellas. Puedes seguir explorando mientras termina el grupo.»

Guía de Vanessa: antes, invitar a explorar sin anunciar la casa; después, preguntar qué detalles encontraron, mostrar la casa con su demostración y pensar el límite («¿Poder ver algo significa que tenemos derecho a observarlo de cerca?», «¿Necesitábamos conocer esa conversación para seguir descubriendo cosas?»). No pedir que identifiquen quién miró la casa, ni que compartan experiencias familiares, ni adivinar el motivo de la discusión. Cerrar con «¿Qué otra pregunta podríamos investigar con esta herramienta?». El mensaje del inventor, «Investigar con respeto», aparece al incorporarse la pieza, no como instrucción inicial.

### 3.5. Inventor, pregunta final y reinicios

Con las tres piezas incorporadas (una por ronda terminada), el inventor se enciende con sus tres mensajes:

| Pieza | Mensaje |
| --- | --- |
| Lupa | Observar y comparar. |
| Diálogo | Preguntar y escuchar. |
| Corazón | Investigar con respeto. |

**El inventor es una mesa más** *(15 de octubre de 2026)*. «Pasar al inventor» devuelve a todas las personas al mapa: caminan hasta la máquina (que late suavemente para señalar a dónde ir); tocarla antes de tiempo explica «Vanessa abrirá el inventor en un momento». Cuando el grupo está ahí, Vanessa pulsa **«Abrir inventor»** (`inventor.open`): la proyección pasa a la máquina —las piezas viajan a sus espacios— y cada persona entra tocando la máquina (camina y entra al llegar; el servidor valida la cercanía) o con «Ir al inventor» del menú «Mesas» (equivalente accesible). Una sala guardada antes de este paso tiene el inventor cerrado.

**La pregunta de cada persona.** Dentro del inventor, el celular muestra la pregunta de Vanessa («¿Qué pregunta nos gustaría seguir investigando como grupo?») y una lista de **preguntas sugeridas por mesa** (`inventor.questions`, contenido editable):

| Mesa | Preguntas sugeridas |
| --- | --- |
| Sombras | «¿Qué le pasa a la sombra si acercamos el objeto a la linterna, en lugar de mover la linterna?» · «¿Por qué nuestra sombra en el patio cambia de tamaño durante el día?» |
| Rampas | «¿Todos los objetos tardan lo mismo en bajar por la misma rampa?» · «Si la pelota fuera más pesada, ¿bajaría más rápido por la rampa?» |
| El observatorio | «¿Cómo hace un telescopio para que veamos más cerca lo que está lejos?» · «¿Qué tan lejos de nosotros están la Luna, las estrellas y las galaxias?» |

Cada persona elige una o escribe la suya (hasta 280 caracteres) y la **registra** (`inventor.question`); puede cambiarla mientras el inventor siga abierto, y recién con su pregunta registrada aparece «Volver al mapa». La pregunta vive en su **estado personal**: nunca llega a las demás personas ni al estado de grupo. Vanessa la recibe en la presencia y la ve en el panel **«Preguntas del inventor (N de M)»** —que aparece al abrir el inventor, cerrado— con las escritas por las personas (las iguales se reúnen, con sus nombres) y las sugeridas de cada mesa con quiénes las eligieron; la lista de participantes dice quién ya registró la suya. Registrarla es opcional: la guía recuerda que no hace falta que cada persona escriba una.

**Vanessa elige la pregunta final** entre las de las personas, las sugeridas, las que el grupo guardó en el cuaderno, o escribe otra. Antes de imprimirla en el inventor se le muestra para que la **confirme**; después puede **corregir** un error de escritura (se conserva la versión anterior). La pregunta final solo se confirma con el inventor abierto. No hay generación de respuestas con IA.

Confirmar la pregunta final cambia la fase a `finished`: todas las pantallas ven la máquina con la tarjeta impresa y la proyección muestra «Nuestro inventor está completo y todavía tenemos preguntas.», la reflexión y la invitación final «Para seguir pensando: ¿Cómo ayudaríamos a un niño a pasar de “me da curiosidad” a “quiero comprenderlo”?». La administradora aún puede pausar, cerrar o reiniciar. En `finished` los celulares dicen «Terminamos la aventura. Puedes revisar tus resultados.» (a la observadora, «Terminamos la aventura.») y el cuaderno sigue disponible. Quien quedó dentro del inventor ve la tarjeta impresa y puede **volver al mapa** («Volver al mapa») y volver a entrar a mirarla («Mesas → Ir al inventor»); son las únicas acciones que se aceptan con la aventura terminada (el reloj está detenido: no se camina). La proyección y quien observa siguen viendo la máquina. Confirmar la pregunta final conserva el inventor abierto. No se vuelve a conceder una pieza ni se borra la pregunta final.

**Reiniciar sala** borra el avance —también las preguntas registradas y el inventor abierto— y requiere confirmación de Vanessa.

Reflexión proyectada (de la guía): al probar y conversar pudimos mirar mejor lo que ocurría, reconocer dudas y buscar razones; enseñar exige curiosidad de los niños y también de nosotros como docentes; querer conocer algo no nos da derecho a invadir la privacidad de otra persona: podemos aceptar un límite y buscar otras preguntas.

<a id="spec-4"></a>

## 4. Modelo compartido y fuentes de verdad

### 4.1. Entidades

El estado se separa en **tres capas**: la sala y la ronda (solo las modifica Vanessa), cada participante (solo lo modifica esa persona) . Nada de la capa personal se envía a las demás personas.

| Entidad | Datos mínimos |
| --- | --- |
| Sala | `roomId`, código público, versión de configuración, fase, generación, versión de ronda, versión de estado, fechas y vencimiento. |
| Identidad | `principalId`, papel, nombre, color, número de distinción y si **observa**. Credencial privada almacenada como hash en servidor. |
| Presencia | Conexión vigente, `connectionEpoch` y estado conectado/desconectado. Se reconstruye al arrancar. |
| Ronda | Índice de mesa, fase (`preparation`, `exploration`, `conversation`, `closing`), lista de la ronda, personas incluidas después, pendientes al conversar y si ya se mostró la frase de Freire. |
| Aventura (grupo) | Mapa, ronda, mesas terminadas, piezas derivadas, notas del grupo, pregunta final y reloj. |
| Participante | Personaje (pies, orientación, plan de movimiento), vista (`map` o una mesa) y sus resultados por mesa. Una entrada por quien juega; **quien observa no tiene**. |
| Nota del grupo | `kind` (`initialIdea`, `synthesis`, `question`, `finalQuestion`), mesa, texto, revisión, historial y marcas del servidor. Una nota `comparison` de una sala anterior no se muestra. |
| Prueba de rampa | `trialId`, inclinación, condiciones congeladas, duración, instante de inicio, estado (`running`, `finished`, `cancelled`) e instante de fin. |
| Comando procesado | Identificador, identidad, generación, huella del payload y respuesta definitiva. |

Tipos orientativos; generar o contrastar los tipos finales con los esquemas (`shared/contracts/state.ts`):

~~~ts
type RoomPhase =
  | "welcome" | "running" | "paused"
  | "finished" | "closed" | "expired";

type RoundStage = "preparation" | "exploration" | "conversation" | "closing";

interface RoundState {
  index: number;               // posición en `route`; route.length = cierre
  stage: RoundStage;
  roster: string[];            // se fija al abrir la exploración
  included: string[];          // quienes Vanessa incluyó después
  pendingAtConversation: string[];
  freireShown: boolean;
}

interface ParticipantState {
  character: PlayerState;      // pies, orientación y plan de movimiento
  view: { kind: "map" } | { kind: "activity"; activityId: string };
  activities: Record<string, ShadowsState | RampsState | TelescopeState>;
}

interface RoomState {
  roomId: string;
  code: string;
  contentSetId: string;
  configRevision: string;
  configHash: string;
  mapHash: string;
  roomGeneration: number;
  stateVersion: number;
  roundVersion: number;
  phase: RoomPhase;
  resumePhase: "running" | "finished" | null;
  adventure: AdventureState;                    // capa de grupo
  participants: Record<string, ParticipantState>; // capa personal
}
~~~

`AdventureState` (grupo) contiene:

- `mapId` y `round` (`RoundState`).
- `completed`: mesas cuya ronda terminó con «Abrir siguiente mesa»; `pieces` se **deriva** de ellas.
- `notebook`: notas del grupo, con revisiones e historial.
- `inventor`: si Vanessa ya lo abrió (`open`) y el ID de la pregunta final.

`ParticipantState` (personal) contiene el personaje, la vista (`map`, la mesa abierta o `inventor`), las pruebas de cada mesa y, en el cierre, la pregunta que registró en el inventor (`question`: `presetId` de la sugerida o `null` si la escribió, el texto y su instante).
- `timeline`: tiempo activo acumulado y `counters` para IDs deterministas (notas, pruebas, planes).

Los estados de actividad son uniones discriminadas por `type`: Sombras guarda las posiciones (`distanceCm`, `shadowCm`, si cuenta y su instante); Rampas, las pruebas; El observatorio, la vista del visor (`x`, `y`, `zoom`), las observaciones (`observed`: `moon`, `stars`, sin duplicados) y la cortina de la ventana (`curtain`: `open` o `closed`). No se guarda un historial de movimientos ni cuánto tiempo se miró la casa. Evitar un diccionario arbitrario de variables de juego.

### 4.2. Versiones e invariantes

| Campo | Uso |
| --- | --- |
| `schemaVersion` | Versión del contrato de configuración. |
| `contentSetId` | Identifica esta exposición; no reutilizar el ID de Bitácora Amorcito. |
| `configRevision` | Edición del contenido, sin borrar progreso automáticamente. |
| `configHash / mapHash` | Comprobar que cliente y servidor usan los mismos datos. |
| `roomGeneration` | Distinguir recorridos antes/después de un reinicio de avance. |
| `roundVersion` | Sube con cada cambio de ronda (abrir, conversar, avanzar, reiniciar, pausar, recuperar): una acción personal de una ronda cerrada llega con la versión anterior y se rechaza (`STALE_ROUND`). |
| `stateVersion` | Ordenar transiciones confirmadas y snapshots. |
| `connectionEpoch` | Rechazar una pestaña sustituida. |
| `seq` del reloj | Ordenar las muestras de reloj entre transiciones; no equivale a una respuesta confirmada. |

Invariantes:

1. Cada acción personal se aplica **solo** al estado de quien la envía; las pruebas de una persona no las modifica nadie más.
2. Solo la administradora conduce la ronda; ninguna acción de participante abre, reúne ni avanza una ronda.
3. La lista de la ronda se fija al abrir la mesa y una desconexión no la reduce.
4. «Listo para conversar» se deduce de resultados ya registrados y es monótono: seguir probando no lo quita.
5. El conjunto de piezas se deriva del dominio (`completed`), no del payload del cliente, y una pieza se incorpora una sola vez, al abrir la siguiente mesa.
6. Un resultado confirmado queda guardado antes de anunciarse como aceptado.
7. El reloj de simulación avanza únicamente mientras la sala está en curso.
8. Los borradores, sprites, sockets y credenciales nunca forman parte del estado público; el estado personal de una persona nunca se envía a otra.
9. Un mapa o contenido nuevo no modifica a mitad de exposición una sala iniciada.

<a id="spec-5"></a>

## 5. Identidad, API y sincronización

### 5.1. Alta y recuperación

Usar HTTP para obtener credenciales y Socket.IO para la sesión autenticada. Esto concreta la propuesta `room.create / room.join` del PRD; esos nombres no son una API ya existente.

| Endpoint propuesto | Solicitud | Respuesta |
| --- | --- | --- |
| `POST /api/rooms` | `contentSetId` permitido. | Sala, código, enlace público, `adminId` y credencial privada de administradora. |
| `POST /api/rooms/:code/join` | Nombre y color válidos; `observer` opcional. | Identidad participante, nombre distinguido, si observa y credencial propia. |
| `GET /api/rooms/:code` | Sin credencial. | Código, fase y título públicos; la pantalla de entrada confirma que la sala existe y sigue disponible sin entrar. *(Añadido al implementar la fase 2.)* |
| `GET /api/health` | Sin datos de sala. | Disponibilidad básica del servicio. |

La creación de sala no exige cuenta en la primera versión. Emitir tokens opacos aleatorios de al menos 32 bytes; verificar por hash. Al reconectar, enviar la credencial en el `auth` de Socket.IO, sin query string. El servidor resuelve sala, identidad y papel: no confiar en un `role` ni en un `observer` enviado por el navegador después de entrar.

Conservar la credencial en almacenamiento local con claves propias por proyecto y sala. Usar HTTPS, permitir solo el origen del frontend y no registrar tokens ni incluirlos en logs, QR, capturas o snapshots. Escapar textos con React; no renderizar contenido del público mediante HTML arbitrario.

Limitar creación/entrada, tamaño de mensajes y frecuencia de acciones (por participante: ráfaga de 20 y 8 por segundo). Color debe pertenecer a la paleta; nombre, código y texto se validan en servidor. El código de entrada permite unirse, no recuperar administración.

Quien juega se da de alta con su personaje en la entrada al conectarse por primera vez; quien observa no se da de alta. La nueva conexión de una identidad sustituye a la anterior y aumenta `connectionEpoch`: la participante conserva su personaje y su estado, y la pestaña vieja queda desactivada. Ignorar la desconexión posterior del socket viejo. Una administradora que sustituye su conexión recupera administración, con la aventura pausada.

### 5.2. Sobres de comandos

~~~ts
interface ParticipantCommand {
  requestId: string;
  roomGeneration: number;
  roundVersion: number;      // la ronda que la persona ve
  connectionEpoch: number;
  action: ParticipantAction;
}

interface AdminCommand {
  requestId: string;
  roomGeneration: number;
  connectionEpoch: number;
  commandSeq: number;
  action: AdminAction;
}
~~~

La identidad y la sala proceden de la conexión autenticada. `requestId` es único por comando, por ejemplo UUID. `commandSeq` aumenta en la conexión administrativa vigente; serializar las acciones de Vanessa para que una vieja no reemplace otra posterior.

`ParticipantAction` es una unión tipada. Catálogo (cada acción se aplica solo al estado de quien la envía):

| Acción | Payload y validación de dominio |
| --- | --- |
| `player.moveTo` | Destino de mundo; mapa, camino y fase (preparación, exploración o cierre). |
| `station.open` | ID y origen `map` o `quickNav`; solo la mesa de la ronda, en exploración; proximidad cuando se usa el mapa. Con `inventor`: en el cierre, con el inventor abierto (proximidad a la máquina desde el mapa). |
| `adventure.returnToMap` | Cerrar la mesa; conservar sus resultados. |
| `shadows.sample` | Distancia dentro de rango; registra la posición y su sombra. |
| `ramps.trial.start` | Inclinación válida; ninguna prueba propia en marcha. Sin resultado del cliente. |
| `inventor.question` | `{ kind: "preset", presetId }` o `{ kind: "written", text }`; con el inventor abierto y la persona dentro. Reemplaza la anterior; la misma pregunta no cambia nada. |
| `telescope.aim` | Vista quieta del visor (`x`, `y` en unidades del panorama; `zoom`, índice entero del aumento). El servidor la limita al panorama y decide qué quedó centrado: registra la Luna o las estrellas y, si es la ventana de cerca, cierra la cortina una vez. El cliente no declara observaciones. |

No existen acciones libres como `setState`, `grantPiece`, `setResult`, «observar la casa», «mesa completada» ni «marcar listo».

`AdminAction` agrupa:

| Acción | Efecto |
| --- | --- |
| `room.start`, `room.pause`, `room.resume` | Ciclo de la sala (2.3). |
| `room.reset` (`confirm`), `room.close` (`confirm`) | Reiniciar avance y cerrar. |
| `round.open` | Preparación → exploración; fija la lista de la ronda. |
| `round.converse` (`withPending?`) | Exploración → conversación; con pendientes exige `withPending`. |
| `round.showFreire` | Muestra la frase de Freire de la mesa en la proyección. |
| `round.next` | Conversación → siguiente mesa o cierre; incorpora la pieza. |
| `round.include` | Incluye en la ronda a quien llegó después. |
| `inventor.open` | En el cierre: abre el inventor para que las personas entren y registren su pregunta. |
| `note.save`, `note.edit` | Guardar o corregir una nota del grupo (`initialIdea`, `synthesis`, `question`). |
| `final.confirm`, `final.correct` | Confirmar la pregunta final (un texto —escrito por Vanessa o tomado de las personas o de las sugeridas— o una guardada), solo con el inventor abierto, y corregirla después. |

### 5.3. Eventos del transporte

| Evento propuesto | Dirección | Contenido |
| --- | --- | --- |
| `admin.command` | Administradora → servidor | Sobre y acción de moderación y conducción. |
| `participant.action` | Participante → servidor | Sobre y acción personal. |
| `room.sync` | Cliente → servidor | Solicitar estado permitido para su papel. |
| `room.summary` | Servidor → todos | Fase, versiones, `configMismatch` y estado propio (incluye si observa); sin cuaderno ni credenciales. |
| `group.state` | Servidor → todos | Estado de grupo: ronda, piezas, notas del grupo, pregunta final y efectos de la transición. |
| `me.state` | Servidor → su dueña | Su personaje, su vista y sus resultados. **Nunca** a otra persona. |
| `characters.state` / `character.updated` | Servidor → todos | Posición pública (plan de movimiento, nombre, color, conexión) de cada personaje. |
| `presence.updated` | Servidor → administradora | Listado necesario para conducir y el contador de la ronda `{ready, total}`, con el avance de cada persona. |
| `clock.sample` | Servidor → todos | Reloj de simulación (`activeMs`, `running`, `seq`), mientras algo se mueve o cambia la fase. |
| `session.replaced` | Servidor → socket sustituido | Deshabilitar esa pestaña. |

Responder cada comando mediante acknowledgment de Socket.IO:

~~~ts
type CommandResult =
  | { ok: true; requestId: string; stateVersion: number; roundVersion: number }
  | { ok: false; requestId: string; code: string; message: string };
~~~

Errores estables: `NOT_AUTHORIZED`, `STALE_CONNECTION`, `STALE_ROUND`, `STALE_GENERATION`, `ROOM_PAUSED`, `INVALID_STEP`, `INVALID_PAYLOAD`, `ROOM_UNAVAILABLE`, `REVISION_CONFLICT`, `CONFIG_MISMATCH`, `RATE_LIMITED` y `PERSISTENCE_FAILED`.

Una denegación desbloquea el botón pendiente y muestra una razón comprensible; no concede piezas ni modifica progreso. Si el servidor no responde tras los reintentos, el cliente avisa «El servidor no respondió. Revisa tu conexión.» y libera el botón.

### 5.4. Procesamiento e idempotencia

Cada sala tiene una cola serial de mutaciones. Cada comando que recibe confirmación de éxito sigue este flujo:

1. Verificar conexión vigente y credencial.
2. Detectar un `requestId` procesado para esa identidad y generación; si coincide su huella, devolver la respuesta guardada sin repetir la mutación.
3. Rechazar reutilización del ID con otro payload.
4. Verificar generación, ronda (`roundVersion` en acciones personales), papel, fase, rangos y referencias.
5. Calcular la transición mediante dominio puro.
6. Guardar estado y respuesta del comando en la misma transacción.
7. Actualizar memoria y emitir estado/acknowledgment después del commit.

Si la persistencia falla, no anunciar éxito; bloquear la continuación con mensaje de recuperación. Un cliente no puede escribir directamente en SQLite ni autorizarse cambiando variables del navegador.

Socket.IO no garantiza por sí solo persistencia ni entrega de cada evento. [T4] Si un acknowledgment se pierde, el cliente puede consultar sincronización o reintentar **el mismo comando discreto con el mismo ID**, únicamente mientras siga conectado y con permisos vigentes.

No activar una reproducción automática de entradas acumuladas tras reconectar. Antes de `emit` comprobar conexión y permisos. Al perder conexión, cancelar gestos y pendientes. Al volver, pedir el estado, verificar permiso y habilitar controles desde el estado actual.

### 5.5. Separación de canales y fan-out por audiencia

Usar agrupaciones de Socket.IO controladas por servidor y enviar a cada audiencia solo lo suyo:

| Audiencia | Recibe |
| --- | --- |
| Todas las pantallas | Resumen, estado de grupo, posiciones públicas de los personajes y reloj. |
| Cada participante, además | **Su** estado personal (`me.state`) y ninguno ajeno. |
| Administradora, además | Presencia y contador de la ronda. Ningún estado personal. |
| Observadora | Lo común; sin estado personal ni presencia. |

Al cambiar la ronda se anuncia el nuevo estado de grupo a todas las pantallas; los cambios personales (un resultado registrado, una prueba que termina) solo se envían a su dueña, que además recibe una muestra de reloj para que su animación coincida con la del servidor. Una conversación o un cierre no desmontan el juego de nadie: el cliente cambia de escena dentro del mismo `Phaser.Game`.

### 5.6. Movimiento, reloj y simulaciones

El servidor calcula un camino transitable desde el estado de cada personaje y emite un **plan de movimiento**: ID, puntos en coordenadas de pies, velocidad y tiempo activo. Cada pantalla interpola ese mismo plan para cada personaje; no se envían posiciones a 60 FPS. El servidor conserva el último plan aunque el personaje ya haya llegado: la posición se deduce del plan y del reloj.

Usar una cuadrícula de navegación derivada del TMJ, obstáculos ampliados por la huella del personaje y búsqueda de caminos pura. Los personajes no se bloquean entre sí. No ejecutar Phaser, DOM ni una física de navegador en Node para decidir posiciones. Los personajes aparecen alrededor de la entrada, en anillos, descartando los puntos que chocan con el escenario.

Para rampas, el servidor crea cada prueba con su duración y la **termina en su instante exacto**; el cliente solo representa. Una pausa congela el reloj. Varias pruebas de varias personas pueden estar en marcha a la vez.

**Reloj.** Muestras del servidor cada **500 ms** (`CLOCK_SAMPLE_MS`) mientras algo se mueve o ruede, y al cambiar de fase; cada cliente interpola entre muestras con un reloj local (`ClientClock`) que absorbe la deriva y nunca decide un resultado. Los arrastres de la linterna y de la inclinación **no se envían**: son locales y solo el resultado terminado viaja al servidor (la posición de la linterna se registra poco después de terminar el ajuste). Renderizar desde `Scene.update(time, delta)`.

Ordenar las muestras por generación y secuencia; descartar las de un recorrido anterior o repetidas. Los estados siempre permiten reconstruir lo ocurrido sin haber recibido todas las muestras.

No usar una física Arcade independiente en cada cliente para simular la rampa. Tampoco decidir colisiones autoritarias a partir de la posición enviada por un teléfono. La trayectoria compartida procede del dominio.

<a id="spec-6"></a>

## 6. Persistencia y desconexiones

### 6.1. SQLite y durabilidad

Usar un repositorio pequeño sobre SQLite, transacciones y disco persistente. Guardar el estado JSON validado de sala (incluye a los participantes); no construir event sourcing para la primera versión.

Tablas mínimas: `rooms`, `principals` (con su marca de observadora) y `processed_commands`. La primera almacena el estado, versiones y ciclo de vida; la segunda hashes de credenciales e identidades; la tercera respuestas idempotentes. No guardar sockets como si fueran conexiones recuperables. La versión del esquema es la **2**; una base del modelo anterior (turnos) se respalda como `.v1.bak` y sus salas se conservan sin cargarse.

Guardar cada transición confirmada antes del acknowledgment: resultados registrados, pruebas creadas/terminadas, rondas, notas, piezas, pausa, cierre y reinicio. Para empezar es aceptable guardar cada acción aceptada a la frecuencia limitada. Una muestra de reloj no es un comando confirmado ni requiere una fila nueva en el registro de comandos. El estado de una sala de 50 personas es un solo JSON; el ensayo de capacidad (11.2) mide si hace falta separarlo.

Durante movimiento o prueba guardar un checkpoint de reloj aproximadamente cada **500 ms**, además de hacerlo al pausar, cambiar de ronda o completar. Después de una caída abrupta se recupera el último checkpoint; documentar que la animación puede retroceder hasta ese intervalo. Las respuestas y resultados ya confirmados no se pierden.

El reloj usa tiempo monotónico durante el proceso. Un reinicio no suma el tiempo que el servidor estuvo apagado. Recuperar salas en curso como **pausadas**, aumentar `roundVersion` y reconstruir presencia como desconectada. **La lista de la ronda, el contador, las pruebas en marcha y la vista de cada persona se conservan.** Vanessa debe recuperar administración y elegir cuándo reanudar.

Si la configuración guardada no coincide con la disponible, conservar datos y mostrar `CONFIG_MISMATCH`; no borrar el cuaderno ni migrarlo silenciosamente. Preparar despliegues entre sesiones o conservar el paquete de configuración compatible.

### 6.2. Reconexión y pestañas

| Situación | Comportamiento |
| --- | --- |
| Una persona pierde conexión | Su personaje se ve pálido y «sin conexión»; la ronda **no** cambia: el total del contador no baja y su trabajo se conserva. Los demás siguen. |
| Esa persona regresa | Misma identidad, mismo personaje, misma mesa y sus mismos resultados; sigue la fase de la ronda. |
| Observadora pierde conexión | Solo cambia su presencia. |
| Vanessa pierde conexión | Al detectarlo: pausar para todas las personas. No entregar administración a otro usuario. |
| Vanessa recarga o vuelve | Autenticar credencial, recuperar la conducción con la sala pausada, la ronda y el contador intactos. |
| Dos pestañas con una identidad | Nueva conexión sustituye anterior; solo el epoch vigente puede actuar. |
| Se reinicia el servicio | Recuperar datos durables y sala pausada, con la ronda y los resultados de todas las personas. |
| Sala cerrada/vencida | Detener reconexión operativa y mostrar estado terminal. |

Configurar heartbeat para verificar el objetivo de detectar cortes en **10 s o menos**. Como punto de partida, `pingInterval: 4000` y `pingTimeout: 5000`; medir falsos cortes en celulares. Los valores por defecto de Socket.IO no cumplen ese objetivo sin ajuste. [T6]

No depender de la recuperación automática de Socket.IO. Pedir el estado y validar credenciales/permisos siempre; la recuperación de conexión es una optimización posterior. [T5]

### 6.3. Vida y aislamiento de sala

Vencimiento inicial: **2 horas sin actividad de la administradora**, configurable en servidor. Una administradora conectada envía una señal de actividad autenticada periódica; no medir únicamente clics de moderación ni permitir que participantes mantengan viva una sala abandonada.

Una sala terminal no admite entradas o acciones. Propuesta inicial de limpieza: eliminar datos de sala, identidades y comandos dentro de las siguientes **24 horas**; plazo operativo configurable. Esa retención es una decisión de implementación, no un requisito pedagógico adicional.

Una credencial está ligada a una sola sala. Probar que códigos y IDs de otra sala no permiten suscribir ni modificar sus datos.

*(Añadido al implementar la fase 6.)* Un barrido del servidor (`SWEEP_INTERVAL_MS`, 30 s) vence las salas cuya administradora lleva más de `ADMIN_IDLE_TTL_MS` sin comandos ni señal periódica, y elimina en cascada (sala, identidades y comandos procesados) las salas terminales pasadas `TERMINAL_RETENTION_MS`. El plazo se calcula con la hora guardada, de modo que un reinicio no «perdona» el tiempo con el servicio apagado.

### 6.4. Sin demostración local

*(Retirada el 15 de octubre de 2026.)* Ya no existe la demostración de respaldo (`/demo`, `DemoController`, «Dejar listo el respaldo» ni el aviso para usarla si la conexión no vuelve). Si el servidor falla, la consola dice «Reconectando con la sala…»; al volver el servicio, la sala sigue pausada con lo confirmado (6.1–6.3) y Vanessa decide cuándo reanudar.

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
| React | Sala, conducción de la ronda, panel y controles de cada mesa, preguntas del inventor, notas del grupo, cuaderno y accesibilidad. |
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
  React["React: sala y controles"] --> Controller["Controller: intenciones y estados"]
  Phaser["Phaser: mapa y experimentos"] --> Bridge["GameBridge"]
  Bridge --> Controller
  Controller --> Bridge
  Bridge --> Phaser
  Controller --> Transport["Socket.IO"]
  Transport --> Server["RoomService: permisos y reloj"]
  Server --> Domain["Dominio TypeScript compartido"]
  Server --> DB["RoomRepository: SQLite"]
~~~

No hay dos implementaciones distintas de las reglas: el servidor aplica el dominio de `shared/` y el cliente lo usa solo para mostrar.

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
| `shared/domain/` | Funciones puras: sala (`room`), conducción de la ronda (`round`), acciones y resultados personales (`participant`, `results`), transiciones comunes (`change`), modelos de sombra y rampa, movimiento y navegación. |
| `shared/contracts/` | Eventos, acciones, estados y esquemas de mensajes. |
| `shared/config/` | Validación Ajv, referencias cruzadas y lectura semántica del TMJ. |
| `src/app/` | `RoomController`, puente con Phaser, enrutador de intenciones del mapa, audio y navegación de vistas. |
| `src/network/` | Adaptador Socket.IO, autenticación, sincronización y reloj cliente. |
| `src/config/` | Carga y AssetRegistry adaptado. |
| `src/components/room/` | Bienvenida, vista de quien juega y de quien observa, consola de Vanessa, lista de participantes, barra del mapa. |
| `src/components/admin/` | Conducción de la ronda: pasos, proyección, notas del grupo y preguntas del inventor (pregunta final). |
| `src/components/inventor/` | El inventor en el celular: preguntas sugeridas por mesa y la pregunta de cada persona. |
| `src/components/activities/` | Panel personal y controles HTML de cada mesa (sin formularios de respuesta). |
| `src/components/ui/` | Paneles, botones y confirmaciones. |
| `src/components/notebook/` | Cuaderno de solo lectura (mis resultados y notas del grupo) y bandeja de piezas. |
| `src/game/bridge/` | Puente tipado por host. |
| `src/game/scenes/` | LaboratoryScene, una escena por mesa, la del inventor y el director que cambia entre ellas dentro del mismo juego. |
| `src/game/entities/` | Personajes de las personas (silueta coloreada con su nombre). |
| `src/game/tiled/` | Factories de objetos y composición visual desde TMJ. |
| `server/src/` | HTTP, Socket.IO, RoomService, reloj y RoomRepository. |
| `server/data/` | SQLite de desarrollo, ignorado por Git; en producción usar volumen externo. |
| `scripts/` | Validación, build y ensayo de carga; sin importador de mapas. |

Separar módulos por responsabilidad cuando haya código real, sin crear decenas de abstracciones vacías. Una sola store/Context de sala es suficiente; no agregar Redux o Zustand si el estado existente no lo requiere.

### 7.4. Despliegue previsto

Primera versión: una instancia persistente que sirve frontend, API y Socket.IO. SQLite necesita volumen que sobreviva a reinicios. El proxy debe admitir conexiones persistentes y la negociación HTTP de Socket.IO.

Durante desarrollo, Vite puede usar proxy para `/api` y `/socket.io`. En producción no depender del servidor de desarrollo.

El frontend de la bitácora está pensado para publicación estática, pero la sala nueva requiere proceso backend. Un despliegue exclusivamente estático no implementa la sala compartida ni la persistencia. La elección de proveedor queda pendiente; documentar requisitos y no publicar por redactar estos archivos.

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

Para probar cambios de mapa crear una nueva sala. En producción publicar configuración, TMJ y assets coherentes; no prometer edición en vivo de sesiones activas.

<a id="spec-9"></a>

## 9. Contrato JSON y catálogo de assets

### 9.1. Qué pertenece a cada archivo

| Dato | Fuente editable única |
| --- | --- |
| Título, asignatura y datos de Vanessa | `laboratorio.json → project`. |
| IDs activos y orden | `laboratorio.json → route`. |
| Tipo de minijuego, preguntas y diálogos | `laboratorio.json → project.entryQuestion / activities / inventor.questions / dialogues`. El guion de Vanessa vive en su guía (PDF), fuera del juego. |
| Parámetros y rangos de experimentos | `laboratorio.json → activities[id].experiment`. |
| Archivo TMJ seleccionado | `laboratorio.json → world.mapPath`. |
| Posiciones, dimensiones y colisiones | TMJ. |
| Archivos gráficos/sonoros, atlas y frames | `assets.json` y definiciones de frame verificadas. |
| Credenciales y parámetros secretos | Servidor/entorno; nunca JSON público. |
| Resultados personales, ronda, notas del grupo y piezas | SQLite/estado de sala. |
| Foco, paneles, volumen y la posición de la linterna o la inclinación mientras se ajustan | Estado local del navegador. |

`world.mapPath` es una referencia al archivo de mapa relativa a la base pública del sitio; por ejemplo `maps/laboratorio.tmj`. Es la única excepción necesaria a las referencias de recursos por `assetId`: el mapa conserva su formato nativo fuera del catálogo gráfico. **No añadir el TMJ a assets.json con hash obligatorio que deba reescribirse en cada guardado.**

Todos los gráficos y audios de la experiencia se referencian por `assetId`. El JSON no guarda posiciones de mesas, tamaño del mundo, índices GID ni rutas duplicadas de PNG.

### 9.2. Estructura de configuración

| Campo | Regla |
| --- | --- |
| `schemaVersion` | Entero; contrato inicial 1. |
| `contentSetId` | ID propio y estable del laboratorio. |
| `configRevision` | Revisión del paquete de contenido. |
| `mode` | `prototype` o `presentation`; la segunda no admite recursos/textos de prueba como finales. |
| `project` | Datos de exposición; duración orientativa; `entryQuestion`, la pregunta de entrada. |
| `world` | mapPath, spawnId inicial, velocidad y huella del personaje. |
| `route` | Array de IDs de actividades existentes, únicos y ordenados. |
| `activities` | Definiciones por ID y tipo `shadows`, `ramps` o `telescope`: título, pieza, objetivo corto, pregunta de la mesa (al abrirla), pregunta de conversación, frase de Freire (y, opcional, la pregunta que la acompaña) y parámetros del experimento. |
| `inventor` | Piezas (etiqueta y mensaje), pregunta del cierre, preguntas sugeridas por mesa (`questions`: `id`, `activityId`, `text`), mensaje final, reflexión y pregunta para seguir pensando. |
| `dialogues` | Textos de personajes por ID. |
| `ui` | Etiquetas (las de fase y estado del celular son obligatorias) y referencias a recursos de panel/botones. |
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
  "configRevision": "2026-10-06-rondas",
  "mode": "prototype",
  "project": {
    "title": "El laboratorio de las cosas cotidianas",
    "subtitle": "Una aventura interactiva sobre la curiosidad",
    "entryQuestion": "¿Recuerdan algo que hayan aprendido porque les dio curiosidad?",
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
      "assetId": "character.vanessa-jerry.stand.poses-v5",
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
      "goal": "Acerca y aleja la linterna y compara la sombra en dos posiciones distintas.",
      "openingQuestion": "¿Qué cambiará si acercamos o alejamos la linterna?",
      "conversationQuestion": "¿Qué cambió cuando movieron la linterna? ¿Qué observación nos ayuda a revisar la primera explicación?",
      "freirePhrase": "Freire propone volver más rigurosa nuestra curiosidad al observar, comparar y buscar razones.",
      "experiment": {
        "sourceDistanceMinCm": 10,
        "sourceDistanceMaxCm": 60,
        "screenDistanceCm": 25,
        "objectHeightCm": 8,
        "minDistinctDistanceCm": 5,
        "requiredSamples": 2
      }
    },
    "rampas": {
      "type": "ramps",
      "title": "Rampas",
      "pieceId": "dialogo",
      "goal": "Elige una inclinación y suelta la pelota; luego cambia la inclinación y repite.",
      "openingQuestion": "¿Qué creen que cambiará si inclinamos más esta rampa? ¿Cómo podríamos comprobarlo?",
      "conversationQuestion": "¿Qué observaron y qué resultado apoya su explicación? ¿Alguien quiere añadir algo a lo que dijo su compañero?",
      "freirePhrase": "Para Freire, dialogar incluye preguntar y escuchar las explicaciones con una actitud curiosa.",
      "experiment": {
        "model": "solid-sphere-ideal-v1",
        "minAngleDeg": 20,
        "maxAngleDeg": 45,
        "angleStepDeg": 5,
        "minDistinctAngleDeg": 5,
        "lengthMeters": 2,
        "visualTimeScale": 2.4,
        "requiredTrials": 2,
        "angleLabels": ["La menos empinada", "Poco empinada", "Algo empinada", "Bastante empinada", "Muy empinada", "La más empinada"]
      }
    },
    "cajas": {
      "type": "telescope",
      "title": "El observatorio",
      "pieceId": "corazon",
      "goal": "Mueve el visor y cambia el aumento: observa la Luna con aumento y un grupo de estrellas.",
      "openingQuestion": "Tenemos un telescopio para mirar el cielo. Exploren la Luna y las estrellas: ¿qué detalles aparecen cuando acercan la vista?",
      "conversationQuestion": "¿Qué descubrieron en el cielo al acercar la vista?",
      "freirePhrase": "Freire nos recuerda que la curiosidad no nos da derecho a invadir la privacidad de alguien ni a exponerla ante los demás.",
      "freireQuestion": "¿Qué nos hizo entender el gesto de cerrar la cortina? ¿Qué podíamos seguir investigando con el telescopio?",
      "readyText": "Ya observaste la Luna y un grupo de estrellas. Puedes seguir explorando mientras termina el grupo.",
      "experiment": {
        "zoomLevels": [1, 3],
        "fieldRadius": 380,
        "centerTolerance": 0.3,
        "dwellMs": 800,
        "curtainDelayMs": 1000,
        "curtainCloseMs": 1000
      }
    }
  },
  "inventor": {
    "activeAssetId": "lab.inventor.on",
    "requiredPieceIds": ["lupa", "dialogo", "corazon"],
    "pieces": [
      { "id": "lupa", "label": "Lupa", "message": "Observar y comparar." },
      { "id": "dialogo", "label": "Diálogo", "message": "Preguntar y escuchar." },
      { "id": "corazon", "label": "Corazón", "message": "Investigar con respeto." }
    ],
    "prompt": "¿Qué pregunta nos gustaría seguir investigando como grupo?",
    "questions": [
      { "id": "sombras-objeto", "activityId": "sombras", "text": "¿Qué le pasa a la sombra si acercamos el objeto a la linterna, en lugar de mover la linterna?" },
      { "id": "rampas-peso", "activityId": "rampas", "text": "Si la pelota fuera más pesada, ¿bajaría más rápido por la rampa?" },
      { "id": "cajas-distancias", "activityId": "cajas", "text": "¿Qué tan lejos de nosotros están la Luna, las estrellas y las galaxias?" }
    ],
    "finalMessage": "Nuestro inventor está completo y todavía tenemos preguntas.",
    "reflection": ["Al probar y conversar pudimos mirar mejor lo que ocurría, reconocer dudas y buscar razones.", "Enseñar exige curiosidad de los niños y también de nosotros como docentes."],
    "closingQuestion": "¿Cómo ayudaríamos a un niño a pasar de «me da curiosidad» a «quiero comprenderlo»?"
  },
  "dialogues": {},
  "ui": {
    "assets": {
      "button": "ui.button.green.default",
      "buttonHover": "ui.button.green.hover",
      "panel": "ui.panel.cream.nine-slice",
      "notebookIcon": "ui.icon.open-book"
    },
    "maxRecordCharacters": 280,
    "labels": {
      "waiting": "Estás en la sala. Sigue la aventura en la proyección",
      "loadingMap": "Cargando el laboratorio…",
      "welcomePhone": "Estás en la sala. Vanessa comenzará la aventura en un momento.",
      "roundPreparationPhone": "Escucha la pregunta de Vanessa. Pronto se abre la mesa.",
      "roundExplorationPhone": "La mesa está abierta: explora a tu ritmo.",
      "roundConversationPhone": "Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.",
      "readyYou": "Ya exploraste esta mesa. Puedes seguir probando mientras termina el grupo.",
      "notReadyYou": "Sigue explorando: cuando termines, aquí aparecerá «Listo».",
      "closingPhone": "Ya pasamos por las tres mesas. Camina hasta el inventor de preguntas: Vanessa lo abrirá en un momento.",
      "inventorOpenPhone": "El inventor está abierto: acércate a la máquina, entra y registra tu pregunta.",
      "finishedPhone": "Terminamos la aventura. Puedes revisar tus resultados.",
      "observerPhone": "Estás como observador. Sigue la aventura en la proyección."
    }
  },
  "audio": {
    "phoneInitiallyMuted": false,
    "events": {
      "shadows.click": "lab.audio.click",
      "piece.earned": "lab.audio.piece",
      "inventor.activated": "lab.audio.inventor",
      "adventure.finished": "lab.audio.finished"
    }
  },
  "session": {
    "maxParticipants": 50,
    "adminIdleTtlMs": 7200000
  }
}
~~~

**Campos de la configuración de rondas.** El esquema real, `shared/config/schemas/laboratorio.schema.json`, es el contrato. Cada actividad define `goal` (objetivo corto del celular), `openingQuestion` (se proyecta al abrir la mesa), `conversationQuestion` (en la conversación) y `freirePhrase` (paráfrasis que Vanessa decide mostrar). `readyText` (opcional) sustituye el texto común de «listo» en esa mesa. Rampas define `angleLabels`: un nombre por inclinación, de la menos a la más empinada (tantos como pasos entre `minAngleDeg` y `maxAngleDeg`; la validación lo comprueba). El observatorio define `experiment` con `zoomLevels` (aumento general y cercano, crecientes), `fieldRadius` (radio visible con el aumento 1, en unidades del panorama de 2400×1200; el visor debe caber), `centerTolerance` (fracción del radio visible que cuenta como «centrado»), `dwellMs` (pausa de observación), `curtainDelayMs` y `curtainCloseMs` (giro y cierre de la cortina). La validación comprueba además que la Luna se pueda centrar con el aumento cercano y las estrellas con el general; la configuración no admite pistas, puntos ni requisitos sobre la ventana. El inventor define `activeAssetId`, `pieces[]` (etiqueta y mensaje), `prompt`, `finalMessage`, `reflection` y `closingQuestion`. `inventor.questions` trae las preguntas sugeridas: IDs únicos, una mesa del recorrido y un texto que cabe en una nota (la validación lo comprueba). `project.entryQuestion` es la pregunta de entrada; `freireQuestion` (opcional, por mesa) reemplaza a la de conversación al mostrar la frase de Freire. Desde el 15 de octubre de 2026 el paquete ya no lleva `facilitatorNotes` ni `supportPhrases`: la guía de Vanessa es un documento aparte y el esquema los rechaza. `ui.labels` debe traer las de `REQUIRED_LABELS` (`waiting`, `loadingMap`, `welcomePhone`, `roundPreparationPhone`, `roundExplorationPhone`, `roundConversationPhone`, `readyYou`, `notReadyYou`, `closingPhone`, `inventorOpenPhone`, `finishedPhone`, `observerPhone`); las de señales de audio (`signal*`) son opcionales y tienen texto de respaldo. Los textos que este documento no fija son **de prototipo** y requieren revisión de Vanessa.

El ejemplo abrevia las preguntas sugeridas del inventor (una por mesa). El contenido completo vive en `public/config/laboratorio.json`; los textos de la sección 3 fijan el comportamiento mínimo de las escenas.

### 9.4. Preservación del manifiesto real

Conservar el formato encontrado en Bitácora Amorcito: `version`, `project`, `basePath`, `pathConvention`, `assetCount`, `categoryCounts`, `assets`, `sourceDocuments` y `notes`.

En cada entrada conservar ID, `path`, `type`, `format`, `category`, `kind`, dimensiones, transparencia, procedencia y metadatos especializados que correspondan. `originalPath` describe procedencia; no se usa para cargar.

Los paths se resuelven respecto del directorio de `assets.json` y `basePath`. Usar la base de Vite para encontrar el manifiesto y después URL relativa para sus recursos. No anteponer dos veces `assets/`.

Copiar al proyecto nuevo solo el subconjunto utilizado si conviene, conservando sus IDs y metadatos; actualizar conteos para que describan ese catálogo. Si se conserva completo, cargar únicamente el cierre de dependencias de los recursos referenciados, no las 199 entradas de la referencia.

El recurso `character.vanessa-jerry.stand.poses-v5` (15 de octubre de 2026; reemplaza a la hoja de caminar v4) es una **pose-sheet** con `requiresFrameDefinition: true`: Vanessa y Jerry **de pie** en cuatro direcciones (filas `down`, `left`, `right`, `up`) y tres columnas (ojos abiertos, parpadeo, ojos abiertos). No asumir que su cuadrícula visual basta: los frames son cajas explícitas validadas contra la imagen, con el pivote bajo los zapatos de Vanessa. De pie, Vanessa y Jerry parpadean de vez en cuando; con movimiento reducido quedan quietos con los ojos abiertos. La hoja no tiene pasos: si el personaje se desplazara, lo haría con esa misma animación.

Registrar recursos nuevos con IDs como `lab.station.shadows`, `lab.station.ramps`, `lab.station.telescope`, `lab.inventor.off` y `lab.inventor.on`. Son nombres de planificación; no archivos disponibles hoy. Las rutas concretas se asignan al incorporar assets reales.

El núcleo reutilizable del registro admite los tipos/kinds existentes y las extensiones necesarias del nuevo catálogo. No sustituir el manifiesto por un diccionario reducido de nombres/URLs que pierda la metadata de las hojas.

### 9.5. Validación compartida

Usar JSON Schema + Ajv, siguiendo la base existente. Compartir validadores entre CLI y servidor; el frontend valida su paquete antes de inicializar Phaser. Los esquemas de mensajes son públicos, pero los límites se vuelven a comprobar en servidor.

Comprobar:

- Forma y versión; números finitos; rangos seguros; IDs y enum de acciones.
- Referencias de route, piezas, diálogos y assets existentes, y los textos obligatorios de cada mesa y de las etiquetas.
- IDs de piezas únicos por actividad activa y correspondencia del inventor con todas las piezas del recorrido.
- Dependencias de atlas, frames, origin y nine-slice.
- Perfil TMJ, capas, tipos, duplicados, obstáculos y alcanzabilidad.
- Que dos posiciones/pruebas distintas sean posibles dentro de los rangos.
- Que el telescopio tenga dos aumentos crecientes, un visor que quepa en el panorama y observaciones (Luna y estrellas) que se puedan lograr.
- Que no haya credenciales ni respuestas de una sala en configuración pública.
- Que `mode: presentation` no conserve guiones incompletos o sonidos de prueba como finales.

Los valores del ejemplo no son límites de seguridad que el cliente pueda ampliar libremente. El servidor carga una configuración permitida y valida también topes operativos.

Crear errores que indiquen archivo, ruta JSON y, para Tiled, capa/objeto/propiedad. La validación nunca reescribe el mapa para «arreglarlo» silenciosamente.

<a id="spec-10"></a>

## 10. Phaser, React, dirección visual y sonido

### 10.1. Escenas y ciclo de vida

Escenas: `LaboratoryScene` (el laboratorio compartido con los personajes de todas las personas), una escena por experimento —`ShadowsScene`, `RampsScene` y `TelescopeScene`— e `InventorScene` para el cierre. Un **director de escenas** cambia de una a otra dentro del mismo `Phaser.Game`, según lo que ve esa audiencia: una persona ve la mesa que tiene abierta y, si no tiene ninguna, el laboratorio; la proyección ve siempre el laboratorio (salvo la demostración de la casa en El observatorio); en el cierre y al terminar todas las pantallas ven el inventor. Compartir helpers concretos de composición y animación; no crear una jerarquía compleja de escenas base.

React monta el host de juego para la administradora y para cada persona que juega (no para quien observa). Debe existir un solo `Phaser.Game` por host. Abrir o cerrar una mesa, cambiar de ronda o registrar un resultado **no recrea** el juego de nadie: cambia de escena dentro del mismo canvas. El host observa el tamaño de su contenedor y reajusta el lienzo cuando el hueco del escenario cambia sin que cambie la ventana (por ejemplo, al aparecer la pregunta de la conversación junto al laboratorio).

Al destruir: retirar suscripciones concretas, entrada, observadores, timers, audio y referencias. Mantener Strict Mode y probar montaje/desmontaje, incluyendo destrucción diferida de Phaser. No ocultar duplicaciones desactivando comprobaciones de React.

Las escenas usan `update(time, delta)` para interpolar/renderizar. No añadir un `requestAnimationFrame` de React ni mover sprites desde el render de componentes.

### 10.2. Puente y bloqueos

| Mensaje interno | Uso |
| --- | --- |
| `game:ready` | Escena y token listos; recibir último snapshot. |
| `game:action-request` | Intención tipada desde mapa/escena. |
| `game:load-progress` | Carga esencial, sin alterar progreso de sala. |
| `game:asset-failures` | IDs que no pudieron cargarse. |
| `app:visual` | Estado visual vigente: fase, estado de grupo, **quién mira** (`participant` con su estado personal, `projection` —con la demostración de la casa en El observatorio si está activa— u `observer`) y los personajes de todas las personas. |
| `app:clock` | Muestra del reloj de simulación; evitar render del árbol React por cada una. |
| `app:local` | Lo que solo existe en el dispositivo mientras se ajusta un experimento (posición de la linterna, inclinación elegida); no viaja al servidor. |
| `app:permissions` | Si puede caminar y explorar, y el motivo cuando no (pausa, conversación, sin conexión). |
| `app:request-result` | Resolver solicitudes pendientes, incluso denegadas. |
| `app:effect` | Animación/sonido tras transición confirmada, con ID de efecto único. |

Retener el último estado visual y los permisos para escenas que arrancan después de emitidos. Usar token de escena para descartar callbacks de escenas sustituidas.

Distinguir bloqueos locales de pausa colectiva. Abrir el cuaderno de Vanessa, cambiar el tamaño de ventana o perder foco de su panel no debe pausar a nadie. Los experimentos se detienen por la fase de la ronda y el estado autorizado del servidor.

Al volver de una pestaña oculta, aplicar el estado y el tiempo actuales; no adelantar la simulación con un delta acumulado. La pausa explícita debe poder recibir estado/reanudación fuera de `update`. El reloj del cliente se ajusta **solo** con las muestras del servidor.

### 10.3. Interfaz y arte

Estilo pixel art cálido: madera, crema, verde, plantas decorativas y luz de ventana, coherente con los recursos aprobados de Vanessa y Jerry.

Paneles, textos, slider, botones, notas de Vanessa y controles de sala son HTML/React, fuera del canvas. Los textos no se hornean en imágenes. Un título o señal breve del mapa puede dibujarse en Phaser con equivalente accesible.

Usar una misma silueta simple coloreable para los participantes, realizable con SVG/CSS y dibujada en el laboratorio con el color de cada persona y su nombre encima. No generar retratos ni personaje individual por usuario.

Assets nuevos mínimos:

| Grupo | Recursos |
| --- | --- |
| Laboratorio | Aula, mesas, entrada, inventario/inventor y capas pertinentes. |
| Sombras | Linterna, objeto, pantalla y representación dinámica de sombra. |
| Rampas | Rampa, pelota y marcas. |
| El observatorio | Telescopio sobre trípode para el mapa; panorama nocturno con cielo, tejados y casa; Luna con detalle para el aumento cercano; campo de estrellas; marco del visor; dos siluetas con gestos de discusión, una que gira hacia la ventana y la cortina (abierta, cerrándose y cerrada). Hoy se dibujan con formas en la escena; el telescopio del mapa es provisional. |
| Cierre | Lupa, diálogo, corazón; inventor apagado/encendido. |
| Sala | Señales de conexión y pausa; QR generado por código. |
| Sonido | Clic, campana, pieza y cierre; recursos finales verificables. |

Antes de crear arte, buscar reutilización pertinente en el catálogo. Los modelos precisos de sombra y rampa se dibujan con código y recursos estáticos, conservando coherencia con los cálculos.

### 10.4. Sonido

**El sonido está activado por defecto** (15 de octubre de 2026) en el celular y en la proyección. Como los navegadores no dejan sonar antes de un gesto, empieza con el primer toque o tecla en cualquier parte de la página; el botón ya se muestra como «Silenciar». Quien lo silencia lo deja apagado en ese dispositivo. El volumen/silencio es preferencia local, no parte del progreso compartido. `audio.phoneInitiallyMuted: true` volvería a dejar el celular en silencio.

La proyección es la salida principal. Identificar efectos por transición para no repetir clics/piezas después de un estado nuevo o una reconexión. No reproducir celebraciones históricas al reabrir el juego. Las señales de **grupo** (pieza conseguida, inventor encendido, aventura terminada) llegan como efectos del estado de grupo y las oyen todas las pantallas; las **personales** (la posición de la linterna que se registró) se deducen de los cambios del propio estado y las oye solo quien las provoca.

Cada señal importante tiene texto equivalente. Un fallo de audio no bloquea la mesa. No copiar los tonos `audio.sfx.test-*` del repositorio como sonidos finales.

**Nota de implementación (P7-02).** Los eventos de `audio.events` son un conjunto cerrado: `shadows.click`, `piece.earned`, `inventor.activated`, `adventure.finished` (el «cierre» de la dirección visual) y `flower.tap`; un evento desconocido o que apunte a un recurso que no es sonido es un error de validación. Cada señal tiene su texto en `ui.labels` (`signalPieceEarned`, `signalPiecesPlaced`, `signalFinished`, `signalClick`) y se muestra y anuncia (`aria-live`) con o sin sonido. El audio lo reproduce la propia aplicación (Web Audio, un único contexto creado dentro del gesto que activa el sonido), no el audio de Phaser. Ambas pantallas empiezan a sonar con el primer gesto de la página si nadie lo silenció; el celular de quien juega empieza **al volumen máximo** (la proyección, en 0,8), y la preferencia local se guarda con una clave nueva (v2) para que los celulares de los ensayos vuelvan a empezar activados y al máximo; el gesto sobre el propio botón de sonido no cuenta (lo resuelve su clic). Mientras los sonidos sean provisionales (`placeholder: true`), `mode: presentation` los rechaza.

Los efectos de interfaz/eventos pertenecen a `laboratorio.json → audio`. Si posteriormente se necesitan sonidos espaciales, sus emisores se colocan en la capa `sounds` del TMJ y se leen directamente; archivos y metadata permanecen en `assets.json`. Un laboratorio de sonidos con escritura de archivos no es dependencia de esta primera versión.

<a id="spec-11"></a>

## 11. Responsive, accesibilidad y objetivos de funcionamiento

### 11.1. Celular y proyección

- Vista activa usable en vertical desde **360 px**; probar también 390 y 430 px.
- Texto base de al menos **16 px**; zonas táctiles de al menos **44 × 44 px**.
- Panel de la mesa desplazable, con los controles del experimento alcanzables en vertical. *(Nota: el celular ya no tiene campos de texto del público; las notas las escribe Vanessa en su computadora. La nota P7-06 sobre el teclado en Chrome de Android y `interactive-widget=resizes-content` sigue vigente para los campos de Vanessa, no se probó en un celular real.)*
- Cada fase de la ronda anunciada con texto en el celular («La mesa está abierta», «Miremos la proyección…»); quien observa, sin mapa.
- Botones −/+ equivalentes a arrastrar la linterna o la inclinación; «Ir a la mesa actual» equivalente a navegar.
- Navegación por teclado en HTML y foco visible; no capturar flechas mientras se escribe.
- Estados reconocibles por texto/iconos además de color.
- Descripción textual del cambio de sombra y resultados numéricos de rampas; los resultados proyectados se escriben además de dibujarse (las barras son decoración).
- Los nombres sobre los avatares son legibles en el celular y en la proyección, sin depender del color.
- Respetar reducción de movimiento; sin destellos/sacudidas imprescindibles.
- Controles de moderación plegables sin cubrir resultados en la proyección.
- Fuentes pertinentes servidas con el sitio, sin depender de descargas externas durante la exposición.

La conversación se comprende desde la proyección aunque una persona no tenga teléfono o no haya terminado su exploración.

### 11.2. Metas de ensayo

| Aspecto | Meta y condición |
| --- | --- |
| Concurrencia | 50 participantes y una administradora, **todos explorando a la vez**. |
| Transición de ronda | Abrir, reunir o avanzar visible en menos de 1 s en todas las pantallas en conexión estable; medir carga inicial y cambios posteriores por separado. |
| Reflejo de una acción | Retraso objetivo inferior a 250 ms entre acción aceptada y su visualización en el propio teléfono, y en menos de 1 s en el contador de Vanessa. |
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
| RF-05–RF-11 | **Modificados por la propuesta de rondas:** el turno exclusivo y «tomar control» se sustituyen por participación simultánea y rondas guiadas por Vanessa; se conservan el avance colectivo, la proyección y la pausa: 2, 4 y 5. |
| RF-12–RF-15 | Sombras, Rampas, El observatorio y privacidad: 3. |
| RF-16–RF-18 | Cuaderno (resultados personales y notas del grupo), piezas e inventor: 3 y 4. |
| RF-19–RF-21 | Reconexión, recuperación administrativa, cierre y reinicio: 5 y 6. Quien observa: 2 y 5. |
| RF-22 | Audio opcional: 10 y 11. |
| RF-23 | Demostración local: **retirada** (6.4). |
| RF-24 | Persistencia tras reinicio: 6.1. |

### 12.2. Aceptación funcional

Mantener los IDs CA del PRD para que implementación y ensayo sean trazables. Los marcados **(modificado)** cambian por la propuesta de rondas; los nuevos (CA-34 en adelante) pertenecen a esa propuesta:

| ID | Escenario y resultado obligatorio |
| --- | --- |
| CA-01 | Crear sala entrega código y QR públicos sin exponer credencial administrativa. |
| CA-02 | Entrada por QR con nombre/color aparece en el aula administrativa. |
| CA-03 | Nombres repetidos tienen distinción visible e identidades independientes. |
| CA-04 | **(modificado)** Quien observa ve solo su tarjeta y el texto de la fase; no tiene personaje ni se monta el mapa. |
| CA-05 | **(modificado)** Comenzar abre la aventura para todas las personas a la vez: cada una ve su personaje en el laboratorio compartido. |
| CA-06 | **(modificado)** Tocar un destino representa el mismo movimiento de esa persona en su teléfono, en el de las demás y en la proyección. |
| CA-07 | **(modificado)** Cambiar de ronda conserva el personaje y los resultados de cada persona y la devuelve al mapa. |
| CA-08 | **(modificado)** Una acción personal de una ronda ya cerrada se rechaza (`STALE_ROUND`) sin modificar avance. |
| CA-09 | **(modificado)** Quien observa no puede jugar; ninguna participante puede abrir, reunir ni avanzar la ronda ni emitir acciones de Vanessa. |
| CA-10 | Acciones rápidas y repetidas de Vanessa conservan la última confirmada (cola serial y `commandSeq`). |
| CA-11 | Pausar durante rampa congela tiempo; reanudar no añade la conversación. |
| CA-12 | **(modificado)** Pausar en cualquier fase conserva la ronda, la lista y el contador; reanudar continúa donde estaba. |
| CA-13 | **(modificado)** Vanessa solo conduce: no existe «Tomar control» ni una forma de explorar dentro de la sala. |
| CA-14 | **(modificado)** Sombras conserva las posiciones de cada persona al cambiar de ronda, al recargar y al reconectar; la idea inicial del grupo se conserva aparte de la síntesis. |
| CA-15 | **(modificado)** Rampas no permite soltar la pelota antes de abrir la mesa; una prueba en marcha bloquea solo la suelta de su dueña. |
| CA-16 | Dos pruebas comparables con distintas inclinaciones conservan resultados coherentes. |
| CA-17 | Repetir una petición de suelta crea una sola prueba. |
| CA-18 | **(modificado)** En El observatorio, centrar la ventana de cerca hace que una silueta cierre la cortina una sola vez; no da pistas, puntos ni recompensas y la conversación de las siluetas no se oye ni se revela. |
| CA-19 | **(modificado)** El observatorio conserva observaciones, aumento, dirección del visor y cortina cerrada si la persona recarga, reconecta o regresa; solo reiniciar la sala lo restablece. |
| CA-20 | **(modificado)** Solo resultados registrados por el juego y notas de Vanessa aparecen en cuaderno/proyección; el público no escribe texto. |
| CA-21 | **(modificado)** Quedar lista no depende de escribir: los criterios de cada mesa se cumplen solo con acciones del experimento. |
| CA-22 | Repetir «Abrir siguiente mesa» no duplica pieza ni efecto confirmado. |
| CA-23 | **(modificado)** Tres piezas llevan al cierre: Vanessa escribe o elige la pregunta del grupo y la confirma. |
| CA-24 | **(modificado)** Desconectar a una persona no cambia la ronda ni baja el total del contador; desconectar a Vanessa pausa para todas. |
| CA-25 | **(modificado)** Quien regresa recupera su personaje, su mesa y sus resultados, sin afectar a las demás. |
| CA-26 | Recargar Vanessa recupera administración y sala pausada; decide cuándo continuar. |
| CA-27 | Reiniciar servicio recupera cambios confirmados y deja la sala pausada. |
| CA-28 | Segunda pestaña sustituye primera; solo la conexión vigente puede actuar. |
| CA-29 | Cerrar revoca las credenciales de uso y muestra finalización en todos los dispositivos. |
| CA-30 | Credencial/código de otra sala no permite leer o modificar datos ajenos. |
| CA-31 | **(modificado)** Ensayo con 50 participantes explorando a la vez documenta rondas, sincronización y métricas de 11.2. |
| CA-32 | **(retirado)** Ya no hay demostración local. |
| CA-33 | Con el audio silenciado (o sin audio), el teclado y las alternativas al arrastre permiten comprender y completar. El sonido está activado por defecto y empieza con el primer gesto. |
| CA-34 | Abrir la mesa habilita a todas las personas a la vez; en preparación, conversación y cierre nadie experimenta. |
| CA-35 | Solo la mesa de la ronda se puede abrir: otra se rechaza con un texto que distingue «más adelante» de «ya terminó». |
| CA-36 | Cada experimento registra sus resultados sin formularios, y «listo para conversar» sale de los criterios de la mesa (dos posiciones bien distintas de la linterna; dos pruebas terminadas con inclinaciones distintas; la Luna y las estrellas en El observatorio). |
| CA-37 | El contador «N de M listos» fija M al abrir la mesa, excluye a quien observa, no baja si alguien se desconecta; quien llega tarde acompaña sin contar y Vanessa puede incluirla. |
| CA-38 | **(modificado)** «Conversemos» con pendientes abre «Todavía hay personas explorando», legible sobre la barra de la consola, que dice cuántas terminaron, nombra a quienes faltan y explica el efecto; «Conversar ahora» conserva su trabajo y no les concede la finalización. |
| CA-39 | «Conversemos» cancela las pruebas de rampa en marcha: no cuentan como terminadas. |
| CA-40 | **(modificado)** En la conversación los celulares dicen «Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.» y detienen los controles. |
| CA-41 | **(retirado)** Ya no se proyectan los resultados de una persona ni se guardan comparaciones. |
| CA-42 | La frase de Freire de la mesa se proyecta solo cuando Vanessa lo decide y nunca aparece en los celulares. |
| CA-43 | La pieza de una mesa se incorpora al inventor al abrir la siguiente mesa, una sola vez. |
| CA-44 | **(modificado)** La pregunta final se elige entre las de las personas, las sugeridas por las mesas y las guardadas, o se escribe; solo con el inventor abierto; se confirma antes de imprimirla y puede corregirse después conservando la versión anterior. |
| CA-45 | Cada persona recibe solo su estado personal; la administradora y las demás no reciben el de nadie más. |
| CA-46 | Cada avatar muestra su nombre encima en el celular de cada persona y en la proyección; si se cruzan, los nombres se superponen y en el celular el propio queda encima. |
| CA-47 | **(modificado)** En El observatorio cada persona mira con su propio telescopio desde el cielo y con el aumento general; queda lista con la Luna de cerca y el grupo de estrellas, en cualquier orden y sin acercarse a la casa; las flechas y los aumentos permiten completar toda la exploración, sin atajos que lleven a la Luna, a las estrellas o a la casa; la galaxia es un hallazgo opcional. |
| CA-48 | **(modificado)** La entrada no ofrece acompañar sin jugar. Si alguien entra como observadora por la API, queda fuera del contador y no puede actuar. |
| CA-49 | En El observatorio la consola muestra el avance, nunca quién miró la casa; al mostrar la frase de Freire, la proyección muestra la casa con una demostración propia, que no cuenta para nadie, hasta pasar al inventor. |
| CA-50 | **(modificado)** Sombras no muestra centímetros en ninguna pantalla ni le dice a la persona qué tan grande es la sombra: lo compara mirando la escena (solo los lectores de pantalla reciben la descripción). Rampas ofrece seis inclinaciones con nombre y no muestra grados ni tiempos. |
| CA-51 | El inventor es una mesa más: al pasar al inventor todas las personas siguen en el laboratorio y caminan hasta la máquina; no se puede entrar hasta que Vanessa pulsa «Abrir inventor»; desde el mapa se entra junto a la máquina y desde «Ir al inventor» sin exigir cercanía. |
| CA-52 | Dentro del inventor cada persona elige una pregunta sugerida por las mesas (agrupadas por mesa) o escribe la suya, la registra y puede cambiarla; nunca llega a otra persona ni al estado de grupo; Vanessa la ve con el nombre de quien la registró en «Preguntas del inventor», panel que aparece cerrado al abrir el inventor. |
| CA-53 | Al comenzar solo se proyecta la pregunta de entrada; al abrir cada mesa se proyecta su pregunta a la derecha; antes de abrir la segunda y la tercera mesa no se proyecta nada. Los textos siguen la guía de Vanessa; las frases de Freire no cambian. |
| CA-54 | «Volver al mapa» aparece solo cuando la persona completó la mesa (en el inventor, cuando registró su pregunta). En el celular la escena de cada mesa ocupa todo el ancho y la cámara se acerca a la actividad; en pantallas anchas se ve el escenario entero. |
| CA-59 | Con una mesa abierta, Vanessa hace la actividad en la proyección con los mismos controles; su experimento es local (no cambia el contador, el cuaderno ni el estado de nadie) y su telescopio responde al instante. |
| CA-57 | Al terminar la aventura, quien está dentro del inventor puede volver al mapa y revisar su cuaderno, y volver a entrar a mirar la pregunta impresa; la proyección sigue en la máquina. |
| CA-58 | Tocar la flor de arriba a la izquierda suena en ese celular y muestra un «?» sobre Vanessa y otro sobre Jerry, sin mover al personaje ni enviar nada al servidor. |
| CA-56 | Al abrir una mesa la proyección muestra su actividad en lugar del mapa, en su estado inicial y sin el avance de nadie (ni las observaciones del telescopio de ninguna persona); al conversar vuelve el laboratorio. |
| CA-55 | La consola no tiene «Guía para conversar» y el resumen de participantes dice «N conectados». La pieza de Rampas se llama «Diálogo». |

### 12.3. Aceptación técnica adicional

| ID | Comprobación |
| --- | --- |
| CT-01 | Editar y guardar el TMJ cambia una sala nueva; no existe maps.json ni importación intermedia. |
| CT-02 | El build usa el mismo TMJ y falla con asset desconocido, estación duplicada/faltante, geometría inválida o característica no soportada. |
| CT-03 | Movimiento y colisiones derivan del mismo mapa en cliente/servidor; no se atraviesan obstáculos ni esquinas bloqueadas. |
| CT-04 | Cargar/cambiar escenas y Strict Mode no duplica canvas, listeners, timers ni audio. |
| CT-05 | Remontar/reconectar recibe snapshot completo; no depende de haber escuchado un evento anterior. |
| CT-06 | Phaser y transporte no hacen renderizar todo React por cada frame de movimiento. |
| CT-07 | Sombras cambia continuamente según el modelo; dos muestras iguales no satisfacen exploración. |
| CT-08 | Rampas usa mismo modelo/escala en ambas vistas; pausa, duplicados, desconexiones y cambio de ronda no alteran resultado. |
| CT-09 | Snapshot público, QR y logs no exponen tokens; la dirección del visor y la cortina de cada persona solo viajan en su propio estado personal. |
| CT-10 | Servidor deniega payloads fuera de rango, pasos inválidos, IDs inexistentes y mensajes de generación/epoch antiguos. |
| CT-11 | Fallo simulado de SQLite no produce acknowledgment de éxito ni pieza/registro «confirmado». |
| CT-12 | Reiniciar sala conserva participantes pero invalida comandos y resultados del recorrido anterior. |
| CT-13 | Paquetes config/mapa incompatibles bloquean control sin borrar progreso; no se cambia un mapa en una sala activa. |
| CT-14 | **(retirado)** Ya no hay demostración local. |
| CT-15 | Catálogo conserva IDs, rutas y metadatos; pose-sheets sin frames no se tratan como spritesheets listas. |
| CT-16 | Pruebas con base URL distinta y rutas de entrada por QR resuelven mapa/assets sin duplicar prefijos. |
| CT-17 | El servidor nunca envía a una persona el estado personal de otra (ni a la administradora), ni el listado de presencia a quien no es administradora. |
| CT-18 | Un reinicio abrupto del servicio conserva la lista de la ronda, el contador, las pruebas en marcha y la vista de cada persona; la sala vuelve pausada. |
| CT-19 | Cincuenta personas con pruebas de rampa simultáneas terminan cada una en su instante exacto y en el estado de su dueña. |
| CT-20 | **(retirado)** Ya no hay demostración local; el ciclo de Phaser bajo Strict Mode lo cubre CT-04 con una sala real. |

### 12.4. Validación pedagógica

Ensayar con Vanessa y una o dos personas. Pedir que expliquen:

1. Qué cambió al pasar de una primera idea a observar/probar en Sombras.
2. Qué ocurrió al abrir espacio para preguntar en Rampas.
3. Qué entendieron cuando se cerró la cortina en El observatorio y cómo siguió la curiosidad (la Luna, las estrellas y nuevas preguntas).
4. Qué les gustaría seguir investigando.
5. Si pudieron explorar por su cuenta y luego aportar a la conversación, aunque no hubieran terminado su exploración.

Registrar duración real, claridad de textos y momentos de pausa. Ajustar redacción y ritmo sin añadir evaluación de «respuestas correctas».

<a id="spec-13"></a>

## 13. Límites, decisiones de implementación pendientes y fuentes

### 13.1. Alcance inicial y extensiones

Indispensable: sala, identidad, presencia, observadoras, rondas guiadas, exploración simultánea, contador de personas listas, pausa, proyección, las tres mesas, cuaderno (resultados personales y notas del grupo), piezas, inventor con pregunta final, persistencia y recuperación.

Después: levantar mano, reacciones discretas, exportar cuaderno, segunda ventana de proyección, comparar a varias personas a la vez en la proyección y nuevos experimentos. No introducir esas mejoras como dependencias del recorrido inicial.

Fuera de alcance: rankings, cuentas, fotos, respuestas escritas del público, evaluador de texto con IA, preguntas respondidas automáticamente, edición de mapa dentro de la aplicación y un sistema distribuido de servidores.

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
