import Phaser from "phaser";

const INK = 0x5e3b1f;

/**
 * Dibujo sencillo de cada pieza colectiva (lupa, bocadillo, corazón), con formas: el catálogo aún no tiene un asset propio y no se
 * inventa uno. `size` es el lado aproximado; `collected = false` deja solo el contorno.
 */
export function drawPiece(g: Phaser.GameObjects.Graphics, id: string, x: number, y: number, size: number, collected = true, alpha = 1): void {
  const r = size / 2;
  const fill = collected ? ({ lupa: 0x9fd3f2, dialogo: 0xfff3c4, corazon: 0xe5646b } as Record<string, number>)[id] ?? 0xcfc3a8 : undefined;
  const a = collected ? alpha : alpha * 0.55;
  g.lineStyle(Math.max(2, size / 14), INK, a);
  if (id === "lupa") {
    if (fill !== undefined) g.fillStyle(fill, a).fillCircle(x - r * 0.15, y - r * 0.15, r * 0.62);
    g.strokeCircle(x - r * 0.15, y - r * 0.15, r * 0.62);
    g.lineStyle(Math.max(4, size / 8), INK, a).lineBetween(x + r * 0.3, y + r * 0.3, x + r * 0.85, y + r * 0.85);
  } else if (id === "dialogo") {
    if (fill !== undefined) g.fillStyle(fill, a).fillRoundedRect(x - r * 0.9, y - r * 0.7, r * 1.8, r * 1.2, r * 0.25);
    g.strokeRoundedRect(x - r * 0.9, y - r * 0.7, r * 1.8, r * 1.2, r * 0.25);
    if (fill !== undefined) g.fillStyle(fill, a).fillTriangle(x - r * 0.5, y + r * 0.45, x - r * 0.15, y + r * 0.45, x - r * 0.55, y + r * 0.9);
    g.lineBetween(x - r * 0.5, y + r * 0.5, x - r * 0.55, y + r * 0.9).lineBetween(x - r * 0.55, y + r * 0.9, x - r * 0.15, y + r * 0.5);
  } else if (id === "corazon") {
    const lobe = r * 0.45;
    const cl = { x: x - r * 0.38, y: y - r * 0.2 };
    const cr = { x: x + r * 0.38, y: y - r * 0.2 };
    if (fill !== undefined) g.fillStyle(fill, a).fillCircle(cl.x, cl.y, lobe).fillCircle(cr.x, cr.y, lobe).fillTriangle(x - r * 0.82, y - r * 0.02, x + r * 0.82, y - r * 0.02, x, y + r * 0.88);
    // Contorno solo por fuera (arcos de los dos lóbulos y los lados hacia la punta): sin líneas cruzando el relleno.
    const deg = (d: number) => Phaser.Math.DegToRad(d);
    g.beginPath().arc(cl.x, cl.y, lobe, deg(157.8), deg(327.7), false).strokePath();
    g.beginPath().arc(cr.x, cr.y, lobe, deg(212.3), deg(382.2), false).strokePath();
    g.lineBetween(x - r * 0.82, y - r * 0.02, x, y + r * 0.88).lineBetween(x + r * 0.82, y - r * 0.02, x, y + r * 0.88);
  } else {
    if (fill !== undefined) g.fillStyle(fill, a).fillCircle(x, y, r * 0.7);
    g.strokeCircle(x, y, r * 0.7);
  }
}
