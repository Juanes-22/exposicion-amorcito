import configSchema from "./schemas/laboratorio.schema.json";
import type { AssetManifest, ConfigIssue, ValidationResult } from "../contracts/assets";
import type { LaboratorioConfig } from "../contracts/config";
import { AUDIO_EVENT_IDS, FACILITATOR_MOMENTS, INVENTOR_ID, REQUIRED_LABELS } from "../contracts/config";
import { ajvIssues, compileSchema } from "./ajv";
import type { SheetDefinition } from "./frameDefinitions";

const validateShape = compileSchema(configSchema);
const at = (path: string, message: string): ConfigIssue => ({ file: "laboratorio.json", path, message });

export interface ConfigContext {
  manifest: AssetManifest;
  /** Hojas de poses con frames definidos y validados (CT-15). */
  frameSheets: Readonly<Record<string, Pick<SheetDefinition, "animations">>>;
}

/**
 * Resultado de validar la configuración. Si la forma es válida pero hay referencias rotas, `value` sigue presente para que
 * `validateProject` pueda seguir con el mapa y entregar todos los problemas de una vez.
 */
export type ConfigValidation = ValidationResult<LaboratorioConfig> | { ok: false; issues: ConfigIssue[]; value: LaboratorioConfig };

/** Formas + referencias cruzadas de `laboratorio.json`. Las que dependen del mapa las hace `validateProject`. */
export function validateConfig(data: unknown, ctx: ConfigContext): ConfigValidation {
  if (!validateShape(data)) return { ok: false, issues: ajvIssues("laboratorio.json", validateShape.errors) };
  const c = data as unknown as LaboratorioConfig;
  const issues: ConfigIssue[] = [];
  const asset = (path: string, id: string, kinds?: string[]) => {
    const entry = Object.hasOwn(ctx.manifest.assets, id) ? ctx.manifest.assets[id] : undefined;
    if (!entry) issues.push(at(path, `asset ID no encontrado en assets.json: «${id}»`));
    else if (kinds && !kinds.includes(entry.kind)) issues.push(at(path, `«${id}» es de kind «${entry.kind}»; se esperaba ${kinds.join(" o ")}`));
    return entry;
  };

  // ---- recorrido ----
  for (const id of c.route) {
    if (id === INVENTOR_ID) issues.push(at("route", `«${INVENTOR_ID}» es la estación final reservada: no va en route`));
    else if (!Object.hasOwn(c.activities, id)) issues.push(at("route", `«${id}» no está definido en activities`));
  }
  if (Object.hasOwn(c.activities, INVENTOR_ID)) issues.push(at(`activities.${INVENTOR_ID}`, `«${INVENTOR_ID}» es un identificador reservado`));

  // ---- piezas ----
  const pieceOwner = new Map<string, string>();
  for (const id of c.route) {
    const a = c.activities[id];
    if (!a) continue;
    const owner = pieceOwner.get(a.pieceId);
    if (owner) issues.push(at(`activities.${id}.pieceId`, `la pieza «${a.pieceId}» ya la concede «${owner}»; cada mesa del recorrido concede una pieza distinta`));
    else pieceOwner.set(a.pieceId, id);
  }
  const required = new Set(c.inventor.requiredPieceIds);
  for (const p of pieceOwner.keys()) if (!required.has(p)) issues.push(at("inventor.requiredPieceIds", `falta la pieza «${p}» que concede una mesa del recorrido`));
  for (const p of required) if (!pieceOwner.has(p)) issues.push(at("inventor.requiredPieceIds", `«${p}» no la concede ninguna mesa del recorrido`));
  const defined = new Set<string>();
  c.inventor.pieces.forEach((p, i) => {
    if (defined.has(p.id)) issues.push(at(`inventor.pieces[${i}].id`, `la pieza «${p.id}» está repetida`));
    defined.add(p.id);
    if (!required.has(p.id)) issues.push(at(`inventor.pieces[${i}].id`, `«${p.id}» no está en requiredPieceIds`));
  });
  for (const p of required) if (!defined.has(p)) issues.push(at("inventor.pieces", `falta el texto de la pieza «${p}»`));

  // ---- actividades ----
  const dialogue = (path: string, id: string) => {
    if (!Object.hasOwn(c.dialogues, id)) issues.push(at(path, `diálogo inexistente: «${id}»`));
  };

  for (const [id, a] of Object.entries(c.activities)) {
    const where = `activities.${id}`;
    switch (a.type) {
      case "shadows": {
        const e = a.experiment;
        if (!(e.sourceDistanceMinCm < e.sourceDistanceMaxCm)) issues.push(at(`${where}.experiment`, "sourceDistanceMinCm debe ser menor que sourceDistanceMaxCm"));
        else if (e.sourceDistanceMaxCm - e.sourceDistanceMinCm < e.minDistinctDistanceCm * (e.requiredSamples - 1)) {
          issues.push(at(`${where}.experiment`, "el rango de distancias no permite reunir requiredSamples muestras separadas por minDistinctDistanceCm"));
        }
        break;
      }
      case "ramps": {
        const e = a.experiment;
        if (!(e.minAngleDeg < e.maxAngleDeg)) issues.push(at(`${where}.experiment`, "minAngleDeg debe ser menor que maxAngleDeg"));
        else {
          if ((e.maxAngleDeg - e.minAngleDeg) % e.angleStepDeg !== 0) issues.push(at(`${where}.experiment.angleStepDeg`, "el paso debe dividir exactamente el rango de inclinaciones"));
          if (e.maxAngleDeg - e.minAngleDeg < e.minDistinctAngleDeg * (e.requiredTrials - 1)) {
            issues.push(at(`${where}.experiment`, "el rango de inclinaciones no permite reunir requiredTrials pruebas separadas por minDistinctAngleDeg"));
          }
        }
        break;
      }
      case "boxes": {
        const objects = new Set<string>();
        a.sharedObjects.forEach((o, i) => {
          if (objects.has(o.id)) issues.push(at(`${where}.sharedObjects[${i}].id`, `el objeto «${o.id}» está repetido`));
          objects.add(o.id);
        });
        if (a.requiredObjects > a.sharedObjects.length) issues.push(at(`${where}.requiredObjects`, "no puede pedir más objetos de los que hay en la caja compartida"));
        dialogue(`${where}.refusalDialogueId`, a.refusalDialogueId);
        dialogue(`${where}.personalTouchDialogueId`, a.personalTouchDialogueId);
        break;
      }
    }
  }

  // ---- textos de las fases comunes: contenido obligatorio y editable (SPECS 9.1) ----
  for (const key of REQUIRED_LABELS) if (!c.ui.labels[key]?.trim()) issues.push(at(`ui.labels.${key}`, "falta este texto de las fases comunes"));

  // ---- guiones: cada momento del recorrido tiene el suyo ----
  const moments = new Set<string>([...FACILITATOR_MOMENTS, ...c.route]);
  for (const m of moments) if (!Object.hasOwn(c.facilitatorNotes, m)) issues.push(at(`facilitatorNotes.${m}`, "falta el guion de este momento"));

  // ---- assets ----
  const player = asset("world.player.assetId", c.world.player.assetId, ["pose-sheet"]);
  if (player?.requiresFrameDefinition && !ctx.frameSheets[c.world.player.assetId]) {
    issues.push(at("world.player.assetId", `«${c.world.player.assetId}» es una pose-sheet sin frames definidos: no es un spritesheet utilizable (CT-15)`));
  } else if (player && ctx.frameSheets[c.world.player.assetId]) {
    const anims = Object.keys(ctx.frameSheets[c.world.player.assetId]!.animations);
    for (const needed of ["vanessa-idle", "vanessa-walk-down", "vanessa-walk-left", "vanessa-walk-right", "vanessa-walk-up"]) {
      if (!anims.includes(needed)) issues.push(at("world.player.assetId", `falta la animación «${needed}» en las definiciones de frames`));
    }
  }
  asset("inventor.activeAssetId", c.inventor.activeAssetId, ["station-item"]);
  asset("ui.assets.button", c.ui.assets.button, ["button"]);
  asset("ui.assets.buttonHover", c.ui.assets.buttonHover, ["button"]);
  asset("ui.assets.panel", c.ui.assets.panel, ["panel"]);
  asset("ui.assets.notebookIcon", c.ui.assets.notebookIcon);
  for (const [event, id] of Object.entries(c.audio.events)) {
    if (!(AUDIO_EVENT_IDS as readonly string[]).includes(event)) issues.push(at(`audio.events.${event}`, `evento de audio desconocido; los válidos son ${AUDIO_EVENT_IDS.join(", ")}`));
    asset(`audio.events.${event}`, id, ["sfx", "music"]);
  }

  // ---- modo presentación: sin recursos ni textos de prueba como finales (SPECS 9.5) ----
  if (c.mode === "presentation") {
    const referenced: Array<[string, string]> = [
      ["world.player.assetId", c.world.player.assetId],
      ["inventor.activeAssetId", c.inventor.activeAssetId],
      ["ui.assets.button", c.ui.assets.button],
      ["ui.assets.buttonHover", c.ui.assets.buttonHover],
      ["ui.assets.panel", c.ui.assets.panel],
      ["ui.assets.notebookIcon", c.ui.assets.notebookIcon],
      ...Object.entries(c.audio.events).map(([k, id]): [string, string] => [`audio.events.${k}`, id]),
    ];
    for (const [path, id] of referenced) {
      const entry = ctx.manifest.assets[id];
      if (entry?.placeholder) issues.push(at(path, `«${id}» es un recurso provisional: mode «presentation» no lo admite`));
      if (/(^|\.)test(-|\.|$)/.test(id)) issues.push(at(path, `«${id}» es un recurso de prueba: mode «presentation» no lo admite`));
    }
    for (const m of moments) if ((c.facilitatorNotes[m] ?? []).length === 0) issues.push(at(`facilitatorNotes.${m}`, "guion vacío: mode «presentation» exige guiones completos"));
  }

  return issues.length > 0 ? { ok: false, issues, value: c } : { ok: true, value: c };
}
