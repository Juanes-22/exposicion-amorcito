// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParticipantInfo } from "../../../shared/contracts/events";
import type { Driver } from "../../../shared/testing/drive";
import { useRoomSession } from "../../app/useRoomSession";
import { clientState, conRezagada, config, enEtapa, fakePort, mesaAbierta, OK, project, sala, type Etapa } from "../../testing/clientState";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { QrCode } from "../ui/QrCode";
import { AdminConsole } from "./AdminConsole";
import { AdminWelcome } from "./AdminWelcome";
import { HomeView } from "./HomeView";
import { JoinView } from "./JoinView";
import { ParticipantList } from "./ParticipantList";
import { ParticipantView } from "./ParticipantView";
import { RoomView } from "./RoomView";
import { TerminalView } from "./TerminalView";
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

// Phaser no corre en jsdom (no hay canvas): el host del mapa se sustituye por una región vacía que cuenta cuántas veces se monta.
// Todo lo demás (puente, enrutador de intenciones, barra del mapa, panel personal) es el código real.
const phaser = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("../game/PhaserGame", async () => {
  const { createElement, useEffect } = await import("react");
  return {
    PhaserGame: ({ label }: { label?: string }) => {
      useEffect(() => {
        phaser.mounts++;
      }, []);
      return createElement("div", { className: "game-host", role: "region", "aria-label": label });
    },
  };
});
// La sesión real abre un socket; las vistas se prueban con el estado que se les entrega.
vi.mock("../../app/useRoomSession", () => ({ useRoomSession: vi.fn() }));

beforeAll(async () => {
  // El módulo del mapa se carga bajo demanda: se calienta una vez para que ninguna prueba dependa de lo que tarde la primera carga.
  await import("./AdventureHost");
});
beforeEach(() => {
  phaser.mounts = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Un clic y espera a que termine lo que la consola hace con la respuesta (mientras envía, sus botones se deshabilitan). */
const pulsar = (el: Element) => act(async () => void fireEvent.click(el));
/** El contador «N de M listos» de la barra de la consola (en la lista de personas también hay «N de M» por persona). */
const contador = () => document.querySelector(".round-controls__counter")?.textContent ?? null;

/** Deja correr las cargas bajo demanda pendientes: sirve para afirmar que algo NO apareció, sin que lo oculte una carga todavía en curso. */
const dejarCargar = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 30))));

/** Tras cargar el módulo bajo demanda aparece el escenario: Vanessa lo ve entero, las personas lo ven siguiendo a su personaje. */
const escenario = () => screen.findByRole("region", { name: "Escena de la aventura" });
const mapa = () => screen.findByRole("region", { name: "Mapa del laboratorio" });

// ---- quien acompaña ----------------------------------------------------------------------------------------------

describe("WaitingView: quien acompaña como observadora", () => {
  const observadora = (d: Driver, over = {}) => clientState(d, "luz", { observers: { luz: "Luz" }, ...over });

  it("muestra silueta con nombre, su nombre y el texto de observadora, y nunca monta el mapa ni ofrece controles", async () => {
    const { container } = render(<WaitingView project={project} state={observadora(enEtapa("exploration"))} />);
    await dejarCargar();
    expect(screen.getByRole("heading", { name: "Luz" })).toBeTruthy();
    expect(screen.getByText(config.ui.labels.observerPhone!)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Tu silueta, color/ })).toBeTruthy(); // el color no es lo único que la identifica
    expect(container.querySelector("canvas, .game-host, .adventure, .adventure__map")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(phaser.mounts).toBe(0);
  });

  it("dice con palabras qué toca en cada fase, y en la conversación manda a mirar la proyección", () => {
    const frases: Array<[Etapa, string]> = [
      ["welcome", config.ui.labels.welcomePhone!],
      ["preparation", config.ui.labels.roundPreparationPhone!],
      ["exploration", config.ui.labels.roundExplorationPhone!],
      ["conversation", "Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás."],
      ["closing", config.ui.labels.closingPhone!],
      // Quien acompaña no tiene cuaderno propio: no se le manda a «revisar sus resultados».
      ["finished", "Terminamos la aventura."],
    ];
    for (const [etapa, texto] of frases) {
      const { unmount } = render(<WaitingView project={project} state={observadora(enEtapa(etapa))} />);
      expect(screen.getByText(texto), etapa).toBeTruthy();
      unmount();
    }
  });

  it("indica por texto cuando se pierde la conexión o cuando Vanessa no está", () => {
    const d = enEtapa("exploration");
    const { rerender } = render(<WaitingView project={project} state={observadora(d)} />);
    expect(screen.getByText("● Conectada")).toBeTruthy();
    rerender(<WaitingView project={project} state={observadora(d, { status: "reconnecting", adminConnected: false })} />);
    expect(screen.getByText("○ Reconectando…")).toBeTruthy();
    expect(screen.getByText("La persona que presenta no está conectada.")).toBeTruthy();
  });

  it("avisa por texto cuando Vanessa pausó la aventura", () => {
    const d = enEtapa("exploration");
    d.must(d.admin({ type: "room.pause" }), "pausar");
    render(<WaitingView project={project} state={observadora(d)} />);
    expect(screen.getByText(/en pausa/i)).toBeTruthy();
  });
});

// ---- el celular de quien juega ---------------------------------------------------------------------------------

describe("ParticipantView: el celular de quien juega", () => {
  const vista = (d: Driver, id = "ana", over = {}) => {
    const port = fakePort(clientState(d, id, over));
    const ui = (state = clientState(d, id, over)) => <ParticipantView project={project} state={state} controller={port.asController()} />;
    return { port, ui };
  };

  it("muestra su nombre, el sonido activado por defecto y el texto de la fase; en la conversación manda a mirar la proyección", async () => {
    const d = enEtapa("conversation");
    const { ui } = vista(d);
    render(ui());
    await mapa();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Silenciar/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true"); // suena desde el primer toque
  });

  it("el texto cambia con cada fase de la ronda", async () => {
    const d = enEtapa("preparation");
    const { ui } = vista(d);
    const { rerender } = render(ui());
    await mapa();
    expect(screen.getByText(config.ui.labels.roundPreparationPhone!)).toBeTruthy();
    d.must(d.admin({ type: "round.open" }), "abrir");
    rerender(ui(clientState(d, "ana")));
    expect(screen.getByText(config.ui.labels.roundExplorationPhone!)).toBeTruthy();
    expect(screen.queryByText(config.ui.labels.roundPreparationPhone!)).toBeNull();
    d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    rerender(ui(clientState(d, "ana")));
    expect(screen.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.")).toBeTruthy();
  });

  it("con el personaje en el mapa muestra la barra del mapa y no los controles de ninguna mesa", async () => {
    const d = enEtapa("exploration");
    const { ui } = vista(d);
    const { container } = render(ui());
    await mapa();
    expect(screen.getByText("Mesas")).toBeTruthy();
    expect(screen.getByText("Cuaderno")).toBeTruthy();
    expect(container.querySelector(".personal")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("«Ir a la mesa actual» abre la mesa habilitada con la acción personal de abrir estación", async () => {
    const d = enEtapa("exploration");
    const { port, ui } = vista(d);
    render(ui());
    await mapa();
    fireEvent.click(screen.getByRole("button", { name: "Ir a la mesa actual" }));
    expect(port.act).toHaveBeenCalledWith({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(port.admin).not.toHaveBeenCalled();
  });

  it("en el cierre camina hasta el inventor; abierto, «Ir al inventor» entra y ahí registra su pregunta", async () => {
    const d = enEtapa("closing");
    const { port, ui } = vista(d);
    const { rerender, container } = render(ui());
    await mapa();
    expect(screen.getByText(config.ui.labels.closingPhone!)).toBeTruthy();
    expect(screen.getByText("El inventor de preguntas").parentElement!.textContent).toContain("Ahora");
    expect((screen.getByRole("button", { name: "Ir al inventor" }) as HTMLButtonElement).disabled).toBe(true); // Vanessa todavía no lo abre
    d.must(d.admin({ type: "inventor.open" }), "abrir el inventor");
    rerender(ui(clientState(d, "ana")));
    expect(screen.getByText(config.ui.labels.inventorOpenPhone!)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ir al inventor" }));
    expect(port.act).toHaveBeenCalledWith({ type: "station.open", stationId: "inventor", origin: "quickNav" });
    d.openStation("ana", "inventor");
    rerender(ui(clientState(d, "ana")));
    expect(container.querySelector(".adventure__activity .personal")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: config.inventor.questions[0]!.text }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar mi pregunta" }));
    expect(port.act).toHaveBeenLastCalledWith({ type: "inventor.question", question: { kind: "preset", presetId: config.inventor.questions[0]!.id } });
    expect(port.admin).not.toHaveBeenCalled();
  });

  it("con la mesa abierta muestra sus controles junto al mapa y sus acciones salen por la acción personal", async () => {
    const d = mesaAbierta(1);
    d.openStation("ana", "rampas");
    const { port, ui } = vista(d);
    const { container } = render(ui());
    await mapa();
    expect(screen.getByRole("heading", { name: "Rampas" })).toBeTruthy();
    expect(container.querySelector(".adventure__activity .personal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Soltar la pelota" }));
    expect(port.act).toHaveBeenCalledWith({ type: "ramps.trial.start", angleDeg: 20 }); // la inclinación más baja
    expect(port.admin).not.toHaveBeenCalled(); // quien juega nunca conduce la ronda
    // Con la mesa abierta ya no se ofrece la barra del mapa: el panel ocupa su lugar.
    expect(screen.queryByText("Mesas")).toBeNull();
  });

  it("en la conversación los controles desaparecen aunque su vista siga en la mesa: solo queda el texto", async () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.openStation("ana", "sombras");
    d.must(d.admin({ type: "round.converse" }), "conversar");
    const { ui } = vista(d);
    const { container } = render(ui());
    await mapa();
    expect(container.querySelector(".personal")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.")).toBeTruthy();
  });

  it("con la aventura en pausa dice «En pausa», detiene los controles y lo explica con texto", async () => {
    const d = mesaAbierta(0);
    d.openStation("ana", "sombras");
    d.must(d.admin({ type: "room.pause" }), "pausar");
    const { ui } = vista(d);
    render(ui());
    await mapa();
    expect(screen.getByRole("heading", { name: "En pausa" })).toBeTruthy();
    expect(screen.getByText("La mesa está en pausa.")).toBeTruthy();
    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
  });

  it("al terminar la aventura el celular dice que se pueden revisar los resultados y el cuaderno los muestra, de solo lectura", async () => {
    const d = enEtapa("finished");
    const { ui } = vista(d);
    const { container } = render(ui());
    await mapa();
    expect(screen.getByText(config.ui.labels.finishedPhone!)).toBeTruthy();
    const cuaderno = container.querySelector(".notebook-menu")!;
    expect(within(cuaderno as HTMLElement).getByRole("heading", { name: "Mis resultados" })).toBeTruthy();
    expect(within(cuaderno as HTMLElement).getByText("Probaste la linterna en 2 posiciones distintas.")).toBeTruthy();
    expect(within(cuaderno as HTMLElement).getByRole("heading", { name: "Lo que anotó el grupo" })).toBeTruthy();
    expect(within(cuaderno as HTMLElement).getByText("¿Por qué la luna cambia de forma?")).toBeTruthy();
    expect(cuaderno.querySelector("form, textarea, input, button")).toBeNull();
  });

  it("el mapa se monta una sola vez aunque cambie la etapa o se abra y se cierre la mesa", async () => {
    const d = enEtapa("preparation");
    const { ui } = vista(d);
    const { rerender } = render(ui());
    await mapa();
    d.must(d.admin({ type: "round.open" }), "abrir");
    rerender(ui(clientState(d, "ana")));
    d.openStation("ana", "sombras");
    rerender(ui(clientState(d, "ana")));
    expect(screen.getByRole("heading", { name: "Sombras" })).toBeTruthy();
    d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    rerender(ui(clientState(d, "ana")));
    expect(phaser.mounts).toBe(1);
  });

  it("no existen las piezas de interfaz del modelo de turnos ni las respuestas escritas", async () => {
    const d = mesaAbierta(0);
    d.openStation("ana", "sombras");
    const { ui } = vista(d);
    const { container } = render(ui());
    await mapa();
    for (const texto of [/Tengo una pregunta/, /Entendido/, /Colocar las piezas/, /Dar (el )?turno/, /Tiene el turno/, /Explora:/, /Anotar/]) expect(screen.queryByText(texto), String(texto)).toBeNull();
    expect(container.querySelector("textarea, form")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});

// ---- la bienvenida de Vanessa -------------------------------------------------------------------------------------

describe("AdminWelcome", () => {
  const bienvenida = (d: Driver, over = {}) => {
    const port = fakePort(clientState(d, "admin", over));
    const ui = (state = clientState(d, "admin", over)) => <AdminWelcome project={project} state={state} controller={port.asController()} />;
    return { port, ui };
  };

  it("muestra el QR, el código, el enlace y cuántas personas hay, aparte de quienes observan", () => {
    const { ui } = bienvenida(sala({ ana: "Ana", beto: "Beto" }), { observers: { luz: "Luz" } });
    render(ui());
    expect(screen.getByRole("img", { name: "Código QR para entrar a la sala ABC234" })).toBeTruthy();
    expect(screen.getByLabelText("Código de sala A B C 2 3 4").textContent).toBe("ABC234");
    expect(document.querySelector(".join-url")!.textContent).toMatch(/\/sala\/ABC234$/);
    expect(screen.getByText("2 personas conectadas · 1 observa")).toBeTruthy();
    expect(screen.getByText("● Sala conectada")).toBeTruthy();
    expect(screen.getByText("Observa")).toBeTruthy();
  });

  it("todas las personas exploran a la vez: no hay turnos que dar ni controlar", () => {
    const { ui } = bienvenida(sala());
    render(ui());
    expect(screen.queryByRole("button", { name: /turno/i })).toBeNull();
    expect(screen.getByText(/Todas las personas exploran a la vez/)).toBeTruthy();
  });

  it("«Comenzar la aventura» envía room.start una sola vez aunque se pulse dos veces", async () => {
    const { port, ui } = bienvenida(sala());
    let terminar!: () => void;
    port.admin.mockImplementation(() => new Promise((resolve) => (terminar = () => resolve(OK))));
    render(ui());
    const comenzar = screen.getByRole("button", { name: "Comenzar la aventura" }) as HTMLButtonElement;
    fireEvent.click(comenzar);
    fireEvent.click(comenzar);
    expect(port.admin).toHaveBeenCalledTimes(1);
    expect(port.admin).toHaveBeenCalledWith({ type: "room.start" });
    expect(comenzar.disabled).toBe(true);
    await act(async () => terminar());
    await waitFor(() => expect(comenzar.disabled).toBe(false));
  });

  it("no se puede comenzar sin nadie que juegue (las observadoras no cuentan), ni sin conexión", () => {
    const solo = bienvenida(sala({}), { observers: { luz: "Luz" } });
    const { unmount } = render(solo.ui());
    expect((screen.getByRole("button", { name: "Comenzar la aventura" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const caida = bienvenida(sala(), { status: "reconnecting" });
    render(caida.ui());
    expect((screen.getByRole("button", { name: "Comenzar la aventura" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("○ Reconectando…")).toBeTruthy();
  });

  it("mientras no llega la presencia no afirma que no haya nadie", () => {
    const { ui } = bienvenida(sala(), { noPresence: true });
    render(ui());
    expect(screen.getByText("Cargando a las personas de la sala…")).toBeTruthy();
    expect(screen.queryByText(/Todavía no hay nadie/)).toBeNull();
  });
});

// ---- la consola de Vanessa --------------------------------------------------------------------------------------

describe("HomeView", () => {
  it("ofrece crear una sala y unirse con un código; ya no hay demostración de respaldo", () => {
    render(<HomeView project={project} navigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Crear sala" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unirme" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Demostración|respaldo/i })).toBeNull();
  });
});

describe("AdminConsole", () => {
  const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre }) as HTMLButtonElement;
  const consola = (d: Driver, over = {}) => {
    const port = fakePort(clientState(d, "admin", over));
    const ui = (state = clientState(d, "admin", over)) => <AdminConsole project={project} state={state} controller={port} />;
    return { port, ui };
  };

  it("dice en qué mesa, etapa y fase va la aventura", async () => {
    const { ui } = consola(enEtapa("exploration"));
    render(ui());
    expect(screen.getByText("Mesa 1 de 3: Sombras")).toBeTruthy();
    expect(screen.getByText("Exploración")).toBeTruthy();
    expect(screen.getByText("En curso")).toBeTruthy();
    await escenario();
  });

  describe("el botón de ronda de cada etapa", () => {
    it("preparación: «Abrir mesa: Sombras» envía round.open y no ofrece los pasos de otras etapas", () => {
      const { port, ui } = consola(enEtapa("preparation"));
      render(ui());
      expect(screen.queryByRole("button", { name: "Conversemos" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Freire/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Abrir mesa: Sombras" }));
      expect(port.admin).toHaveBeenCalledWith({ type: "round.open" });
    });

    it("exploración: «Conversemos» y el contador; ya no se ofrece abrir la mesa", () => {
      const { ui } = consola(mesaAbierta(0, ["ana"]));
      render(ui());
      expect(screen.getByRole("button", { name: "Conversemos" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Abrir mesa/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Freire/ })).toBeNull();
      expect(contador()).toBe("1 de 2 listos");
    });

    it("conversación: primero solo «Mostrar la frase de Freire»; ya mostrada, ese botón deja su lugar a «Abrir siguiente mesa»", async () => {
      const d = enEtapa("conversation");
      const { port, ui } = consola(d);
      const { rerender } = render(ui());
      expect(screen.queryByRole("button", { name: "Conversemos" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Abrir siguiente mesa/ })).toBeNull();
      await pulsar(screen.getByRole("button", { name: "Mostrar la frase de Freire" }));
      expect(port.admin).toHaveBeenLastCalledWith({ type: "round.showFreire" });
      d.must(d.admin({ type: "round.showFreire" }), "Freire");
      rerender(ui(clientState(d, "admin")));
      expect(screen.queryByRole("button", { name: /Freire/ })).toBeNull();
      await pulsar(screen.getByRole("button", { name: "Abrir siguiente mesa: Rampas" }));
      expect(port.admin).toHaveBeenLastCalledWith({ type: "round.next" });
    });

    it("la siguiente mesa lleva el nombre de la que sigue y, tras la última, «Pasar al inventor»", () => {
      const rampas = mesaAbierta(1, ["ana", "beto"]);
      rampas.must(rampas.admin({ type: "round.converse" }), "conversar");
      rampas.must(rampas.admin({ type: "round.showFreire" }), "Freire");
      const primera = consola(rampas);
      const { unmount } = render(primera.ui());
      expect(screen.getByRole("button", { name: "Abrir siguiente mesa: El observatorio" })).toBeTruthy();
      unmount();
      const observatorio = mesaAbierta(2, ["ana", "beto"]);
      observatorio.must(observatorio.admin({ type: "round.converse" }), "conversar");
      observatorio.must(observatorio.admin({ type: "round.showFreire" }), "Freire");
      const ultima = consola(observatorio);
      render(ultima.ui());
      expect(screen.queryByRole("button", { name: /Abrir siguiente mesa/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Pasar al inventor" }));
      expect(ultima.port.admin).toHaveBeenCalledWith({ type: "round.next" });
    });

    it("cierre: el único paso es «Abrir inventor»; las preguntas del inventor aparecen recién al abrirlo", () => {
      const { ui } = consola(enEtapa("closing"));
      render(ui());
      for (const nombre of [/Abrir mesa/, /Conversemos/, /Freire/, /siguiente mesa/, /Pasar al inventor/]) expect(screen.queryByRole("button", { name: nombre }), String(nombre)).toBeNull();
      expect(screen.getByRole("button", { name: "Abrir inventor" })).toBeTruthy();
      expect(screen.queryByText(/Preguntas del inventor/)).toBeNull(); // todavía caminan hasta él
      cleanup();
      const abierto = consola(enEtapa("inventor"));
      render(abierto.ui());
      expect(screen.queryByRole("button", { name: "Abrir inventor" })).toBeNull();
      expect(screen.getByText("Preguntas del inventor (0 de 2)")).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Escribir otra pregunta" })).toBeTruthy();
    });

    it("con la pregunta final confirmada la aventura terminó: se puede pausar, no conducir", () => {
      const { ui } = consola(enEtapa("finished"));
      render(ui());
      expect(screen.getByText("Terminó la aventura")).toBeTruthy();
      expect(screen.getAllByText("¿Por qué la luna cambia de forma?").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /Conversemos|Abrir/ })).toBeNull();
    });
  });

  describe("el contador de listos", () => {
    it("dice «N de M listos» y se actualiza a medida que las personas terminan", () => {
      const d = mesaAbierta(0);
      const { ui } = consola(d);
      const { rerender } = render(ui());
      expect(contador()).toBe("0 de 2 listos");
      d.readyShadows("ana");
      rerender(ui(clientState(d, "admin")));
      expect(contador()).toBe("1 de 2 listos");
      d.readyShadows("beto");
      rerender(ui(clientState(d, "admin")));
      expect(contador()).toBe("2 de 2 listos");
    });

    it("una desconexión no reduce el total; quien acompaña no cuenta", () => {
      const d = mesaAbierta(0, ["ana"]);
      const { ui } = consola(d, { offline: ["beto"], observers: { luz: "Luz" } });
      render(ui());
      expect(contador()).toBe("1 de 2 listos");
    });

    it("sin presencia todavía no inventa una cifra", () => {
      const { ui } = consola(mesaAbierta(0), { noPresence: true });
      render(ui());
      expect(contador()).toBe("— listos");
    });
  });

  describe("«Conversemos»", () => {
    it("con personas pendientes abre un diálogo y NO envía nada hasta confirmarlo", async () => {
      const { port, ui } = consola(mesaAbierta(0, ["ana"]));
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Conversemos" }));
      const dialogo = screen.getByRole("alertdialog", { name: "Todavía hay personas explorando" });
      expect(within(within(dialogo).getByRole("list", { name: "Personas que aún no terminan" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Beto"]);
      expect(port.admin).not.toHaveBeenCalled();

      fireEvent.click(within(dialogo).getByRole("button", { name: "Conversar ahora" }));
      expect(port.admin).toHaveBeenCalledTimes(1);
      expect(port.admin).toHaveBeenCalledWith({ type: "round.converse", withPending: true });
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("cancelar el diálogo no cambia nada y deja volver a intentarlo", () => {
      const { port, ui } = consola(mesaAbierta(0, ["ana"]));
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Conversemos" }));
      fireEvent.click(screen.getByRole("button", { name: "Esperar un poco más" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Conversemos" }));
      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(port.admin).not.toHaveBeenCalled();
    });

    it("enumera a varias personas pendientes en plural", () => {
      const { ui } = consola(mesaAbierta(0, [], { ana: "Ana", beto: "Beto", cata: "Cata" }));
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Conversemos" }));
      expect(screen.getByText(/Aún no terminan 3 personas:/)).toBeTruthy();
      expect(within(screen.getByRole("list", { name: "Personas que aún no terminan" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Ana", "Beto", "Cata"]);
    });

    it("sin pendientes envía round.conversar directamente, sin diálogo y sin «con pendientes»", () => {
      const { port, ui } = consola(mesaAbierta(0, ["ana", "beto"]));
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Conversemos" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(port.admin).toHaveBeenCalledTimes(1);
      expect(port.admin.mock.calls[0]![0]).toEqual({ type: "round.converse" });
    });

    it("quien acompaña o llegó después de abrir la mesa no cuenta como pendiente", () => {
      const d = conRezagada(mesaAbierta(0, ["ana", "beto"]));
      const { port, ui } = consola(d, { observers: { luz: "Luz" } });
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Conversemos" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(port.admin).toHaveBeenCalledWith({ type: "round.converse" });
    });
  });

  it("sin conexión o con la aventura en pausa los pasos de la ronda se detienen; en pausa se ofrece reanudar", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    const { unmount } = render(consola(d, { status: "reconnecting" }).ui());
    for (const nombre of ["Conversemos", "Pausar", "Reiniciar", "Cerrar"]) expect((screen.getByRole("button", { name: nombre }) as HTMLButtonElement).disabled, nombre).toBe(true);
    unmount();

    d.must(d.admin({ type: "room.pause" }), "pausar");
    const { port, ui } = consola(d);
    render(ui());
    expect((screen.getByRole("button", { name: "Conversemos" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Pausar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    expect(port.admin).toHaveBeenCalledWith({ type: "room.resume" });
  });

  it("«Pausar» envía room.pause", async () => {
    const { port, ui } = consola(mesaAbierta(0));
    render(ui());
    await pulsar(boton("Pausar"));
    expect(port.admin).toHaveBeenCalledWith({ type: "room.pause" });
  });

  describe("lo que Vanessa escribe llega al servidor con la mesa y la revisión correctas", () => {
    const area = (nombre: string | RegExp) => screen.getByLabelText(nombre) as HTMLTextAreaElement;

    it("guardar la idea inicial en Sombras envía note.save con la mesa de ahora", async () => {
      const { port, ui } = consola(mesaAbierta(0));
      render(ui());
      fireEvent.change(area("Idea inicial del grupo"), { target: { value: "Será por la luz" } });
      await pulsar(boton("Guardar la idea inicial"));
      expect(port.admin).toHaveBeenCalledWith({ type: "note.save", activityId: "sombras", kind: "initialIdea", text: "Será por la luz" });
    });

    it("la síntesis y la pregunta de la mesa siguiente se guardan en ESA mesa", async () => {
      const d = mesaAbierta(1);
      const { port, ui } = consola(d);
      render(ui());
      expect(screen.queryByLabelText("Idea inicial del grupo")).toBeNull();
      fireEvent.change(area("Pregunta que el grupo quiere conservar"), { target: { value: "¿Y si cambia la rampa?" } });
      await pulsar(boton("Guardar la pregunta"));
      expect(port.admin).toHaveBeenCalledWith({ type: "note.save", activityId: "rampas", kind: "question", text: "¿Y si cambia la rampa?" });
    });

    it("corregir una nota envía note.edit con su identificador y la revisión que se corrige", async () => {
      const d = mesaAbierta(0);
      d.must(d.admin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "La distancia importa" }), "guardar");
      const { port, ui } = consola(d);
      render(ui());
      fireEvent.click(boton("Corregir"));
      fireEvent.change(area("Corregir la nota"), { target: { value: "La distancia y la luz importan" } });
      await pulsar(boton("Guardar la corrección"));
      expect(port.admin).toHaveBeenCalledWith({ type: "note.edit", noteId: "n1", expectedRevision: 1, text: "La distancia y la luz importan" });
    });

    it("en el inventor, abrirlo envía inventor.open; escribir la pregunta final pide confirmación y solo al confirmar envía final.confirm", async () => {
      const cerrado = consola(enEtapa("closing"));
      render(cerrado.ui());
      await pulsar(boton("Abrir inventor"));
      expect(cerrado.port.admin).toHaveBeenCalledWith({ type: "inventor.open" });
      cleanup();
      const { port, ui } = consola(enEtapa("inventor"));
      render(ui());
      fireEvent.click(screen.getByRole("radio", { name: "Escribir otra pregunta" }));
      fireEvent.change(area("Pregunta final del grupo"), { target: { value: "¿Por qué la luna cambia de forma?" } });
      fireEvent.click(boton("Revisar y confirmar"));
      expect(port.admin).not.toHaveBeenCalled();
      await pulsar(within(screen.getByRole("alertdialog", { name: "¿Esta es la pregunta final?" })).getByRole("button", { name: "Sí, imprimirla en el inventor" }));
      expect(port.admin).toHaveBeenCalledWith({ type: "final.confirm", value: { kind: "written", text: "¿Por qué la luna cambia de forma?" } });
    });

    it("en el inventor, elegir una pregunta guardada envía final.confirm con esa nota", async () => {
      const d = enEtapa("closing");
      d.must(d.admin({ type: "note.save", activityId: "cajas", kind: "question", text: "¿Cómo investigamos con respeto?" }), "guardar");
      d.must(d.admin({ type: "inventor.open" }), "abrir el inventor");
      const { port, ui } = consola(d);
      render(ui());
      fireEvent.click(screen.getByRole("radio", { name: "¿Cómo investigamos con respeto?" }));
      fireEvent.click(boton("Revisar y confirmar"));
      await pulsar(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sí, imprimirla en el inventor" }));
      expect(port.admin).toHaveBeenCalledWith({ type: "final.confirm", value: { kind: "saved", noteId: "n1" } });
    });

    it("Vanessa ve las preguntas que registraron las personas y quién no ha registrado la suya", () => {
      const d = enEtapa("inventor");
      d.openStation("ana", "inventor");
      d.must(d.act("ana", { type: "inventor.question", question: { kind: "written", text: "¿Por qué la Luna cambia de forma?" } }), "Ana registra");
      const { ui } = consola(d);
      render(ui());
      expect(screen.getByText("Preguntas del inventor (1 de 2)")).toBeTruthy();
      expect(screen.getByRole("radio", { name: /Luna cambia de forma/ }).closest("label")!.textContent).toContain("Ana");
      const lista = screen.getByRole("list", { name: "Participantes" });
      expect(within(within(lista).getByText("Ana").closest("li")!).getByText("✓ Registró su pregunta")).toBeTruthy();
      expect(within(within(lista).getByText("Beto").closest("li")!).getByText("Sin pregunta aún")).toBeTruthy();
    });

    it("con la pregunta final confirmada solo se puede corregir un error de escritura, con final.correct", async () => {
      const { port, ui } = consola(enEtapa("finished"));
      render(ui());
      expect(screen.queryByRole("button", { name: "Revisar y confirmar" })).toBeNull();
      fireEvent.click(boton("Corregir un error de escritura"));
      fireEvent.change(area("Corregir la pregunta final"), { target: { value: "¿Por qué la Luna cambia de forma?" } });
      await pulsar(boton("Guardar la corrección"));
      expect(port.admin).toHaveBeenCalledWith({ type: "final.correct", expectedRevision: 1, text: "¿Por qué la Luna cambia de forma?" });
    });
  });

  it("«Reiniciar» y «Cerrar» piden confirmación y solo envían la acción al confirmar", async () => {
    const { port, ui } = consola(enEtapa("exploration"));
    render(ui());
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
    expect(screen.getByRole("alertdialog", { name: "¿Reiniciar la aventura?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(port.admin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar" }));
    await pulsar(screen.getByRole("button", { name: "Sí, reiniciar" }));
    expect(port.admin).toHaveBeenLastCalledWith({ type: "room.reset", confirm: true });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.getByRole("alertdialog", { name: "¿Cerrar la sala?" })).toBeTruthy();
    await pulsar(screen.getByRole("button", { name: "Sí, cerrar la sala" }));
    expect(port.admin).toHaveBeenLastCalledWith({ type: "room.close", confirm: true });
  });

  describe("lista de participantes dentro de la consola", () => {
    it("durante la exploración «Incluir en la ronda» suma a quien llegó después", () => {
      const { port, ui } = consola(conRezagada(mesaAbierta(0)));
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Incluir en la ronda a Cata" }));
      expect(port.admin).toHaveBeenCalledWith({ type: "round.include", principalId: "cata" });
    });

    it("en ninguna conversación se proyectan los resultados de una persona: no existe «Proyectar resultados»", async () => {
      for (const n of [0, 1, 2] as const) {
        const d = mesaAbierta(n, ["ana", "beto"]);
        d.must(d.admin({ type: "round.converse" }), "conversar");
        const { unmount } = render(consola(d).ui());
        await escenario();
        expect(screen.queryByRole("button", { name: /Proyectar resultados|Quitar los resultados/ }), `mesa ${n}`).toBeNull();
        unmount();
      }
    });

    it("en la conversación de Rampas la proyección pregunta qué resultado apoya su explicación (guía de Vanessa)", async () => {
      const d = mesaAbierta(1, ["ana", "beto"]);
      d.must(d.admin({ type: "round.converse" }), "conversar");
      const { ui } = consola(d);
      render(ui());
      await escenario();
      expect(screen.getByRole("heading", { name: "¿Qué observaron y qué resultado apoya su explicación? ¿Alguien quiere añadir algo a lo que dijo su compañero?" })).toBeTruthy();
    });

    it("cuenta a las personas conectadas en el resumen", () => {
      const { ui } = consola(enEtapa("exploration"));
      const { rerender } = render(ui());
      expect(screen.getByText("Participantes (2 conectados)")).toBeTruthy();
      rerender(ui(clientState(enEtapa("exploration"), "admin", { offline: ["beto"] })));
      expect(screen.getByText(/^Participantes \(1 /)).toBeTruthy();
    });
  });

  describe("la proyección", () => {
    it("al comenzar proyecta solo la pregunta de entrada; al abrir la mesa, su pregunta y el avance del grupo", async () => {
      const d = enEtapa("preparation");
      const { ui } = consola(d);
      const { rerender, container } = render(ui());
      await escenario();
      expect(screen.getByRole("heading", { name: "¿Recuerdan algo que hayan aprendido porque les dio curiosidad?" })).toBeTruthy();
      expect(screen.queryByText(/acercamos o alejamos la linterna/)).toBeNull();
      expect(container.querySelector(".projection-badge")).toBeNull();
      d.must(d.admin({ type: "round.open" }), "abrir");
      rerender(ui(clientState(d, "admin")));
      expect(screen.queryByRole("heading", { name: /Recuerdan algo/ })).toBeNull();
      expect(screen.getByRole("heading", { name: "¿Qué cambiará si acercamos o alejamos la linterna?" })).toBeTruthy();
      expect(container.querySelector(".projection-badge")!.textContent).toBe("Sombras · 0 de 2 listos");
    });

    it("antes de abrir la segunda mesa el laboratorio ocupa toda la pantalla: no hay panel", async () => {
      const d = sala();
      d.toExploration(0);
      d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
      d.must(d.admin({ type: "round.next" }), "siguiente");
      const { ui } = consola(d);
      const { container } = render(ui());
      await escenario();
      expect(container.querySelector(".projection, .adventure__activity")).toBeNull();
    });

    it("en la exploración la proyección muestra la pregunta de la mesa y cuántas personas están listas, nunca resultados", async () => {
      const { ui } = consola(mesaAbierta(0, ["ana"]));
      const { container } = render(ui());
      await escenario();
      expect(container.querySelector(".projection-badge")!.textContent).toBe("Sombras · 1 de 2 listos");
      expect(container.querySelector(".projection")!.textContent).toBe("Mesa 1 de 3 · Sombras¿Qué cambiará si acercamos o alejamos la linterna?");
    });

    it("en la conversación proyecta la pregunta y la frase de Freire solo cuando Vanessa la muestra", async () => {
      const d = enEtapa("conversation");
      const { ui } = consola(d);
      const { rerender, container } = render(ui());
      await escenario();
      expect(screen.getByRole("heading", { name: /Qué observación nos ayuda a revisar la primera explicación/ })).toBeTruthy();
      expect(container.querySelector(".projection-badge")).toBeNull();
      expect(screen.queryByText(/Freire propone volver más rigurosa/)).toBeNull();
      d.must(d.admin({ type: "round.showFreire" }), "Freire");
      rerender(ui(clientState(d, "admin")));
      expect(screen.getByText(/Freire propone volver más rigurosa/)).toBeTruthy();
    });
  });

  describe("el observatorio", () => {
    /** La tercera mesa con Ana lista y Beto, que se acercó a la ventana de la casa. */
    const observatorio = () => {
      const d = mesaAbierta(2, ["ana"]);
      d.openStation("beto", "cajas");
      d.must(d.act("beto", { type: "telescope.aim", x: 1330, y: 930, zoom: 1 }), "Beto mira la ventana");
      return d;
    };

    it("en la exploración la consola muestra el avance de cada persona, nunca quién miró la casa", async () => {
      const { ui } = consola(observatorio());
      const { container } = render(ui());
      await escenario();
      expect(contador()).toBe("1 de 2 listos");
      const lista = screen.getByRole("list", { name: "Participantes" });
      expect(lista.textContent).not.toMatch(/casa|ventana|cortina/i);
      expect(container.querySelector(".projection-badge")!.textContent).toBe("El observatorio · 1 de 2 listos");
    });

    it("en la conversación la casa llega con la frase de Freire: no hay «Mostrar la casa» ni «Volver al laboratorio»", async () => {
      const d = observatorio();
      d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
      const { port, ui } = consola(d);
      const { rerender } = render(ui());
      await escenario();
      expect(screen.queryByRole("button", { name: /Mostrar la casa|Volver al laboratorio|Proyectar resultados/ })).toBeNull();
      await pulsar(screen.getByRole("button", { name: "Mostrar la frase de Freire" }));
      expect(port.admin).toHaveBeenLastCalledWith({ type: "round.showFreire" }); // un solo paso: la frase y la casa
      d.must(d.admin({ type: "round.showFreire" }), "Freire");
      rerender(ui(clientState(d, "admin")));
      expect(screen.queryByRole("button", { name: /Mostrar la casa|Volver al laboratorio|Freire/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Pasar al inventor" })).toBeTruthy();
    });
  });

  it("Vanessa no tiene personaje: la consola no muestra la barra del mapa ni controles de mesa", async () => {
    const { ui } = consola(mesaAbierta(0));
    const { container } = render(ui());
    await escenario();
    expect(screen.queryByText("Mesas")).toBeNull();
    expect(screen.queryByText("Cuaderno")).toBeNull(); // el «Cuaderno del grupo» de abajo es otra cosa
    expect(screen.getByText("Cuaderno del grupo (0)")).toBeTruthy();
    expect(container.querySelector(".personal")).toBeNull();
    expect(screen.queryByRole("button", { name: "Volver al mapa" })).toBeNull();
  });

  it("ofrece el código QR, reiniciar y cerrar", () => {
    render(consola(enEtapa("exploration")).ui());
    expect(screen.getByText("Código QR para entrar (ABC234)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reiniciar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });

  it("no ofrece «Probar la mesa yo misma» ni ninguna demostración: Vanessa solo conduce la ronda", () => {
    for (const etapa of ["preparation", "exploration", "conversation"] as const) {
      const { ui } = consola(etapa === "exploration" ? mesaAbierta(0) : enEtapa(etapa));
      const { unmount } = render(ui());
      expect(screen.queryByRole("button", { name: /Probar la mesa|demostración/i }), etapa).toBeNull();
      unmount();
    }
  });
});

// ---- la lista de personas ---------------------------------------------------------------------------------------------

describe("ParticipantList", () => {
  /** Lo que recibe Vanessa: la presencia de una sala conducida de verdad. */
  const presencia = (d: Driver, over = {}) => clientState(d, "admin", over).presence!.participants;
  const botones = () => screen.queryAllByRole("button").map((b) => b.textContent);

  it("el estado de conexión se lee por texto e icono, no solo por color", () => {
    render(<ParticipantList participants={presencia(enEtapa("preparation"), { offline: ["beto"] })} />);
    expect(screen.getByText("● Conectado")).toBeTruthy();
    expect(screen.getByText("○ Desconectado")).toBeTruthy();
  });

  it("en exploración dice cuánto lleva cada persona («1 de 2») y quién ya quedó lista («✓ Listo»)", () => {
    const d = mesaAbierta(0, ["beto"]);
    d.openStation("ana", "sombras");
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 20 }), "una posición");
    render(<ParticipantList participants={presencia(d)} stage="exploration" />);
    const ana = screen.getByText("Ana").closest("li")!;
    const beto = screen.getByText("Beto").closest("li")!;
    expect(within(ana).getByText("1 de 2")).toBeTruthy();
    expect(within(beto).getByText("✓ Listo")).toBeTruthy();
    expect(within(beto).queryByText(/de 2/)).toBeNull();
  });

  it("antes de abrir la mesa nadie tiene avance que mostrar", () => {
    render(<ParticipantList participants={presencia(enEtapa("preparation"))} stage="preparation" />);
    expect(screen.queryByText(/ de \d/)).toBeNull();
    expect(screen.queryByText(/Lista/)).toBeNull();
  });

  it("quien acompaña como observadora se distingue y no tiene avance ni acciones, ni en exploración ni en conversación", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    const { rerender } = render(<ParticipantList participants={presencia(d, { observers: { luz: "Luz" } })} stage="exploration" onInclude={vi.fn()} />);
    const luz = screen.getByText("Luz").closest("li")!;
    expect(within(luz).getByText("Observa")).toBeTruthy();
    expect(within(luz).queryByRole("button")).toBeNull();
    expect(within(luz).queryByText(/Acompaña/)).toBeNull();
    d.must(d.admin({ type: "round.converse" }), "conversar");
    rerender(<ParticipantList participants={presencia(d, { observers: { luz: "Luz" } })} stage="conversation" onInclude={vi.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0); // en la conversación la lista solo informa
  });

  describe("«Incluir en la ronda»", () => {
    it("solo en exploración y solo para quien llegó después de abrir la mesa y está conectada", () => {
      const d = conRezagada(mesaAbierta(0, ["ana"]));
      d.join("dani", "Dani");
      const onInclude = vi.fn();
      render(<ParticipantList participants={presencia(d, { offline: ["dani"] })} stage="exploration" onInclude={onInclude} />);
      expect(botones()).toEqual(["Incluir en la ronda"]); // Cata; Dani está desconectada, Ana y Beto ya cuentan
      const cata = screen.getByText("Cata").closest("li")!;
      expect(within(cata).getByText("Acompaña")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Incluir en la ronda a Cata" }));
      expect(onInclude).toHaveBeenCalledWith("cata");
    });

    it("no se ofrece en la preparación, en la conversación ni en el cierre", () => {
      const d = conRezagada(mesaAbierta(0, ["ana", "beto"]));
      for (const stage of ["preparation", "conversation", "closing"] as const) {
        const { unmount } = render(<ParticipantList participants={presencia(d)} stage={stage} onInclude={vi.fn()} />);
        expect(screen.queryByText("Incluir en la ronda"), stage).toBeNull();
        unmount();
      }
    });

    it("sin manejador no hay botón, y con la consola ocupada se deshabilita", () => {
      const d = conRezagada(mesaAbierta(0, ["ana", "beto"]));
      const { rerender } = render(<ParticipantList participants={presencia(d)} stage="exploration" />);
      expect(screen.queryByText("Incluir en la ronda")).toBeNull();
      expect(screen.getByText("Acompaña")).toBeTruthy();
      rerender(<ParticipantList participants={presencia(d)} stage="exploration" onInclude={vi.fn()} busy />);
      expect((screen.getByRole("button", { name: "Incluir en la ronda a Cata" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("una vez incluida, muestra su avance como cualquiera", () => {
      const d = conRezagada(mesaAbierta(0, ["ana", "beto"]));
      d.must(d.admin({ type: "round.include", principalId: "cata" }), "incluir");
      render(<ParticipantList participants={presencia(d)} stage="exploration" onInclude={vi.fn()} />);
      expect(within(screen.getByText("Cata").closest("li")!).getByText("0 de 2")).toBeTruthy();
      expect(screen.queryByText("Incluir en la ronda")).toBeNull();
    });
  });

  it("en la conversación sigue mostrando el avance de cada persona, también de quien quedó pendiente, sin acciones", () => {
    const d = mesaAbierta(0, ["ana"]);
    d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    render(<ParticipantList participants={presencia(d)} stage="conversation" onInclude={vi.fn()} />);
    expect(within(screen.getByText("Ana").closest("li")!).getByText("✓ Listo")).toBeTruthy();
    expect(within(screen.getByText("Beto").closest("li")!).getByText("0 de 2")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("sin participantes explica cómo entrar y mientras carga no afirma que no haya nadie", () => {
    const { rerender } = render(<ParticipantList participants={[]} />);
    expect(screen.getByText(/escaneen el código QR/)).toBeTruthy();
    rerender(<ParticipantList participants={[]} loading />);
    expect(screen.getByText("Cargando a las personas de la sala…")).toBeTruthy();
    expect(screen.queryByText(/escaneen el código QR/)).toBeNull();
  });

  it("la lista tiene nombre accesible y la silueta no se anuncia (el nombre y el color van como texto)", () => {
    const d = enEtapa("preparation");
    const { container } = render(<ParticipantList participants={presencia(d)} />);
    expect(screen.getByRole("list", { name: "Participantes" })).toBeTruthy();
    expect(container.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(2);
    const ana = screen.getByText("Ana").closest("li")!;
    expect(within(ana).getByText("Rojo")).toBeTruthy();
  });

  it("no queda ningún rastro del turno: ni «Dar turno» ni «Tiene el turno»", () => {
    const d = mesaAbierta(0);
    render(<ParticipantList participants={presencia(d)} stage="exploration" onInclude={vi.fn()} />);
    expect(screen.queryByText(/turno/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /turno/i })).toBeNull();
  });

  // Mismo tipo `ParticipantInfo` que construye el servidor: la lista no depende de nada más.
  it("acepta directamente la información pública de las personas", () => {
    const persona: ParticipantInfo = { principalId: "p", role: "participant", displayName: "Ana · 2", name: "Ana", color: "azul", distinction: 2, connected: true, observer: false, inRound: true, ready: false, progress: { done: 1, needed: 2 }, question: null };
    render(<ParticipantList participants={[persona]} stage="exploration" />);
    expect(screen.getByText("Ana · 2")).toBeTruthy();
    expect(screen.getByText("1 de 2")).toBeTruthy();
  });
});

// ---- estados terminales ---------------------------------------------------------------------------------------------------

describe("TerminalView", () => {
  it.each([
    ["closed", "La aventura terminó", /ya no admite más acciones/],
    ["expired", "La sala venció", /sin actividad/],
    ["replaced", "Esta pestaña quedó desactivada", /otra pestaña o ventana/],
    ["unauthorized", "Tu acceso ya no es válido", /Vuelve a entrar a la sala con su código/],
  ] as const)("%s: explica con palabras qué pasó y solo deja volver al inicio", (reason, titulo, cuerpo) => {
    const onHome = vi.fn();
    render(<TerminalView reason={reason} onHome={onHome} />);
    expect(screen.getByRole("heading", { name: titulo })).toBeTruthy();
    expect(screen.getByText(cuerpo)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});

// ---- entrada a la sala ----------------------------------------------------------------------------------------------------

describe("JoinView", () => {
  beforeEach(() => {
    vi.mocked(api.getRoomInfo).mockResolvedValue({ code: "ABC234", phase: "welcome", title: "El laboratorio de las cosas cotidianas" });
    vi.mocked(api.joinRoom).mockReset();
  });
  const entrada = { principalId: "p9", name: "Ana", displayName: "Ana", color: "verde", distinction: 1, observer: false, token: "t".repeat(43) };

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
    vi.mocked(api.joinRoom).mockResolvedValue(entrada);
    const onJoined = vi.fn();
    render(<JoinView code="ABC234" onJoined={onJoined} navigate={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Tu nombre"), { target: { value: "  Ana   " } });
    fireEvent.click(screen.getByRole("radio", { name: "Verde" }));
    fireEvent.click(screen.getByRole("button", { name: "Entrar a la sala" }));
    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));
    expect(api.joinRoom).toHaveBeenCalledWith("ABC234", "Ana", "verde");
    expect(onJoined.mock.calls[0]![0]).toMatchObject({ role: "participant", principalId: "p9", color: "verde", token: "t".repeat(43) });
  });

  it("no ofrece entrar solo a acompañar: no hay casilla de observadora y todas entran a jugar", async () => {
    render(<JoinView code="ABC234" onJoined={() => undefined} navigate={() => undefined} />);
    await screen.findByLabelText("Tu nombre");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/acompañar|observador/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Entrar a la sala" })).toBeTruthy();
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

// ---- la vista que corresponde a cada persona -------------------------------------------------------------------------------

describe("RoomView: elige la vista según la credencial, el papel y la fase", () => {
  const sesion = (state: ReturnType<typeof clientState> | null, role: "admin" | "participant" = "participant", over: Partial<ReturnType<typeof useRoomSession>> = {}) => {
    const port = fakePort(state ?? clientState(sala(), "ana"));
    const navigate = vi.fn();
    const leave = vi.fn();
    vi.mocked(useRoomSession).mockReturnValue({
      credential: { token: "t".repeat(43), role, principalId: "x", displayName: "x", color: null, savedAt: "2026-10-06T10:00:00.000Z" },
      controller: state ? port.asController() : null,
      state: state ?? { status: "connecting", summary: null, group: null, me: null, characters: {}, presence: null, pending: 0, notice: null },
      adopt: vi.fn(),
      leave,
      ...over,
    });
    return { port, navigate, leave, ui: () => <RoomView project={project} code="ABC234" navigate={navigate} /> };
  };

  it("sin credencial muestra la entrada a la sala", async () => {
    vi.mocked(api.getRoomInfo).mockResolvedValue({ code: "ABC234", phase: "welcome", title: "El laboratorio de las cosas cotidianas" });
    vi.mocked(useRoomSession).mockReturnValue({ credential: null, controller: null, state: clientState(sala(), "ana"), adopt: vi.fn(), leave: vi.fn() });
    render(<RoomView project={project} code="ABC234" navigate={() => undefined} />);
    expect(await screen.findByLabelText("Tu nombre")).toBeTruthy();
  });

  it("mientras no llega el resumen de la sala dice que está conectando", () => {
    render(sesion(null).ui());
    expect(screen.getByText("Conectando con la sala…")).toBeTruthy();
  });

  it("Vanessa ve la bienvenida antes de comenzar y la consola después", async () => {
    const bienvenida = sesion(clientState(enEtapa("welcome"), "admin"), "admin");
    const { unmount } = render(bienvenida.ui());
    expect(screen.getByRole("button", { name: "Comenzar la aventura" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Abrir mesa/ })).toBeNull();
    unmount();
    const curso = sesion(clientState(enEtapa("preparation"), "admin"), "admin");
    render(curso.ui());
    expect(screen.getByRole("button", { name: "Abrir mesa: Sombras" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Comenzar la aventura" })).toBeNull();
    await escenario();
  });

  it("quien juega ve su celular con el mapa", async () => {
    render(sesion(clientState(enEtapa("exploration"), "ana")).ui());
    await mapa();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText(config.ui.labels.roundExplorationPhone!)).toBeTruthy();
    expect(phaser.mounts).toBe(1);
  });

  it("quien observa ve la espera: sin mapa, sin canvas y sin un solo control", async () => {
    const d = enEtapa("exploration");
    const { container } = render(sesion(clientState(d, "luz", { observers: { luz: "Luz" } })).ui());
    await dejarCargar();
    expect(screen.getByRole("heading", { name: "Luz" })).toBeTruthy();
    expect(screen.getByText(config.ui.labels.observerPhone!)).toBeTruthy();
    expect(container.querySelector("canvas, .game-host, .adventure, .adventure__map")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(phaser.mounts).toBe(0);
  });

  it("en la conversación la observadora y quien juega leen el mismo texto de la proyección", async () => {
    const d = enEtapa("conversation");
    const observa = render(sesion(clientState(d, "luz", { observers: { luz: "Luz" } })).ui());
    expect(screen.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.")).toBeTruthy();
    observa.unmount();
    render(sesion(clientState(d, "ana")).ui());
    await mapa();
    expect(screen.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.")).toBeTruthy();
  });

  it("una sala terminada o vencida y una pestaña desplazada muestran su explicación; «Ir al inicio» olvida la credencial", () => {
    const cerrada = enEtapa("exploration");
    cerrada.must(cerrada.admin({ type: "room.close", confirm: true }), "cerrar");
    const a = sesion(clientState(cerrada, "ana"));
    const { unmount } = render(a.ui());
    expect(screen.getByRole("heading", { name: "La aventura terminó" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    expect(a.leave).toHaveBeenCalledTimes(1);
    expect(a.navigate).toHaveBeenCalledWith("/");
    unmount();

    const vencida = clientState(enEtapa("exploration"), "ana");
    const b = sesion({ ...vencida, summary: { ...vencida.summary!, phase: "expired" } });
    const segunda = render(b.ui());
    expect(screen.getByRole("heading", { name: "La sala venció" })).toBeTruthy();
    segunda.unmount();

    const c = sesion({ ...clientState(enEtapa("exploration"), "ana"), status: "replaced" });
    render(c.ui());
    expect(screen.getByRole("heading", { name: "Esta pestaña quedó desactivada" })).toBeTruthy();
  });

  describe("avisos y conexión", () => {
    it("anuncia el aviso a lectores de pantalla, lo muestra y lo retira a los 5 segundos", () => {
      vi.useFakeTimers();
      const state = clientState(enEtapa("exploration"), "luz", { observers: { luz: "Luz" }, notice: { id: 7, kind: "error", text: "La ronda cambió; esta acción llegó tarde." } });
      const s = sesion(state);
      const { container } = render(s.ui());
      const vivo = container.querySelector("[aria-live=polite]")!;
      expect(vivo.textContent).toBe("La ronda cambió; esta acción llegó tarde.");
      expect(container.querySelector(".notice--error")!.getAttribute("aria-hidden")).toBe("true"); // no se lee dos veces
      act(() => void vi.advanceTimersByTime(4999));
      expect(s.port.clearNotice).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(1));
      expect(s.port.clearNotice).toHaveBeenCalledWith(7);
    });

    it("con la conexión caída lo dice con texto en lugar del aviso", () => {
      const state = clientState(enEtapa("exploration"), "luz", { observers: { luz: "Luz" }, status: "reconnecting", notice: { id: 1, kind: "info", text: "Otro aviso" } });
      const { container } = render(sesion(state).ui());
      expect(screen.getByText("Reconectando con la sala…", { selector: ".notice" })).toBeTruthy();
      expect(container.querySelectorAll(".notice")).toHaveLength(1);
    });

    it("si la conexión de Vanessa no vuelve, solo se avisa que se está reconectando: ya no se ofrece ninguna demostración", () => {
      vi.useFakeTimers();
      const s = sesion(clientState(enEtapa("welcome"), "admin", { status: "reconnecting" }), "admin");
      render(s.ui());
      act(() => void vi.advanceTimersByTime(30_000));
      expect(screen.getByText("Reconectando con la sala…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /demostración/i })).toBeNull();
      expect(s.navigate).not.toHaveBeenCalled();
    });
  });
});

// ---- piezas comunes -----------------------------------------------------------------------------------------------------

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
