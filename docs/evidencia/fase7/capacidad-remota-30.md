# Ensayo de capacidad con participación simultánea (P7-05)

Fecha: 2026-10-15T21:56:30.019Z
Equipo: Darwin 25.1.0 (darwin/arm64), Apple M3 Pro, 11 núcleos, 18 GiB, Node v24.20.0.
Red: Internet hasta https://exposicion-vanessa.onrender.com: los clientes salen de una sola computadora (una IP) y el servidor es el publicado.
Escenario: 30 participantes y 1 administradora; 26 en la lista de la ronda y 4 entradas tardías que acompañan; las tres mesas completas con todas las personas explorando a la vez (26 personas con 2 posiciones de linterna cada una; después las 30 con 2 pruebas de rampa simultáneas; el observatorio, con la Luna y las estrellas; el inventor, con la pregunta de cada persona); 3 desconexiones y reconexiones; caída y regreso de la administradora; pregunta final.

| Medida (ms) | n | p50 | p95 | p99 | máx | Meta (SPECS 11.2) |
| --- | --- | --- | --- | --- | --- | --- |
| Entrada (unirse + conectar + resumen) | 26 | 1810.9 | 3147.4 | 3148.1 | 3148.1 | ≤ 5000 |
| Transición de ronda visible en todas las pantallas | 7 | 204.7 | 379.4 | 379.4 | 379.4 | < 1000 |
| Acuse de cada posición de la linterna | 52 | 192.4 | 211.9 | 218.0 | 218.0 | — |
| Acción → el propio teléfono | 52 | 192.0 | 208.4 | 217.8 | 217.8 | < 250 |
| Acuse de «soltar la pelota» | 60 | 335.6 | 506.3 | 565.1 | 565.1 | — |
| Entradas tardías (durante la exploración) | 4 | 974.6 | 1024.6 | 1024.6 | 1024.6 | ≤ 5000 |
| Separación entre muestras de reloj (cada 500 ms) | 11 | 503.7 | 602.2 | 602.2 | 602.2 | ≈ 500 (≤ 700) |

El contador de la administradora llegó al total 0 ms después de la última acción (meta ≤ 1000). Las 30 personas vieron la pausa 226 ms después de caer la administradora.
Servidor: el publicado en https://exposicion-vanessa.onrender.com (CPU y memoria: ver su panel).
Bytes recibidos por persona: promedio 36864, máx 39602; la administradora, 1555185. Nadie recibió el listado de presencia ni estados personales ajenos.

Ninguna meta comprobable aquí quedó incumplida.

**Limitaciones:** todos los clientes salen de una misma computadora y red (una IP), sin celulares reales y sin FPS; los clientes no renderizan.
