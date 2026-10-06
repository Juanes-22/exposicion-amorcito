/** Banderas de depuración por URL: `?debug` superpone colisiones y radios y expone el juego; `?hooks` solo expone el juego (pruebas). */
export interface GameFlags {
  debug: boolean;
  hooks: boolean;
}

export function readGameFlags(search: string = window.location.search): GameFlags {
  const q = new URLSearchParams(search);
  const debug = q.has("debug");
  return { debug, hooks: debug || q.has("hooks") };
}
