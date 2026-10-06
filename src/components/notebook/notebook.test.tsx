// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdventureAction, CommandResult } from "../../../shared/contracts/actions";
import { beto, bundle, Driver, finishBoxes, finishRamps, finishShadows, openStation } from "../../../shared/testing/drive";
import { InventorPanel } from "../activities/InventorPanel";
import { drafts } from "../activities/drafts";
import type { ActivityViewProps } from "../activities/ActivityView";
import { NotebookView } from "./NotebookView";
import { PieceTray } from "./PieceTray";

const ROOM = "ABC234";
const OK: CommandResult = { ok: true, requestId: "r", stateVersion: 1, turnVersion: 1 };
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

/** Camino real hasta la máquina del inventor: las tres mesas completas y abierta la vista final. */
function journey(extra?: (d: Driver) => void) {
  const d = new Driver();
  finishShadows(d);
  d.do({ type: "adventure.returnToMap" });
  finishRamps(d);
  d.do({ type: "adventure.returnToMap" });
  finishBoxes(d);
  d.do({ type: "adventure.returnToMap" });
  openStation(d, "inventor");
  extra?.(d);
  return d;
}
const place = (d: Driver) => d.do({ type: "inventor.placePieces" });

const notebook = (d: Driver, over: Partial<Parameters<typeof NotebookView>[0]> = {}) => (
  <NotebookView room={ROOM} config={bundle.config} records={d.state.notebook} canEdit busy={false} send={send} {...over} />
);
const inventor = (d: Driver, over: Partial<ActivityViewProps> = {}) => (
  <InventorPanel room={ROOM} config={bundle.config} adv={d.state} interactive canReturn busy={false} ownerName="Ana" send={send} {...over} />
);

describe("PieceTray", () => {
  it("dice con texto cuántas piezas hay y cuáles faltan (no solo con la forma)", () => {
    const { container, rerender } = render(<PieceTray pieces={bundle.config.inventor.pieces} have={["lupa"]} compact />);
    expect(screen.getByLabelText("Piezas conseguidas: 1 de 3")).toBeTruthy();
    expect(container.textContent).toContain("Lupa: conseguida");
    expect(container.textContent).toContain("Bocadillo: falta");
    rerender(<PieceTray pieces={bundle.config.inventor.pieces} have={["lupa", "dialogo", "corazon"]} />);
    expect(screen.getByLabelText("Tenemos las tres piezas")).toBeTruthy();
  });
});

describe("cuaderno (P5-01, CA-20)", () => {
  it("agrupa por mesa en el orden del recorrido, con autor, y distingue la primera idea", () => {
    const d = journey();
    const { container } = render(notebook(d));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Sombras", "Rampas", "La caja de las sorpresas"]);
    const first = container.querySelector(".record--first")!;
    expect(first.textContent).toContain("Primera idea");
    expect(first.textContent).toContain("Será por la luz");
    expect(container.querySelectorAll(".record--first")).toHaveLength(1);
    expect(container.textContent).toContain("Observación");
    expect(container.textContent).toContain("Todavía no tenemos una explicación"); // la observación incierta de Beto
    expect(container.textContent).toContain("Lo compartiremos en voz alta"); // la predicción oral
    expect(container.textContent).toContain("Beto");
  });

  it("muestra el aviso de vacío y nunca un borrador", () => {
    const { container, unmount } = render(notebook(new Driver()));
    expect(container.textContent).toContain("Todavía no hay nada en el cuaderno");
    unmount();
    drafts.set({ room: ROOM, activityId: "sombras", field: "observation" }, "BORRADOR PRIVADO");
    const r = render(notebook(journey()));
    expect(r.container.textContent).not.toContain("BORRADOR PRIVADO");
  });

  it("sin permiso de edición no hay «Corregir»; con él, nunca para la pregunta final", () => {
    const d = journey((x) => (place(x), x.do({ type: "inventor.question.confirm", value: { modality: "oral" } }, beto)));
    const { rerender } = render(notebook(d, { canEdit: false }));
    expect(screen.queryByRole("button", { name: "Corregir" })).toBeNull();
    rerender(notebook(d, { canEdit: true }));
    const total = d.state.notebook.length;
    expect(screen.getAllByRole("button", { name: "Corregir" })).toHaveLength(total - 1); // todas menos la pregunta final
    expect(screen.getByText(bundle.config.inventor.oralQuestionText)).toBeTruthy(); // y la final oral usa la frase del inventor
  });

  it("corregir parte del valor actual, no deja enviar lo mismo y manda la revisión que se estaba viendo", async () => {
    const d = journey();
    render(notebook(d));
    const row = screen.getByText("Será por la luz").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Corregir" }));
    const area = within(row).getByLabelText("Tu respuesta") as HTMLTextAreaElement;
    expect(area.value).toBe("Será por la luz");
    const save = within(row).getByRole("button", { name: "Guardar la corrección" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // sin cambios no hay versión nueva
    fireEvent.change(area, { target: { value: "Será por la luz y la distancia" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const first = d.state.notebook.find((r) => r.field === "firstIdea")!;
    await waitFor(() => expect(sent).toEqual([{ type: "record.edit", recordId: first.id, expectedRevision: 1, value: { modality: "written", text: "Será por la luz y la distancia" } }]));
    await waitFor(() => expect(within(row).queryByLabelText("Tu respuesta")).toBeNull()); // aceptada: se cierra
  });

  it("si alguien lo cambió antes, muestra la versión vigente, conserva lo escrito y la siguiente confirmación ya es sobre esa versión", async () => {
    const d = journey();
    const { rerender } = render(notebook(d));
    const row = screen.getByText("Será por la luz").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Corregir" }));
    fireEvent.change(within(row).getByLabelText("Tu respuesta"), { target: { value: "Mi corrección" } });
    reply = { ok: false, requestId: "r", code: "REVISION_CONFLICT", message: "Alguien cambió esta idea mientras la editabas." };
    fireEvent.click(within(row).getByRole("button", { name: "Guardar la corrección" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Alguien cambió esta idea mientras la editabas"));
    expect(sent[0]).toMatchObject({ expectedRevision: 1 });
    expect((within(row).getByLabelText("Tu respuesta") as HTMLTextAreaElement).value).toBe("Mi corrección"); // no se pierde

    // Mientras tanto otra persona la editó (revisión 2): llega el snapshot nuevo.
    const first = d.state.notebook.find((r) => r.field === "firstIdea")!;
    d.do({ type: "record.edit", recordId: first.id, expectedRevision: 1, value: { modality: "written", text: "Versión de Beto" } }, beto);
    rerender(notebook(d));
    expect(screen.getByRole("alert").textContent).toContain("Versión de Beto"); // la vigente a la vista
    reply = OK;
    fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ type: "record.edit", expectedRevision: 2, value: { modality: "written", text: "Mi corrección" } });
  });

  it("una edición queda con su historial visible y conserva a la autora original", () => {
    const d = journey();
    const first = d.state.notebook.find((r) => r.field === "firstIdea")!;
    d.do({ type: "record.edit", recordId: first.id, expectedRevision: 1, value: { modality: "written", text: "Ahora creo otra cosa" } }, beto);
    const { container } = render(notebook(d));
    const row = container.querySelector(".record--first")!;
    expect(row.textContent).toContain("Ahora creo otra cosa");
    expect(row.textContent).toContain("Ana"); // autora original
    expect(row.textContent).toContain("editada por Beto");
    expect(within(row as HTMLElement).getByText("Versiones anteriores (1)")).toBeTruthy();
    expect(row.textContent).toContain("Será por la luz"); // la versión anterior sigue ahí
  });
});

describe("inventor (P5-03, CA-22, CA-23)", () => {
  it("antes de colocar: indicación editable y «Colocar las piezas»; la proyección no tiene el botón", async () => {
    const d = journey();
    const { container, unmount } = render(inventor(d));
    expect(screen.getByText(bundle.config.inventor.placePrompt)).toBeTruthy();
    expect(screen.getByLabelText("Tenemos las tres piezas")).toBeTruthy();
    expect(screen.getByText("Paso 1 de 2: colocar las piezas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: bundle.config.inventor.placeButtonLabel }));
    await waitFor(() => expect(sent).toEqual([{ type: "inventor.placePieces" }]));
    unmount();
    const ro = render(inventor(d, { interactive: false, canReturn: false }));
    expect(ro.container.querySelector("button:not(summary)")).toBeNull();
    expect(ro.container.textContent).toContain("Ana puede colocar las piezas.");
    void container;
  });

  it("colocadas, cada pieza dice su mensaje; la pregunta se elige entre las cuatro formas", () => {
    const d = journey(place);
    render(inventor(d));
    for (const p of bundle.config.inventor.pieces) expect(screen.getByText(p.message, { exact: false })).toBeTruthy();
    for (const label of ["Elegir una pregunta del cuaderno", "Elegir una sugerencia", "Escribir una nueva", "La diremos en voz alta"]) expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    expect(screen.getByText(bundle.config.inventor.prompt)).toBeTruthy();
  });

  it("«del cuaderno» ofrece solo preguntas (no ideas ni observaciones) y envía la guardada", async () => {
    const d = journey(place);
    const { container } = render(inventor(d));
    const options = container.querySelectorAll(".record-form__options .option");
    const questions = d.state.notebook.filter((r) => r.field === "nextQuestion" || r.field === "question");
    expect(options).toHaveLength(questions.length);
    expect(container.querySelector(".record-form__options")!.textContent).not.toContain("Será por la luz");
    fireEvent.click(options[0]!.querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "Compartir la pregunta final" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: "inventor.question.confirm", value: { modality: "saved", recordId: questions[0]!.id } });
  });

  it("una sugerencia envía solo su identificador; oral muestra la frase del inventor y no manda texto", async () => {
    const d = journey(place);
    render(inventor(d));
    fireEvent.click(screen.getByRole("radio", { name: "Elegir una sugerencia" }));
    const share = screen.getByRole("button", { name: "Compartir la pregunta final" }) as HTMLButtonElement;
    expect(share.disabled).toBe(true); // sin elegir no se envía
    fireEvent.click(screen.getByRole("radio", { name: "¿Qué pasaría si movemos el objeto?" }));
    fireEvent.click(share);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: "inventor.question.confirm", value: { modality: "suggested", optionId: "mover-objeto" } });
    fireEvent.click(screen.getByRole("radio", { name: "La diremos en voz alta" }));
    expect(screen.getByText(bundle.config.inventor.oralQuestionText)).toBeTruthy();
    fireEvent.click(share);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ type: "inventor.question.confirm", value: { modality: "oral" } });
  });

  it("la pregunta escrita cuenta caracteres, se bloquea pasados 280 y su borrador es local", async () => {
    const d = journey(place);
    render(inventor(d));
    fireEvent.click(screen.getByRole("radio", { name: "Escribir una nueva" }));
    const area = screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement;
    const share = screen.getByRole("button", { name: "Compartir la pregunta final" }) as HTMLButtonElement;
    fireEvent.change(area, { target: { value: "x".repeat(281) } });
    expect(share.disabled).toBe(true);
    expect(area.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(area, { target: { value: "¿Por qué el hielo flota?" } });
    expect(sent).toHaveLength(0); // escribir no envía nada
    expect(drafts.hasUnshared(ROOM)).toBe(true);
    fireEvent.click(share);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: "inventor.question.confirm", value: { modality: "written", text: "¿Por qué el hielo flota?" } });
    await waitFor(() => expect(drafts.hasUnshared(ROOM)).toBe(false));
  });

  it("si el servidor deniega, se conserva lo escrito", async () => {
    reply = { ok: false, requestId: "r", code: "STALE_TURN", message: "Ya no tienes el turno." };
    const d = journey(place);
    render(inventor(d));
    fireEvent.click(screen.getByRole("radio", { name: "Escribir una nueva" }));
    fireEvent.change(screen.getByLabelText("Tu pregunta"), { target: { value: "¿Cómo vuela un avión?" } });
    fireEvent.click(screen.getByRole("button", { name: "Compartir la pregunta final" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Compartir la pregunta final" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).value).toBe("¿Cómo vuela un avión?");
  });

  it("el final muestra la pregunta, el mensaje y la reflexión; «Revisar» vuelve al mapa y abre la mesa; no hay forma de elegir otra pregunta", async () => {
    const d = journey((x) => (place(x), x.do({ type: "inventor.question.confirm", value: { modality: "written", text: "¿Qué hay dentro de una nube?" } }, beto)));
    const { container } = render(inventor(d));
    expect(screen.getByText("Aventura completa")).toBeTruthy();
    expect(container.querySelector(".final-card__question")!.textContent).toBe("¿Qué hay dentro de una nube?");
    expect(screen.getByText(bundle.config.inventor.finalMessage)).toBeTruthy();
    for (const line of bundle.config.inventor.reflection) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compartir la pregunta final" })).toBeNull();
    expect(screen.queryByRole("button", { name: bundle.config.inventor.placeButtonLabel })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar: Rampas" }));
    await waitFor(() => expect(sent).toEqual([{ type: "adventure.returnToMap" }, { type: "station.open", stationId: "rampas", origin: "quickNav" }]));
  });

  it("si «volver al mapa» falla, «Revisar» no intenta abrir la mesa", async () => {
    reply = { ok: false, requestId: "r", code: "STALE_TURN", message: "Ya no tienes el turno." };
    const d = journey((x) => (place(x), x.do({ type: "inventor.question.confirm", value: { modality: "oral" } }, beto)));
    render(inventor(d));
    fireEvent.click(screen.getByRole("button", { name: "Revisar: Sombras" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent).toEqual([{ type: "adventure.returnToMap" }]);
  });

  it("la proyección del final solo lee: sin botones de revisión ni formularios, con el cuaderno a la vista", () => {
    const d = journey((x) => (place(x), x.do({ type: "inventor.question.confirm", value: { modality: "oral" } }, beto)));
    const { container } = render(inventor(d, { interactive: false, canReturn: false }));
    expect(container.querySelectorAll("button, textarea, input").length).toBe(0);
    expect(container.querySelector("details.panel")!.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain(bundle.config.inventor.oralQuestionText);
  });
});
