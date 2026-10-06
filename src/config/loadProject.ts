import { frameDefinitions } from "../../shared/config/frameDefinitions";
import { validateProject, type ProjectBundle } from "../../shared/config/validateProject";
import type { ConfigIssue } from "../../shared/contracts/assets";
import { createAssetRegistry, type AssetRegistry } from "./assetRegistry";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Fallo de carga con la etapa que lo produjo; nunca se sustituye por una configuración vacía. */
export type LoadFailure =
  | { stage: "network"; url: string; message: string }
  | { stage: "parse"; url: string; message: string }
  | { stage: "validation"; issues: ConfigIssue[] };

export interface LoadedProject {
  bundle: ProjectBundle;
  registry: AssetRegistry;
  /** TMJ ya validado, tal cual: se entrega a Phaser como objeto para no descargarlo dos veces (SPECS 8.5). */
  tmj: unknown;
  baseUrl: string;
}

export type ProjectLoad = { ok: true; project: LoadedProject } | { ok: false; failure: LoadFailure };

async function getJson(url: string, fetcher: Fetcher): Promise<{ ok: true; data: unknown } | { ok: false; failure: LoadFailure }> {
  let response: Response;
  try {
    // Revalidación HTTP: la edición del archivo se ve en la siguiente recarga, sin service workers ni sondeos.
    response = await fetcher(url, { cache: "no-cache" });
  } catch (e) {
    return { ok: false, failure: { stage: "network", url, message: e instanceof Error ? e.message : String(e) } };
  }
  if (!response.ok) return { ok: false, failure: { stage: "network", url, message: `HTTP ${response.status} ${response.statusText}`.trim() } };
  try {
    return { ok: true, data: await response.json() };
  } catch (e) {
    return { ok: false, failure: { stage: "parse", url, message: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Descarga configuración, catálogo y TMJ, los valida juntos y construye el AssetRegistry. El frontend valida su paquete
 * antes de inicializar Phaser (SPECS 9.5). `baseUrl` es la base pública del sitio: absoluta, para que las rutas de entrada
 * por QR (`/sala/ABC234`) resuelvan igual que `/` (CT-16).
 */
export async function loadProject(baseUrl: string = new URL(import.meta.env.BASE_URL, window.location.href).href, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<ProjectLoad> {
  const at = (rel: string) => new URL(rel, baseUrl).href;
  const configUrl = at("config/laboratorio.json");
  const manifestUrl = at("assets/assets.json");

  const [config, manifest] = await Promise.all([getJson(configUrl, fetcher), getJson(manifestUrl, fetcher)]);
  if (!config.ok) return config;
  if (!manifest.ok) return manifest;

  const mapPath = (config.data as { world?: { mapPath?: unknown } })?.world?.mapPath;
  if (typeof mapPath !== "string") return { ok: false, failure: { stage: "validation", issues: [{ file: "laboratorio.json", path: "world.mapPath", message: "falta la ruta del mapa" }] } };
  const tmj = await getJson(at(mapPath), fetcher);
  if (!tmj.ok) return tmj;

  const result = validateProject({ config: config.data, manifest: manifest.data, tmj: tmj.data, frameSheets: frameDefinitions });
  if (!result.ok) return { ok: false, failure: { stage: "validation", issues: result.issues } };
  return { ok: true, project: { bundle: result.bundle, registry: createAssetRegistry(result.bundle.manifest, manifestUrl), tmj: tmj.data, baseUrl } };
}
