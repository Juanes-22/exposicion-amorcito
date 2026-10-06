import type { AssetEntry, AssetManifest } from "../../shared/contracts/assets";

/** Error de un asset concreto: lleva el ID y, cuando se conoce, la ruta resuelta. */
export class AssetError extends Error {
  constructor(
    message: string,
    readonly assetId: string,
    readonly resolvedUrl?: string,
  ) {
    super(`${message} (assetId «${assetId}»${resolvedUrl ? `, ruta ${resolvedUrl}` : ""})`);
    this.name = "AssetError";
  }
}

export interface AssetRegistry {
  /** URL absoluta del assets.json de la que parte toda resolución. */
  readonly manifestUrl: string;
  /** Directorio contra el que se resuelven los `path` (manifiesto + basePath). */
  readonly baseUrl: string;
  readonly manifest: AssetManifest;
  has(assetId: string): boolean;
  /** Entrada completa, con toda su metadata. Lanza AssetError si el ID no existe. */
  get(assetId: string): AssetEntry;
  /** URL absoluta del archivo. También es la clave con la que se registra la textura (la misma `assetId`). */
  url(assetId: string): string;
  ids(): string[];
  entries(): Array<[string, AssetEntry]>;
  byKind(kind: string): Array<[string, AssetEntry]>;
  nineSlice(assetId: string): NonNullable<AssetEntry["nineSlice"]> | undefined;
  atlasUrl(assetId: string): string;
  isAtlas(assetId: string): boolean;
  /** `true` para hojas de poses que aún necesitan frames inspeccionados: no son spritesheets (CT-15). */
  needsFrameDefinition(assetId: string): boolean;
}

/** Directorio de los assets: el del propio manifiesto, desplazado por `basePath`. */
export function resolveAssetBase(manifestUrl: string | URL, basePath: string): URL {
  const dir = new URL(".", manifestUrl);
  const bp = basePath === "" ? "." : basePath;
  return new URL(bp.endsWith("/") ? bp : `${bp}/`, dir);
}

/**
 * Registro compartido por React y Phaser. El manifiesto ya pasó por `validateAssetManifest`: aquí no se copia ni transforma,
 * solo se indexa, de modo que se conserva toda la metadata de cada entrada. `originalPath` nunca se usa para cargar.
 */
export function createAssetRegistry(manifest: AssetManifest, manifestUrl: string | URL): AssetRegistry {
  const manifestHref = new URL(manifestUrl).href;
  const base = resolveAssetBase(manifestHref, manifest.basePath);

  const get = (assetId: string): AssetEntry => {
    const entry = Object.hasOwn(manifest.assets, assetId) ? manifest.assets[assetId] : undefined;
    if (!entry) throw new AssetError("asset ID no encontrado en assets.json", assetId);
    return entry;
  };
  const resolve = (assetId: string, path: string): string => {
    try {
      return new URL(path, base).href;
    } catch {
      throw new AssetError(`path no resoluble «${path}»`, assetId);
    }
  };

  return {
    manifestUrl: manifestHref,
    baseUrl: base.href,
    manifest,
    has: (id) => Object.hasOwn(manifest.assets, id),
    get,
    url: (id) => resolve(id, get(id).path),
    ids: () => Object.keys(manifest.assets),
    entries: () => Object.entries(manifest.assets),
    byKind: (kind) => Object.entries(manifest.assets).filter(([, a]) => a.kind === kind),
    nineSlice: (id) => get(id).nineSlice,
    atlasUrl: (id) => {
      const path = get(id).atlasPath;
      if (!path) throw new AssetError("el asset no tiene atlas (atlasPath)", id);
      return resolve(id, path);
    },
    isAtlas: (id) => typeof get(id).atlasPath === "string",
    needsFrameDefinition: (id) => get(id).requiresFrameDefinition === true,
  };
}
