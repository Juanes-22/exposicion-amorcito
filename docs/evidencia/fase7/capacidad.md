# Ensayo de capacidad con participación simultánea (P7-05)

Fecha: 2026-10-07T07:14:20.845Z
Equipo: Darwin 25.1.0 (darwin/arm64), Apple M3 Pro, 11 núcleos, 18 GiB, Node v24.20.0.
Red: bucle local (127.0.0.1): clientes y servidor en la misma computadora; no hay red inalámbrica ni celulares reales.
Escenario: 50 participantes y 1 administradora; 44 en la lista de la ronda y 6 entradas tardías que acompañan; las tres mesas completas con todas las personas explorando a la vez (44 personas con 2 posiciones de linterna cada una; después las 50 con 2 pruebas de rampa simultáneas; La caja); 3 desconexiones y reconexiones; caída y regreso de la administradora; pregunta final.

| Medida (ms) | n | p50 | p95 | p99 | máx | Meta (SPECS 11.2) |
| --- | --- | --- | --- | --- | --- | --- |
| Entrada (unirse + conectar + resumen) | 44 | 13.6 | 16.9 | 18.9 | 18.9 | ≤ 5000 |
| Transición de ronda visible en todas las pantallas | 6 | 5.4 | 13.7 | 13.7 | 13.7 | < 1000 |
| Acuse de cada posición de la linterna | 88 | 3.5 | 9.6 | 10.8 | 10.8 | — |
| Acción → el propio teléfono | 88 | 3.0 | 8.2 | 9.9 | 9.9 | < 250 |
| Acuse de «soltar la pelota» | 100 | 13.1 | 25.3 | 26.6 | 26.9 | — |
| Entradas tardías (durante la exploración) | 6 | 26.0 | 28.1 | 28.1 | 28.1 | ≤ 5000 |
| Separación entre muestras de reloj (cada 500 ms) | 11 | 511.2 | 518.5 | 518.5 | 518.5 | ≈ 500 (≤ 700) |

El contador de la administradora llegó al total 0 ms después de la última acción (meta ≤ 1000). Las 50 personas vieron la pausa 2 ms después de caer la administradora.
Servidor: CPU máx 31 % (p95 12 %), memoria máx 131 MiB.
Bytes recibidos por persona: promedio 43604, máx 45659; la administradora, 2427621. Nadie recibió el listado de presencia ni estados personales ajenos.

Ninguna meta comprobable aquí quedó incumplida.

**Limitaciones:** bucle local, sin celulares reales, sin red inalámbrica y sin FPS; los clientes no renderizan. Los celulares reales se ensayan por separado (P7-06 y fase 8).
