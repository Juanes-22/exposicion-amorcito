# PLAN.md — Construcción de El laboratorio de las cosas cotidianas

**Expositora:** Vanessa Estrada.  
**Documento rector:** [SPECS.md](SPECS.md).  
**Versión documental:** 1.0 · 5 de octubre de 2026.  
**Estado:** fases 0 a 6 construidas y verificadas (registro en §5); fases 7 y 8 pendientes. Lo que sigue sin verificar está indicado en cada fila de §5 y en la matriz de cierre; no se acredita nada por haber redactado estos documentos.

<a id="plan-0"></a>

## 0. Cómo usar este plan

Leer primero `.claude/SPECS.md`, luego este archivo y después el PRD versión 2.0. SPECS fija comportamiento y contratos; PLAN organiza el trabajo. No mantener aquí otra versión del JSON, de los mensajes de red o de las reglas de las mesas.

Tomar [Bitácora Amorcito](https://github.com/Juanes-22/bitacora-amorcito) como referencia en el commit **041d326f1f0b9e30b2d0de816cb7bb986e542d50**. Sus documentos se llaman `.claude/SPEC.md` y `.claude/PLAN.md`; las marcas de avance de esa bitácora no son evidencias de esta aventura.

Trabajar en el proyecto nuevo o en una rama/copia aislada cuando se prepare la implementación. No reemplazar la bitácora original ni empujar cambios al repositorio de referencia por el solo hecho de usarlo como base.

### Reglas de seguimiento

- Marcar una tarea terminada cuando exista su resultado y la verificación indicada.
- Registrar archivos relevantes, comando/ensayo, fecha y resultado; incluir pendientes concretos.
- Conservar las decisiones del PRD: sala compartida y tres mesas forman parte de la primera versión.
- No dar por construido un recurso propuesto, un esquema, un endpoint o un mapa de ejemplo.
- No reutilizar «pruebas pasadas» de otro proyecto como validación de este.
- Si cambia un requisito, actualizar SPECS y después tareas y pruebas afectadas.
- Resolver elecciones técnicas rutinarias dentro de esta arquitectura; registrar decisiones sin detener el trabajo por cada nombre de archivo.
- Crear arte final después de comprobar interacción, estado compartido y permisos.

<a id="plan-1"></a>

## 1. Insumos y decisiones de partida

| Insumo | Estado y uso |
| --- | --- |
| PRD versión 2.0 | Disponible. Fuente pedagógica y de requisitos RF/CA. Guardar copia de trabajo junto a la documentación. |
| SPECS.md | Preparado. Especificación del nuevo producto. |
| PLAN.md | Preparado. Plan pendiente de ejecución. |
| Repo Bitácora | Referencia revisada; no es el código ya construido de este laboratorio. |
| React/Vite/TypeScript/Phaser | Versiones reales del lockfile registradas en SPECS 7.1. |
| AssetRegistry/GameBridge | Candidatos concretos de reutilización, con adaptación. |
| Vanessa y Jerry | Recursos identificados en el manifiesto; confirmar frames, carga y escala al integrarlos. |
| Aula y objetos específicos | Pendientes de crear o seleccionar; usar formas claras durante prototipo. |
| Sonidos finales | Pendientes. Los tonos de prueba heredados no son finales. |
| Servidor Socket.IO y SQLite | Pendientes de construir. |
| Hosting y acceso | Pendientes de elegir para operación; no impiden desarrollo local. |
| Celulares/equipo de proyección | Identificar durante ensayo; necesarios para cerrar validación real. |

### Secuencia y dependencias

| Fase | Objetivo | Dependencia | Resultado que habilita seguir |
| --- | --- | --- | --- |
| 0 | Base y selección de reutilización | Documentos e insumos. | Proyecto ejecutable y dependencias fijadas. |
| 1 | Configuración, dominio inicial y TMJ directo | Fase 0. | Mapa nativo cargado y contrato validado sin importaciones. |
| 2 | Sala, permisos y persistencia base | Contratos de fase 1. | Tres navegadores con control exclusivo y comandos durables. |
| 3 | Movimiento y escena compartida | Fases 1–2. | Un teléfono mueve a Vanessa y la proyección muestra el mismo plan. |
| 4 | Las tres mesas | Fase 3 y dominio probado. | Experimentos compartidos que sobreviven al cambio de jugador. |
| 5 | Cuaderno, piezas e inventor | Fase 4. | Recorrido pedagógico completo. |
| 6 | Recuperación y respaldo | Persistencia base y recorrido. | Reinicio/reconexión verificados; demo aislada. |
| 7 | Arte, accesibilidad y capacidad | Recorrido y recuperación. | Experiencia usable en celular y métricas con 50 participantes. |
| 8 | Ensayo y entrega operativa | Fases anteriores. | Exposición probada y procedimiento de uso/recuperación. |

La sala y la persistencia se prueban antes de pulir los minijuegos. No completar un juego individual para después intentar añadir turnos como una capa externa.

<a id="plan-2"></a>

## 2. Fases y tareas

### 2.0. Fase 0 — Base y reutilización

**Especificación:** [0](SPECS.md#spec-0), [7](SPECS.md#spec-7), [9](SPECS.md#spec-9).  
**Criterios:** CT-04, CT-15, CT-16.

- [x] **P0-01 — Inspeccionar el punto de partida.** Revisar package.json/lockfile, host React, AssetRegistry, puente, frames y pathfinding en el commit de referencia. Registrar qué se copia/adapta y qué queda fuera.
- [x] **P0-02 — Crear una base pequeña.** Un package.json y lockfile; frontend, server y shared; scripts de desarrollo/tipos/pruebas/build. Conservar Phaser 4 y verificar Node, Socket.IO 4.x y driver SQLite compatibles.
- [x] **P0-03 — Importar solo recursos necesarios.** Mantener IDs y metadatos del catálogo, conteos correctos y fuentes pertinentes. Confirmar licencia/procedencia de recursos nuevos cuando se incorporen.
- [ ] **P0-04 — Preparar documentación de operación inicial.** Guardar SPECS/PLAN/PRD en .claude; README con instalación y scripts ejecutables. Configurar datos SQLite y credenciales fuera de Git.

**Salida verificable:** instalación reproducible, frontend y servidor de desarrollo arrancan, un recurso real del catálogo carga y el lockfile registra las versiones usadas.

**Evidencia:** comandos de instalación/tipos/build; lista breve de módulos reutilizados; captura del host inicial. No hace falta arrastrar las pruebas o los cientos de recursos de la bitácora si no aplican.

### 2.1. Fase 1 — Contratos, dominio y Tiled directo

**Especificación:** [4](SPECS.md#spec-4), [7](SPECS.md#spec-7), [8](SPECS.md#spec-8), [9](SPECS.md#spec-9).  
**Criterios:** CT-01–CT-03, CT-07, CT-08, CT-13, CT-15, CT-16.

- [x] **P1-01 — Definir contratos compartidos.** Tipos de sala, aventura, registros, pruebas, acciones y resultados; esquemas Ajv para configuración/mensajes; separación entre datos públicos, privados y locales.
- [x] **P1-02 — Crear la configuración de prototipo.** laboratorio.json con las tres actividades y textos/guiones del PRD. IDs nuevos de assets marcados como pendientes; ningún dato de sala o credencial en el JSON.
- [x] **P1-03 — Crear el mapa nativo.** laboratorio.tmj dentro de public/maps y proyecto Tiled que lo referencia. Usar un fondo o tileset incrustado compatible, spawn, tres estaciones, inventor y colisiones sencillas.
- [x] **P1-04 — Implementar lectura/validación espacial.** Un MapIndex puro en memoria desde el TMJ; mismos límites, puntos y obstáculos para navegador/servidor. Validar IDs, geometría, assets, rutas editoriales y alcanzabilidad.
- [x] **P1-05 — Probar Phaser nativo.** Cargar el TMJ con tilemapTiledJSON, crear capas/factories y cargar texturas por AssetRegistry. Probar JSON prevalidado como objeto del loader si evita una descarga repetida; contrastar API/tipos 4.2.1.
- [x] **P1-06 — Construir el dominio inicial.** Reducer/transiciones puras, avance secuencial, condiciones de piezas y modelos matemáticos de sombra/rampa; sin React, Phaser, sockets ni almacenamiento.

**Salida verificable:** guardar un cambio de estación/colisión en Tiled se refleja al recargar una demo nueva. El build sirve el mismo TMJ; no existe maps.json, comando de importación ni segunda ubicación editable.

**Pruebas esenciales:** mapa válido e inválido; asset inexistente; estación duplicada/faltante; spawn bloqueado; puntos inaccesibles; rutas con base distinta; sombra continua; rampa con tiempo coherente y monotónico.

**Evidencia:** TMJ abierto en Tiled y cargado en navegador; diff del cambio espacial; salida del validador. Las formas temporales pueden ser simples, pero deben permitir entender y recorrer el prototipo.

### 2.2. Fase 2 — Sala, control exclusivo y persistencia base

**Especificación:** [2](SPECS.md#spec-2), [4](SPECS.md#spec-4), [5](SPECS.md#spec-5), [6](SPECS.md#spec-6).  
**Criterios:** CA-01–CA-05, CA-07–CA-13, CA-17, CA-28–CA-30; CT-09–CT-12.

- [x] **P2-01 — Implementar alta e identidad.** Crear/unirse por API; código público, QR, nombre/color y distinción de duplicados; tokens opacos propios de cada papel y hashes de servidor.
- [x] **P2-02 — Construir el repositorio durable.** SQLite con salas, identidades y comandos procesados; transacciones de estado + respuesta; carga validada y volumen/configuración para datos.
- [x] **P2-03 — Autenticar sockets y presencia.** Resolver identidad desde credencial; conexión vigente/epoch; sustituir pestaña anterior; listado administrativo y resumen mínimo para espera.
- [x] **P2-04 — Implementar moderación atómica.** Comenzar, dar/retirar/tomar control, pausar/reanudar, cerrar/reiniciar; turnVersion/generation y commandSeq; confirmación de acciones destructivas de avance.
- [x] **P2-05 — Validar y deduplicar comandos.** Cola por sala, schemas, papel/turno/fase/paso, huella de requestId, acknowledgment después de commit. Denegación visible sin bloquear botones permanentemente.
- [x] **P2-06 — Construir bienvenida y espera.** Tarjetas simples; panel de participantes; ningún canvas ni snapshot completo para espera. Cambio de vista al otorgar/revocar turno.

**Salida verificable:** una administradora y dos participantes entran con credenciales distintas. Cambiar el turno retira al anterior y habilita solo al siguiente. Pausar conserva propietario; cambiar en pausa no reanuda. Los comandos aceptados sobreviven al reinicio de SQLite/proceso.

**Pruebas esenciales:** acción de espera; moderación falsificada; turno antiguo; epoch sustituido; selección rápida; requestId repetido/diferente payload; otra sala; fallo de commit sin éxito anunciado; reset y mensaje de generación anterior.

**Evidencia:** test de integración con Socket.IO real y SQLite temporal; capturas de tres vistas; caso de fallo de persistencia. No sustituir autorización de servidor por botones ocultos.

### 2.3. Fase 3 — Movimiento y proyección compartidos

**Especificación:** [2.4](SPECS.md#spec-2), [5](SPECS.md#spec-5), [8](SPECS.md#spec-8), [10](SPECS.md#spec-10).  
**Criterios:** CA-06–CA-08, CA-11–CA-13; CT-03–CT-06, CT-10.

- [x] **P3-01 — Implementar trayectos autorizados.** moveTo, conversión pantalla/mundo, pathfinding con huella de pies, límites y esquinas; plan calculado en servidor desde MapIndex.
- [x] **P3-02 — Dibujar el mismo plan.** GameBridge tipado, snapshot retenido, frameSeq y reloj cliente; escenas renderizan/interpolan sin física independiente ni posiciones de teléfono como autoridad.
- [x] **P3-03 — Integrar entrada y aperturas.** Tap/clic en mapa/mesa, navegación rápida accesible, permisos y proximidad solo donde aplica; conservar orden de route.
- [x] **P3-04 — Verificar ciclo y bloqueos.** *(Hecho salvo «foco de formularios»: no existen formularios hasta la fase 4; se verifica en P4-04.)* Una instancia por host, limpieza al perder turno/desmontar, tokens de escena, ready/sync y foco de formularios. Pausa colectiva separada de paneles locales.

**Salida verificable:** teléfono mueve a Vanessa/Jerry, proyección refleja la trayectoria y cambiar de jugador conserva posición/vista. Espera no recibe frames de simulación.

**Pruebas esenciales:** tocar tras pared; destino fuera de mapa; cambio de turno durante movimiento; pausa/reanudación; redimensionar; pestaña oculta/vuelta; Strict Mode; desmontajes repetidos.

**Evidencia:** video breve de dos dispositivos o capturas secuenciales con mismo plan; medición preliminar de latencia; conteo de hosts/listeners sin duplicación.

### 2.4. Fase 4 — Tres mesas con estado compartido

**Especificación:** [1](SPECS.md#spec-1), [3](SPECS.md#spec-3), [5.6](SPECS.md#spec-5), [10](SPECS.md#spec-10).  
**Criterios:** CA-11, CA-14–CA-21; CT-07–CT-10.

- [x] **P4-01 — Sombras.** *(Hecho; el arte y los textos son de prototipo.)* Sorpresa, primera idea, slider/−/+, dos muestras distintas, observación y pregunta. Modelo único, primera idea conservada y reacción breve de Jerry.
- [x] **P4-02 — Rampas.** *(Hecho; el arte y los textos son de prototipo.)* Respuesta cerrada, Tengo una pregunta, pregunta/predicción, controles y dos pruebas comparables. trialId, parámetros congelados, duración visual coherente y final autorizado por servidor.
- [x] **P4-03 — Cajas.** *(Hecho; el arte y las descripciones son de prototipo.)* Explorar objetos compartidos; pedir permiso; negativa; confirmación/respeto; nueva pregunta ligada a objeto compartido. Sin contenido ni acción de apertura de caja personal.
- [x] **P4-04 — Formularios comunes.** *(Hecho; también cierra el «foco de formularios» que quedó pendiente en P3-04.)* Modalidades escrita/sugerida/oral/incertidumbre según campo, 280 caracteres, borradores locales, aviso de publicación al grupo y respuesta a denegaciones.
- [x] **P4-05 — Probar pasos entre jugadores.** Repartir cada mesa entre dos o tres identidades; cambiar turno antes/después de confirmar; pausa en prueba; reset de experimento sin borrar progreso confirmado.

**Salida verificable:** las tres mesas se completan desde celulares y se ven en proyección. Las acciones rechazadas no saltan pasos. Las predicciones equivocadas, dudas y participación oral siguen permitiendo completar.

**Pruebas esenciales:**

| Mesa | Casos decisivos |
| --- | --- |
| Sombras | Dos posiciones iguales no bastan; acercar linterna agranda sombra; primera idea permanece entre turnos. |
| Rampas | Controles cerrados antes de pregunta/predicción; no hay dos sueltas; dos inclinaciones distintas; pausa no añade tiempo; resultado deriva del modelo. |
| Cajas | Negativa no revela contenido; cambiar jugador conserva paso; después del respeto se vuelve a objeto compartido y pregunta. |
| Formularios | Borrador no se proyecta; límites Unicode; sugerencia inexistente rechazada; campo fuera de paso denegado. |

**Evidencia:** test de dominio y transporte por mesa; grabación de cambios de turno durante actividades; revisión de claridad con Vanessa. El arte temporal no invalida la fase si las reglas y estados ya funcionan.

### 2.5. Fase 5 — Cuaderno, piezas e inventor

**Especificación:** [3](SPECS.md#spec-3), [4](SPECS.md#spec-4), [9](SPECS.md#spec-9).  
**Criterios:** CA-20–CA-23; CT-11, CT-12.

- [x] **P5-01 — Construir cuaderno compartido.** Mostrar ideas, pruebas y autor; distinguir primera idea/observación; ediciones con revisión esperada e historial. Panel local de Vanessa sin interferir con el controlador.
- [x] **P5-02 — Derivar y conceder piezas.** *(La derivación y la transición única ya estaban en el dominio desde P1-06; esta fase añade la interfaz y las pruebas de punta a punta.)* Completar mesa y añadir pieza en una transición durable; efecto identificado una sola vez; repetir visita/comando no duplica.
- [x] **P5-03 — Implementar inventor y final.** *(Arte de la máquina y de las piezas: de prototipo.)* Tres espacios, colocar piezas, elegir/escribir pregunta o modalidad oral, tarjeta final y reflexión. Sin respuestas generadas por IA.
- [x] **P5-04 — Implementar revisitas y reinicios.** Fase finished permite consultas/exploración controlada; reset de experimento conserva evidencia; reset de sala vuelve a bienvenida y conserva identidades.

**Salida verificable:** recorrido completo con tres piezas y pregunta final. Reabrir una mesa, reenviar cierre o cambiar jugador no concede copias. Los registros se mantienen al volver al mapa.

**Pruebas esenciales:** cierre repetido; pieza derivada sin comando directo; edición concurrente/revisión antigua; pregunta seleccionada del cuaderno; final oral; reset de sala seguido de mensaje viejo.

**Evidencia:** captura del cuaderno con contribuciones de varias personas; inventario final y pregunta; pruebas de idempotencia.

### 2.6. Fase 6 — Continuidad y demostración local

**Especificación:** [5](SPECS.md#spec-5), [6](SPECS.md#spec-6), [9](SPECS.md#spec-9), [10](SPECS.md#spec-10).  
**Criterios:** CA-19, CA-24–CA-28, CA-32; CT-05, CT-10–CT-14.

- [x] **P6-01 — Completar reconexión segura.** *(Lo esencial ya estaba desde P2/P3; esta fase lo midió con cortes reales.)* Snapshot al regresar, entradas canceladas, sin replay automático de gestos; controlador anterior en espera; administración recuperada mediante credencial.
- [x] **P6-02 — Verificar desconexiones y reemplazo.** *(Sin medir falsos cortes en celulares reales: P7.)* Ajustar heartbeat; pausar y revocar al controlador; pausar al perder Vanessa; ignorar desconexión de socket sustituido; detener reconexión de salas terminales.
- [x] **P6-03 — Verificar reinicio real del servicio.** Checkpoints de reloj/movimiento, resultados durables, sala recuperada pausada y sin sumar downtime; mismatches de configuración preservan datos.
- [x] **P6-04 — Implementar vencimiento/limpieza.** Actividad administrativa autenticada, TTL, revocación y eliminación de identidades/comandos/datos de sala.
- [x] **P6-05 — Implementar DemoController.** Mismo dominio, reglas y escenas; estado separado, rótulo visible; ningún socket ni escritura a una sala desconectada.
- [x] **P6-06 — Preparar respaldo utilizable.** *(Ensayado en Chromium con el servidor apagado y con la red cortada; falta ensayarlo en el equipo y la red reales: P8.)* Recursos mínimos cargados y build local; procedimientos para backend caído y pérdida completa de red. Volver al último estado confirmado de sala sin fusionar demo.

**Salida verificable:** se puede recuperar una sala tras recarga/reinicio sin perder registros confirmados. Si falla el servicio, la exposición puede continuar desde demo; al volver, la sala sigue con su estado propio.

**Pruebas esenciales:** corte abrupto de controlador y administradora; nueva pestaña; reinicio en mitad de rampa; acknowledgment perdido; DB inaccesible; config cambiada; backend apagado; demo local sin red.

**Evidencia:** test de integración que reinicia realmente el proceso y usa el mismo archivo SQLite; registro de tiempo de detección y retroceso visual; ensayo de respaldo con la red deshabilitada.

### 2.7. Fase 7 — Acabado, accesibilidad y capacidad

**Especificación:** [9](SPECS.md#spec-9), [10](SPECS.md#spec-10), [11](SPECS.md#spec-11).  
**Criterios:** CA-04–CA-06, CA-20, CA-31, CA-33; CT-04, CT-06, CT-09, CT-15, CT-16.

- [ ] **P7-01 — Integrar arte definitivo.** Laboratorio, objetos, secundarios, piezas/inventor y animaciones mínimas; conservar diseño de Vanessa/Jerry y metadata real; retirar placeholders en modo presentation.
- [x] **P7-02 — Integrar audio opcional.** Recursos finales, silencio inicial en celulares, activación mediante gesto, señales textuales y deduplicación de efectos; no bloquear actividades si falla audio. *(Hecho con una salvedad: la mecánica está completa y probada, pero los cinco sonidos son **provisionales** generados para el prototipo; los «recursos finales» siguen pendientes y `presentation` los rechaza.)*
- [ ] **P7-03 — Ajustar layouts y teclado.** Vertical desde 360 px; controles táctiles, formularios con teclado abierto, foco y −/+; moderación plegable y resultados visibles en proyección.
- [ ] **P7-04 — Optimizar carga y render.** Solo recursos referenciados, carga por mesa, prefetch prudente sin canvas en espera; medir bytes, tiempo de entrada y frames. No copiar una optimización del repo sin revisar su efecto en arte/manifiesto.
- [x] **P7-05 — Ejecutar ensayo de capacidad.** 50 participantes + administradora, un controlador; turnos repetidos, slider, rampa, entradas tardías y desconexión. Registrar latencia y que espera no recibe snapshot completo/frames. *(Hecho en **bucle local** con clientes que no dibujan: valida protocolo y servidor, no la red del lugar ni celulares; sin FPS. Informe en `docs/evidencia/fase7/capacidad.md`.)*
- [~] **P7-06 — Probar navegadores reales.** Safari/iPhone, Chrome/Android y equipo proyectado; sonido apagado, reducción de movimiento, navegación alternativa y conexión del lugar. *(**Parcial:** hecho en **Safari de iPhone SE (simulador iOS 18.2) y Chrome de Android 15 (emulador, 411 y 360 dp)**, más la proyección a 1920×1080 y 1366×768 en Chromium; **no** en celulares ni equipo de proyección físicos. Sin probar: teclado de iOS en el campo de texto de las mesas, reducción de movimiento en dispositivo, FPS y la conexión real del lugar.)*

**Salida verificable:** las métricas de SPECS 11.2 se han medido y la exposición es usable en los dispositivos seleccionados. Si una meta falla, registrar causa y corregir; no declararla aprobada por simulación de viewport.

**Evidencia:** capturas en 360/390/430 px y proyección; prueba real de teclado; reporte de capacidad con equipo/red y percentiles; tamaños de carga y FPS. Usar herramientas de accesibilidad como apoyo y revisar manualmente las acciones esenciales.

### 2.8. Fase 8 — Ensayo y entrega operativa

**Especificación:** [1](SPECS.md#spec-1), [6](SPECS.md#spec-6), [11](SPECS.md#spec-11), [12](SPECS.md#spec-12), [13](SPECS.md#spec-13).  
**Criterios:** todos los CA/CT aplicables; validación pedagógica de SPECS 12.4.

- [ ] **P8-01 — Ensayar la exposición completa.** Vanessa conduce bienvenida, aproximadamente ocho turnos flexibles, tres mesas y cierre; incluir pausas y preguntas del grupo. Medir duración real frente a los 18 minutos orientativos.
- [ ] **P8-02 — Revisar comprensión y contenido.** Una o dos personas explican curiosidad, comparación, diálogo, privacidad y pregunta siguiente; corregir textos y ritmo con Vanessa.
- [ ] **P8-03 — Preparar operación y despliegue.** README con build/servidor, proxy, HTTPS, volumen SQLite, expiración y recuperación; entorno de entrega con versiones fijadas. Elegir proveedor/acceso cuando corresponda a la implementación.
- [ ] **P8-04 — Cerrar evidencias y entrega.** Matriz CA/CT, comandos/checks, recursos finales y pendientes; comprobar QR real y respaldo preparado. No publicar ni presentar resultados de pruebas que no se hayan ejecutado.

**Salida verificable:** otra persona puede arrancar la aplicación, crear sala, conducir turnos y recuperar/usar respaldo siguiendo README. La exposición completa se entiende también desde la proyección sin teléfono.

**Evidencia:** registro de ensayo de 18 minutos aproximadamente, ajustes de Vanessa, matriz de aceptación y guía operativa. Si la publicación todavía no tiene destino, dejar el build y servidor verificables localmente e indicar ese pendiente específico.

<a id="plan-3"></a>

## 3. Estrategia de verificación

### 3.1. Capas de prueba

| Capa | Qué verifica | Herramienta orientativa |
| --- | --- | --- |
| Validación estática | JSON, TMJ, recursos y referencias coherentes. | CLI compartida con Ajv. |
| Dominio | Pasos, prerrequisitos, piezas, límites y modelos deterministas. | Vitest, sin navegador. |
| Servidor + DB | Credenciales, cola, permisos, idempotencia y durabilidad. | Socket.IO client real + SQLite temporal. |
| Interfaz | Cambio espera/turno, formularios, borradores y alternativas de control. | Testing Library en casos relevantes. |
| Navegador | Mapa/experimentos y flujo de varias identidades. | Playwright con contextos separados. |
| Dispositivos reales | Safari/Android, teclado, FPS y proyección. | Ensayo manual documentado. |
| Capacidad | 50 conexiones, latencia, fan-out y recuperación. | Script Socket.IO + navegador de proyección. |
| Pedagogía | Comprensión, conversación y duración. | Vanessa y una o dos personas de ensayo. |

Probar los riesgos reales del producto. No crear tests que solo repitan constantes de configuración, inspeccionen cada clase CSS o se limiten a reproducir la implementación.

### 3.2. Escenarios de extremo a extremo indispensables

1. **Recorrido normal:** administradora + dos participantes; repartir las tres mesas; cuaderno, piezas y pregunta final.
2. **Control y pausa:** espera intenta actuar; comando anterior llega tarde; cambio rápido; pausa a mitad de rampa; asignación en pausa; tomar control.
3. **Aislamiento:** dos salas; credencial de otra sala; QR sin secretos; espera sin cuaderno/frames.
4. **Idempotencia:** duplicar suelta, formulario y cierre; perder acknowledgment y reintentar mismo ID; payload distinto con mismo ID.
5. **Continuidad:** cortar conexión activa, regresar en espera, recargar Vanessa, sustituir pestaña, reiniciar proceso en una prueba.
6. **Persistencia fallida:** SQLite rechaza commit; no aparece estado confirmado ni éxito.
7. **Respaldo:** backend apagado; demo recorre mesas; volver a sala no mezcla avance; copia local sin red.
8. **Accesibilidad:** sin audio ni arrastre, teclado y navegación por mesas, modal/formulario con teclado móvil abierto.
9. **Tiled directo:** mover estación o pared, guardar y recargar una demo/sala nueva; datos inválidos fallan; ningún JSON espacial intermedio.

Usar identidades y contextos independientes, no tres pestañas con la misma credencial para simular participantes diferentes.

### 3.3. Medición de objetivos

Tomar una serie de al menos 30 cambios/acciones representativas durante el ensayo de capacidad. Registrar mediana, p95 y máximo cuando sea útil, separando entrada fría, juego cargado y recuperación.

Para latencia de proyección, medir de forma trazable desde acción aceptada hasta render visible; corregir diferencias de relojes o usar medición en un mismo entorno. No restar timestamps de teléfono y servidor sin sincronización.

Documentar equipo, navegador, conexión, cantidad de participantes, tamaño de recursos y presencia de caché. El script de 50 sockets comprueba capacidad del servidor; un celular real verifica render y usabilidad.

Reportar cada meta como **aprobada**, **fallida** o **pendiente**. No sustituir la meta de 50 participantes por una captura con cuatro avatares.

### 3.4. Scripts que debe ofrecer la implementación

Estos son nombres previstos; crear y comprobar su funcionamiento antes de documentarlos como disponibles:

| Script propuesto | Resultado |
| --- | --- |
| `npm run dev` | Frontend y backend de desarrollo con proxy/configuración local. |
| `npm run validate:project` | Validar laboratorio.json, assets.json y TMJ sin escribir archivos. |
| `npm run typecheck` | Tipos de frontend, shared y servidor. |
| `npm test` | Tests significativos de dominio, interfaz y servidor. |
| `npm run test:e2e` | Flujo de varias identidades en navegador. |
| `npm run test:load` | Ensayo de 50 conexiones con reporte de métricas. |
| `npm run build` | Validación, tipos y compilación frontend/servidor; sin importar mapas. |
| `npm start` | Servicio de producción con estáticos, API, Socket.IO y volumen configurado. |
| `npm run preview:demo` | Servir build local para respaldo sin backend conectado. |

No se necesita Tiled instalado para ejecutar tests, construir o servir el juego. Tiled de escritorio se usa para editar el TMJ.

<a id="plan-4"></a>

## 4. Riesgos y decisiones que resolver en el momento adecuado

| Riesgo o pendiente | Respuesta y fase |
| --- | --- |
| Catálogo de Tiled heredado incompatible con ruta nativa | Usar el perfil de SPECS 8; verificar en P1, no construir otro importador. |
| PNG/hojas grandes retrasan el primer turno | Subconjunto real y carga/prefetch medidos, P0/P7. |
| Física diferente en teléfono/proyección | Modelo TypeScript compartido y tiempo del servidor, P1/P4. |
| Evento viejo retoma control tras pausa/cambio | turnVersion, generation, epoch y cola; integración P2/P6. |
| Copia nueva de tab pausa por desconexión de la vieja | Vincular evento a conexión vigente y probar P2/P6. |
| Registro visible pero no durable | Emitir éxito solo después de transacción; pruebas P2/P6. |
| Configuración nueva cambia sala de exposición | Pin de revisión/hash y mismatches explícitos, P1/P6. |
| Hosting sin proceso persistente o disco | Resolver antes de entrega operativa, P8. |
| Toda la red falla | Build local preparado y ensayo sin red, P6/P8. |
| La exposición excede el tiempo | Ajustar textos, pausas y cantidad de turnos con Vanessa, P8. |
| Participantes sin turno quedan desconectados de la actividad | Preguntas orales y proyección legible; validación pedagógica P8. |

Arte y proveedor no bloquean una primera prueba local de permisos y movimiento. Los dispositivos reales y el ensayo sí son necesarios para declarar terminada la experiencia de presentación.

<a id="plan-5"></a>

## 5. Registro de ejecución

Actualizar esta tabla durante la construcción. No copiar historiales ni resultados del repositorio de referencia.

| Fecha | Tarea(s) | Archivos/cambio | Verificación y resultado | Pendiente |
| --- | --- | --- | --- | --- |
| 2026-10-05 | P0-01 | Referencia Bitácora Amorcito clonada en el commit `041d326f` (solo lectura, fuera del proyecto). **Reutilizado/adaptado:** AssetRegistry y carga/validación del catálogo; GameBridge (eventos propios del laboratorio); host React de Phaser; definiciones de frames de la hoja de caminar y su validación contra los píxeles. **Reescrito:** pathfinding (huella de pies y prueba exacta de segmento). **Fuera:** importador de Tiled, `maps.json`/WorldBuilder, progreso individual, insignias, zonas, audio, laboratorio de sonidos. | Inspección de `package.json`, lockfile, `assetRegistry.ts`, `GameBridge.ts`, `createGame.ts`, `PhaserGame.tsx`, `frameDefinitions.ts`, `validateFrames.ts`, `pathfinding.ts`. | — |
| 2026-10-05 | P0-02 | `package.json` + lockfile únicos; `tsconfig*.json`, `vite.config.ts`, `scripts/dev.mjs`. Versiones reales instaladas: Node 24.20.0, Phaser 4.2.1, React/React DOM 19.3.0, Vite 8.3.2, TypeScript 7.0.2, Ajv 8.20.0, Vitest 5.0.3, Playwright 1.63.0, Socket.IO 4.8.4, Express 5.2.1, better-sqlite3 13.0.3. | `npm install`, `npm run typecheck`, `npm run build` ✔; el driver SQLite abre y escribe con Node 24. | Probar con Node 22 LTS (el `engines` exige ≥ 22.12 y solo se verificó en 24.20). |
| 2026-10-05 | P0-03 | `public/assets/`: **8** entradas reales del catálogo (Vanessa caminar v4, botón verde ×2, panel crema ×3, icono de libro, margaritas), IDs y metadata idénticos, archivos copiados byte a byte; **6** provisionales `lab.*` generados para el prototipo (`placeholder: true`). Conteos: 14. Fuentes Nunito y Gelasio por `@fontsource-variable`. | `npm run validate:project` ✔ (catálogo, archivos y frames contra la imagen real). | Las margaritas pesan 738 KB y la hoja de poses 1,1 MB: revisar el presupuesto de 3 MiB en P7-04. |
| 2026-10-05 | P0-04 | `README.md`, `.env.example`, `.gitignore` (SQLite y credenciales fuera de Git), `.claude/launch.json`. | Los scripts del README se ejecutaron. | **Falta la copia del PRD v2.0 en `.claude/`: no estaba disponible** (SPECS lo cita pero no se entregó). El directorio **no es un repositorio Git** (no se inicializó). |
| 2026-10-05 | P1-01, P1-02 | `shared/contracts/` (estado, acciones, eventos, límites, esquemas Ajv de mensajes), `public/config/laboratorio.json` + `.schema.json`. | `shared/contracts/schemas.test.ts`: cada acción del catálogo tiene su esquema y su ejemplo; se rechazan acciones libres (`grantPiece`, `setResult`, `openPersonalBox`), campos de más, rol forjado y `room.reset/close` sin confirmación. | Los textos que SPECS no fija (`ideaSuggestions` de Sombras, descripciones de los objetos de la caja, etiquetas de interfaz) son de **prototipo** y requieren revisión de Vanessa contra el PRD. |
| 2026-10-05 | P1-03, P1-04 | `public/maps/laboratorio.tmj` (1280×768, tileset incrustado con `assetId`, spawn, 3 estaciones, inventor, 9 colisiones, 3 decoraciones); `tools/tiled/laboratorio.tiled-project` y README; `shared/config/tmj.ts` (lector + perfil), `validateProject.ts`, `navigation.ts`. | `validateProject.test.ts` (31 casos: mapa inválido, asset inexistente, estación duplicada/faltante, spawn bloqueado, punto inaccesible/inalcanzable, rutas editoriales equivalentes y distintas, `presentation` rechaza provisionales). **Tiled 1.12.2:** `tmxrasterizer` lee y dibuja el TMJ, acepta el proyecto y reexporta; la exportación se guarda como fixture y valida con el mismo `MapIndex`. Tiled escribe la clase como `type`. | **No se probó una sesión de edición en la interfaz gráfica de Tiled** (comprobación manual pendiente). El TMJ inicial se generó una vez con un script y desde entonces es la única fuente. |
| 2026-10-05 | P1-05 | `src/config/loadProject.ts`, `src/game/` (escena, factories, bridge, hoja de poses con pivote en los pies), `src/components/game/PhaserGame.tsx`. El TMJ validado se entrega al loader nativo como objeto (clonado). | Navegador: mapa, mesas, decoraciones y personaje correctos. `npm run test:e2e` → `strictmode.ts`: tras el doble montaje de StrictMode y 5 montajes/desmontajes, un solo canvas, juegos anteriores destruidos, sin errores. `tiled-direct.ts` (CT-01): mover una estación en el TMJ la mueve 100 px en una demo nueva sin paso intermedio; no existen `maps.json` ni importador; un asset desconocido se rechaza nombrando archivo, objeto y `assetId` sin iniciar Phaser. | El «guardado» se simuló escribiendo el TMJ; no con Tiled. En el teléfono vertical el mapa completo queda diminuto: la cámara de seguimiento es de la fase 3. |
| 2026-10-05 | P1-06 | `shared/domain/` (`adventure.ts`, `room.ts`, `models.ts`, `movement.ts`, `text.ts`): reductores **puros** (no mutan su entrada) de las tres mesas, cuaderno, piezas, inventor, final, revisitas y de la sala (turnos, pausa, reinicio, cierre, recuperación). | 109 pruebas de dominio: pasos en orden, dos posiciones/inclinaciones distintas, ninguna acción salta pasos, primera idea conservada con historial, caja personal sin contenido ni acción de abrirla, pieza una sola vez, pausa que conserva propietario, tiempo activo y duración de rampa (≈3,56 s a 15° y ≈2,16 s a 45°). | Se añadió `shadows.surprise.ack` y campos de configuración: reflejados en SPECS. |
| 2026-10-05 | P2-01 a P2-05 | `server/src/`: `db.ts` (SQLite, transacciones, `synchronous=FULL`), `roomService.ts` (cola por sala, sobre en el orden de SPECS 5.4, fan-out por canales), `http.ts`, `socket.ts`, `auth.ts` (tokens de 32 bytes, solo hash), `rateLimit.ts`, `config.ts`. | **Integración con Socket.IO real y SQLite temporal** (`rooms.test.ts`, `continuity.test.ts`, `clientController.test.ts`): alta e identidad, distinción de duplicados, tres vistas, espera sin snapshot, turno antiguo/generación antigua/epoch sustituido/otra sala/moderación falsificada, selecciones rápidas, `requestId` repetido y con otro payload, **fallo real de SQLite sin éxito anunciado ni estado «confirmado»** (CT-11), fallo a mitad de transacción, **reinicio real del proceso con el mismo archivo** (cuaderno intacto, sala pausada, ID aún protegido, sin sumar el tiempo apagado), reset, cierre, `CONFIG_MISMATCH`, límites de frecuencia y de tamaño. **Pruebas de mutación manuales:** 9 invariantes rotas a propósito, 9 detectadas. | Fase 6: medir la detección de cortes (≤ 10 s) con el latido ajustado, vencimiento y limpieza de salas (P6-04: `adminActivity` y la columna existen, el barrido no), ensayo con celulares reales. |
| 2026-10-05 | P2-06 | `src/app/` (`RoomController`, `useRoomSession`, rutas, credenciales por sala), `src/components/room/` (entrada, unirse, bienvenida de Vanessa, consola, controlador, espera, terminal), `src/components/ui/`. Módulo del mapa con Phaser cargado bajo demanda y precargado en espera (entrada 485 kB / 149 kB gzip; motor 1,38 MB aparte). | `npm run test:e2e` → `room-flow.ts`: administradora y dos participantes en **tres contextos de navegador independientes** contra el build servido por el servidor real: QR y código sin credenciales, «ana · 2», espera **sin canvas** (CA-04), un canvas por vista activa, cambio de turno retira y monta el mapa, pausa/reanudación, recarga de Vanessa con la sala pausada, sin errores de consola. Capturas en `docs/evidencia/fase2/`. Componentes con Testing Library (entrada, espera, diálogo accesible, almacenamiento que falla, rutas con otra base). Cliente: cancela pendientes al perder la conexión, **no reproduce** lo intentado sin conexión, reintenta el mismo comando con el mismo ID, se detiene en estados terminales y al ser sustituido. | Probar en Safari/iPhone, Chrome/Android y el equipo proyectado (P7-06). Medición informal de ~40 ms para el cambio de turno (un intento, misma máquina): **no** es la medición de P7. Entrada táctil, cámara de seguimiento y formularios de las mesas: fases 3–4. |
| 2026-10-05 | P3-01 | `shared/domain/frames.ts` (constructor puro del frame), bucle de simulación en `server/src/roomService.ts` (`tick`/`simulate`: cierra movimientos y pruebas por reloj, **checkpoints cada ~500 ms** sin subir versión, `simulation.frame` a 10 Hz **solo al canal de vista**), ancla del reloj exacta en cada commit, `src/game/framing.ts` (`screenToWorld`, encuadres). `player.moveTo` ya vivía en el dominio (P1-06). | `server/src/simulation.test.ts` (13 casos con reloj controlado y `tick()` a mano): frames solo a administradora y controlador (la espera, 0); posición del frame = la del plan al instante del reloj; el fin del movimiento lo decide el servidor, se guarda y se anuncia **una vez**; si SQLite rechaza el guardado no se anuncia y se reintenta; checkpoints sin `stateVersion` ni filas de comandos; **caída abrupta simulada con una copia consistente de la base**: retrocede ≤ 500 ms y lo confirmado se conserva, sin sumar el tiempo apagado; **pausa mid-movimiento y mid-rampa (CA-11 de punta a punta)**: no suma la conversación y la prueba termina en su instante exacto; cambio de turno con plan en marcha; destino en pared o fuera del mapa rechazado con explicación. e2e: el servidor recibió (640,0; 449,1) al tocar (640; 450). | Medición formal de latencia y de FPS en celulares: P7. |
| 2026-10-05 | P3-02 | `src/game/bridge/ClientClock.ts` (reloj local ajustado por snapshots y frames; en pausa queda quieto en el valor del servidor; no acumula `delta`), `GameBridge` con reloj retenido, `RoomController.subscribeFrames` + `shouldAcceptFrame` (ordena por generación, versiones y `frameSeq`; descarta planes anteriores), `LaboratoryScene.update` dibuja desde `bridge.clock.now()`. Los frames **no pasan por el estado de React**. | `ClientClock.test.ts` (6), `framing.test.ts` (9), `shouldAcceptFrame` (2), y en cliente real: ~26 frames en un trayecto provocan ≤ 3 avisos al estado observable, solo snapshots (CT-06). e2e `movement.ts`: teléfono y proyección dibujan **el mismo plan**; divergencia máxima 1,8–5,3 px durante el trayecto; al llegar, ambos exactamente en el destino. | |
| 2026-10-05 | P3-03 | `src/app/mapIntents.ts` (traduce intenciones del mapa en comandos; respeta permisos y el orden del recorrido; al tocar una mesa lejana camina y la abre **cuando el reloj dice que llegó**, cancelando si hay un toque nuevo, cambia el turno o la vista), `LaboratoryScene` (toque válido = corto y quieto, conversión pantalla→mundo con la cámara real, anillos de resultado, marca de destino, mesas bloqueadas/disponibles/completadas), cámara `fit` (proyección) y `follow` (teléfono, ~520 px de mundo), `StationsMenu` (lista accesible, conserva orden y permisos sin exigir proximidad), `NearbyPrompt`, `ActivityPanel` (**provisional**: la mesa abierta y «Volver al mapa»). | `server/src/mapIntents.test.ts` (14: permisos, mesa bloqueada, apertura por reloj, pausa, cancelaciones, token viejo). e2e: toque en pared → «no se puede pisar» sin quedar atrapada; mesa bloqueada → explicación sin caminar; lista con Rampas/Inventor bloqueados; abrir Sombras desde la lista y tocando su mesa; la proyección también la ve abierta. | Las escenas y formularios de cada mesa: fase 4. |
| 2026-10-05 | P3-04 | Un `Phaser.Game` por host, token de escena, snapshot retenido, banderas `?debug`/`?hooks` (`src/game/flags.ts`). | e2e `movement.ts` (contextos independientes): **6 cambios de turno** → canvas 1/0/1 (proyección/controlador/espera), **6 listeners del puente antes y después**, un solo `Phaser.Game` vivo; **cambio de turno en pleno movimiento**: el nuevo controlador recibe el mismo plan y dibuja a Vanessa a mitad de camino (a ~1 px de la proyección); la espera recibe **0 frames** por su WebSocket y quien pierde el turno deja de recibirlos; pausa mid-movimiento congela las dos escenas (< 0,5 px en 1,5 s); redimensionar 390×844 → 700×420; **pestaña congelada 1,8 s** (CDP `Page.setWebLifecycleState`) y de vuelta a ~0 px de la proyección; `strictmode.ts` sigue verde. Abrir un panel local de la consola durante el movimiento no lo pausa. | **Foco de formularios**: P4-04. Probar «pestaña oculta» en navegadores reales: P7-06. |
| 2026-10-06 | P4-01 | `src/game/geometry/{stage,shadows}.ts` (la misma fórmula `h·(d+b)/d` para el dibujo y para la descripción textual), `src/game/scenes/ShadowsScene.ts` (dibujo procedimental sobre un escenario lógico de 960×540; objeto y pantalla fijos, la linterna no atraviesa el objeto, anillo en la sorpresa, reacción breve de Jerry), `src/components/activities/{ShadowsPanel,LightControls}.tsx` (slider con «Más lejos / Más cerca», −/+, «Anotar esta posición», arrastre a ≈ 12 Hz sin contar como exploración, texto descriptivo de la sombra anunciado con retraso para lectores de pantalla). La linterna **empieza cerca** (`shared/domain/adventure.ts`): la sombra grande es la sorpresa del paso 1. | `geometry.test.ts` (rayo del borde del objeto colineal con la altura de la sombra; más cerca ⇒ más grande; mínimos y máximos), `panels.test.tsx` (slider invertido correcto, envío sin anotar, anotar con el valor mostrado, descripción y bloqueo en los extremos), `tables.test.ts` (tres identidades; muestra parecida no cuenta; arrastrar no cuenta). e2e `tables.ts`: tras mover el slider a 30 cm teléfono y proyección dibujan **la misma distancia y la misma medida de sombra**. | Revisión de claridad con Vanessa; arte final. |
| 2026-10-06 | P4-02 | `src/game/geometry/ramps.ts`, `src/game/scenes/RampsScene.ts` (docente ficticio con bocadillo, guía, rampa, pelota que rueda con `s/L = min(1,(t/T)²)` desde el reloj de simulación, rótulo «tiempo de la simulación»), `src/components/activities/RampsPanel.tsx` (respuesta cerrada sin controles; «Tengo una pregunta»; invitación del docente; inclinación 15–45° de 5 en 5; «Soltar la pelota»; tabla de pruebas; aviso de cuántas faltan para comparar; texto «no es una medición real»). | `panels.test.tsx` (sin controles con la respuesta cerrada; inclinación y suelta bloqueadas mientras rueda; tabla con «rodando…» y tiempos), `tables.test.ts` (pregunta de Ana, predicción de Beto, pruebas de Cata; **cambio de turno con la pelota rodando**; pausa de 5 min no la hace avanzar ni terminar y termina en su instante exacto; reiniciar la marca **cancelada** sin contarla). e2e: **pausa con la pelota rodando**: el reloj del cliente queda quieto y la prueba sigue «en curso»; al reanudar termina en `startActiveMs + durationMs` exacto; la tabla de teléfono y proyección coincide (15° → 3,6 s, 45° → 2,2 s). | Arte final. |
| 2026-10-06 | P4-03 | `src/game/scenes/BoxesScene.ts` (caja compartida, objetos, caja personal **cerrada con candado y sin interior**, compañera ficticia), `src/components/activities/BoxesPanel.tsx` (abrir, mirar objetos con su descripción en texto, pedir permiso, leer la negativa, «Entendido», «Respetar y seguir explorando», pregunta ligada a un objeto compartido). Tocar la caja personal muestra un mensaje **solo local**: no existe ninguna acción para abrirla. | `panels.test.tsx`: tocar la caja personal **no envía ningún comando**; la proyección ve los objetos mirados sin botones activos. `tables.test.ts`: la negativa no se puede saltar; `boxes.personal.open`, `openPersonalBox`, `setState`, `grantPiece` se rechazan; el estado de la mesa no contiene nada «personal»; sugerida trae el objeto, escrita sin objeto se rechaza. e2e: el `stateVersion` **no cambia** al tocar la caja personal y la proyección no recibe el mensaje. | Descripciones de objetos y diálogos: revisión de Vanessa. |
| 2026-10-06 | P4-04 | `src/components/activities/{RecordForm,RecordsList,ActivityView,modalities,steps,drafts,throttle}.ts(x)`, `src/components/room/{ActivityPanel,AdventureHost}.tsx` (escenario + panel de la mesa en la misma posición del árbol: abrir una mesa no recrea el canvas), `src/game/scenes/{director,sceneKeys}.ts` (cambio de escena dentro del mismo `Phaser.Game`), `RoomController.turnLossHint`, estilos. Las modalidades salen de `FIELD_RULES` del dominio; los textos de cada paso son contenido editable en `laboratorio.json` (`prompts`). | `panels.test.tsx` (25): aviso «Esta idea se compartirá con el grupo», las cuatro formas de responder según el campo, contador y bloqueo pasados los 280, el texto se conserva si el servidor deniega, borrador local que sobrevive al desmontaje, la sugerencia envía solo su ID, modo lectura sin campos ni botones en las tres mesas y **sin borradores**. e2e: **el borrador no aparece en la proyección ni viaja por la red a nadie** (se inspeccionan los mensajes WebSocket recibidos por los otros contextos); al perder el turno con texto sin compartir llega el aviso; el nuevo jugador recibe el formulario vacío y al recuperar el turno el borrador sigue en el teléfono de su autora; con la ventana reducida a 390×430 el campo y el botón quedan **a la vista y sin nada encima** (`elementFromPoint`), la página no se desplaza y en horizontal (844×390) el escenario queda a la izquierda. | Probar el teclado real de iOS/Android (P7-06). |
| 2026-10-06 | P4-05 | `server/src/tables.test.ts` (8 casos de integración con Socket.IO real, SQLite temporal y reloj controlado), `scripts/e2e/tables.ts` (proyección + dos teléfonos con contextos independientes, añadido a `npm run test:e2e`). | **Sombras:** el turno cambia antes de confirmar (Ana no puede confirmar tras perderlo), entre muestras y tras la observación; autores [Beto, Ana, Beto]; la edición de la primera idea añade versión y conserva a la autora original; reiniciar conserva cuaderno, muestras y piezas. **Rampas y Cajas:** ver arriba. e2e completo a través de la interfaz: las tres mesas se completan con piezas `lupa → dialogo → corazon` y el inventor queda disponible; predicción «Todavía no sé» y pregunta sugerida permiten completar. Repetido **3 veces seguidas** en verde antes de añadir la comprobación de horizontal y el control de solapamiento, y una vez más después. | Grabación de cambios de turno con Vanessa; revisión de claridad. |
| 2026-10-05 | Verificación | `npm run typecheck`, `npm test` (**259 pruebas, 19 archivos**), `npm run build`, `npm run test:e2e` (4 e2e). La suite completa se repitió **60 veces seguidas sin fallos** tras corregir los defectos de la fase 2 y **8 veces** tras la fase 3. Mutación manual de la fase 3: **12 de 12** detectadas. Latencia preliminar clic en el teléfono → plan nuevo en la proyección: mediana 3–6 ms, máx 18–19 ms (12 toques, localhost, misma máquina; **no** es la medición de P7). | | |
| 2026-10-06 | P5-01 | `src/components/notebook/{NotebookView,PieceTray}.tsx`, `src/components/room/MapHud.tsx` (piezas y menú «Cuaderno» sobre el mapa del controlador), panel «Cuaderno» en `AdminConsole` (local: no toca la escena ni el turno), `RecordForm` con modo edición (parte del valor actual, no deja enviar lo mismo, borrador propio). El cuaderno agrupa por mesa en el orden del recorrido, con autor, la primera idea distinguida, «editada por …» e historial de versiones; «Corregir» solo para quien tiene el turno y nunca para la pregunta final; envía `expectedRevision`. | `notebook.test.tsx` (16): agrupación y orden, primera idea, vacío, ningún borrador, permisos de edición, corrección con revisión esperada, **conflicto**: se muestra la versión vigente, se conserva lo escrito y el siguiente envío ya es sobre esa versión, historial. `inventor.test.ts`: `REVISION_CONFLICT` en `finished`. e2e: el panel de Vanessa agrupa y muestra contribuciones de Ana y Beto; **abrirlo y leerlo no cambia `stateVersion` ni la escena de Beto**; Beto corrige la observación de Ana desde su teléfono y la proyección muestra «editada por Beto», la versión anterior en el historial y la primera idea intacta. | El conflicto de edición solo es alcanzable con **un** controlador por reconexiones o carreras: se prueba en el componente y en el servidor, no en e2e. |
| 2026-10-06 | P5-02 | `PieceTray` (con texto, no solo forma), aviso de pieza al completar cada mesa (P4), piezas en la esquina del mapa y en el inventor. El dominio ya las derivaba en la misma transición que completa la mesa. | `inventor.test.ts`: **ningún** comando concede piezas (`grantPiece`, `inventor.grantPiece`, `pieces.set` rechazados); el inventor sigue bloqueado sin las tres; al completar quedan `lupa → dialogo → corazon`, también en disco; en `finished` revisitar y explorar mesas completadas **no** añade piezas ni cambia lo registrado. | Sonido y efecto visual de «pieza conseguida»: fase 7. |
| 2026-10-06 | P5-03 | `src/game/scenes/{InventorScene,pieceGlyphs}.ts` (máquina apagada/encendida, tres espacios, las piezas viajan a su espacio y se identifican con su mensaje, tarjeta con la pregunta, Jerry), `src/components/activities/{InventorPanel,FinalQuestionForm}.tsx` (colocar las piezas; elegir una pregunta del cuaderno, una sugerencia, escribir una o decirla en voz alta; tarjeta final, mensaje de cierre, reflexión, «Revisar» cada mesa), `inventor.placePrompt` (contenido editable), `desiredScene`: `final` → `InventorScene`. Sin respuestas generadas. | `notebook.test.tsx`: la indicación y el botón salen de la configuración; «del cuaderno» ofrece **solo preguntas**; sugerida envía solo su ID; oral no envía texto; escrita cuenta, bloquea pasados 280 y su borrador es local; si el servidor deniega se conserva el texto; el final no ofrece elegir otra pregunta; la proyección no tiene botones. `inventor.test.ts`: colocar es de quien tiene el turno y **una sola vez**; la pregunta final llega tras un cambio de turno y pasa la sala a `finished` (también en disco); reenviarla o cambiarla no la reemplaza ni duplica; texto vacío/largo, sugerencia inexistente y «guardada» que no es pregunta se rechazan; final oral. e2e: ambas vistas pasan a la escena del inventor; al colocar, cada pieza muestra su mensaje en la escena; se ofrecen las 3 preguntas guardadas; la tarjeta imprime la pregunta elegida; la sala pasa a «Terminó la aventura». | Revisión de claridad con Vanessa; arte final de la máquina y las piezas. |
| 2026-10-06 | P5-04 | `ActivityPanel`: en `finished` quien tiene el turno sigue actuando (el servidor decide qué vale); «Revisar: [mesa]» vuelve al mapa y la abre; `RoomController.onGenerationChange` borra los borradores del dispositivo al reiniciar la sala. | `inventor.test.ts`: en `finished` se revisita y se explora de nuevo, **no** se reabren los pasos ni se pisa lo registrado; se puede corregir un registro con la revisión esperada; pausa/reanudación en `finished` vuelve a `finished`; **reiniciar la sala** borra avance, registros, piezas y pregunta final, sube la generación, **conserva a las personas**, y un mensaje armado con la generación anterior ya no se aplica; el inventor vuelve a estar bloqueado. `clientController.test.ts`: el aviso de reinicio ocurre solo con un cambio de generación. e2e: revisitar Sombras en `finished` y mover la linterna (las dos vistas coinciden) sin cambiar piezas ni duplicar la pregunta final; reiniciar desde la consola devuelve la proyección a la bienvenida y los teléfonos a la espera, con las dos personas, y **borra un borrador de corrección sin enviar** del teléfono. | |
| 2026-10-06 | P6-01, P6-02 | `server/src/detection.test.ts` (relojes reales; un proxy TCP que **descarta el tráfico sin cerrar nada**, es decir, un corte silencioso: nadie avisa, solo puede notarlo el latido), `RoomController` real como cliente. El latido ya estaba ajustado (`pingInterval` 4 s + `pingTimeout` 5 s). Ya existían y siguen verdes: segunda pestaña que sustituye a la primera, controlador/administradora que pierden la conexión, espera que se desconecta, `room.sync` por papel, cliente que se detiene en sala terminal. Nuevo: el cliente también se detiene cuando la sala **vence** (`clientController.test.ts`). | **Tiempo de detección medido (3 ejecuciones, corte silencioso a ~0,3 s de un latido):** servidor → controlador 8,6 s; cliente del controlador 8,6 s; servidor → administradora 8,7 s. Objetivo ≤ 10 s; peor caso teórico 9 s. Tras el corte: el controlador pausa y pierde el control; la administradora pausa **conservando al propietario**. Al volver la red el controlador reconecta en **espera**, con la sala pausada, sin el estado de la aventura y sin recuperar el turno solo. | Falsos cortes con celulares reales (pantalla que se apaga, wifi↔datos), Safari en segundo plano: P7. |
| 2026-10-06 | P6-03 | `scripts/e2e/restart.ts`: el servidor corre como **proceso aparte** (`node --import tsx`), se juega hasta mitad de una prueba de rampa, se le envía **`SIGKILL`** en un punto cualquiera del ciclo de 500 ms entre checkpoints y se arranca otro proceso con el **mismo archivo SQLite y el mismo puerto**; los clientes son `RoomController` reales y reconectan solos. Añadido a `npm run test:e2e`. | **Retroceso visual medido (3 ejecuciones):** 0, 202 y 302 ms (límite de diseño: el intervalo de checkpoint, 500 ms). El servicio estuvo apagado ~3,3 s y **no se sumó**. Los 5 registros confirmados quedan idénticos; la prueba sigue «en curso» con sus condiciones congeladas; la sala vuelve **pausada y sin propietario**; la controladora anterior regresa **en espera** y sin el estado de la aventura; el turno se renovó. Al dar el turno y reanudar, la prueba terminó en su instante exacto (`inicio + duración`) y tardó lo que le faltaba (2,02 s → 2,06–2,13 s), sin saltar al final ni alargarse. Vanessa recupera la administración con su misma credencial. | Corte de energía real (el modo `synchronous=FULL` ya lo cubre en teoría): P8. |
| 2026-10-06 | P6-04 | `shared/domain/room.ts` (`expireRoom`: transición automática, no comando), `server/src/roomService.ts` (`sweep()` cada `SWEEP_INTERVAL_MS`: vence las salas sin actividad **de la administradora** y elimina las terminales pasada la retención, cada sala dentro de su cola; seguimiento de `adminActiveAt` y `terminalAt`; los puntos de entrada ya no lanzan si la sala fue eliminada), `server/src/socket.ts` (`guard` también atrapa fallos síncronos). Plazo y retención desde el servidor (el servidor prevalece sobre el JSON). Mensaje distinto al unirse a una sala vencida. | `room.test.ts` (4): vence en cualquier fase, no toca el avance, repetirlo no sube versiones, todo comando se rechaza con «venció». `lifecycle.test.ts` (13, reloj de pared controlado): antes del plazo vive; al cumplirse vence, avisa a todas las vistas y cierra conexiones; ficha pública «expired» y unirse da 410; **solo la administradora** mantiene viva la sala (participantes con comandos o con una señal falsa no cuentan; la señal periódica y los comandos de Vanessa reinician el plazo); el plazo del servidor prevalece; si **no se puede guardar** el vencimiento no se anuncia y se reintenta; vencen también las salas en bienvenida y en pausa; hasta la retención se conservan los datos y después se elimina **sala, identidades y comandos** y las credenciales dejan de valer; una sala cerrada se limpia igual y **las demás salas no se tocan**; mensajes tardíos tras la limpieza no rompen nada; si no se puede borrar se reintenta; **tras reiniciar el servicio** el plazo y la retención se calculan con lo guardado. | Valores por defecto (2 h, 24 h) a confirmar con Vanessa. Retención es decisión de implementación, no requisito pedagógico. |
| 2026-10-06 | P6-05 | `src/app/DemoController.ts` (cumple el nuevo contrato `RoomPort`, el mismo que `RoomController`, usando las **mismas funciones puras de `shared/domain`**: `applyAdventureAction`, `applyAdminAction`, `tickRoom`, `buildSimulationFrame`; sin sockets ni `fetch`), `src/components/room/DemoView.tsx` (rótulo «Demostración» siempre visible, pausa, reiniciar, volver a la sala, guía), ruta `/demo` (reemplaza la vista provisional del mapa), `demoPath`/`homePath` con prefijo de despliegue. Estado en un espacio propio (`…:demo:estado`); al recargar vuelve **en pausa** (como Vanessa que recarga) y no suma el tiempo transcurrido; si cambió el contenido o lo guardado está dañado, empieza de cero. | `DemoController.test.ts` (11): recorre las tres mesas, el inventor y la pregunta final hasta `finished`; **produce lo mismo que el dominio puro** con las mismas acciones; las reglas se cumplen (no se salta el orden, acciones libres rechazadas); **no abre sockets ni hace peticiones** (`io`, `fetch`, `WebSocket` y `XMLHttpRequest` sustituidos por funciones que fallan); **solo toca su clave** y ni siquiera lee las de una sala (credencial, borradores) ni guarda tokens; reiniciar solo borra la demostración; pausa congela la prueba y termina en su instante exacto; frames solo mientras algo se mueve; sin almacenamiento sigue en memoria. `app.test.ts`: rutas con prefijo. | Niñas y niños no tienen demostración en el celular: siguen la proyección. |
| 2026-10-06 | P6-06 | `src/app/backup.ts` (`prepareBackup`: con la sala funcionando, la consola de Vanessa descarga el módulo de la demostración y calienta la caché con los recursos del catálogo), oferta **«Usar la demostración»** en `RoomView` a los 5 s de conexión caída (solo a quien administra; no se activa sola), `/demo?from=CÓDIGO` para ofrecer el regreso, `npm run preview:demo`, caché de 1 h para imágenes y sonidos del catálogo en el servidor (los JSON siguen revalidándose), README con el procedimiento y los límites. `scripts/e2e/demo.ts` añadido a `npm run test:e2e`. | `backup.test.ts` (2). **e2e A (backend caído, frontend ya cargado):** sala real con la primera idea de Ana; el módulo de la demostración ya estaba descargado; se apaga el servicio; la oferta aparece a los 5,3 s; al aceptar, el laboratorio se pinta **sin que falle ningún recurso ni petición**; se recorren las tres mesas y el inventor hasta el final; el estado de la demostración queda aparte (sin credenciales ni nada de la sala); vuelve el servicio con el mismo archivo y **la sala sigue con SU estado** (un solo registro, el de Ana; sin piezas; recuperada en pausa; nada de la demostración mezclado). **e2e B (sin red, build local):** `vite preview` sin API; «Crear sala» avisa del fallo; la demostración completa la aventura con la red cortada del todo y **cero peticiones fallidas**; recargar recupera lo guardado en pausa; «Reiniciar la demostración» la deja desde cero. | Ensayo en la computadora y la red reales del día: P8. |
| 2026-10-06 | Verificación fase 4 | `npm run typecheck`, `npm test` (**320 pruebas, 24 archivos**; la suite se repitió **6 veces seguidas sin fallos**), `npm run build`, `npm run test:e2e` (**5 e2e**). Mutación manual de la fase 4: **15 de 15** detectadas (director sin esperar al laboratorio, sin aplazar durante el `create`, caja personal que envía una acción, objetos activos en la proyección, borrar el texto aunque el servidor deniegue, borrador no guardado, «Reiniciar» en Cajas, soltar otra pelota rodando, controles con la respuesta cerrada, slider invertido, primera idea sin destacar, formulario en la proyección, aviso de borrador al perder el turno, reiniciar que borra el cuaderno, Sombras empezando lejos). Capturas en `docs/evidencia/fase4/` (se regeneran con `E2E_EVIDENCE=1`). | | |
| 2026-10-06 | Verificación fase 5 | `npm run typecheck`, `npm run validate:project`, `npm test` (**345 pruebas, 26 archivos**; repetida **6 veces seguidas sin fallos**), `npm run build`, `npm run test:e2e` (5 e2e; `tables.ts` ahora cubre mesas, cuaderno, inventor, revisita y reinicio). Mutación manual de la fase 5: **15 de 15** detectadas (inventor en el laboratorio, corregir la pregunta final, revisión vieja en la corrección, corregir sin cambios, «del cuaderno» con cualquier registro, oral que envía texto, botones de revisar en la proyección, revisar sin poder volver al mapa, reinicio sin aviso al cliente, piezas colocadas dos veces, pregunta final reemplazable, «guardada» que no es pregunta, pregunta final editable, reinicio que conserva el avance, bandeja de piezas). Capturas 17–23 en `docs/evidencia/fase4/`. | | |
| 2026-10-06 | Verificación fase 6 | `npm run typecheck`, `npm run validate:project`, `npm test` (**378 pruebas, 30 archivos**; repetida **6 veces seguidas sin fallos**), `npm run build`, `npm run test:e2e` (**7 e2e**). Mutación manual de la fase 6: **12 de 12** detectadas (vencimiento un instante tarde, señal que no reinicia el plazo, participante que mantiene viva la sala, JSON que prevalece sobre el servidor, vencimiento anunciado sin guardarse, limpieza un instante tarde, limpieza que no borra identidades ni comandos, latido con los valores por defecto de Socket.IO, demostración que acepta contenido ajeno, que no vuelve en pausa, que no se reinicia o que no avisa un rechazo). Capturas en `docs/evidencia/fase6/`. | | |
| 2026-10-06 | P7-02 | `src/app/audio/` (`signals.ts`: señales por transición con línea de base y `effectId`; `player.ts`: un único `AudioContext` creado dentro del gesto, fallos que nunca bloquean; `preferences.ts`: preferencia local; `useAudioSignals.ts`), `src/components/room/SoundControl.tsx` (control y texto equivalente en región `aria-live`) en la consola de Vanessa, el teléfono del controlador y la demostración. `AUDIO_EVENT_IDS` y validación (evento desconocido o recurso que no es sonido). Cinco WAV **provisionales** generados con `tools/audio/generate_sfx.py` y registrados con `placeholder: true`. | Pruebas unitarias y de componente (signals, player, preferencias, hook; 416 en total). e2e `tables.ts`: sin sonido el texto igualmente aparece, no se repite tras una reconexión ni tras reiniciar la sala, el teléfono nunca suena solo. Mutación del código nuevo: **31 de 31** detectadas (a la primera, 25: las 6 que sobrevivieron mostraron huecos —línea de base que no recordaba efectos, reinicio de generación, snapshot viejo con efecto sin ver, fallo al lanzar el sonido, volumen fuera de rango y «activado» guardado tras fallar— y se cerraron con 9 pruebas nuevas). | **Los sonidos son de prueba**: faltan los finales y `presentation` los rechaza. **No se escuchó el audio en ningún dispositivo** (el emulador de Android corrió con `-no-audio` y en el simulador de iOS solo se comprobó el control y su estado). |
| 2026-10-06 | P7-05 | `scripts/load/{capacity,client}.ts`, `npm run test:load` (`LOAD_REPORT=1` escribe `docs/evidencia/fase7/capacidad.{md,json}`): servidor REAL en proceso aparte con SQLite temporal; 50 participantes + administradora, un controlador, 30 cambios de turno, slider a 12 Hz durante 12 s, prueba de rampa con cambio de turno a mitad, 6 entradas tardías y desconexiones. | **Todas las metas comprobables se cumplieron** (bucle local, M3 Pro, Node 24.20): entrada p95 16 ms (meta ≤ 5000), cambio de turno visible en todas las pantallas p95 13 ms / máx 13 ms (< 1000), acción → proyección p95 4,2 ms (< 250), frames a ~10 Hz con separación p95 103 ms, servidor CPU máx 29 % y 130 MiB. Quien espera (40 personas): **0** snapshots completos, **0** frames y **0** presencias; ≈ 12 kB por persona frente a 1,1 MB de la administradora. Quien pierde el turno deja de recibir frames al instante. | **No** valida la red inalámbrica del lugar, ni celulares, ni FPS: los clientes no dibujan y todo corre en la misma computadora. Repetir con celulares en la red real (fase 8). Latencia de un corte silencioso: la sigue midiendo `detection.test.ts` (≈ 8,6 s). |
| 2026-10-06 | P7-06 | `scripts/rehearsal/room.ts` (`npm run ensayo`: sala lista y panel de control para repartir el turno, simular la proyección y capturar), `docs/evidencia/fase7/` (iOS iPhone SE, Chrome Android 411 y 360 dp, proyección 1920×1080 y 1366×768). | Probado a mano en **Safari de iPhone SE (simulador, iOS 18.2)** y **Chrome de Android 15 (emulador)**: entrar a la sala, mapa con menús, formularios de las mesas, slider, activar sonido, borradores que se conservan y semántica de turnos al recargar. **Defectos hallados y corregidos** (ver lista abajo): la barra del mapa, botones de acciones, `interactive-widget` del teclado, botón de compartir fuera de la vista, círculos de color aplastados. | **No se probó**: celulares físicos, el teclado de iOS con el campo de texto de las mesas (el simulador quedó en teclado físico), reducción de movimiento en un dispositivo, FPS, Rampas/Cajas/Inventor en Android, el equipo y proyector de la exposición ni la conexión real del lugar. Esto **no** cierra CA-01–CA-05 en dispositivos reales. |
| 2026-10-06 | Verificación fase 7 | `npm run typecheck`, `npm run validate:project`, `npm test` (**416 pruebas, 34 archivos**; repetida **6 veces seguidas sin fallos**), `npm run build`, `npm run test:e2e` (7 e2e), `npm run test:load`. Mutación de interfaz: MapBar (3 de 3 detectadas tras añadir la comprobación del sentido inverso), revelado del botón con el teclado, mensaje de cierre duplicado, círculos de color; sobrevive «la barra se parte en varias filas» (equivalente a 360 px: las tres piezas caben en una). | Ver los defectos de la fase 7 abajo, en particular **dos comprobaciones e2e con falsos fallos** (`===` entre decimales; toque perdido tras «Volver al mapa»). | P7-01, P7-03 y P7-04 sin hacer; P7-06 parcial. |

**Defectos que la propia verificación sacó a la luz y se corrigieron** (evidencia de que las pruebas tienen dientes):

- La prueba de segmento **muestreaba** cada 2 px y dejaba pasar roces de esquina diagonales: ahora es una prueba **exacta** (rectángulo ampliado y recorte de segmento), con una prueba que construye un roce de ~0,15 px que el muestreo no ve.
- El reductor trataba una acción **desconocida** como «válida y sin cambios»: ahora la rechaza (y el `switch` es exhaustivo en tipos).
- `validateProject` devolvía solo los problemas de la configuración y ocultaba los del mapa; y `mode: "presentation"` no rechazaba los recursos provisionales del **mapa**.
- `configHash` incluía la línea `$schema` (metadato del editor): tocarla invalidaba las salas ya creadas. Ahora se excluye y hay prueba.
- `tickRoom` no devolvía el reloj al día cuando no había progreso (necesario para el checkpoint de SPECS 6.1).
- `RoomController` marcaba «conectada» al abrir el socket y conservaba presencia, snapshot y resumen **anteriores a la caída**: la interfaz podía actuar sobre estado viejo. Ahora solo pasa a «conectada» con el resumen de la conexión nueva.
- **Pruebas intermitentes** (1 de cada 5–15 ejecuciones): un proceso local ajeno (ayudantes de VS Code) tenía el mismo puerto en `127.0.0.1` que el SO asignó a mi servidor de pruebas enlazado a la interfaz comodín. Ahora `HOST` es configurable y las pruebas enlazan a `127.0.0.1`.
- **Fase 3.** El ancla del reloj de simulación se fijaba *después* del commit; con `synchronous=FULL` ese tiempo se perdía del reloj en cada guardado. Ahora es el instante en que se calculó la transición.
- **Fase 3.** El anti-rebote de toques medía con el reloj de la escena (que Phaser detiene en páginas en segundo plano) y descartaba toques válidos; ahora usa `performance.now()`.
- **Fase 3.** El menú «Mesas» quedaba abierto sobre el mapa y tapaba el punto que se iba a tocar; ahora se cierra al elegir. Los paneles de la consola pasaron a una fila para no quitarle altura al mapa proyectado.
- **Fase 3 (higiene).** Cada e2e reescribía las capturas versionadas: ahora solo se escriben con `E2E_EVIDENCE=1`.
- Dos «capturas» iniciales eran artefactos de mirar un panel de navegador **oculto** (`requestAnimationFrame` no corre): los e2e usan Chromium visible/headless donde sí corre.
- **Fase 4.** Al arrancar el juego con una mesa ya abierta (nuevo controlador, recarga) el **laboratorio no se detenía** y quedaba en marcha junto a la escena de la mesa: el director intentaba parar una escena desde su propio `create` (Phaser la deja en marcha al terminar) o antes de que existiera. Ahora espera a que el laboratorio esté listo y, si está creándose, aplaza el cambio al final del fotograma. Lo encontró el e2e (`escenas activas: LaboratoryScene,ShadowsScene`); hay prueba unitaria con un `Phaser.Game` simulado.
- **Fase 4.** Con la ventana reducida por el teclado, el escenario (con `min-height` propio) **desbordaba su celda y tapaba el campo de texto**; la comprobación «está dentro de la ventana» pasaba igual, así que el e2e pasó a comprobar con `elementFromPoint` que **nada lo cubre**. El mismo ensayo destapó otros dos: los elementos «solo para lectores de pantalla» (posición absoluta) tomaban la ventana como referencia y al desplazar el panel **alargaban el documento y subían el aviso «Es tu turno»** (ahora el panel es su referencia y `.visually-hidden` no suma altura); y el aviso temporal de la parte inferior **interceptaba el toque** sobre «Compartir» (ahora no captura punteros).
- **Fase 4.** Un primer intento de reducir el escenario *mientras se escribe* (`:has(textarea:focus)`) movía el botón «Compartir» al perder el foco en mitad del toque; se descartó: la reducción depende de la **altura de la ventana**, no del foco.
- **Fase 4.** `movement.ts` leía la posición de Vanessa del sprite del laboratorio con la mesa abierta; ahora que la escena de la mesa lo reemplaza, lo lee del snapshot.
- **Fase 5.** Al terminar la aventura el mensaje de cierre aparecía **dos veces** en la pantalla del inventor (la franja provisional del mapa y la tarjeta final): un lector de pantalla lo habría leído dos veces. La franja ahora solo sale fuera de la vista del inventor. Lo mostró el e2e (un localizador de texto encontraba dos elementos).
- **Fase 5 (visual, visto en las capturas).** Los mensajes de las piezas quedaban cruzados por los tubos de la máquina y el halo de la máquina encendida tapaba su pantalla como un disco; el corazón mostraba líneas del contorno dentro del relleno. Se reordenó el dibujo (halo detrás, tubos bajo los mensajes) y el corazón se contornea solo por fuera.
- **Fase 5.** Con la ventana en `finished`, un `interactive = canAct && running` habría dejado la mesa **sin controles** al revisitarla (solo se podía mirar). Se detectó antes de ejecutar el e2e de revisita: ahora `interactive = canAct` y el servidor decide qué sigue siendo válido.
- **Fase 6 (incidente de prueba, mío).** La primera versión del e2e de la demostración sirvió el build con `vite preview`, que **hereda el proxy de `/api` y `/socket.io` hacia el puerto 3001**: allí estaba el servidor de desarrollo que alguien tenía encendido, y «Crear sala» **creó una sala de verdad en su base de desarrollo**. Una sala vacía, en bienvenida, que vence sola por el nuevo barrido y se limpia a las 24 h; no se tocó nada más. Corregido: la prueba arranca la vista previa con `PORT` apuntando a un puerto sin nadie, y queda anotado en las particularidades del entorno.
- **Fase 6 (riesgo hallado al diseñar la limpieza).** Un comando, una señal de actividad o un `room.sync` de una conexión que sobrevive a la eliminación de su sala lanzaba una excepción síncrona dentro del manejador del socket. Ahora responden «la sala ya no está disponible» y `guard` atrapa también los fallos síncronos; hay prueba.
- **Fase 7 (audio).** El primer snapshot que llegaba mientras el cliente estaba «reconectando» fijaba la línea de base antes de tiempo y la reconexión repetía celebraciones: ahora se ignoran los snapshots que llegan sin conexión vigente (prueba). Los seis huecos que dejó ver la mutación del código nuevo están en la fila de P7-02.
- **Fase 7 (duplicados de lectores de pantalla).** El mensaje de cierre y los avisos de pieza salían a la vez en el panel, en la región viva del audio y en la franja del mapa; el e2e lo encontró con localizadores estrictos. Los avisos de pieza dejaron de ser `role="status"`, la señal tiene un texto propio y la franja ya no sale en la vista final.
- **Fase 7 (visto en el iPhone SE simulado).** Con las piezas y el cuaderno como elementos sueltos en dos esquinas, el cuaderno abierto **tapaba los botones de las mesas**. Se reemplazó `MapHud` por una barra de una fila (`MapBar`: Mesas · piezas · Cuaderno) con paneles que se abren debajo y de uno en uno. Un fallo propio en el camino: cerrar un menú porque se abre el otro disparaba su evento de cierre y pisaba al nuevo (corregido con `setOpen` funcional; el e2e comprueba ambos sentidos tras la mutación).
- **Fase 7 (visto en Chrome para Android).** (1) Las dos acciones de cada paso se partían en dos filas a 360 dp: ahora van en una fila bajo 420 px. (2) Por defecto Chrome de Android **no reduce la página al abrir el teclado** y lo deja encima del formulario: `index.html` declara `interactive-widget=resizes-content`; además, al enfocar el campo se lleva a la vista el botón de compartir y el campo queda encima (el e2e comprueba que se ven a la vez). (3) Los círculos de color se aplastaban en columnas estrechas: `flex: none` y una prueba e2e a 320 px (reproduce el defecto sin el arreglo).
- **Fase 7 (pruebas con falsos fallos, mías).** (1) Tres comprobaciones e2e comparaban con `===` el resultado de `(inicio + duración) − inicio`, que en coma flotante puede diferir en 1 ulp según el instante de inicio: fallaba en 2 de 6 ejecuciones del e2e de mesas medidas bajo carga. Ahora usan tolerancia de 1e-6 (igual que el ensayo de capacidad, que tuvo el mismo error). (2) `movement.ts` (fase 3) falló por tiempo de espera —un toque perdido tras «Volver al mapa» o el sprite aún sin crear— en 3 de 10 ejecuciones con el código de la fase 7 y en 2 de 6 con el commit anterior a ella (copia limpia), **mientras el equipo tenía una carga anómala** (promedio de 15 min ≈ 190); con la carga ya baja pasó **10 de 10** (5 de cada versión, alternadas). No es una regresión de la fase 7, pero la causa no está demostrada: queda pendiente que esos e2e esperen condiciones explícitas de «escena lista» en lugar de pausas fijas (se probó esperar a que la escena esté activa y no bastó, así que no se dejó).
- **Fase 7 (ensayo de capacidad, mío).** Las primeras versiones medían desde un origen equivocado, comparaban decimales con igualdad exacta y contaban en «todos ven al controlador» a clientes que ya se habían cerrado.
- **Fase 7 (higiene).** Dos comentarios de documentación seguidos en `MapBar` (el segundo describía la lógica de `setOpen`): unificados. Las capturas de la fase 4 se regeneraron a propósito con `E2E_EVIDENCE=1` porque la barra del mapa cambió; las de las fases 2 y 3 siguen mostrando el HUD anterior.

Para decisiones que cambien arquitectura o alcance:

| Fecha | Decisión | Motivo | Cambio en SPECS | Tareas afectadas |
| --- | --- | --- | --- | --- |
| 2026-10-05 | `engines.node` ≥ 22.12 | `better-sqlite3` 13 exige Node ≥ 22; Vite ≥ 22.12. | Ninguno (SPECS 7.1 pedía elegir y documentar). | P0-02 |
| 2026-10-05 | `base` de Vite absoluta (`/`), configurable con `VITE_BASE`. | Con `./` las rutas de entrada `/sala/ABC234` resolverían recursos relativos al segmento de la sala (CT-16). | Ninguno. | P0-02, P1-05 |
| 2026-10-05 | Endpoint `GET /api/rooms/:code`, acción `shadows.surprise.ack`, `configMismatch` en `room.summary` y los campos de configuración nuevos. | La entrada debe confirmar la sala sin entrar; la sorpresa de Sombras es un clic opcional que merece acción propia; la incompatibilidad de revisión debe verse. | **Sí:** SPECS 5.1, 5.2, 5.3 y 9.3. | P1-01, P1-02, P2-01 |
| 2026-10-05 | Audio de Phaser desactivado (`noAudio`) hasta P7-02. | Con StrictMode se cerraba un `AudioContext` que aún arrancaba. Al incorporar sonido hay que crearlo bajo un gesto del usuario. | Ninguno. | P1-05, P7-02 |
| 2026-10-05 | Definiciones de frames en `shared/config/` (no en `src/`). | Las usan el validador de la CLI, el servidor y el frontend. | Ninguno. | P0-01, P1-05 |
| 2026-10-05 | Módulo del mapa (con Phaser) con carga diferida y precarga en la espera. | SPECS 11.2: cargar por necesidad; permitido precargar el módulo sin crear canvas ni pedir datos privados. | Ninguno. | P2-06, P7-04 |
| 2026-10-05 | El cliente solo está «conectado» con el resumen de la conexión nueva; presencia y snapshot viejos se descartan al reconectar. | Evitar actuar sobre estado anterior a la caída (SPECS 5.4). | Ninguno. | P2-06, P6-01 |
| 2026-10-05 | `HOST` configurable (por defecto `0.0.0.0`); pruebas y e2e enlazan a `127.0.0.1`. | Ver defectos corregidos. | Ninguno. | P2-02 |
| 2026-10-05 | Reloj de simulación del cliente (`ClientClock`): snapshots lo fijan y frames lo ajustan; la escena dibuja desde él. | SPECS 5.6: «reloj local ajustado por las muestras del servidor; el tiempo del dispositivo no decide el resultado»; leer `base + (ahora − ancla)` evita «adelantar» tras una pestaña oculta. | Ninguno. | P3-02 |
| 2026-10-05 | La escena emite **intenciones en coordenadas de mundo** (`move`, `openStation`); la aplicación las traduce en comandos. Tipo `MapIntent` en el puente en lugar de `AdventureAction`. | SPECS 7.2: Phaser no decide ni habla con el servidor. | Ninguno (SPECS 10.2 ya pedía «intención tipada»). | P3-03 |
| 2026-10-05 | Cámara `fit` para la proyección y `follow` para el controlador (≈520 px de mundo en vertical, 900 en horizontal, zoom ≤ 2,5). | SPECS 2.4: cada dispositivo adapta cámara y composición. | Ninguno. | P3-03 |
| 2026-10-05 | `tickIntervalMs` = 100 y `checkpointIntervalMs` = 500 como ajustes del servidor. | SPECS 5.6 (10 Hz) y 6.1 (≈ 500 ms). | Ninguno. | P3-01 |
| 2026-10-05 | Los esquemas JSON pasan de `public/config` y `public/assets` a `shared/config/schemas/`. | Vite avisa «Assets in public directory cannot be imported from JavaScript» y podría convertirlo en error; los esquemas son código de validación, no archivos servidos. | **Sí:** SPECS 7.3 y 9.3 (`$schema`). | P1-01, P1-02 |
| 2026-10-06 | Cada mesa abierta tiene **su propia escena de Phaser** (`ShadowsScene`, `RampsScene`, `BoxesScene`) en el mismo `Phaser.Game`; un `SceneDirector` cambia de escena según `adventure.view` del snapshot. El dibujo es procedimental sobre un escenario lógico de 960×540; los controles y formularios son HTML fuera del canvas. | SPECS 10.1 (escenas separadas por mesa, un solo juego) y 11.1 (controles accesibles). Sin arte final aún, el dibujo con formas simples evita acoplarse a assets provisionales. | Ninguno. | P4-01 a P4-03 |
| 2026-10-06 | Los textos de cada paso (`prompts`) son **contenido editable** de `laboratorio.json` y obligatorios por tipo de mesa (`REQUIRED_PROMPTS`); el validador rechaza los que faltan y los pasos desconocidos. | SPECS 9.1: el contenido pedagógico no vive en el código. | **Sí:** SPECS 9.1 (nota de campos) añade `prompts`. | P4-01 a P4-04 |
| 2026-10-06 | La linterna de Sombras **empieza en el extremo cercano** del rango (`d = 10 cm`). | La sorpresa del paso 1 es una sombra grande de un objeto pequeño; SPECS 3.2 no fija la posición inicial. | Nota en SPECS 3.2. | P4-01 |
| 2026-10-06 | Los borradores viven solo en el dispositivo (`localStorage` con respaldo en memoria, clave por proyecto/sala/mesa/campo); se borran al compartir, al salir de la sala y al terminar. Perder el turno con texto sin compartir añade un aviso (`RoomController.turnLossHint`). | SPECS 3.1. | Ninguno. | P4-04 |
| 2026-10-06 | «Reiniciar experimento» se ofrece en Sombras y Rampas, **no en Cajas**. | En Cajas solo repondría la selección de un objeto; el botón confundiría. El reducer lo admite en las tres mesas (SPECS 3.5). | Ninguno. | P4-03 |
| 2026-10-06 | Con la proyección (sin turno) la mesa es de **solo lectura**: sin campos ni botones, solo texto, lo ya compartido y, de las mesas en curso, la indicación del paso. | SPECS 3.1 y CA-20: lo no confirmado nunca se proyecta. | Ninguno. | P4-04 |
| 2026-10-06 | El inventor tiene **escena propia** (`InventorScene`) en lugar de ser una vista del laboratorio. | SPECS 10.1 dice que «puede» ser una vista del laboratorio; una escena cercana permite ver los tres espacios, las piezas viajando y la tarjeta con la pregunta, igual que las mesas. El mapa conserva la máquina apagada/encendida. | Ninguno. | P5-03 |
| 2026-10-06 | `inventor.placePrompt` es contenido editable obligatorio (indicación antes de colocar las piezas). | SPECS 9.1: los textos pedagógicos no viven en el código. | **Sí:** nota de campos de SPECS 9.1. | P5-03 |
| 2026-10-06 | El cuaderno es de lectura para la administradora que observa y editable solo para quien tiene el turno; la pregunta final no se edita. «Revisar» una mesa completada son dos comandos (volver al mapa y abrirla), el segundo solo si el primero se aceptó. | SPECS 2.2 y 3.5. | Ninguno. | P5-01, P5-03 |
| 2026-10-06 | Los iconos de las piezas son SVG y formas de Phaser, sin asset: el catálogo no tiene arte de las piezas y no se inventa uno. | Evitar acoplarse a recursos provisionales. | Ninguno. | P5-02, P5-03 |
| 2026-10-06 | El vencimiento es una transición automática del dominio (`expireRoom`), no un comando; un barrido del servidor (cada 30 s, `SWEEP_INTERVAL_MS`) vence salas sin actividad de la administradora y elimina las terminales tras 24 h (`TERMINAL_RETENTION_MS`) en cascada. El plazo se cuenta con la hora guardada, así que sobrevive a un reinicio. | SPECS 6.3: solo la administradora mantiene viva la sala; limpieza dentro de las siguientes 24 h. | Ninguno. | P6-04 |
| 2026-10-06 | Contrato `RoomPort` (estado observable, frames, `adventure`, `admin`, avisos) que cumplen `RoomController` (servidor) y `DemoController` (local). Las vistas de la aventura dependen del contrato, no de la clase. | SPECS 6.4: «sustituyendo solo transporte y persistencia». | Ninguno. | P6-05 |
| 2026-10-06 | La demostración es de **una sola persona**: Vanessa es administradora y quien explora, empieza directamente en el mapa y se recarga en pausa. | No hay participantes ni turnos que repartir; la recarga reproduce la regla de la administradora que recarga. | Ninguno. | P6-05 |
| 2026-10-06 | Pasar a la demostración es **siempre decisión de Vanessa**: a los 5 s de conexión caída se le ofrece el botón; no hay cambio automático. Al volver, la sala se retoma desde su credencial y no se fusiona nada. | SPECS 6.4: «Vanessa decide entrar al respaldo». | Ninguno. | P6-06 |
| 2026-10-06 | Imágenes y sonidos del catálogo se sirven con caché de 1 h; los JSON editables siguen revalidándose. | Sin ello, una página ya abierta no podía volver a pintar el laboratorio dentro de la demostración con el servidor apagado: el navegador revalidaría contra un servidor que no responde. | Ninguno. | P6-06 |
| 2026-10-06 | El audio lo reproduce un módulo propio (`src/app/audio/`, Web Audio con un único contexto creado dentro del gesto), no el audio de Phaser, que sigue con `noAudio`. Los efectos se derivan de **transiciones del estado** con la línea de base del primer snapshot, `effectId` y generación; lo que el servidor no marca como efecto (campanita, posición anotada) se deduce comparando con el snapshot anterior. | Phaser crea su contexto al arrancar el juego, no bajo un gesto (era lo que cerraba contextos con StrictMode); la proyección y el teléfono necesitan reglas distintas (el teléfono nunca se activa solo; la computadora retoma «activado» con el primer gesto). | **Sí:** nota en SPECS 10.4. | P7-02 |
| 2026-10-06 | El conjunto de eventos de audio es cerrado y suma `adventure.finished` a los cuatro del ejemplo de SPECS; un evento desconocido o un recurso que no es sonido es error de validación. Cada señal tiene su texto en `ui.labels`. | SPECS 10.4 pide texto equivalente para cada señal importante y la dirección visual menciona el sonido de cierre. | **Sí:** nota en SPECS 10.4. | P7-02 |
| 2026-10-06 | Los sonidos son generados y provisionales (`placeholder: true`); `presentation` los rechaza. | No hay recursos sonoros finales y SPECS prohíbe copiar los tonos de prueba de la referencia. | Ninguno. | P7-02, P7-01 |
| 2026-10-06 | `MapBar` sustituye a `MapHud` y al botón de mesas suelto: una fila, paneles debajo y de uno en uno; los huecos no capturan toques. | Defecto visto en el iPhone SE simulado (ver defectos). | Ninguno. | P7-03, P7-06 |
| 2026-10-06 | `interactive-widget=resizes-content` en el `viewport` y desplazamiento del botón de compartir al enfocar el campo. | Chrome de Android no reduce la página con el teclado por defecto. No se sabe si Safari de iOS respeta la declaración. | **Sí:** nota en SPECS 11.1. | P7-03, P7-06 |
| 2026-10-06 | El ensayo de capacidad usa un servidor real en otro proceso con SQLite temporal y clientes Socket.IO que no dibujan, y mide con relojes reales; mide desde el instante de la acción, no del envío en cola. | Aísla el protocolo y el servidor del renderizado; es reproducible. Sus límites están escritos en el informe. | Ninguno. | P7-05 |
| 2026-10-06 | `npm run ensayo` (sala lista + panel de control con `/viewport` y `/shot`) es una herramienta de ensayo, no parte del producto; escucha en `0.0.0.0` (3400/3412) para que los celulares de la red la vean. | Probar en dispositivos exige repartir turno y simular la proyección sin dos personas. | Ninguno. | P7-06 |

### Matriz de cierre

| Grupo de criterios | Fases responsables | Evidencia final | Estado |
| --- | --- | --- | --- |
| CA-01–CA-05 | 2 y 7 | Sala/entrada/espera y cambio de vista. | **Parcial:** servidor y e2e en Chromium ✔ (capturas fase 2); entrada, espera y mapa probados además en Safari de iPhone SE (simulador) y Chrome de Android (emulador) — **no** en celulares físicos ni en el equipo proyectado. |
| CA-06–CA-13 | 2 y 3 | Movimiento, control exclusivo, pausa y acciones tardías. | **CA-06 ✔** (mismo movimiento en teléfono y proyección, e2e). **CA-07 a CA-10, CA-12 y CA-13 ✔.** **CA-11 ✔** pausa mid-rampa en el servidor de punta a punta y vista en teléfono y proyección (e2e: el reloj queda quieto y la prueba termina a su hora exacta). Sin probar en dispositivos reales. |
| CA-14–CA-21 | 4 y 5 | Experimentos y registros compartidos. | **CA-14 a CA-21 ✔ en Chromium** (las tres mesas completas desde dos teléfonos y la proyección; caja personal sin acción de apertura; predicción «Todavía no sé» y preguntas sugeridas permiten completar; **cuaderno** agrupado por mesa con autor, primera idea distinguida, ediciones con revisión esperada e historial; borradores que no se proyectan ni viajan por la red; panel de Vanessa que no interfiere con quien explora). Sin dispositivos reales ni revisión pedagógica. |
| CA-22–CA-23 | 5 | Piezas e inventor idempotentes. | **CA-22 y CA-23 ✔ en Chromium:** piezas derivadas sin comando directo, colocación única, pregunta final única, revisita sin copias, reinicio de sala que conserva a las personas y descarta mensajes viejos (integración con Socket.IO real + e2e). Sin dispositivos reales. |
| CA-24–CA-30 | 2 y 6 | Reconexión, durabilidad, pestañas y aislamiento. | **CA-24 a CA-30 ✔ en integración y e2e:** desconexión del controlador y de la administradora medida con cortes silenciosos (≈ 8,6 s, objetivo ≤ 10 s); quien regresa vuelve en espera; recarga de Vanessa recupera la administración con la sala pausada; **reinicio real del proceso con `SIGKILL`** a mitad de una prueba (retroceso ≤ 302 ms medido, sin sumar el tiempo apagado); segunda pestaña; cierre; vencimiento y limpieza; aislamiento entre salas. Sin celulares ni red reales. |
| CA-31 | 7 | Reporte de capacidad y latencia. | **Parcial:** `npm run test:load` con 50 + 1 conexiones cumple las metas comprobables y quien espera no recibe snapshot ni frames (informe en `docs/evidencia/fase7/`), pero en bucle local y sin FPS: falta la red del lugar y celulares reales. |
| CA-32–CA-33 | 6 y 7 | Respaldo y alternativas accesibles. | **CA-32 ✔ en Chromium** (la demostración recorre las tres mesas y el inventor sin servidor y con la red cortada; su estado queda aislado de la sala, que al volver sigue con el suyo). **CA-33 parcial:** con el audio apagado todo se completa y cada señal tiene su texto (e2e y pruebas); teclado y −/+ en Chromium; el teclado de pantalla se probó en el emulador de Android pero **no** en iOS; los sonidos son provisionales. |
| CT-01–CT-03 | 1 y 3 | TMJ nativo y navegación coherente. | **CT-01, CT-02 y CT-03 ✔** (misma implementación y prueba exacta de segmento en servidor y navegador; no se atraviesan obstáculos ni esquinas; verificado en pantalla). |
| CT-04–CT-06 | 3 y 7 | Ciclo de Phaser, snapshots y render. | **CT-04 ✔** (StrictMode, 6 cambios de turno: un canvas, listeners estables; el audio usa un único contexto aunque se monten varios reproductores). **CT-05 ✔** (reconexión: nueva pestaña, regreso tras un corte y tras reiniciar el servicio). **CT-06 ✔** en transporte (frames sin avisos al estado de React); **FPS y renders en celulares: sin medir** (P7-04); en el emulador de Android sin GPU Phaser, que redibuja a 60 fps incluso en reposo, resultó pesado. |
| CT-07–CT-08 | 1 y 4 | Modelos coherentes. | **CT-07 y CT-08 ✔** (la misma fórmula dibuja y describe la sombra; la pelota sale del reloj de simulación; teléfono y proyección dibujan la misma distancia y la misma medida). |
| CT-09–CT-12 | 2 y 6 | Validación, secretos y transacciones. | **CT-10, CT-11 y CT-12 ✔.** CT-09: snapshots, resumen, QR y enlace sin tokens ✔; los logs no los registran por diseño pero no hay prueba de logs. |
| CT-13–CT-14 | 6 | Paquete coherente y demo aislada. | **CT-13 ✔.** **CT-14 ✔ en Chromium:** la demostración funciona con el backend apagado y desde el build local sin red, y no sincroniza avances al volver. Falta ensayarlo en el equipo real (P8). |
| CT-15–CT-16 | 0, 1 y 7 | Assets/frames y rutas de despliegue. | **CT-15 ✔.** CT-16 parcial: rutas y base probadas en el enrutador; falta desplegar bajo un prefijo real. |
| Validación pedagógica | 8 | Comprensión y ensayo con Vanessa. | Pendiente. |

<a id="plan-6"></a>

## 6. Instrucción de arranque para Claude u otra IA de implementación

~~~text
Lee primero .claude/SPECS.md, después .claude/PLAN.md y el PRD.
Usa Juanes-22/bitacora-amorcito como referencia, sin modificar la bitácora original.
Verifica las versiones reales y reutiliza solo módulos/assets pertinentes.
Conserva React + Vite + TypeScript + Phaser 4 y añade servidor TypeScript,
Socket.IO y SQLite para la sala compartida.

Empieza por P0 y P1 y luego construye una prueba con administradora
y dos participantes antes de pulir el arte.
El TMJ es la única fuente espacial: se guarda en public/maps y se carga
directamente con Phaser. No generes maps.json ni placements ni introduzcas
un importador/exportador intermedio.

El servidor decide permisos, progreso y resultados.
La demostración local usa el mismo dominio con estado separado.
Implementa fases con sus verificaciones y registra evidencias en PLAN.md.
No marques requisitos cumplidos por disponer de ejemplos, capturas
conceptuales o código que todavía no se ha ejecutado.
~~~

