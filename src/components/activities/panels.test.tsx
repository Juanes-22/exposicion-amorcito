// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdventureAction, CommandResult } from "../../../shared/contracts/actions";
import { bundle, Driver, finishRamps, finishShadows, openStation, beto } from "../../../shared/testing/drive";
import { ActivityView, type ActivityViewProps } from "./ActivityView";
import { drafts } from "./drafts";

const ROOM = "ABC234";
const OK: CommandResult = { ok: true, requestId: "r", stateVersion: 1, turnVersion: 1 };
const DENIED: CommandResult = { ok: false, requestId: "r", code: "STALE_TURN", message: "Ya no tienes el turno." };

let sent: AdventureAction[];
let reply: CommandResult;
const send = vi.fn(async (a: AdventureAction) => {
  sent.push(a);
  return reply;
});

beforeEach(() => {
  sent = [];
  reply = OK;
  send.mockClear();
  window.localStorage.clear();
  drafts.forgetRoom(ROOM);
});
afterEach(cleanup);

const view = (d: Driver, over: Partial<ActivityViewProps> = {}) => (
  <ActivityView room={ROOM} config={bundle.config} adv={d.state} interactive canReturn busy={false} ownerName="Ana" send={send} {...over} />
);
const shadowsAt = (...steps: Array<(d: Driver) => void>) => {
  const d = new Driver();
  openStation(d, "sombras");
  for (const s of steps) s(d);
  return d;
};
/** Camino real hasta Cajas: se completan Sombras y Rampas con el dominio (el orden del recorrido las exige). */
const untilBoxes = () => {
  const d = new Driver();
  finishShadows(d);
  d.do({ type: "adventure.returnToMap" });
  finishRamps(d);
  d.do({ type: "adventure.returnToMap" });
  return d;
};
const area = () => screen.getByLabelText("Tu respuesta") as HTMLTextAreaElement;

describe("formulario común (P4-04, SPECS 3.1)", () => {
  it("avisa que lo escrito se comparte, ofrece las cuatro formas de responder la primera idea y cuenta caracteres", () => {
    render(view(shadowsAt()));
    expect(screen.getByText("Esta idea se compartirá con el grupo")).toBeTruthy();
    for (const label of ["Escribir", "Elegir una idea", "Lo diremos en voz alta", "Todavía no sé"]) expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    fireEvent.change(area(), { target: { value: "Por la luz" } });
    expect(screen.getByText(/10\/280 caracteres/)).toBeTruthy();
  });

  it("la observación no ofrece sugerencias y la pregunta nueva no ofrece «Todavía no sé» (reglas del dominio)", () => {
    const d = shadowsAt(
      (x) => x.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } }),
      (x) => x.do({ type: "shadows.light.set", distanceCm: 15, commitSample: true }),
      (x) => x.do({ type: "shadows.light.set", distanceCm: 45, commitSample: true }),
    );
    const { unmount } = render(view(d));
    expect(screen.queryByRole("radio", { name: /Elegir/ })).toBeNull();
    expect(screen.getByRole("radio", { name: "Todavía no sé" })).toBeTruthy();
    unmount();
    d.do({ type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "uncertain" } });
    render(view(d));
    expect(screen.getByRole("radio", { name: "Elegir una pregunta" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Todavía no sé" })).toBeNull();
  });

  it("pasado el límite no se puede compartir y el campo queda marcado; con texto válido se envía solo lo escrito", async () => {
    render(view(shadowsAt()));
    const share = screen.getByRole("button", { name: "Compartir con el grupo" }) as HTMLButtonElement;
    expect(share.disabled).toBe(true); // vacío
    fireEvent.change(area(), { target: { value: "x".repeat(281) } });
    expect(share.disabled).toBe(true);
    expect(area().getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(area(), { target: { value: "  Por la luz  " } });
    expect(share.disabled).toBe(false);
    fireEvent.click(share);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Por la luz" } });
  });

  it("el borrador es local: escribir no envía nada, y sobrevive a desmontar el formulario", () => {
    const { unmount } = render(view(shadowsAt()));
    fireEvent.change(area(), { target: { value: "algo a medias" } });
    expect(sent).toHaveLength(0);
    expect(drafts.hasUnshared(ROOM)).toBe(true);
    unmount();
    render(view(shadowsAt()));
    expect(area().value).toBe("algo a medias");
  });

  it("si el servidor deniega, el texto se conserva y el botón vuelve a estar disponible; si acepta, el borrador se borra", async () => {
    reply = DENIED;
    render(view(shadowsAt()));
    fireEvent.change(area(), { target: { value: "mi idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Compartir con el grupo" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Compartir con el grupo" }) as HTMLButtonElement).disabled).toBe(false));
    expect(area().value).toBe("mi idea");
    expect(drafts.get({ room: ROOM, activityId: "sombras", field: "firstIdea" })).toBe("mi idea");

    reply = OK;
    fireEvent.click(screen.getByRole("button", { name: "Compartir con el grupo" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() => expect(area().value).toBe(""));
    expect(drafts.hasUnshared(ROOM)).toBe(false);
  });

  it("una sugerencia envía solo su identificador (el servidor resuelve el texto) y «oral» no envía texto", async () => {
    render(view(shadowsAt()));
    fireEvent.click(screen.getByRole("radio", { name: "Elegir una idea" }));
    fireEvent.click(screen.getByRole("radio", { name: "Creo que la luz tiene algo que ver." }));
    fireEvent.click(screen.getByRole("button", { name: "Compartir con el grupo" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ value: { modality: "suggested", optionId: "la-luz" } });
    expect(JSON.stringify(sent[0])).not.toContain("Creo que");
    fireEvent.click(screen.getByRole("radio", { name: "Lo diremos en voz alta" }));
    fireEvent.click(screen.getByRole("button", { name: "Compartir con el grupo" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ value: { modality: "oral" } });
    expect(JSON.stringify(sent[1])).not.toContain('"text"');
  });
});

describe("modo lectura de la proyección (CA-20)", () => {
  it("sin turno no hay campos, botones ni controles en ninguna mesa; solo el texto y lo ya compartido", () => {
    const sombras = shadowsAt();
    const rampas = new Driver();
    finishShadows(rampas);
    rampas.do({ type: "adventure.returnToMap" });
    openStation(rampas, "rampas");
    const cajas = untilBoxes();
    openStation(cajas, "cajas");
    cajas.do({ type: "boxes.shared.open" });
    cajas.do({ type: "boxes.object.inspect", objectId: "campanita" });
    for (const d of [sombras, rampas, cajas]) {
      const { container, unmount } = render(view(d, { interactive: false, canReturn: false }));
      expect(container.textContent!.length).toBeGreaterThan(0);
      expect(container.querySelectorAll("button, input, textarea, select").length).toBe(0);
      unmount();
    }
  });

  it("la proyección muestra el texto confirmado y su autor, y la primera idea destacada, pero nunca un borrador", () => {
    const d = shadowsAt((x) => x.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Será la luz" } }, beto));
    drafts.set({ room: ROOM, activityId: "sombras", field: "observation" }, "BORRADOR PRIVADO");
    const { container } = render(view(d, { interactive: false, canReturn: false }));
    expect(screen.getByText("Será la luz")).toBeTruthy();
    expect(container.querySelector(".record--first")?.textContent).toContain("Beto");
    expect(container.textContent).not.toContain("BORRADOR PRIVADO");
  });
});

describe("Sombras: controles de la linterna", () => {
  const explore = () => shadowsAt((x) => x.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } }));

  it("el slider va de «más lejos» (izquierda) a «más cerca» (derecha) y envía la posición sin anotarla", async () => {
    render(view(explore()));
    const slider = screen.getByRole("slider", { name: "Distancia de la linterna al objeto" }) as HTMLInputElement;
    expect(slider.value).toBe("60"); // d = 10 cm (cerca) → extremo derecho del rango 10–60
    expect(screen.getByText("Más lejos del objeto").compareDocumentPosition(screen.getByText("Más cerca del objeto")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(slider, { target: { value: "40" } }); // 10 + 60 − 40 = 30 cm
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0]).toEqual({ type: "shadows.light.set", distanceCm: 30, commitSample: false });
  });

  it("«Anotar esta posición» confirma la distancia mostrada (equivalente por teclado y botones)", async () => {
    render(view(explore()));
    fireEvent.click(screen.getByRole("button", { name: "Alejar la linterna del objeto" }));
    fireEvent.click(screen.getByRole("button", { name: "Anotar esta posición" }));
    await waitFor(() => expect(sent.some((a) => a.type === "shadows.light.set" && a.commitSample)).toBe(true));
    expect(sent.filter((a) => a.type === "shadows.light.set" && a.commitSample).at(-1)).toEqual({ type: "shadows.light.set", distanceCm: 11, commitSample: true });
  });

  it("describe la sombra con texto y los botones se bloquean en los extremos", () => {
    render(view(explore()));
    expect(screen.getByRole("status").textContent).toMatch(/La linterna está a 10 cm del objeto/);
    expect((screen.getByRole("button", { name: "Acercar la linterna al objeto" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Rampas", () => {
  const ramps = (...steps: Array<(d: Driver) => void>) => {
    const d = new Driver();
    finishShadows(d);
    d.do({ type: "adventure.returnToMap" });
    openStation(d, "rampas");
    for (const s of steps) s(d);
    return d;
  };
  const toTrials = [
    (d: Driver) => d.do({ type: "ramps.question.open" }),
    (d: Driver) => d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } }),
    (d: Driver) => d.do({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } }),
  ];

  it("con la respuesta cerrada no hay controles de la rampa; «Tengo una pregunta» la abre", async () => {
    render(view(ramps()));
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: "Soltar la pelota" })).toBeNull();
    expect(screen.getByText(/No hagas preguntas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tengo una pregunta" }));
    await waitFor(() => expect(sent).toEqual([{ type: "ramps.question.open" }]));
  });

  it("con una prueba rodando se bloquean la inclinación y soltar otra; la tabla indica «rodando…»", () => {
    const d = ramps(...toTrials, (x) => x.do({ type: "ramps.trial.start" }));
    render(view(d));
    expect((screen.getByRole("slider", { name: "Inclinación de la rampa" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "La pelota está rodando…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Subir la inclinación" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("rodando…")).toBeTruthy();
  });

  it("en reposo permite elegir de 5° en 5° y soltar; la tabla muestra el tiempo de la simulación", async () => {
    const d = ramps(...toTrials, (x) => x.do({ type: "ramps.trial.start" }), (x) => x.tick(10_000));
    render(view(d));
    const slider = screen.getByRole("slider", { name: "Inclinación de la rampa" }) as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value: "3" } }); // 15 + 3 × 5 = 30°
    await waitFor(() => expect(sent).toEqual([{ type: "ramps.angle.set", angleDeg: 30 }]));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(/^\d+,\d s$/)).toBeTruthy();
    expect(screen.getByText(/El tiempo es el de la simulación, no una medición real/)).toBeTruthy();
  });

  it("dice cuántas pruebas faltan para comparar", () => {
    const d = ramps(...toTrials);
    render(view(d));
    expect(screen.getByText(/hacen falta 2 pruebas terminadas con inclinaciones que se diferencien al menos 5° \(llevas 0\)/)).toBeTruthy();
  });
});

describe("La caja de las sorpresas", () => {
  const boxes = (...steps: Array<(d: Driver) => void>) => {
    const d = untilBoxes();
    openStation(d, "cajas");
    for (const s of steps) s(d);
    return d;
  };
  const afterRefusal = [
    (d: Driver) => d.do({ type: "boxes.shared.open" }),
    (d: Driver) => d.do({ type: "boxes.object.inspect", objectId: "campanita" }),
    (d: Driver) => d.do({ type: "boxes.permission.ask" }),
    (d: Driver) => d.do({ type: "boxes.refusal.ack" }),
    (d: Driver) => d.do({ type: "boxes.refusal.respect" }),
  ];

  it("la caja compartida empieza cerrada: sin objetos hasta abrirla", async () => {
    render(view(boxes()));
    expect(screen.queryByRole("button", { name: "Campanita" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir la caja para explorar" }));
    await waitFor(() => expect(sent).toEqual([{ type: "boxes.shared.open" }]));
  });

  it("al elegir un objeto se muestra su descripción en texto", () => {
    render(view(boxes((d) => d.do({ type: "boxes.shared.open" }), (d) => d.do({ type: "boxes.object.inspect", objectId: "lupa" }))));
    expect(screen.getByText(/Una lupa\. Al mirar a través de ella/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "✓ Lupa" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tocar la caja personal solo muestra un mensaje local: no se envía NINGÚN comando (CA-18)", () => {
    render(view(boxes(...afterRefusal)));
    expect(screen.queryByText(/Su contenido es personal/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Caja personal/ }));
    expect(screen.getByText("Su contenido es personal. Podemos seguir explorando los objetos compartidos.")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    // y no existe ningún control para abrirla: el único botón con «personal» es el que muestra el mensaje
    expect(screen.getAllByRole("button").filter((b) => /abrir/i.test(b.textContent ?? "") && /personal/i.test(b.textContent ?? ""))).toHaveLength(0);
  });

  it("la negativa se lee antes de seguir: «Entendido» y luego «Respetar y seguir explorando»", async () => {
    const d = boxes(afterRefusal[0]!, afterRefusal[1]!, afterRefusal[2]!);
    const { unmount } = render(view(d));
    expect(screen.getByText(/Prefiero guardar esas cosas para mí/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Respetar y seguir explorando" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    await waitFor(() => expect(sent).toEqual([{ type: "boxes.refusal.ack" }]));
    unmount();
    d.do({ type: "boxes.refusal.ack" });
    render(view(d));
    fireEvent.click(screen.getByRole("button", { name: "Respetar y seguir explorando" }));
    await waitFor(() => expect(sent.at(-1)).toEqual({ type: "boxes.refusal.respect" }));
  });

  it("la pregunta pide el objeto sobre el que es y lo envía con la respuesta escrita", async () => {
    render(view(boxes(...afterRefusal)));
    fireEvent.change(area(), { target: { value: "¿Por qué suena?" } });
    const share = screen.getByRole("button", { name: "Compartir con el grupo" }) as HTMLButtonElement;
    expect((screen.getByRole("radio", { name: "Campanita" }) as HTMLInputElement).checked).toBe(true); // el último objeto mirado ya viene elegido
    fireEvent.click(screen.getByRole("radio", { name: "Piedra" }));
    fireEvent.click(share);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "written", text: "¿Por qué suena?" }, objectId: "piedra" });
  });

  it("la proyección ve qué objetos se miraron pero sin botones activos", () => {
    const { container } = render(view(boxes(afterRefusal[0]!, afterRefusal[1]!), { interactive: false, canReturn: false }));
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.querySelector(".object-chip.is-selected")?.textContent).toContain("Campanita");
  });
});

describe("estructura de la mesa", () => {
  it("«Reiniciar experimento» está en Sombras y Rampas; no en Cajas, donde no hay experimento que reponer", async () => {
    const { unmount } = render(view(shadowsAt()));
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar experimento" }));
    await waitFor(() => expect(sent).toEqual([{ type: "experiment.reset" }]));
    unmount();
    const d = untilBoxes();
    openStation(d, "cajas");
    render(view(d));
    expect(screen.queryByRole("button", { name: "Reiniciar experimento" })).toBeNull();
  });

  it("muestra «Paso n de m», «Volver al mapa» y, al completar, la pieza conseguida con su mensaje", async () => {
    const d = new Driver();
    finishShadows(d);
    render(view(d));
    expect(screen.getByText("Mesa completada")).toBeTruthy();
    const piece = bundle.config.inventor.pieces.find((p) => p.id === "lupa")!;
    const banner = document.querySelector(".banner--piece")!.textContent!;
    expect(banner).toContain(piece.label);
    expect(banner).toContain(piece.message);
    fireEvent.click(screen.getByRole("button", { name: "Volver al mapa" }));
    await waitFor(() => expect(sent).toEqual([{ type: "adventure.returnToMap" }]));
  });

  it("mientras hay un comando en vuelo los botones principales se bloquean (sin doble envío)", () => {
    render(view(shadowsAt(), { busy: true }));
    expect((screen.getByRole("button", { name: "Volver al mapa" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Compartiendo/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sin la mesa en el snapshot (vista del mapa) no pinta nada", () => {
    const d = new Driver();
    const { container } = render(view(d));
    expect(container.innerHTML).toBe("");
  });
});
