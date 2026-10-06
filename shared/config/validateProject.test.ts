import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inputsOf, loadRawProject, tmjObject, validateRaw, type RawProject } from "../testing/project";
import { validateProject } from "./validateProject";

/** Mutaciones sobre los archivos reales: cada caso debe fallar con la ubicación del problema, y el original debe pasar. */
const issuesFor = (mutate: (raw: RawProject) => void) => {
  const raw = loadRawProject();
  mutate(raw);
  const result = validateRaw(raw);
  return result.ok ? [] : result.issues.map((i) => `[${i.file}] ${i.path}: ${i.message}`);
};
const expectIssue = (issues: string[], ...fragments: string[]) => expect(issues.some((i) => fragments.every((f) => i.includes(f))), issues.join("\n") || "(sin problemas)").toBe(true);

describe("proyecto real", () => {
  it("valida y entrega huellas de configuración y mapa", () => {
    const result = validateRaw(loadRawProject());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.configHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.bundle.mapHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.bundle.map.stations.map((s) => s.activityId)).toEqual(["sombras", "rampas", "cajas"]);
    }
  });
  it("la huella de la configuración ignora `$schema` (metadato del editor) pero no el contenido", () => {
    const base = validateRaw(loadRawProject());
    const reschemaed = loadRawProject();
    reschemaed.config.$schema = "../otra/ruta.schema.json";
    const edited = loadRawProject();
    edited.config.activities.sombras.title = "Sombras (otro texto)";
    const a = base.ok && base.bundle.configHash;
    const b = (() => { const r = validateRaw(reschemaed); return r.ok && r.bundle.configHash; })();
    const c = (() => { const r = validateRaw(edited); return r.ok && r.bundle.configHash; })();
    expect(typeof a).toBe("string");
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it("no depende del formato JSON: el mismo contenido con otro orden de claves da la misma huella", () => {
    const a = validateRaw(loadRawProject());
    const raw = loadRawProject();
    const sorted = (v: any): any => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().reverse().map((k) => [k, sorted(v[k])])) : v);
    raw.tmj = JSON.parse(JSON.stringify(sorted(raw.tmj), null, 4));
    const b = validateRaw(raw);
    expect(a.ok && b.ok && a.bundle.mapHash === b.bundle.mapHash).toBe(true);
  });
});

describe("mapa (TMJ)", () => {
  it("rechaza un archivo que no es un mapa de Tiled", () => {
    expectIssue(issuesFor((r) => (r.tmj = { hola: 1 })), "laboratorio.tmj", "type");
  });
  it("rechaza mapas infinitos, no ortogonales y grupos de capas", () => {
    expectIssue(issuesFor((r) => (r.tmj.infinite = true)), "infinite");
    expectIssue(issuesFor((r) => (r.tmj.orientation = "isometric")), "orientation");
    expectIssue(issuesFor((r) => r.tmj.layers.push({ id: 99, name: "grupo", type: "group", layers: [] })), "capa «grupo»", "grupos");
  });
  it("rechaza datos de tiles con compresión o de tamaño erróneo y GIDs sin tileset", () => {
    expectIssue(issuesFor((r) => (r.tmj.layers[0].compression = "zlib")), "capa «floor»", "compresión");
    expectIssue(issuesFor((r) => r.tmj.layers[0].data.pop()), "capa «floor»", "celdas");
    expectIssue(issuesFor((r) => (r.tmj.layers[0].data[10] = 99)), "capa «floor»", "GID");
  });
  it("rechaza tilesets externos y sin assetId", () => {
    expectIssue(issuesFor((r) => (r.tmj.tilesets[0].source = "tiles.tsx")), "externo");
    expectIssue(issuesFor((r) => (r.tmj.tilesets[0].properties = [])), "tileset «laboratorio-tiles»", "assetId");
  });
  it("rechaza geometrías y características no soportadas, indicando capa y objeto", () => {
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "collisions", "mesa-sombras").rotation = 15)), "capa «collisions»", "mesa-sombras", "rotaciones");
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "collisions", "mesa-sombras").ellipse = true)), "elipses");
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "collisions", "mesa-sombras").polygon = [{ x: 0, y: 0 }])), "polígonos");
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "stations", "rampas").template = "mesa.tx")), "plantillas");
  });
  it("rechaza una colisión fuera del mapa o con tamaño nulo", () => {
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "collisions", "pared-derecha").x = 1260)), "se sale del mapa");
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "collisions", "pared-derecha").width = 0)), "ancho y alto positivos");
  });
  it("rechaza objetos sin clase fuera de la capa collisions y clases desconocidas", () => {
    expectIssue(issuesFor((r) => delete tmjObject(r.tmj, "stations", "rampas").class), "capa «stations»", "no tiene clase");
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "stations", "rampas").class = "Mesa")), "clase «Mesa» no admitida");
  });
  it("acepta la clase en el campo `type` de formatos antiguos y trata EditorOnly como nota", () => {
    const raw = loadRawProject();
    const o = tmjObject(raw.tmj, "stations", "rampas");
    o.type = o.class;
    delete o.class;
    raw.tmj.layers.find((l: any) => l.name === "spawns").objects.push({ id: 90, name: "nota", class: "EditorOnly", point: true, x: 5, y: 5, rotation: 0, visible: true, width: 0, height: 0 });
    expect(validateRaw(raw).ok).toBe(true);
  });
  it("exige que las propiedades de negocio estén en el TMJ (activityId, spawnId, assetId)", () => {
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "stations", "sombras").properties = [{ name: "assetId", type: "string", value: "lab.station.shadows" }])), "propiedad activityId", "obligatoria");
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "spawns", "entrada").properties = [])), "propiedad spawnId");
  });
});

describe("estaciones, spawn y alcanzabilidad", () => {
  it("rechaza una estación duplicada", () => {
    expectIssue(
      issuesFor((r) => {
        const dup = structuredClone(tmjObject(r.tmj, "stations", "sombras"));
        dup.id = 80;
        r.tmj.layers.find((l: any) => l.name === "stations").objects.push(dup);
      }),
      "más de una estación",
      "sombras",
    );
  });
  it("rechaza una estación faltante en el mapa y una estación que ya no está en route", () => {
    expectIssue(issuesFor((r) => (r.tmj.layers.find((l: any) => l.name === "stations").objects = r.tmj.layers.find((l: any) => l.name === "stations").objects.filter((o: any) => o.name !== "cajas"))), "falta la estación de «cajas»");
    expectIssue(
      issuesFor((r) => {
        // Retirar «cajas» de la configuración sin quitar su objeto del mapa.
        r.config.route = ["sombras", "rampas"];
        r.config.inventor.requiredPieceIds = ["lupa", "dialogo"];
        r.config.inventor.pieces = r.config.inventor.pieces.filter((p: any) => p.id !== "corazon");
      }),
      "cajas",
      "no está en route",
    );
  });
  it("rechaza ocultar una capa funcional como forma de retirar una mesa: la visibilidad no elimina objetos funcionales", () => {
    const raw = loadRawProject();
    raw.tmj.layers.find((l: any) => l.name === "stations").visible = false;
    const result = validateRaw(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.map.stations).toHaveLength(3); // sigue contando
  });
  it("rechaza que falte o se repita el Inventor", () => {
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "stations", "inventor").class = "EditorOnly")), "falta el objeto Inventor");
    expectIssue(
      issuesFor((r) => {
        const dup = structuredClone(tmjObject(r.tmj, "stations", "inventor"));
        dup.id = 81;
        r.tmj.layers.find((l: any) => l.name === "stations").objects.push(dup);
      }),
      "más de un Inventor",
    );
  });
  it("rechaza un spawn inexistente o con la huella contra una pared", () => {
    expectIssue(issuesFor((r) => (r.config.world.initialSpawnId = "puerta")), "no existe el Spawn «puerta»");
    expectIssue(issuesFor((r) => ((tmjObject(r.tmj, "spawns", "entrada").x = 300), (tmjObject(r.tmj, "spawns", "entrada").y = 745))), "Spawn «entrada»", "choca");
  });
  it("rechaza un spawn repetido", () => {
    expectIssue(
      issuesFor((r) => {
        const dup = structuredClone(tmjObject(r.tmj, "spawns", "entrada"));
        dup.id = 82;
        r.tmj.layers.find((l: any) => l.name === "spawns").objects.push(dup);
      }),
      "propiedad spawnId",
      "repetido",
    );
  });
  it("rechaza una estación cuyo punto cae dentro de una colisión (suelo no transitable)", () => {
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "stations", "rampas").y = 280)), "rampas", "no es transitable");
  });
  it("rechaza una estación inalcanzable: encerrada por un muro nuevo", () => {
    expectIssue(
      issuesFor((r) => {
        // Cuatro muros alrededor del punto de «cajas» (1020, 330), con holgura para la huella de 42×25.
        const walls = r.tmj.layers.find((l: any) => l.name === "collisions").objects;
        const add = (id: number, x: number, y: number, w: number, h: number) => walls.push({ id, name: `muro${id}`, class: "Collision", rotation: 0, visible: true, x, y, width: w, height: h });
        add(70, 960, 300, 8, 90);
        add(71, 1080, 300, 8, 90);
        add(72, 960, 392, 128, 8);
        add(73, 960, 296, 128, 4);
      }),
      "cajas",
      "alcanzable",
    );
  });
});

describe("catálogo y referencias de recursos", () => {
  it("rechaza un asset inexistente en el mapa (estación) y en la configuración (jugador)", () => {
    expectIssue(issuesFor((r) => (tmjObject(r.tmj, "stations", "sombras").properties[1].value = "lab.station.fantasma")), "asset ID no encontrado", "lab.station.fantasma");
    expectIssue(issuesFor((r) => (r.config.world.player.assetId = "character.nadie.walk")), "asset ID no encontrado");
  });
  it("rechaza una ruta editorial de Tiled que no resuelve al mismo archivo del catálogo", () => {
    expectIssue(issuesFor((r) => (r.tmj.tilesets[0].image = "../assets/backgrounds/laboratorio/otro.png")), "no resuelve al archivo", "lab.tiles.laboratorio");
  });
  it("acepta la ruta editorial equivalente con otra forma (./ y segmentos redundantes)", () => {
    const raw = loadRawProject();
    raw.tmj.tilesets[0].image = "./../assets/./backgrounds/laboratorio/../laboratorio/tiles.png";
    expect(validateRaw(raw).ok).toBe(true);
  });
  it("rechaza que el tamaño del tileset del mapa no coincida con el catálogo", () => {
    expectIssue(issuesFor((r) => (r.manifest.assets["lab.tiles.laboratorio"].tileCount = 6)), "tilecount");
    expectIssue(issuesFor((r) => (r.manifest.assets["lab.tiles.laboratorio"].width = 512)), "imagewidth");
  });
  it("rechaza un catálogo con conteos incorrectos o paths que escapan del directorio", () => {
    expectIssue(issuesFor((r) => (r.manifest.assetCount = 99)), "assets.json", "assetCount");
    expectIssue(issuesFor((r) => (r.manifest.assets["ui.icon.open-book"].path = "../secreto.png")), "no puede salir");
  });
  it("trata una pose-sheet sin frames definidos como no utilizable (CT-15)", () => {
    const raw = loadRawProject();
    const result = validateProject({ ...inputsOf(raw), frameSheets: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.message).join("|")).toContain("sin frames definidos");
  });
});

describe("configuración de contenido", () => {
  it("rechaza referencias rotas: ruta, piezas, diálogos y objetos de Cajas", () => {
    expectIssue(issuesFor((r) => r.config.route.push("fantasma")), "route", "fantasma");
    expectIssue(issuesFor((r) => (r.config.inventor.requiredPieceIds = ["lupa", "dialogo"])), "falta la pieza «corazon»");
    expectIssue(issuesFor((r) => (r.config.activities.rampas.pieceId = "lupa")), "ya la concede");
    expectIssue(issuesFor((r) => (r.config.activities.rampas.inviteDialogueId = "no-hay")), "diálogo inexistente");
    expectIssue(issuesFor((r) => (r.config.activities.cajas.suggestions[0].objectId = "tesoro")), "no es un objeto compartido");
    expectIssue(issuesFor((r) => delete r.config.activities.cajas.suggestions[0].objectId), "objectId");
  });
  it("rechaza rangos que impiden completar: dos posiciones o dos pruebas distintas", () => {
    expectIssue(issuesFor((r) => (r.config.activities.sombras.experiment.minDistinctDistanceCm = 80)), "muestras separadas");
    expectIssue(issuesFor((r) => (r.config.activities.rampas.experiment.minDistinctAngleDeg = 40)), "pruebas separadas");
    expectIssue(issuesFor((r) => (r.config.activities.rampas.experiment.angleStepDeg = 4)), "dividir exactamente");
  });
  it("rechaza propiedades desconocidas y credenciales: la configuración pública no admite datos extra", () => {
    expectIssue(issuesFor((r) => (r.config.adminToken = "secreto")), "adminToken", "no permitida");
    expectIssue(issuesFor((r) => (r.config.activities.cajas.contenidoCajaPersonal = ["x"])), "contenidoCajaPersonal", "no permitida");
  });
  it("mode presentation no admite recursos provisionales ni guiones vacíos; prototype sí", () => {
    expect(issuesFor((r) => (r.config.mode = "prototype"))).toEqual([]);
    expectIssue(issuesFor((r) => (r.config.mode = "presentation")), "laboratorio.tmj", "lab.station.shadows", "provisional");
    expectIssue(issuesFor((r) => ((r.config.mode = "presentation"), (r.manifest.assets["ui.icon.open-book"].placeholder = true), (r.manifest.assets["ui.icon.open-book"].provenance = "x"))), "ui.assets.notebookIcon", "provisional");
    expectIssue(issuesFor((r) => ((r.config.mode = "presentation"), (r.config.facilitatorNotes.cierre = []))), "facilitatorNotes.cierre", "guion vacío");
    expect(issuesFor((r) => (r.config.facilitatorNotes.cierre = []))).toEqual([]); // en prototype se admite
  });
});

describe("TMJ escrito por Tiled de escritorio (flujo de edición real)", () => {
  // Exportación real de Tiled 1.12.2 del mapa del proyecto (`Tiled --export-map json`). Documenta cómo escribe el programa:
  // la clase del objeto sale como `type` (no `class`) y se reordenan/añaden campos propios del editor.
  const fixture = JSON.parse(readFileSync(resolve("shared/testing/fixtures/laboratorio.exportado-por-tiled-1.12.2.tmj"), "utf8"));

  it("la clase de los objetos llega en `type` y aun así se reconoce", () => {
    const station = fixture.layers.find((l: any) => l.name === "stations").objects[0];
    expect(station.type).toBe("Station");
    expect(station.class).toBeUndefined();
    expect(fixture.tiledversion).toBe("1.12.2");
  });

  it("valida y produce exactamente el mismo índice espacial que el TMJ original", () => {
    const original = validateRaw(loadRawProject());
    const raw = loadRawProject();
    raw.tmj = fixture;
    const exported = validateRaw(raw);
    expect(exported.ok, exported.ok ? "" : exported.issues.map((i) => `${i.path}: ${i.message}`).join("; ")).toBe(true);
    if (original.ok && exported.ok) {
      const strip = (m: typeof original.bundle.map) => ({ ...m, stations: m.stations.map((s) => ({ ...s, objectId: 0 })), decorations: m.decorations.map((d) => ({ ...d, objectId: 0 })), inventor: { ...m.inventor!, objectId: 0 } });
      expect(strip(exported.bundle.map)).toEqual(strip(original.bundle.map));
      // La huella cambia (el archivo es otro), pero eso solo implica que una sala creada con el original queda marcada CONFIG_MISMATCH.
      expect(exported.bundle.mapHash).not.toBe(original.bundle.mapHash);
    }
  });
});
