import type Phaser from "phaser";

/**
 * Resolución del lienzo. Phaser (modo RESIZE) dibuja con 1 píxel por píxel CSS y el navegador lo agranda en pantallas de alta densidad
 * (celulares, Retina): todo el mapa, y sobre todo el texto, se ve pixelado y borroso. Aquí el lienzo se dibuja con la densidad real de la
 * pantalla —hasta `MAX_PIXEL_RATIO`, para no multiplicar el costo de dibujo en celulares— y se muestra al tamaño CSS del contenedor.
 */
export const MAX_PIXEL_RATIO = 2;

export const pixelRatio = (): number => Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));

/** Tamaño CSS del contenedor y el que debe tener el lienzo en píxeles del dispositivo. */
export function canvasSize(parent: HTMLElement): { ratio: number; cssWidth: number; cssHeight: number; width: number; height: number } {
  const rect = parent.getBoundingClientRect();
  const ratio = pixelRatio();
  return { ratio, cssWidth: rect.width, cssHeight: rect.height, width: Math.max(1, Math.round(rect.width * ratio)), height: Math.max(1, Math.round(rect.height * ratio)) };
}

/**
 * Mantiene el lienzo del tamaño de su contenedor y a la densidad de la pantalla: al cambiar el hueco del escenario (aparece un panel),
 * la ventana, el zoom del navegador o al mover la ventana a otra pantalla. Devuelve la función que lo detiene.
 */
export function trackCanvasSize(game: Phaser.Game, parent: HTMLElement): () => void {
  const apply = () => {
    if (!game.isBooted || !game.canvas) return;
    const { ratio, cssWidth, cssHeight, width, height } = canvasSize(parent);
    const scale = game.scale;
    const canvas = game.canvas;
    // El tamaño CSS se fija ANTES de que Phaser calcule los límites del lienzo (los usa para convertir los toques a coordenadas del
    // juego); fijarlo después dejaba límites viejos y los toques caían corridos. Phaser solo lo fija cuando difiere del tamaño del lienzo.
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    // Si el navegador tiene que agrandar el lienzo una fracción (densidad 3 con tope 2), lo suaviza en lugar de mostrar píxeles desiguales.
    canvas.style.imageRendering = Math.abs((window.devicePixelRatio || 1) / ratio - 1) < 1e-6 ? "pixelated" : "auto";
    let changed = false;
    if (Math.abs(scale.zoom - 1 / ratio) > 1e-9) {
      scale.setZoom(1 / ratio);
      changed = true;
    }
    if (width !== scale.width || height !== scale.height) {
      scale.resize(width, height);
      changed = true;
    }
    if (!changed) scale.updateBounds(); // solo cambió la posición o el tamaño CSS: los límites para los toques igual se recalculan
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
  observer?.observe(parent);
  window.addEventListener("resize", apply);
  apply();
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", apply);
  };
}
