// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drafts } from "./drafts";
import { stepProgress, recordText } from "./steps";
import { createThrottledSender } from "./throttle";

describe("borradores locales (SPECS 3.1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const room of ["ABC234", "XYZ789", "OTRA11", "MEM111"]) drafts.forgetRoom(room);
  });
  afterEach(() => vi.restoreAllMocks());
  const k = (over = {}) => ({ room: "ABC234", activityId: "sombras", field: "firstIdea", ...over });

  it("se guardan por sala, mesa y campo, sin mezclarse", () => {
    drafts.set(k(), "una idea");
    drafts.set(k({ field: "observation" }), "otra");
    drafts.set(k({ room: "XYZ789" }), "de otra sala");
    expect(drafts.get(k())).toBe("una idea");
    expect(drafts.get(k({ field: "observation" }))).toBe("otra");
    expect(drafts.get(k({ room: "XYZ789" }))).toBe("de otra sala");
    expect(drafts.get(k({ activityId: "rampas" }))).toBe("");
  });
  it("sobreviven a una recarga (almacenamiento local) y se borran al compartirse", () => {
    drafts.set(k(), "texto a medias");
    expect(window.localStorage.length).toBe(1);
    drafts.clear(k());
    expect(window.localStorage.length).toBe(0);
    expect(drafts.get(k())).toBe("");
  });
  it("detectan texto sin compartir de ESA sala, ignorando espacios y otras salas", () => {
    expect(drafts.hasUnshared("ABC234")).toBe(false);
    drafts.set(k({ field: "nextQuestion" }), "   ");
    expect(drafts.hasUnshared("ABC234")).toBe(false);
    drafts.set(k({ room: "OTRA11" }), "algo");
    expect(drafts.hasUnshared("ABC234")).toBe(false);
    drafts.set(k({ field: "nextQuestion" }), "¿Y si…?");
    expect(drafts.hasUnshared("abc234")).toBe(true);
    drafts.clear(k({ field: "nextQuestion" }));
    expect(drafts.hasUnshared("ABC234")).toBe(false);
  });
  it("forgetRoom borra los de esa sala y solo esos", () => {
    drafts.set(k(), "a");
    drafts.set(k({ room: "XYZ789" }), "b");
    drafts.forgetRoom("abc234");
    expect(drafts.get(k())).toBe("");
    expect(drafts.get(k({ room: "XYZ789" }))).toBe("b");
    expect(drafts.hasUnshared("ABC234")).toBe(false);
  });
  it("si el almacenamiento falla siguen en memoria y no lanzan", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("cuota", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(() => drafts.set(k({ room: "MEM111" }), "en memoria")).not.toThrow();
    expect(drafts.get(k({ room: "MEM111" }))).toBe("en memoria");
  });
});

describe("emisor con límite de frecuencia (≈ 12 Hz)", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  const make = (send: (v: number) => void) => createThrottledSender(send, 83, () => Date.now(), setTimeout, clearTimeout);

  it("no supera la frecuencia: 100 valores en un segundo envían como mucho ~12 mensajes y el último siempre llega", () => {
    const sent: number[] = [];
    const s = make((v) => sent.push(v));
    for (let i = 0; i < 100; i++) {
      s.push(i);
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(200);
    expect(sent.length).toBeLessThanOrEqual(13);
    expect(sent.length).toBeGreaterThanOrEqual(10);
    expect(sent.at(-1)).toBe(99); // la posición final nunca se pierde
    expect(sent).toEqual([...sent].sort((a, b) => a - b)); // y en orden
  });
  it("flush envía ya el valor pendiente (al soltar el gesto) sin esperar", () => {
    const sent: number[] = [];
    const s = make((v) => sent.push(v));
    s.push(1);
    vi.advanceTimersByTime(20);
    s.push(2); // dentro del intervalo: queda pendiente
    expect(sent).toEqual([1]);
    s.flush();
    expect(sent).toEqual([1, 2]);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1, 2]); // sin duplicados
  });
  it("tras dispose no envía nada pendiente", () => {
    const sent: number[] = [];
    const s = make((v) => sent.push(v));
    s.push(1);
    vi.advanceTimersByTime(10);
    s.push(2);
    s.dispose();
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1]);
  });
});

describe("pasos y textos de registros", () => {
  it("los pasos internos se presentan como pasos del público (sorpresa + primera idea = paso 1)", () => {
    const shadows = (step: string) => stepProgress({ type: "shadows", step, distanceCm: 10, samples: [] } as never);
    expect(shadows("surprise")).toEqual({ n: 1, total: 4, done: false });
    expect(shadows("firstIdea")).toEqual({ n: 1, total: 4, done: false });
    expect(shadows("nextQuestion")).toEqual({ n: 4, total: 4, done: false });
    expect(shadows("completed")).toMatchObject({ done: true });
    const boxes = (step: string) => stepProgress({ type: "boxes", step, sharedOpen: false, inspected: [] } as never);
    expect(boxes("refusal").n).toBe(boxes("respect").n); // negativa y respeto son un mismo momento visible
  });
  it("oral e incertidumbre muestran las frases de la configuración; escrito y sugerido, su texto", () => {
    const labels = { oralRecord: "Lo diremos en voz alta", uncertainRecord: "Aún no sabemos" };
    expect(recordText({ modality: "oral", text: null }, labels)).toBe("Lo diremos en voz alta");
    expect(recordText({ modality: "uncertain", text: null }, labels)).toBe("Aún no sabemos");
    expect(recordText({ modality: "written", text: "Mi idea" }, labels)).toBe("Mi idea");
    expect(recordText({ modality: "suggested", text: "¿Qué pasaría…?" }, labels)).toBe("¿Qué pasaría…?");
  });
});
