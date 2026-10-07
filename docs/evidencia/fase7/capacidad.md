# Ensayo de capacidad (P7-05)

Fecha: 2026-10-06T20:39:03.353Z
Equipo: Darwin 25.1.0 (darwin/arm64), Apple M3 Pro, 11 núcleos, 18 GiB, Node v24.20.0.
Red: bucle local (127.0.0.1): clientes y servidor en la misma computadora; no hay red inalámbrica ni celulares reales.
Escenario: 50 participantes y 1 administradora, 1 controlador; 6 entradas tardías; 30 cambios de turno; slider a 12 Hz durante 12 s; prueba de rampa con cambio de turno a mitad; desconexiones.

| Medida (ms) | n | p50 | p95 | p99 | máx | Meta (SPECS 11.2) |
| --- | --- | --- | --- | --- | --- | --- |
| Entrada (unirse + conectar + resumen) | 44 | 9.5 | 15.9 | 16.5 | 16.5 | ≤ 5000 |
| Cambio de turno: nuevo controlador con su estado | 30 | 8.9 | 12.7 | 13.4 | 13.4 | < 1000 |
| Cambio de turno: todas las pantallas lo ven | 30 | 8.9 | 12.7 | 13.5 | 13.5 | < 1000 |
| Acuse del servidor a cada cambio del slider | 144 | 3.4 | 4.5 | 5.0 | 31.6 | — |
| Acción → proyección | 143 | 3.2 | 4.2 | 4.9 | 31.4 | < 250 |
| Acción → teléfono del controlador | 143 | 3.4 | 4.5 | 5.0 | 31.6 | — |
| Entradas tardías (durante el arrastre) | 6 | 19.3 | 21.7 | 21.7 | 21.7 | ≤ 5000 |
| Separación entre frames (10 Hz) | 34 | 101.3 | 103.0 | 104.2 | 104.2 | ≈ 100 |

Servidor: CPU máx 29 % (p95 14 %), memoria máx 130 MiB.
Quien solo esperó (40 personas): 0 snapshots, 0 frames; 12082 bytes de promedio por persona (máx 15180) frente a 1113240 de la administradora.
Caída del controlador (cierre de socket): reflejada en la proyección en 3 ms.

Ninguna meta comprobable aquí quedó incumplida.

**Limitaciones:** bucle local, sin celulares reales, sin red inalámbrica y sin FPS; los clientes no renderizan. Los celulares reales se ensayan por separado (P7-06 y fase 8).
