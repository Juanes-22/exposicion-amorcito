// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParticipantInfo, RoomSummary } from "../../../shared/contracts/events";
import type { RoomClientState } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { QrCode } from "../ui/QrCode";
import { JoinView } from "./JoinView";
import { ParticipantList } from "./ParticipantList";
import { WaitingView } from "./WaitingView";

vi.mock("../../network/api", () => ({
  ApiFailure: class extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  getRoomInfo: vi.fn(),
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
}));
import * as api from "../../network/api";

afterEach(cleanup);

const project = { bundle: { config: { ui: { labels: { waiting: "Estás en la sala. Sigue la aventura en la proyección" } } } } } as unknown as LoadedProject;
const summary = (over: Partial<RoomSummary> = {}): RoomSummary => ({
  code: "ABC234",
  roomGeneration: 1,
  stateVersion: 1,
  turnVersion: 1,
  phase: "running",
  resumePhase: null,
  controller: { principalId: "p2", role: "participant", displayName: "Beto", color: "verde" },
  adminConnected: true,
  configMismatch: false,
  self: { principalId: "p1", role: "participant", displayName: "Ana · 2", color: "azul", connectionEpoch: 1, isController: false },
  ...over,
});
const state = (over: Partial<RoomClientState> = {}): RoomClientState => ({ status: "connected", summary: summary(), presence: null, snapshot: null, pending: 0, notice: null, ...over });

describe("WaitingView (CA-04)", () => {
  it("muestra silueta, nombre y estado, y nunca monta el mapa ni el canvas", () => {
    const { container } = render(<WaitingView project={project} state={state()} />);
    expect(screen.getByRole("heading", { name: "Ana · 2" })).toBeTruthy();
    expect(screen.getByText("Estás en la sala. Sigue la aventura en la proyección")).toBeTruthy();
    expect(screen.getByText("★ Explora: Beto")).toBeTruthy();
    expect(screen.getByRole("img", { name: /color Azul/ })).toBeTruthy(); // la silueta tiene nombre accesible: el color no es lo único
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".game-host")).toBeNull();
  });
  it("indica por texto cuando se pierde la conexión o la persona que presenta no está", () => {
    render(<WaitingView project={project} state={state({ status: "reconnecting", summary: summary({ adminConnected: false }) })} />);
    expect(screen.getByText("○ Reconectando…")).toBeTruthy();
    expect(screen.getByText("La persona que presenta no está conectada.")).toBeTruthy();
  });
  it("describe la fase con palabras (pausa, terminó)", () => {
    const { rerender } = render(<WaitingView project={project} state={state({ summary: summary({ phase: "paused" }) })} />);
    expect(screen.getByText("La aventura está en pausa.")).toBeTruthy();
    rerender(<WaitingView project={project} state={state({ summary: summary({ phase: "finished" }) })} />);
    expect(screen.getByText(/La aventura terminó/)).toBeTruthy();
  });
});

describe("JoinView", () => {
  beforeEach(() => {
    vi.mocked(api.getRoomInfo).mockResolvedValue({ code: "ABC234", phase: "welcome", title: "El laboratorio de las cosas cotidianas" });
    vi.mocked(api.joinRoom).mockReset();
  });

  it("valida el nombre mientras se escribe: vacío y más de 20 caracteres Unicode deshabilitan la entrada", async () => {
    render(<JoinView code="ABC234" onJoined={() => undefined} navigate={() => undefined} />);
    const input = await screen.findByLabelText("Tu nombre");
    const submit = screen.getByRole("button", { name: "Entrar a la sala" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "😀".repeat(20) } });
    expect(submit.disabled).toBe(false);
    expect(screen.getByText(/20\/20 caracteres/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "😀".repeat(21) } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);
  });

  it("envía el nombre normalizado y el color elegido, y entrega la credencial una sola vez", async () => {
    vi.mocked(api.joinRoom).mockResolvedValue({ principalId: "p9", name: "Ana", displayName: "Ana", color: "verde", distinction: 1, token: "t".repeat(43) });
    const onJoined = vi.fn();
    render(<JoinView code="ABC234" onJoined={onJoined} navigate={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Tu nombre"), { target: { value: "  Ana   " } });
    fireEvent.click(screen.getByRole("radio", { name: "Verde" }));
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));
    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));
    expect(api.joinRoom).toHaveBeenCalledWith("ABC234", "Ana", "verde");
    expect(onJoined.mock.calls[0]![0]).toMatchObject({ role: "participant", principalId: "p9", color: "verde", token: "t".repeat(43) });
  });

  it("muestra el error del servidor con role=alert y deja intentar de nuevo", async () => {
    vi.mocked(api.joinRoom).mockRejectedValue(new (api.ApiFailure as unknown as new (s: number, c: string, m: string) => Error)(409, "ROOM_FULL", "La sala está llena."));
    render(<JoinView code="ABC234" onJoined={() => undefined} navigate={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Tu nombre"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));
    expect((await screen.findByRole("alert")).textContent).toBe("La sala está llena.");
    expect((screen.getByRole("button", { name: "Entrar a la sala" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explica con claridad una sala inexistente o terminada", async () => {
    vi.mocked(api.getRoomInfo).mockRejectedValueOnce(new Error("404"));
    const { unmount } = render(<JoinView code="ZZZZZZ" onJoined={() => undefined} navigate={() => undefined} />);
    expect(await screen.findByText("No encontramos esa sala")).toBeTruthy();
    unmount();
    vi.mocked(api.getRoomInfo).mockResolvedValueOnce({ code: "ABC234", phase: "closed", title: "x" });
    render(<JoinView code="ABC234" onJoined={() => undefined} navigate={() => undefined} />);
    expect(await screen.findByText("Esta sala ya terminó")).toBeTruthy();
    expect(screen.queryByLabelText("Tu nombre")).toBeNull();
  });
});

describe("ParticipantList", () => {
  const person = (over: Partial<ParticipantInfo>): ParticipantInfo => ({ principalId: "p", role: "participant", displayName: "Ana", name: "Ana", color: "rojo", distinction: 1, connected: true, isController: false, ...over });
  it("el estado se lee por texto e icono, no solo por color", () => {
    render(<ParticipantList participants={[person({ principalId: "a" }), person({ principalId: "b", displayName: "Beto", connected: false }), person({ principalId: "c", displayName: "Cata", isController: true })]} onAssign={() => undefined} />);
    expect(screen.getAllByText("● Conectada")).toHaveLength(2);
    expect(screen.getByText("○ Desconectada")).toBeTruthy();
    expect(screen.getByText("★ Tiene el turno")).toBeTruthy();
  });
  it("«Dar turno» solo está disponible para quien está conectada y no ya controla, con nombre accesible", () => {
    const onAssign = vi.fn();
    render(<ParticipantList participants={[person({ principalId: "a" }), person({ principalId: "b", displayName: "Beto", connected: false })]} onAssign={onAssign} />);
    const ana = screen.getByRole("button", { name: "Dar el turno a Ana" }) as HTMLButtonElement;
    const beto = screen.getByRole("button", { name: "Dar el turno a Beto" }) as HTMLButtonElement;
    expect(beto.disabled).toBe(true);
    fireEvent.click(ana);
    expect(onAssign).toHaveBeenCalledWith("a");
  });
  it("sin participantes explica cómo entrar", () => {
    render(<ParticipantList participants={[]} />);
    expect(screen.getByText(/escaneen el código QR/)).toBeTruthy();
  });
});

describe("ConfirmDialog", () => {
  it("el foco empieza en la opción segura (Cancelar), Escape cancela y Tab no sale del diálogo", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="¿Reiniciar?" confirmLabel="Sí, reiniciar" danger onCancel={onCancel} onConfirm={onConfirm}>
        <p>Se borrará el avance.</p>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "¿Reiniciar?" });
    expect(dialog.getAttribute("aria-describedby")).toBe("confirm-body");
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    const confirm = screen.getByRole("button", { name: "Sí, reiniciar" });
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel); // da la vuelta
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("QrCode", () => {
  it("dibuja la matriz como path de SVG sin inyectar HTML y cambia con el valor", () => {
    const { container, rerender } = render(<QrCode value="http://localhost/sala/ABC234" label="QR de prueba" />);
    const path1 = container.querySelector("path")!.getAttribute("d");
    expect(container.querySelector("svg")!.getAttribute("role")).toBe("img");
    expect(path1!.length).toBeGreaterThan(200);
    expect(container.querySelector("script,foreignObject,img")).toBeNull();
    rerender(<QrCode value="http://localhost/sala/XYZ789" label="QR de prueba" />);
    expect(container.querySelector("path")!.getAttribute("d")).not.toBe(path1);
  });
});
