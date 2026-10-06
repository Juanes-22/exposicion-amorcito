import type { ConfigIssue } from "../contracts/assets";
import type { Point, Rect } from "../contracts/geometry";

/**
 * Lectura semántica mínima del TMJ (SPECS 8): interpreta qué objeto es un spawn, una estación o una colisión y valida el perfil
 * compatible de la primera versión. No es un parser alternativo de Tiled ni escribe nada: Phaser lee el mismo TMJ de forma nativa.
 */

export const DEFAULT_INTERACTION_RADIUS = 72;
export type DepthMode = "feet" | "back" | "front";

export interface MapStation {
  activityId: string;
  assetId: string;
  point: Point;
  interactionRadius: number;
  scale: number;
  objectId: number;
}

export interface MapInventor {
  assetId: string;
  point: Point;
  interactionRadius: number;
  scale: number;
  objectId: number;
}

export interface MapDecoration {
  assetId: string;
  point: Point;
  origin: Point;
  scale: number;
  depthMode: DepthMode;
  objectId: number;
  layer: string;
  /** Visible en Tiled en el objeto y en su capa: la visibilidad solo afecta a lo decorativo (SPECS 8.3). */
  visible: boolean;
}

export interface MapSoundEmitter {
  soundId: string;
  assetId: string;
  point: Point;
  volume: number;
  radius: number;
  mode: string;
  objectId: number;
}

export interface MapTileset {
  name: string;
  assetId: string;
  /** Campo nativo `image` del TMJ, relativo al propio mapa. Referencia editorial: debe resolver al mismo archivo que `assetId`. */
  image: string;
  firstGid: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
  imageWidth: number;
  imageHeight: number;
}

export interface MapImageLayer {
  /** Posición entre todas las capas del TMJ: define el orden visual. */
  index: number;
  name: string;
  assetId: string;
  image: string;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
}

export interface MapTileLayer {
  index: number;
  name: string;
  visible: boolean;
  opacity: number;
}

export interface MapIndex {
  mapId: string;
  widthPx: number;
  heightPx: number;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  spawns: Record<string, Point>;
  stations: MapStation[];
  inventor: MapInventor | null;
  decorations: MapDecoration[];
  collisions: Rect[];
  soundEmitters: MapSoundEmitter[];
  tilesets: MapTileset[];
  imageLayers: MapImageLayer[];
  tileLayers: MapTileLayer[];
}

export type TmjRead = { map: MapIndex; issues: ConfigIssue[] } | { map: null; issues: ConfigIssue[] };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

const GID_MASK = 0x1fffffff;
const KNOWN_CLASSES = ["Spawn", "Station", "Inventor", "Decoration", "Collision", "SoundEmitter", "EditorOnly"] as const;
type ObjectClass = (typeof KNOWN_CLASSES)[number];

interface PropValue {
  type: string;
  value: unknown;
}

/** Lee una vez un TMJ y devuelve el índice semántico o los problemas con su ubicación exacta. */
export function readTmj(raw: unknown, mapId: string): TmjRead {
  const issues: ConfigIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ file: "laboratorio.tmj", path, message });
  };

  if (!isObj(raw)) {
    issue("mapa", "el archivo no es un objeto JSON de Tiled");
    return { map: null, issues };
  }
  if (raw.type !== "map") issue("mapa › type", `debe ser «map» (formato Tiled JSON map); es ${JSON.stringify(raw.type)}`);
  if (raw.orientation !== "orthogonal") issue("mapa › orientation", `solo se admite «orthogonal»; es ${JSON.stringify(raw.orientation)}`);
  if (raw.infinite !== false) issue("mapa › infinite", "los mapas infinitos (con chunks) no están soportados: desactiva «Infinite» al crear el mapa");
  for (const key of ["width", "height", "tilewidth", "tileheight"] as const) {
    if (!isPosInt(raw[key])) issue(`mapa › ${key}`, "debe ser un entero positivo");
  }
  if (!Array.isArray(raw.layers)) issue("mapa › layers", "debe ser una lista de capas");
  if (!Array.isArray(raw.tilesets)) issue("mapa › tilesets", "debe ser una lista (puede estar vacía)");
  if (issues.length > 0) return { map: null, issues };

  const cols = raw.width as number;
  const rows = raw.height as number;
  const tileWidth = raw.tilewidth as number;
  const tileHeight = raw.tileheight as number;
  const widthPx = cols * tileWidth;
  const heightPx = rows * tileHeight;

  // ---- tilesets incrustados ----
  const tilesets: MapTileset[] = [];
  (raw.tilesets as unknown[]).forEach((ts, i) => {
    const at = `tileset #${i}`;
    if (!isObj(ts)) return issue(at, "no es un objeto");
    const name = typeof ts.name === "string" ? ts.name : `#${i}`;
    const where = `tileset «${name}»`;
    if (ts.source !== undefined) return issue(where, "usa un tileset externo (`source`): la definición debe estar incrustada en el TMJ");
    if (typeof ts.image !== "string" || ts.image === "") return issue(where, "no tiene una sola imagen: las colecciones de imágenes no están soportadas; usa una imagen de tiles o capas de imagen");
    for (const key of ["firstgid", "tilewidth", "tileheight", "tilecount", "columns", "imagewidth", "imageheight"] as const) {
      if (!isPosInt(ts[key])) return issue(`${where} › ${key}`, "debe ser un entero positivo");
    }
    if (ts.margin !== undefined && ts.margin !== 0) issue(`${where} › margin`, "los márgenes no están soportados en el perfil inicial");
    if (ts.spacing !== undefined && ts.spacing !== 0) issue(`${where} › spacing`, "el espaciado no está soportado en el perfil inicial");
    const props = readProps(ts.properties, (m) => issue(where, m));
    const assetId = props.get("assetId");
    if (!assetId || assetId.type !== "string" || typeof assetId.value !== "string" || assetId.value === "") {
      return issue(`${where} › propiedad assetId`, "obligatoria: el assetId de la imagen en assets.json");
    }
    tilesets.push({
      name,
      assetId: assetId.value,
      image: ts.image,
      firstGid: ts.firstgid as number,
      tileWidth: ts.tilewidth as number,
      tileHeight: ts.tileheight as number,
      columns: ts.columns as number,
      tileCount: ts.tilecount as number,
      imageWidth: ts.imagewidth as number,
      imageHeight: ts.imageheight as number,
    });
  });

  const maxGid = tilesets.reduce((m, t) => Math.max(m, t.firstGid + t.tileCount - 1), 0);

  // ---- capas ----
  const spawns: Record<string, Point> = {};
  const stations: MapStation[] = [];
  let inventor: MapInventor | null = null;
  const decorations: MapDecoration[] = [];
  const collisions: Rect[] = [];
  const soundEmitters: MapSoundEmitter[] = [];
  const imageLayers: MapImageLayer[] = [];
  const tileLayers: MapTileLayer[] = [];
  const layerNames = new Set<string>();

  const readObject = (o: Json, oi: number, lloc: string, layerName: string, layerVisible: boolean): void => {
    const oid = isNum(o.id) ? o.id : -1;
    const oname = typeof o.name === "string" && o.name !== "" ? ` «${o.name}»` : "";
    const oloc = `${lloc} › objeto #${oid >= 0 ? oid : oi}${oname}`;
    const rawClass = (typeof o.class === "string" && o.class !== "" ? o.class : undefined) ?? (typeof o.type === "string" && o.type !== "" ? o.type : undefined);
    let cls: ObjectClass | undefined;
    if (rawClass === undefined) {
      if (layerName === "collisions") cls = "Collision";
      else return issue(oloc, `no tiene clase: asigna ${KNOWN_CLASSES.join(", ")} (o EditorOnly si es solo una nota)`);
    } else if ((KNOWN_CLASSES as readonly string[]).includes(rawClass)) cls = rawClass as ObjectClass;
    else return issue(oloc, `clase «${rawClass}» no admitida; usa ${KNOWN_CLASSES.join(", ")}`);
    if (cls === "EditorOnly") return; // se ignora en runtime

    if (o.ellipse === true) return issue(oloc, "las elipses no están soportadas: solo puntos y rectángulos");
    if (o.polygon !== undefined || o.polyline !== undefined) return issue(oloc, "los polígonos y polilíneas no están soportados: solo puntos y rectángulos");
    if (o.text !== undefined) return issue(oloc, "los objetos de texto no están soportados");
    if (o.gid !== undefined) return issue(oloc, "los objetos de tile (gid) no están soportados: usa un punto con `assetId`");
    if (o.template !== undefined) return issue(oloc, "las plantillas externas no están soportadas");
    if (isNum(o.rotation) && o.rotation !== 0) return issue(oloc, "las rotaciones no están soportadas");
    if (!isNum(o.x) || !isNum(o.y)) return issue(oloc, "x e y deben ser números");

    const isPoint = o.point === true;
    if (cls === "Collision") {
      if (isPoint) return issue(oloc, "una colisión debe ser un rectángulo, no un punto");
      if (!isNum(o.width) || !isNum(o.height) || o.width <= 0 || o.height <= 0) return issue(oloc, "una colisión necesita ancho y alto positivos");
      const rect = { x: o.x, y: o.y, width: o.width, height: o.height };
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > widthPx || rect.y + rect.height > heightPx) {
        issue(oloc, `la colisión se sale del mapa (${widthPx} × ${heightPx} px)`);
      }
      collisions.push(rect);
      return;
    }

    if (!isPoint) return issue(oloc, `${cls} debe ser un punto (herramienta «Insert Point»)`);
    const point = { x: o.x, y: o.y };
    if (point.x < 0 || point.y < 0 || point.x > widthPx || point.y > heightPx) issue(oloc, `el punto cae fuera del mapa (${widthPx} × ${heightPx} px)`);
    const props = readProps(o.properties, (m) => issue(oloc, m));
    const str = (key: string, required: boolean): string | undefined => readString(props, key, required, `${oloc} › propiedad ${key}`, issue);
    const num = (key: string, fallback: number, positive = true): number => readNumber(props, key, fallback, positive, `${oloc} › propiedad ${key}`, issue);

    switch (cls) {
      case "Spawn": {
        const spawnId = str("spawnId", true);
        if (spawnId === undefined) return;
        if (Object.hasOwn(spawns, spawnId)) return issue(`${oloc} › propiedad spawnId`, `«${spawnId}» está repetido`);
        spawns[spawnId] = point;
        return;
      }
      case "Station": {
        const activityId = str("activityId", true);
        const assetId = str("assetId", true);
        if (activityId === undefined || assetId === undefined) return;
        stations.push({ activityId, assetId, point, interactionRadius: num("interactionRadius", DEFAULT_INTERACTION_RADIUS), scale: num("scale", 1), objectId: oid });
        return;
      }
      case "Inventor": {
        const assetId = str("assetId", true);
        if (assetId === undefined) return;
        if (inventor) return issue(oloc, "hay más de un Inventor; el mapa inicial admite uno solo");
        inventor = { assetId, point, interactionRadius: num("interactionRadius", DEFAULT_INTERACTION_RADIUS), scale: num("scale", 1), objectId: oid };
        return;
      }
      case "Decoration": {
        const assetId = str("assetId", true);
        if (assetId === undefined) return;
        const depth = str("depthMode", false) ?? "feet";
        if (depth !== "feet" && depth !== "back" && depth !== "front") return issue(`${oloc} › propiedad depthMode`, "debe ser feet, back o front");
        decorations.push({
          assetId,
          point,
          origin: { x: num("originX", 0.5, false), y: num("originY", 1, false) },
          scale: num("scale", 1),
          depthMode: depth,
          objectId: oid,
          layer: layerName,
          visible: layerVisible && o.visible !== false,
        });
        return;
      }
      case "SoundEmitter": {
        const soundId = str("soundId", true);
        const assetId = str("assetId", true);
        if (soundId === undefined || assetId === undefined) return;
        soundEmitters.push({ soundId, assetId, point, volume: num("volume", 1), radius: num("radius", 200), mode: str("mode", false) ?? "loop", objectId: oid });
        return;
      }
    }
  };

  (raw.layers as unknown[]).forEach((layer, li) => {
    if (!isObj(layer)) return issue(`capa #${li}`, "no es un objeto");
    const name = typeof layer.name === "string" ? layer.name : `#${li}`;
    const lloc = `capa «${name}»`;
    if (layerNames.has(name)) issue(lloc, "hay dos capas con el mismo nombre");
    layerNames.add(name);
    const visible = layer.visible !== false;
    const opacity = isNum(layer.opacity) ? layer.opacity : 1;

    switch (layer.type) {
      case "group":
        return issue(lloc, "los grupos de capas no están soportados en el perfil inicial: saca las capas del grupo");
      case "tilelayer": {
        if (layer.encoding !== undefined && layer.encoding !== "csv") return issue(`${lloc} › encoding`, "los datos deben ser un arreglo numérico sin compresión ni base64");
        if (layer.compression !== undefined && layer.compression !== "") return issue(`${lloc} › compression`, "la compresión no está soportada");
        if (layer.chunks !== undefined) return issue(`${lloc} › chunks`, "los chunks no están soportados (mapa finito)");
        if (!Array.isArray(layer.data)) return issue(`${lloc} › data`, "debe ser un arreglo numérico (sin base64 ni compresión)");
        if (layer.data.length !== cols * rows) issue(`${lloc} › data`, `tiene ${layer.data.length} celdas y el mapa ${cols * rows} (${cols} × ${rows})`);
        let bad = 0;
        for (const raw of layer.data as unknown[]) {
          if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
            bad++;
            continue;
          }
          const gid = raw & GID_MASK;
          if (gid !== 0 && (gid > maxGid || !tilesets.some((t) => gid >= t.firstGid && gid < t.firstGid + t.tileCount))) bad++;
        }
        if (bad > 0) issue(`${lloc} › data`, `${bad} celda(s) con un GID que no pertenece a ningún tileset incrustado`);
        tileLayers.push({ index: li, name, visible, opacity });
        return;
      }
      case "imagelayer": {
        if (typeof layer.image !== "string" || layer.image === "") return issue(`${lloc}`, "la capa de imagen no tiene imagen");
        if ((isNum(layer.parallaxx) && layer.parallaxx !== 1) || (isNum(layer.parallaxy) && layer.parallaxy !== 1)) issue(lloc, "el parallax no está soportado");
        if (layer.tintcolor !== undefined) issue(lloc, "los tintes no están soportados");
        if (layer.repeatx === true || layer.repeaty === true) issue(lloc, "repetir la imagen no está soportado");
        const props = readProps(layer.properties, (m) => issue(lloc, m));
        const assetId = props.get("assetId");
        if (!assetId || typeof assetId.value !== "string" || assetId.value === "") return issue(`${lloc} › propiedad assetId`, "obligatoria: el assetId de la imagen en assets.json");
        imageLayers.push({
          index: li,
          name,
          assetId: assetId.value,
          image: layer.image,
          x: isNum(layer.offsetx) ? layer.offsetx : 0,
          y: isNum(layer.offsety) ? layer.offsety : 0,
          visible,
          opacity,
        });
        return;
      }
      case "objectgroup": {
        if (!Array.isArray(layer.objects)) return issue(`${lloc} › objects`, "debe ser una lista");
        (layer.objects as unknown[]).forEach((o, oi) => {
          if (!isObj(o)) return issue(`${lloc} › objeto #${oi}`, "no es un objeto");
          readObject(o, oi, lloc, name, visible);
        });
        return;
      }
      default:
        return issue(lloc, `tipo de capa «${String(layer.type)}» no soportado`);
    }
  });

  if (issues.length > 0) return { map: null, issues };
  return { map: { mapId, widthPx, heightPx, tileWidth, tileHeight, cols, rows, spawns, stations, inventor, decorations, collisions, soundEmitters, tilesets, imageLayers, tileLayers }, issues };
}

// ---- propiedades de Tiled ---------------------------------------------------------

function readProps(raw: unknown, onProblem: (message: string) => void): Map<string, PropValue> {
  const out = new Map<string, PropValue>();
  if (raw === undefined) return out;
  if (!Array.isArray(raw)) {
    onProblem("`properties` debe ser una lista de propiedades de Tiled");
    return out;
  }
  for (const p of raw) {
    if (!isObj(p) || typeof p.name !== "string") {
      onProblem("hay una propiedad sin nombre");
      continue;
    }
    if (out.has(p.name)) onProblem(`la propiedad «${p.name}» está repetida`);
    out.set(p.name, { type: typeof p.type === "string" ? p.type : "string", value: p.value });
  }
  return out;
}

type Report = (path: string, message: string) => void;

function readString(props: Map<string, PropValue>, key: string, required: boolean, loc: string, report: Report): string | undefined {
  const p = props.get(key);
  if (!p) {
    if (required) report(loc, "obligatoria y ausente");
    return undefined;
  }
  if (typeof p.value !== "string" || p.value.trim() === "") {
    report(loc, "debe ser un texto no vacío");
    return undefined;
  }
  return p.value;
}

function readNumber(props: Map<string, PropValue>, key: string, fallback: number, positive: boolean, loc: string, report: Report): number {
  const p = props.get(key);
  if (!p) return fallback;
  if (typeof p.value !== "number" || !Number.isFinite(p.value) || (positive && p.value <= 0)) {
    report(loc, positive ? "debe ser un número mayor que 0" : "debe ser un número");
    return fallback;
  }
  return p.value;
}
