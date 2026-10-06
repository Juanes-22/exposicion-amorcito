/**
 * Identificador de petición único por comando (SPECS 5.2). `crypto.randomUUID` solo existe en contextos seguros: los celulares de
 * ensayo pueden abrir el servidor por http:// en la red local, pero `getRandomValues` sí está disponible.
 */
export function newRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
