# Ensayo de capacidad con participación simultánea (P7-05)

Fecha: 2026-10-15T21:55:42.425Z
Equipo: Darwin 25.1.0 (darwin/arm64), Apple M3 Pro, 11 núcleos, 18 GiB, Node v24.20.0.
Red: bucle local (127.0.0.1): clientes y servidor en la misma computadora; no hay red inalámbrica ni celulares reales.
Escenario: 30 participantes y 1 administradora; 26 en la lista de la ronda y 4 entradas tardías que acompañan; las tres mesas completas con todas las personas explorando a la vez (26 personas con 2 posiciones de linterna cada una; después las 30 con 2 pruebas de rampa simultáneas; el observatorio, con la Luna y las estrellas; el inventor, con la pregunta de cada persona); 3 desconexiones y reconexiones; caída y regreso de la administradora; pregunta final.

| Medida (ms) | n | p50 | p95 | p99 | máx | Meta (SPECS 11.2) |
| --- | --- | --- | --- | --- | --- | --- |
| Entrada (unirse + conectar + resumen) | 26 | 15.0 | 19.7 | 19.8 | 19.8 | ≤ 5000 |
| Transición de ronda visible en todas las pantallas | 7 | 3.6 | 13.7 | 13.7 | 13.7 | < 1000 |
| Acuse de cada posición de la linterna | 52 | 2.7 | 7.9 | 17.9 | 17.9 | — |
| Acción → el propio teléfono | 52 | 2.4 | 6.4 | 16.2 | 16.2 | < 250 |
| Acuse de «soltar la pelota» | 60 | 11.6 | 20.7 | 21.4 | 21.4 | — |
| Entradas tardías (durante la exploración) | 4 | 22.4 | 26.6 | 26.6 | 26.6 | ≤ 5000 |
| Separación entre muestras de reloj (cada 500 ms) | 10 | 504.5 | 506.8 | 506.8 | 506.8 | ≈ 500 (≤ 700) |

El contador de la administradora llegó al total 0 ms después de la última acción (meta ≤ 1000). Las 30 personas vieron la pausa 3 ms después de caer la administradora.
Servidor: CPU máx 27 % (p95 11 %), memoria máx 130 MiB.
Bytes recibidos por persona: promedio 35604, máx 38257; la administradora, 1489154. Nadie recibió el listado de presencia ni estados personales ajenos.

Ninguna meta comprobable aquí quedó incumplida.

**Limitaciones:** bucle local, sin celulares reales, sin red inalámbrica y sin FPS; los clientes no renderizan. Los celulares reales se ensayan por separado (P7-06 y fase 8).
