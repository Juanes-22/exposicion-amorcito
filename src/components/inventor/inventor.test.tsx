// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, ParticipantAction } from "../../../shared/contracts/actions";
import type { Driver } from "../../../shared/testing/drive";
import { config, denied, enEtapa, OK } from "../../testing/clientState";
import { InventorPanel } from "./InventorPanel";
import { questionGroups, questionKey } from "./questions";

afterEach(cleanup);

/** El inventor abierto con Ana ya adentro. */
const dentro = (): Driver => {
  const d = enEtapa("inventor");
  d.openStation("ana", "inventor");
  return d;
};
const montar = (d: Driver, over: { act?: (a: ParticipantAction) => Promise<CommandResult>; interactive?: boolean; finished?: boolean; busy?: boolean } = {}) => {
  const act = vi.fn(over.act ?? (async (a: ParticipantAction) => (d.act("ana", a) ? OK : denied("INVALID_STEP", d.lastError?.message ?? ""))));
  const ui = () => <InventorPanel config={config} participant={d.person("ana")} act={act} busy={over.busy ?? false} interactive={over.interactive ?? true} finished={over.finished ?? false} />;
  return { act, ui };
};
const registrar = () => screen.getByRole("button", { name: "Registrar mi pregunta" }) as HTMLButtonElement;

describe("preguntas sugeridas del inventor", () => {
  it("se agrupan por mesa en el orden del recorrido, y cada mesa tiene al menos una", () => {
    expect(questionGroups(config).map((g) => [g.title, g.questions.length])).toEqual([
      ["Sombras", 2],
      ["Rampas", 2],
      ["El observatorio", 2],
    ]);
  });

  it("dos preguntas escritas iguales salvo mayúsculas y espacios son la misma", () => {
    expect(questionKey("¿Por qué  la Luna cambia?")).toBe(questionKey(" ¿por qué la luna cambia? "));
    expect(questionKey("¿Por qué la Luna cambia?")).not.toBe(questionKey("¿Por qué la Luna brilla?"));
  });
});

describe("InventorPanel: la pregunta de cada persona en su celular", () => {
  it("muestra la pregunta del inventor, las sugeridas por mesa y la opción de escribir la suya; nada elegido de antemano", () => {
    render(montar(dentro()).ui());
    expect(screen.getByRole("heading", { name: "El inventor de preguntas" })).toBeTruthy();
    expect(screen.getByText(config.inventor.prompt)).toBeTruthy();
    for (const g of questionGroups(config)) {
      const grupo = screen.getByRole("group", { name: g.title });
      expect(within(grupo).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(g.questions.map((q) => q.text));
    }
    expect(screen.getByRole("radio", { name: "Quiero escribir mi pregunta" })).toBeTruthy();
    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
    expect(registrar().disabled).toBe(true);
  });

  it("registrar una sugerida envía su ID; queda registrada y se puede cambiar", async () => {
    const d = dentro();
    const { act: enviar, ui } = montar(d);
    const { rerender } = render(ui());
    const preset = config.inventor.questions[2]!;
    fireEvent.click(screen.getByRole("radio", { name: preset.text }));
    await act(async () => void fireEvent.click(registrar()));
    expect(enviar).toHaveBeenCalledWith({ type: "inventor.question", question: { kind: "preset", presetId: preset.id } });
    rerender(ui());
    expect(screen.getByRole("status").textContent).toBe("✓ Tu pregunta quedó registrada");
    expect(screen.getByText(preset.text, { selector: "blockquote" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mi pregunta" }));
    expect((screen.getByRole("radio", { name: preset.text }) as HTMLInputElement).checked).toBe(true); // vuelve con la suya elegida
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText(preset.text, { selector: "blockquote" })).toBeTruthy();
  });

  it("escribir la suya cuenta los caracteres, no deja enviar vacía ni demasiado larga y envía el texto", async () => {
    const d = dentro();
    const { act: enviar, ui } = montar(d);
    const { rerender } = render(ui());
    fireEvent.click(screen.getByRole("radio", { name: "Quiero escribir mi pregunta" }));
    const area = screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement;
    expect(registrar().disabled).toBe(true);
    fireEvent.change(area, { target: { value: "x".repeat(config.ui.maxRecordCharacters + 1) } });
    expect(registrar().disabled).toBe(true);
    expect(screen.getByText(`${config.ui.maxRecordCharacters + 1}/${config.ui.maxRecordCharacters} caracteres`)).toBeTruthy();
    fireEvent.change(area, { target: { value: "¿Por qué la Luna cambia de forma?" } });
    await act(async () => void fireEvent.click(registrar()));
    expect(enviar).toHaveBeenCalledWith({ type: "inventor.question", question: { kind: "written", text: "¿Por qué la Luna cambia de forma?" } });
    rerender(ui());
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mi pregunta" }));
    expect((screen.getByLabelText("Tu pregunta") as HTMLTextAreaElement).value).toBe("¿Por qué la Luna cambia de forma?"); // conserva lo escrito
  });

  it("si el servidor la rechaza, lo dice y conserva la elección", async () => {
    const { ui } = montar(dentro(), { act: async () => denied("INVALID_STEP", "Las preguntas se registran cuando Vanessa abre el inventor.") });
    render(ui());
    fireEvent.click(screen.getByRole("radio", { name: config.inventor.questions[0]!.text }));
    fireEvent.click(registrar());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Las preguntas se registran cuando Vanessa abre el inventor."));
    expect((screen.getByRole("radio", { name: config.inventor.questions[0]!.text }) as HTMLInputElement).checked).toBe(true);
  });

  it("en pausa no se registra: el botón se deshabilita y lo explica", () => {
    render(montar(dentro(), { interactive: false }).ui());
    fireEvent.click(screen.getByRole("radio", { name: config.inventor.questions[0]!.text }));
    expect(registrar().disabled).toBe(true);
    expect(screen.getByText("La aventura está en pausa.")).toBeTruthy();
  });

  it("«Volver al mapa» aparece recién después de registrar la pregunta y sale del inventor con la acción personal", () => {
    const d = dentro();
    const { unmount } = render(montar(d).ui());
    expect(screen.queryByRole("button", { name: "Volver al mapa" })).toBeNull();
    unmount();
    d.must(d.act("ana", { type: "inventor.question", question: { kind: "preset", presetId: config.inventor.questions[0]!.id } }), "registrar");
    const { act: enviar, ui } = montar(d);
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Volver al mapa" }));
    expect(enviar).toHaveBeenCalledWith({ type: "adventure.returnToMap" });
  });

  it("con la aventura terminada muestra la suya sin poder cambiarla, y siempre se puede volver al mapa", () => {
    const d = dentro();
    d.must(d.act("ana", { type: "inventor.question", question: { kind: "written", text: "¿Qué come Jerry?" } }), "registrar");
    const { act: enviar, ui } = montar(d, { finished: true, interactive: false });
    render(ui());
    expect(screen.getByText("¿Qué come Jerry?")).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Volver al mapa"]);
    fireEvent.click(screen.getByRole("button", { name: "Volver al mapa" }));
    expect(enviar).toHaveBeenCalledWith({ type: "adventure.returnToMap" });
    cleanup();
    render(montar(dentro(), { finished: true, interactive: false }).ui()); // sin pregunta registrada
    expect(screen.getByText("La pregunta del grupo ya quedó impresa en el inventor.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: "Volver al mapa" })).toBeTruthy();
  });
});
