# PLAN.md — Construcción de El laboratorio de las cosas cotidianas

**Expositora:** Vanessa Estrada.  
**Documento rector:** [SPECS.md](SPECS.md).  
**Versión documental:** 1.0 · 5 de octubre de 2026.  
**Estado:** fases 0, 1 y 2 construidas y verificadas (registro en §5); fases 3 a 8 pendientes. Lo que sigue sin verificar está indicado en cada fila de §5 y en la matriz de cierre; no se acredita nada por haber redactado estos documentos.

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

- [ ] **P3-01 — Implementar trayectos autorizados.** moveTo, conversión pantalla/mundo, pathfinding con huella de pies, límites y esquinas; plan calculado en servidor desde MapIndex.
- [ ] **P3-02 — Dibujar el mismo plan.** GameBridge tipado, snapshot retenido, frameSeq y reloj cliente; escenas renderizan/interpolan sin física independiente ni posiciones de teléfono como autoridad.
- [ ] **P3-03 — Integrar entrada y aperturas.** Tap/clic en mapa/mesa, navegación rápida accesible, permisos y proximidad solo donde aplica; conservar orden de route.
- [ ] **P3-04 — Verificar ciclo y bloqueos.** Una instancia por host, limpieza al perder turno/desmontar, tokens de escena, ready/sync y foco de formularios. Pausa colectiva separada de paneles locales.

**Salida verificable:** teléfono mueve a Vanessa/Jerry, proyección refleja la trayectoria y cambiar de jugador conserva posición/vista. Espera no recibe frames de simulación.

**Pruebas esenciales:** tocar tras pared; destino fuera de mapa; cambio de turno durante movimiento; pausa/reanudación; redimensionar; pestaña oculta/vuelta; Strict Mode; desmontajes repetidos.

**Evidencia:** video breve de dos dispositivos o capturas secuenciales con mismo plan; medición preliminar de latencia; conteo de hosts/listeners sin duplicación.

### 2.4. Fase 4 — Tres mesas con estado compartido

**Especificación:** [1](SPECS.md#spec-1), [3](SPECS.md#spec-3), [5.6](SPECS.md#spec-5), [10](SPECS.md#spec-10).  
**Criterios:** CA-11, CA-14–CA-21; CT-07–CT-10.

- [ ] **P4-01 — Sombras.** Sorpresa, primera idea, slider/−/+, dos muestras distintas, observación y pregunta. Modelo único, primera idea conservada y reacción breve de Jerry.
- [ ] **P4-02 — Rampas.** Respuesta cerrada, Tengo una pregunta, pregunta/predicción, controles y dos pruebas comparables. trialId, parámetros congelados, duración visual coherente y final autorizado por servidor.
- [ ] **P4-03 — Cajas.** Explorar objetos compartidos; pedir permiso; negativa; confirmación/respeto; nueva pregunta ligada a objeto compartido. Sin contenido ni acción de apertura de caja personal.
- [ ] **P4-04 — Formularios comunes.** Modalidades escrita/sugerida/oral/incertidumbre según campo, 280 caracteres, borradores locales, aviso de publicación al grupo y respuesta a denegaciones.
- [ ] **P4-05 — Probar pasos entre jugadores.** Repartir cada mesa entre dos o tres identidades; cambiar turno antes/después de confirmar; pausa en prueba; reset de experimento sin borrar progreso confirmado.

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

- [ ] **P5-01 — Construir cuaderno compartido.** Mostrar ideas, pruebas y autor; distinguir primera idea/observación; ediciones con revisión esperada e historial. Panel local de Vanessa sin interferir con el controlador.
- [ ] **P5-02 — Derivar y conceder piezas.** Completar mesa y añadir pieza en una transición durable; efecto identificado una sola vez; repetir visita/comando no duplica.
- [ ] **P5-03 — Implementar inventor y final.** Tres espacios, colocar piezas, elegir/escribir pregunta o modalidad oral, tarjeta final y reflexión. Sin respuestas generadas por IA.
- [ ] **P5-04 — Implementar revisitas y reinicios.** Fase finished permite consultas/exploración controlada; reset de experimento conserva evidencia; reset de sala vuelve a bienvenida y conserva identidades.

**Salida verificable:** recorrido completo con tres piezas y pregunta final. Reabrir una mesa, reenviar cierre o cambiar jugador no concede copias. Los registros se mantienen al volver al mapa.

**Pruebas esenciales:** cierre repetido; pieza derivada sin comando directo; edición concurrente/revisión antigua; pregunta seleccionada del cuaderno; final oral; reset de sala seguido de mensaje viejo.

**Evidencia:** captura del cuaderno con contribuciones de varias personas; inventario final y pregunta; pruebas de idempotencia.

### 2.6. Fase 6 — Continuidad y demostración local

**Especificación:** [5](SPECS.md#spec-5), [6](SPECS.md#spec-6), [9](SPECS.md#spec-9), [10](SPECS.md#spec-10).  
**Criterios:** CA-19, CA-24–CA-28, CA-32; CT-05, CT-10–CT-14.

- [ ] **P6-01 — Completar reconexión segura.** Snapshot al regresar, entradas canceladas, sin replay automático de gestos; controlador anterior en espera; administración recuperada mediante credencial.
- [ ] **P6-02 — Verificar desconexiones y reemplazo.** Ajustar heartbeat; pausar y revocar al controlador; pausar al perder Vanessa; ignorar desconexión de socket sustituido; detener reconexión de salas terminales.
- [ ] **P6-03 — Verificar reinicio real del servicio.** Checkpoints de reloj/movimiento, resultados durables, sala recuperada pausada y sin sumar downtime; mismatches de configuración preservan datos.
- [ ] **P6-04 — Implementar vencimiento/limpieza.** Actividad administrativa autenticada, TTL, revocación y eliminación de identidades/comandos/datos de sala.
- [ ] **P6-05 — Implementar DemoController.** Mismo dominio, reglas y escenas; estado separado, rótulo visible; ningún socket ni escritura a una sala desconectada.
- [ ] **P6-06 — Preparar respaldo utilizable.** Recursos mínimos cargados y build local; procedimientos para backend caído y pérdida completa de red. Volver al último estado confirmado de sala sin fusionar demo.

**Salida verificable:** se puede recuperar una sala tras recarga/reinicio sin perder registros confirmados. Si falla el servicio, la exposición puede continuar desde demo; al volver, la sala sigue con su estado propio.

**Pruebas esenciales:** corte abrupto de controlador y administradora; nueva pestaña; reinicio en mitad de rampa; acknowledgment perdido; DB inaccesible; config cambiada; backend apagado; demo local sin red.

**Evidencia:** test de integración que reinicia realmente el proceso y usa el mismo archivo SQLite; registro de tiempo de detección y retroceso visual; ensayo de respaldo con la red deshabilitada.

### 2.7. Fase 7 — Acabado, accesibilidad y capacidad

**Especificación:** [9](SPECS.md#spec-9), [10](SPECS.md#spec-10), [11](SPECS.md#spec-11).  
**Criterios:** CA-04–CA-06, CA-20, CA-31, CA-33; CT-04, CT-06, CT-09, CT-15, CT-16.

- [ ] **P7-01 — Integrar arte definitivo.** Laboratorio, objetos, secundarios, piezas/inventor y animaciones mínimas; conservar diseño de Vanessa/Jerry y metadata real; retirar placeholders en modo presentation.
- [ ] **P7-02 — Integrar audio opcional.** Recursos finales, silencio inicial en celulares, activación mediante gesto, señales textuales y deduplicación de efectos; no bloquear actividades si falla audio.
- [ ] **P7-03 — Ajustar layouts y teclado.** Vertical desde 360 px; controles táctiles, formularios con teclado abierto, foco y −/+; moderación plegable y resultados visibles en proyección.
- [ ] **P7-04 — Optimizar carga y render.** Solo recursos referenciados, carga por mesa, prefetch prudente sin canvas en espera; medir bytes, tiempo de entrada y frames. No copiar una optimización del repo sin revisar su efecto en arte/manifiesto.
- [ ] **P7-05 — Ejecutar ensayo de capacidad.** 50 participantes + administradora, un controlador; turnos repetidos, slider, rampa, entradas tardías y desconexión. Registrar latencia y que espera no recibe snapshot completo/frames.
- [ ] **P7-06 — Probar navegadores reales.** Safari/iPhone, Chrome/Android y equipo proyectado; sonido apagado, reducción de movimiento, navegación alternativa y conexión del lugar.

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
| 2026-10-05 | Verificación | `npm run typecheck`, `npm test` (**210 pruebas, 14 archivos**), `npm run build`, `npm run test:e2e` (3 e2e). La suite completa se repitió **60 veces seguidas sin fallos** tras corregir los defectos de abajo. | | |

**Defectos que la propia verificación sacó a la luz y se corrigieron** (evidencia de que las pruebas tienen dientes):

- La prueba de segmento **muestreaba** cada 2 px y dejaba pasar roces de esquina diagonales: ahora es una prueba **exacta** (rectángulo ampliado y recorte de segmento), con una prueba que construye un roce de ~0,15 px que el muestreo no ve.
- El reductor trataba una acción **desconocida** como «válida y sin cambios»: ahora la rechaza (y el `switch` es exhaustivo en tipos).
- `validateProject` devolvía solo los problemas de la configuración y ocultaba los del mapa; y `mode: "presentation"` no rechazaba los recursos provisionales del **mapa**.
- `configHash` incluía la línea `$schema` (metadato del editor): tocarla invalidaba las salas ya creadas. Ahora se excluye y hay prueba.
- `tickRoom` no devolvía el reloj al día cuando no había progreso (necesario para el checkpoint de SPECS 6.1).
- `RoomController` marcaba «conectada» al abrir el socket y conservaba presencia, snapshot y resumen **anteriores a la caída**: la interfaz podía actuar sobre estado viejo. Ahora solo pasa a «conectada» con el resumen de la conexión nueva.
- **Pruebas intermitentes** (1 de cada 5–15 ejecuciones): un proceso local ajeno (ayudantes de VS Code) tenía el mismo puerto en `127.0.0.1` que el SO asignó a mi servidor de pruebas enlazado a la interfaz comodín. Ahora `HOST` es configurable y las pruebas enlazan a `127.0.0.1`.
- Dos «capturas» iniciales eran artefactos de mirar un panel de navegador **oculto** (`requestAnimationFrame` no corre): los e2e usan Chromium visible/headless donde sí corre.

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
| 2026-10-05 | Los esquemas JSON pasan de `public/config` y `public/assets` a `shared/config/schemas/`. | Vite avisa «Assets in public directory cannot be imported from JavaScript» y podría convertirlo en error; los esquemas son código de validación, no archivos servidos. | **Sí:** SPECS 7.3 y 9.3 (`$schema`). | P1-01, P1-02 |

### Matriz de cierre

| Grupo de criterios | Fases responsables | Evidencia final | Estado |
| --- | --- | --- | --- |
| CA-01–CA-05 | 2 y 7 | Sala/entrada/espera y cambio de vista. | **Parcial:** servidor y e2e en Chromium ✔ (capturas fase 2). Falta navegadores reales (fase 7). |
| CA-06–CA-13 | 2 y 3 | Movimiento, control exclusivo, pausa y acciones tardías. | **Parcial:** CA-07 a CA-10, CA-12 y CA-13 ✔ (integración); movimiento (CA-06) y rampa en pausa (CA-11, dominio ✔) sin interfaz: fases 3–4. |
| CA-14–CA-21 | 4 y 5 | Experimentos y registros compartidos. | **Parcial:** reglas y estados ✔ en el dominio y por el transporte; sin formularios ni escenas de mesa. |
| CA-22–CA-23 | 5 | Piezas e inventor idempotentes. | **Parcial:** dominio e idempotencia por `requestId` ✔; sin interfaz del inventor. |
| CA-24–CA-30 | 2 y 6 | Reconexión, durabilidad, pestañas y aislamiento. | **Servidor ✔ en integración** (incluido reinicio real). Pendiente de fase 6: tiempo de detección medido, vencimiento y ensayo real. |
| CA-31 | 7 | Reporte de capacidad y latencia. | Pendiente. |
| CA-32–CA-33 | 6 y 7 | Respaldo y alternativas accesibles. | Pendiente. |
| CT-01–CT-03 | 1 y 3 | TMJ nativo y navegación coherente. | **CT-01 y CT-02 ✔.** CT-03: misma implementación y pruebas exactas; falta verlo en pantalla (fase 3). |
| CT-04–CT-06 | 3 y 7 | Ciclo de Phaser, snapshots y render. | **CT-04 ✔** (StrictMode, un canvas; audio aún desactivado). **CT-05 ✔** (reconexión). CT-06: aún no hay frames. |
| CT-07–CT-08 | 1 y 4 | Modelos coherentes. | **Dominio ✔.** Falta comprobarlo en ambas vistas (fase 4). |
| CT-09–CT-12 | 2 y 6 | Validación, secretos y transacciones. | **CT-10, CT-11 y CT-12 ✔.** CT-09: snapshots, resumen, QR y enlace sin tokens ✔; los logs no los registran por diseño pero no hay prueba de logs. |
| CT-13–CT-14 | 6 | Paquete coherente y demo aislada. | **CT-13 ✔.** CT-14 (demostración): fase 6. |
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

