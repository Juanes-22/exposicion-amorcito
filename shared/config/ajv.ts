import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import type { ConfigIssue } from "../contracts/assets";

// Un solo Ajv por proceso. `discriminator` da errores claros para uniones por `type`.
// Se usa el export con nombre: funciona igual en Node ESM (CLI, servidor, Vitest) y en el bundle de Vite.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, discriminator: true });

export function compileSchema<T = unknown>(schema: object): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

function toPath(instancePath: string): string {
  return instancePath
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((acc, seg) => (/^\d+$/.test(seg) ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg), "");
}

const join = (base: string, extra: string) => (base ? `${base}.${extra}` : extra);

function toIssue(file: ConfigIssue["file"], e: ErrorObject): ConfigIssue {
  const base = toPath(e.instancePath);
  const p = e.params as Record<string, unknown>;
  const at = (path: string, message: string): ConfigIssue => ({ file, path, message });
  switch (e.keyword) {
    case "required":
      return at(join(base, String(p.missingProperty)), "propiedad obligatoria ausente");
    case "additionalProperties":
      return at(join(base, String(p.additionalProperty)), "propiedad no permitida");
    case "type":
      return at(base, `debe ser de tipo ${String(p.type)}`);
    case "enum":
      return at(base, `valor no permitido; admitidos: ${(p.allowedValues as unknown[]).join(", ")}`);
    case "const":
      return at(base, `debe ser ${JSON.stringify(p.allowedValue)}`);
    case "discriminator":
      return at(base, p.error === "tag" ? `falta «${String(p.tag)}» o no es texto` : `«${String(p.tag)}» = «${String(p.tagValue)}» no es un valor reconocido`);
    case "oneOf":
      return at(base, "no coincide con ninguna de las variantes admitidas");
    case "pattern":
      return at(base, `no cumple el formato ${String(p.pattern)}`);
    case "exclusiveMinimum":
      return at(base, `debe ser mayor que ${String(p.limit)}`);
    case "minimum":
      return at(base, `debe ser mayor o igual que ${String(p.limit)}`);
    case "maximum":
      return at(base, `debe ser menor o igual que ${String(p.limit)}`);
    case "minItems":
      return at(base, `debe tener al menos ${String(p.limit)} elemento(s)`);
    case "maxItems":
      return at(base, `debe tener como máximo ${String(p.limit)} elemento(s)`);
    case "minLength":
      return at(base, "no puede estar vacío");
    case "maxLength":
      return at(base, `no puede superar ${String(p.limit)} unidades`);
    case "uniqueItems":
      return at(base, "contiene elementos repetidos");
    case "propertyNames":
      return at(base, `clave «${String(p.propertyName)}» con formato no válido`);
    default:
      return at(base, e.message ?? e.keyword);
  }
}

export function ajvIssues(file: ConfigIssue["file"], errors: ErrorObject[] | null | undefined): ConfigIssue[] {
  return (errors ?? []).map((e) => toIssue(file, e));
}
