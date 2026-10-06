/**
 * Contrato del catálogo `assets.json` (formato heredado de Bitácora Amorcito, SPECS 9.4).
 * Las entradas admiten metadata adicional: se conserva sin interpretarla.
 */
export interface AssetEntry {
  path: string;
  type: string;
  format?: string;
  category: string;
  label: string;
  kind: string;
  width?: number;
  height?: number;
  hasAlphaChannel?: boolean;
  transparent?: boolean;
  sizeBytes?: number;
  sha256?: string;
  /** Procedencia; nunca se usa para cargar. */
  originalPath?: string;
  state?: string;
  nineSlice?: { top: number; right: number; bottom: number; left: number };
  poseCount?: number;
  visualLayout?: { columns: number; rows: number };
  rowDirections?: string[];
  /** Pose-sheets: no son spritesheets hasta que sus frames estén definidos y comprobados (CT-15). */
  requiresFrameDefinition?: boolean;
  atlasPath?: string;
  frameCount?: number;
  origin?: { x: number; y: number };
  recommendedScale?: number;
  /** Recurso provisional del prototipo: `mode: presentation` no lo admite como final. */
  placeholder?: boolean;
  provenance?: string;
  /** Tilesets: tamaño de tile y cantidad, para cotejar con la definición incrustada en el TMJ. */
  tileWidth?: number;
  tileHeight?: number;
  tileCount?: number;
  [key: string]: unknown;
}

export interface SourceDocument {
  path: string;
  originalPath?: string;
  sizeBytes?: number;
  sha256?: string;
  [key: string]: unknown;
}

export interface AssetManifest {
  version: number;
  project: string;
  basePath: string;
  pathConvention: string;
  assetCount: number;
  categoryCounts: Record<string, number>;
  notes?: string[];
  assets: Record<string, AssetEntry>;
  sourceDocuments?: SourceDocument[];
  [key: string]: unknown;
}

/** Un problema de validación con su ubicación: archivo y ruta JSON o, en Tiled, capa/objeto/propiedad. */
export interface ConfigIssue {
  /** Archivo al que pertenece. */
  file: "laboratorio.json" | "assets.json" | "laboratorio.tmj" | "mensaje";
  /** Notación con puntos para JSON (`activities.sombras.experiment.requiredSamples`); para el TMJ, `capa «stations» › objeto #3 «sombras» › propiedad activityId`. */
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ConfigIssue[] };
