import type { LoadedProject } from "../config/loadProject";

let prepared: Promise<{ modules: boolean; assets: number; failed: number }> | null = null;

/**
 * Prepara el respaldo MIENTRAS la sala funciona (SPECS 6.4): descarga el módulo de la demostración y calienta la caché del navegador
 * con los recursos del catálogo. Si después el servidor deja de responder, el frontend que ya está abierto puede pasar a la
 * demostración sin pedirle nada. Se hace una sola vez por carga de la página y nunca bloquea ni rompe la sala: un fallo aquí solo
 * significa que ese recurso no estará precargado.
 */
export function prepareBackup(project: LoadedProject): Promise<{ modules: boolean; assets: number; failed: number }> {
  prepared ??= (async () => {
    const modules = await import("../components/room/DemoView").then(() => true, () => false);
    const urls = project.registry.ids().map((id) => project.registry.url(id));
    const results = await Promise.allSettled(urls.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))));
    return { modules, assets: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
  })();
  return prepared;
}

export const resetBackupForTests = () => {
  prepared = null;
};
