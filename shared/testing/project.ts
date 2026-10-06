// Solo pruebas (Node): carga los archivos reales del proyecto para mutarlos en cada caso. No forma parte del bundle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { frameDefinitions } from "../config/frameDefinitions";
import { validateProject, type ProjectBundle, type ProjectInputs, type ProjectResult } from "../config/validateProject";

const read = (rel: string): unknown => JSON.parse(readFileSync(resolve("public", rel), "utf8"));

export interface RawProject {
  config: any;
  manifest: any;
  tmj: any;
}

/** Copia profunda editable de los tres archivos reales. */
export const loadRawProject = (): RawProject => ({
  config: read("config/laboratorio.json"),
  manifest: read("assets/assets.json"),
  tmj: read("maps/laboratorio.tmj"),
});

export const inputsOf = (raw: RawProject): ProjectInputs => ({ ...raw, frameSheets: frameDefinitions });
export const validateRaw = (raw: RawProject): ProjectResult => validateProject(inputsOf(raw));

export function realBundle(): ProjectBundle {
  const result = validateRaw(loadRawProject());
  if (!result.ok) throw new Error(`El proyecto real no valida: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  return result.bundle;
}

export const tmjObject = (tmj: any, layer: string, name: string) => tmj.layers.find((l: any) => l.name === layer).objects.find((o: any) => o.name === name);
