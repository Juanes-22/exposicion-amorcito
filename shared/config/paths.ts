/** Rutas POSIX sin `node:path`: el módulo corre también en el navegador. */

export function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // Una ruta que sale de la raíz conserva el prefijo «..» y así se puede detectar.
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else out.push(seg);
  }
  return out.join("/");
}

export function dirnamePosix(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function joinPosix(...parts: string[]): string {
  return normalizePosix(parts.filter((p) => p !== "").join("/"));
}

export function isAbsoluteOrUrl(path: string): boolean {
  return path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path);
}
