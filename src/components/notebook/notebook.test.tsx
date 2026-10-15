// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, FinalQuestionInput, SavableNoteKind } from "../../../shared/contracts/actions";
import type { Comparison, GroupNote, NoteKind } from "../../../shared/contracts/state";
import { formatNumber, rampDurationMs, shadowHeightCm } from "../../../shared/domain/models";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../../shared/domain/telescope";
import type { Driver } from "../../../shared/testing/drive";
import { config, denied, enEtapa, mesaAbierta, OK, sala } from "../../testing/clientState";
import { ComparisonView } from "../admin/ComparisonView";
import { FinalQuestion } from "../admin/FinalQuestion";
import { GroupNotes } from "../admin/GroupNotes";
import { Guide } from "../admin/Guide";
import { ProjectionBadge, ProjectionPanel } from "../admin/ProjectionPanel";
import { RoundControls } from "../admin/RoundControls";
import { NotebookView } from "./NotebookView";
import { NOTE_LABEL, noteText, personalLines } from "./notes";
import { PieceTray } from "./PieceTray";

afterEach(cleanup);

const adv = (d: Driver) => d.room.adventure;
const note = (d: Driver, kind: NoteKind, n = 0): GroupNote => adv(d).notebook.filter((x) => x.kind === kind)[n]!;
/** Lo que Vanessa guarda en el cuaderno del grupo, por la misma acción que usa la consola. */
const guardar = (d: Driver, kind: SavableNoteKind, text: string, activityId = "sombras") => d.must(d.admin({ type: "note.save", activityId, kind, text }), `guardar ${kind}`);
const posicion = (cm: number) => `linterna a ${formatNumber(cm)} cm → sombra de ${formatNumber(shadowHeightCm(cm, 25, 8), 1)} cm`;

/** Las tres mesas completas, con las dos personas listas en cada una, hasta el cierre. */
const alCierre = () => enEtapa("closing");

// ---- piezas -----------------------------------------------------------------------------------------------------------------

describe("PieceTray", () => {
  const piezas = config.inventor.pieces;

  it("dice con texto cuántas piezas hay y cuáles faltan (no solo con la forma)", () => {
    const { container, rerender } = render(<PieceTray pieces={piezas} have={["lupa"]} compact />);
    expect(screen.getByLabelText("Piezas conseguidas: 1 de 3")).toBeTruthy();
    expect(container.textContent).toContain("Lupa: conseguida");
    expect(container.textContent).toContain(`${piezas[1]!.label}: falta`);
    expect(container.textContent).toContain(`${piezas[2]!.label}: falta`);
    rerender(<PieceTray pieces={piezas} have={["lupa", "dialogo", "corazon"]} />);
    expect(screen.getByLabelText("Tenemos las tres piezas")).toBeTruthy();
  });

  it("sin piezas lo dice, y una pieza desconocida no cuenta", () => {
    const { rerender } = render(<PieceTray pieces={piezas} have={[]} />);
    expect(screen.getByLabelText("Piezas conseguidas: 0 de 3")).toBeTruthy();
    rerender(<PieceTray pieces={piezas} have={["nada"]} />);
    expect(screen.getByLabelText("Piezas conseguidas: 0 de 3")).toBeTruthy();
  });

  it("marca las conseguidas y, sin ser compacta, escribe el nombre de cada pieza", () => {
    const { container } = render(<PieceTray pieces={piezas} have={["lupa"]} />);
    expect(container.querySelectorAll("li.is-collected")).toHaveLength(1);
    for (const p of piezas) expect(within(container).getByText(p.label)).toBeTruthy();
  });

  it("refleja las piezas que el servidor deriva al terminar cada mesa, no las que alguien diga", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    const antes = render(<PieceTray pieces={piezas} have={adv(d).pieces} compact />);
    expect(screen.getByLabelText("Piezas conseguidas: 0 de 3")).toBeTruthy(); // lista para conversar no es una pieza
    antes.unmount();
    d.must(d.admin({ type: "round.converse" }), "conversar");
    d.must(d.admin({ type: "round.next" }), "siguiente");
    render(<PieceTray pieces={piezas} have={adv(d).pieces} compact />);
    expect(screen.getByLabelText("Piezas conseguidas: 1 de 3")).toBeTruthy();
  });
});

// ---- textos del cuaderno ---------------------------------------------------------------------------------------------

describe("notes.ts", () => {
  it("la idea de Vanessa se identifica siempre como del grupo, y la inicial se distingue de la síntesis", () => {
    expect(NOTE_LABEL.initialIdea).toBe("Idea inicial del grupo");
    expect(NOTE_LABEL.synthesis).toBe("Idea del grupo");
    expect(NOTE_LABEL.initialIdea).not.toBe(NOTE_LABEL.synthesis);
    expect(NOTE_LABEL.question).toBe("Pregunta del grupo");
    expect(NOTE_LABEL.comparison).toBe("Resultados comparados");
    expect(NOTE_LABEL.finalQuestion).toBe("Pregunta final");
  });

  it("el texto de una nota escrita es el que Vanessa guardó", () => {
    const d = mesaAbierta(0);
    guardar(d, "synthesis", "La luz y la distancia cambian la sombra");
    expect(noteText(note(d, "synthesis"))).toBe("La luz y la distancia cambian la sombra");
  });

  it("una comparación se escribe con el nombre de quien la hizo y sus datos, para lectores de pantalla", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    d.must(d.admin({ type: "present.select", principalId: "ana" }), "proyectar");
    const texto = noteText(note(d, "comparison"));
    expect(texto.startsWith("Ana: ")).toBe(true); // el nombre visible que dio la sala
    expect(texto).toContain(posicion(20));
    expect(texto).toContain(posicion(50));
  });

  it("una nota sin texto ni comparación queda vacía en lugar de «null»", () => {
    const vacia: GroupNote = { id: "n9", activityId: "sombras", kind: "synthesis", text: null, revision: 1, createdAt: "", updatedAt: "", history: [] };
    expect(noteText(vacia)).toBe("");
  });

  describe("personalLines: solo lo que el juego registró", () => {
    it("sin estado no hay líneas", () => {
      expect(personalLines(undefined)).toEqual([]);
    });

    it("Sombras: una línea por posición que cuenta; las muy parecidas no aparecen", () => {
      const d = mesaAbierta(0);
      d.openStation("ana", "sombras");
      for (const cm of [20, 22, 50]) d.must(d.act("ana", { type: "shadows.sample", distanceCm: cm }), `posición ${cm}`);
      const lineas = personalLines(d.person("ana").activities.sombras);
      expect(lineas).toEqual([`Posición 1: ${posicion(20)}`, `Posición 2: ${posicion(50)}`]);
    });

    it("Rampas: una línea por prueba terminada, con la inclinación y el tiempo de la simulación; la que rueda no aparece", () => {
      const d = mesaAbierta(1);
      d.openStation("ana", "rampas");
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "prueba 1");
      expect(personalLines(d.person("ana").activities.rampas)).toEqual([]); // todavía rueda
      d.tick(6000);
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 40 }), "prueba 2"); // rodando
      const lineas = personalLines(d.person("ana").activities.rampas);
      const t1 = d.person("ana").activities.rampas as { trials: Array<{ durationMs: number }> };
      expect(lineas).toEqual([`Prueba 1: 20° → ${formatNumber(t1.trials[0]!.durationMs / 1000, 1)} s (simulación)`]);
      expect(t1.trials[0]!.durationMs).toBe(rampDurationMs(20, 2, 2.4));
    });

    it("Rampas: una prueba cancelada al pasar a la conversación no es un resultado", () => {
      const d = mesaAbierta(1);
      d.openStation("ana", "rampas");
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "prueba");
      d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
      expect(personalLines(d.person("ana").activities.rampas)).toEqual([]);
    });

    it("El observatorio: solo «Luna observada» y «Estrellas observadas», en ese orden, sin importar cuál se observó primero", () => {
      const d = mesaAbierta(2);
      d.openStation("ana", "cajas");
      expect(personalLines(d.person("ana").activities.cajas)).toEqual([]);
      d.must(d.act("ana", { type: "telescope.aim", x: TELESCOPE_TARGETS.stars.x, y: TELESCOPE_TARGETS.stars.y, zoom: 0 }), "estrellas");
      expect(personalLines(d.person("ana").activities.cajas)).toEqual(["Estrellas observadas"]);
      d.must(d.act("ana", { type: "telescope.aim", x: TELESCOPE_TARGETS.moon.x, y: TELESCOPE_TARGETS.moon.y, zoom: CLOSE_ZOOM }), "Luna");
      expect(personalLines(d.person("ana").activities.cajas)).toEqual(["Luna observada", "Estrellas observadas"]);
    });

    it("El observatorio: la ventana y la cortina nunca se anotan en el cuaderno", () => {
      const d = mesaAbierta(2);
      d.openStation("ana", "cajas");
      d.must(d.act("ana", { type: "telescope.aim", x: TELESCOPE_TARGETS.window.x, y: TELESCOPE_TARGETS.window.y, zoom: CLOSE_ZOOM }), "ventana");
      expect(d.person("ana").activities.cajas).toMatchObject({ curtain: "closed" });
      expect(personalLines(d.person("ana").activities.cajas)).toEqual([]);
    });
  });
});

// ---- el cuaderno --------------------------------------------------------------------------------------------------------------

describe("NotebookView: «Mis resultados» y «Lo que anotó el grupo»", () => {
  const cuaderno = (d: Driver, quien: string | null = "ana") => <NotebookView config={config} me={quien ? d.person(quien) : null} adv={adv(d)} />;
  const misResultados = () => screen.getByRole("region", { name: "Mis resultados" });
  const delGrupo = () => screen.getByRole("region", { name: "Lo que anotó el grupo" });

  it("agrupa los resultados propios por mesa, en el orden del recorrido", () => {
    render(cuaderno(alCierre()));
    expect(within(misResultados()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Sombras", "Rampas", "El observatorio"]);
    expect(within(misResultados()).getByText(`Posición 1: ${posicion(20)}`)).toBeTruthy();
    expect(within(misResultados()).getByText(/^Prueba 2: 40° → /)).toBeTruthy();
    expect(within(misResultados()).getByText("Luna observada")).toBeTruthy();
    expect(within(misResultados()).getByText("Estrellas observadas")).toBeTruthy();
  });

  it("solo aparecen las mesas donde la persona ya tiene algo", () => {
    const d = mesaAbierta(0);
    d.readyShadows("ana");
    render(cuaderno(d));
    expect(within(misResultados()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Sombras"]);
  });

  it("quien todavía no exploró lo ve, y quien acompaña o la proyección no tienen «Mis resultados»", () => {
    const d = mesaAbierta(0);
    const { unmount } = render(cuaderno(d));
    expect(screen.getByText("Todavía no hay resultados tuyos. Se anotan solos mientras exploras.")).toBeTruthy();
    unmount();
    render(cuaderno(d, null));
    expect(screen.queryByRole("region", { name: "Mis resultados" })).toBeNull();
    expect(screen.queryByText("Mis resultados")).toBeNull();
    expect(delGrupo()).toBeTruthy();
  });

  it("solo muestra los resultados de quien lo abre, nunca los de otra persona", () => {
    const d = mesaAbierta(0);
    d.readyShadows("beto");
    render(cuaderno(d, "ana"));
    expect(screen.getByText(/Todavía no hay resultados tuyos/)).toBeTruthy();
    expect(screen.queryByText(/Posición 1/)).toBeNull();
  });

  it("es solo de lectura: ningún formulario, cuadro de texto ni botón para anotar", () => {
    const d = alCierre();
    guardar(d, "initialIdea", "Será por la luz");
    guardar(d, "synthesis", "Importa la distancia", "sombras");
    const { container } = render(cuaderno(d));
    expect(container.querySelector("form, textarea, input, select")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    for (const texto of [/Anotar/, /Guardar/, /Tengo una pregunta/, /Entendido/, /Tu respuesta/]) expect(screen.queryByText(texto), String(texto)).toBeNull();
  });

  describe("lo que anotó el grupo", () => {
    it("sin notas dice que todavía no hay y qué aparecerá", () => {
      render(cuaderno(mesaAbierta(0)));
      expect(within(delGrupo()).getByText(/Todavía no hay notas del grupo/)).toBeTruthy();
    });

    it("conserva la idea inicial aparte de la síntesis, y ambas se identifican como del grupo", () => {
      const d = mesaAbierta(0);
      guardar(d, "initialIdea", "Será por la luz");
      guardar(d, "synthesis", "La distancia de la linterna cambia el tamaño");
      guardar(d, "question", "¿Qué pasa si movemos el objeto?");
      const { container } = render(cuaderno(d));
      const primera = container.querySelector(".record--first")!;
      expect(container.querySelectorAll(".record--first")).toHaveLength(1);
      expect(within(primera as HTMLElement).getByText("Idea inicial del grupo")).toBeTruthy();
      expect(primera.textContent).toContain("Será por la luz");
      const sintesis = screen.getByText("La distancia de la linterna cambia el tamaño").closest("li")!;
      expect(within(sintesis).getByText("Idea del grupo")).toBeTruthy();
      expect(sintesis.classList.contains("record--first")).toBe(false);
      expect(within(screen.getByText("¿Qué pasa si movemos el objeto?").closest("li")!).getByText("Pregunta del grupo")).toBeTruthy();
      expect(within(delGrupo()).getByRole("heading", { level: 4, name: "Sombras" })).toBeTruthy();
    });

    it("una nota corregida se marca y deja ver sus versiones anteriores; la idea inicial sigue identificada", () => {
      const d = mesaAbierta(0);
      guardar(d, "initialIdea", "Será por la luz");
      d.must(d.admin({ type: "note.edit", noteId: note(d, "initialIdea").id, expectedRevision: 1, text: "Será por la luz y la distancia" }), "corregir");
      const { container } = render(cuaderno(d));
      const fila = container.querySelector(".record--first") as HTMLElement;
      expect(within(fila).getByText("corregida")).toBeTruthy();
      expect(within(fila).getByText("Será por la luz y la distancia")).toBeTruthy();
      expect(within(fila).getByText("Versiones anteriores (1)")).toBeTruthy();
      expect(within(fila).getByText(/Versión 1:/).closest("li")!.textContent).toContain("Será por la luz");
    });

    it("los resultados proyectados entran escritos con su nombre; si se vuelven a proyectar quedan como corregidos", () => {
      const d = mesaAbierta(0, ["ana", "beto"]);
      d.must(d.admin({ type: "round.converse" }), "conversar");
      d.must(d.admin({ type: "present.select", principalId: "beto" }), "proyectar");
      const { rerender } = render(cuaderno(d));
      expect(screen.getByText("Resultados comparados")).toBeTruthy();
      expect(screen.getByText(new RegExp(`^Beto: ${posicion(20)}`))).toBeTruthy();
      d.must(d.admin({ type: "present.select", principalId: "beto" }), "proyectar otra vez");
      rerender(cuaderno(d));
      expect(screen.getByText("corregida")).toBeTruthy();
      expect(screen.getByText("(resultados anteriores)")).toBeTruthy();
    });

    it("la pregunta final aparece bajo «El inventor», y las notas de cada mesa bajo su título, en el orden del recorrido", () => {
      const d = alCierre();
      guardar(d, "question", "¿Cómo vuela una pelota?", "rampas");
      guardar(d, "synthesis", "La luz importa", "sombras");
      d.must(d.admin({ type: "final.confirm", value: { kind: "saved", noteId: note(d, "question").id } }), "confirmar");
      render(cuaderno(d));
      expect(within(delGrupo()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Sombras", "Rampas", "El inventor"]);
      const inventor = within(delGrupo()).getByRole("heading", { level: 4, name: "El inventor" }).parentElement!;
      expect(within(inventor).getByText("Pregunta final")).toBeTruthy();
      expect(within(inventor).getByText("¿Cómo vuela una pelota?")).toBeTruthy();
    });
  });
});

// ---- cuaderno del grupo de Vanessa -----------------------------------------------------------------------------------------

describe("GroupNotes: lo que Vanessa guarda del grupo", () => {
  const OTRA = "Otra versión escrita en otro momento";
  type Guardar = (kind: SavableNoteKind, text: string) => Promise<CommandResult>;
  type Corregir = (noteId: string, expectedRevision: number, text: string) => Promise<CommandResult>;
  const montar = (d: Driver, over: { busy?: boolean; save?: Guardar; edit?: Corregir } = {}) => {
    const save = vi.fn<Guardar>(over.save ?? (async () => OK));
    const edit = vi.fn<Corregir>(over.edit ?? (async () => OK));
    const ui = (a = adv(d)) => <GroupNotes config={config} adv={a} busy={over.busy ?? false} save={save} edit={edit} />;
    return { save, edit, ui };
  };
  const campo = (nombre: string | RegExp) => screen.getByLabelText(nombre) as HTMLTextAreaElement;
  const escribir = (nombre: string | RegExp, texto: string) => fireEvent.change(campo(nombre), { target: { value: texto } });

  describe("qué se puede guardar en cada mesa", () => {
    it("en Sombras: la idea inicial, la síntesis de la conversación y una pregunta del grupo", () => {
      render(montar(mesaAbierta(0)).ui());
      expect(campo("Idea inicial del grupo")).toBeTruthy();
      expect(campo("Idea del grupo (síntesis de la conversación)")).toBeTruthy();
      expect(campo("Pregunta que el grupo quiere conservar")).toBeTruthy();
      for (const nombre of ["Guardar la idea inicial", "Guardar la idea", "Guardar la pregunta"]) expect(screen.getByRole("button", { name: nombre })).toBeTruthy();
      expect(screen.getByText(/Se conserva aparte, aunque después cambie/)).toBeTruthy();
    });

    it("la idea inicial solo existe en Sombras: Rampas y La caja ofrecen únicamente la síntesis y la pregunta", () => {
      for (const mesa of [1, 2] as const) {
        const { unmount } = render(montar(mesaAbierta(mesa)).ui());
        expect(screen.queryByLabelText("Idea inicial del grupo"), `mesa ${mesa}`).toBeNull();
        expect(screen.queryByRole("button", { name: "Guardar la idea inicial" })).toBeNull();
        expect(campo("Idea del grupo (síntesis de la conversación)")).toBeTruthy();
        expect(campo("Pregunta que el grupo quiere conservar")).toBeTruthy();
        unmount();
      }
    });

    it("en el cierre no hay formularios: la pregunta final se escribe o se elige en su propio panel", () => {
      render(montar(alCierre()).ui());
      expect(screen.getByText(/Ya pasamos por las tres mesas/)).toBeTruthy();
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    });
  });

  describe("guardar", () => {
    it.each([
      ["Idea inicial del grupo", "Guardar la idea inicial", "initialIdea", "Será por la luz"],
      ["Idea del grupo (síntesis de la conversación)", "Guardar la idea", "synthesis", "La distancia cambia el tamaño"],
      ["Pregunta que el grupo quiere conservar", "Guardar la pregunta", "question", "¿Qué pasa si movemos el objeto?"],
    ] as const)("«%s» envía un solo guardado de tipo %3$s y se limpia al aceptarlo", async (campoNombre, boton, tipo, texto) => {
      const { save, ui } = montar(mesaAbierta(0));
      render(ui());
      escribir(campoNombre, texto);
      fireEvent.click(screen.getByRole("button", { name: boton }));
      await waitFor(() => expect(campo(campoNombre).value).toBe(""));
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(tipo, texto);
    });

    it("si el servidor lo rechaza, lo escrito no se pierde", async () => {
      const { save, ui } = montar(mesaAbierta(0), { save: async () => denied("INVALID_PAYLOAD", "El texto tiene caracteres que no se pueden usar.") });
      render(ui());
      escribir("Idea inicial del grupo", "Será por la luz");
      fireEvent.click(screen.getByRole("button", { name: "Guardar la idea inicial" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await waitFor(() => expect((screen.getByRole("button", { name: "Guardar la idea inicial" }) as HTMLButtonElement).disabled).toBe(false));
      expect(campo("Idea inicial del grupo").value).toBe("Será por la luz");
    });

    it("cuenta los caracteres, no deja guardar vacío ni pasarse del máximo, y con la consola ocupada se deshabilita", () => {
      const max = config.ui.maxRecordCharacters;
      const { ui } = montar(mesaAbierta(0));
      const { unmount } = render(ui());
      const boton = () => screen.getByRole("button", { name: "Guardar la idea" }) as HTMLButtonElement;
      const nombre = "Idea del grupo (síntesis de la conversación)";
      expect(boton().disabled).toBe(true);
      escribir(nombre, "   ");
      expect(boton().disabled).toBe(true);
      escribir(nombre, "Hola");
      expect(boton().disabled).toBe(false);
      expect(screen.getAllByText(new RegExp(`^4/${max} caracteres`)).length).toBeGreaterThan(0);
      escribir(nombre, "a".repeat(max + 1));
      expect(boton().disabled).toBe(true);
      expect(screen.getByText(new RegExp(`${max + 1}/${max} caracteres`)).classList.contains("error")).toBe(true);
      unmount();
      render(montar(mesaAbierta(0), { busy: true }).ui());
      escribir(nombre, "Hola");
      expect(boton().disabled).toBe(true);
    });
  });

  describe("las notas ya guardadas", () => {
    it("cada una dice qué es y de qué mesa; las comparaciones no se corrigen", () => {
      const d = mesaAbierta(0, ["ana", "beto"]);
      guardar(d, "initialIdea", "Será por la luz");
      d.must(d.admin({ type: "round.converse" }), "conversar");
      d.must(d.admin({ type: "present.select", principalId: "ana" }), "proyectar");
      guardar(d, "synthesis", "La distancia importa");
      d.must(d.admin({ type: "round.next" }), "siguiente");
      render(montar(d).ui());
      const lista = screen.getByRole("list", { name: "Notas del grupo" });
      const filas = within(lista).getAllByRole("listitem");
      expect(filas).toHaveLength(3);
      // De la mesa anterior: se nombra la mesa en lugar de «mesa de ahora».
      for (const fila of filas) expect(fila.textContent).toContain("Sombras");
      expect(within(lista).getByText("Resultados comparados").closest("li")!.querySelector("button")).toBeNull();
      expect(within(lista).getByText("Idea inicial del grupo").closest("li")!.querySelector("button")!.textContent).toBe("Corregir");
    });

    it("las notas de la mesa abierta dicen «mesa de ahora»", () => {
      const d = mesaAbierta(0);
      guardar(d, "synthesis", "La distancia importa");
      render(montar(d).ui());
      expect(screen.getByText("· mesa de ahora")).toBeTruthy();
    });
  });

  describe("corregir una nota", () => {
    const conSintesis = () => {
      const d = mesaAbierta(0);
      guardar(d, "synthesis", "La distancia importa");
      return d;
    };

    it("abre el texto vigente y envía la corrección con la revisión que se está corrigiendo; al aceptarla cierra el formulario", async () => {
      const d = conSintesis();
      const { edit, ui } = montar(d);
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
      expect(campo("Corregir la nota").value).toBe("La distancia importa");
      escribir("Corregir la nota", "La distancia y la luz importan");
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(screen.queryByLabelText("Corregir la nota")).toBeNull());
      expect(edit).toHaveBeenCalledTimes(1);
      expect(edit).toHaveBeenCalledWith(note(d, "synthesis").id, 1, "La distancia y la luz importan");
    });

    it("«Cancelar» cierra el formulario sin enviar nada", () => {
      const { edit, ui } = montar(conSintesis());
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByLabelText("Corregir la nota")).toBeNull();
      expect(edit).not.toHaveBeenCalled();
    });

    it("si la nota cambió, avisa con role=alert, conserva lo escrito y deja volver a guardar con la revisión vigente", async () => {
      const d = conSintesis();
      const antes = adv(d);
      const id = note(d, "synthesis").id;
      d.must(d.admin({ type: "note.edit", noteId: id, expectedRevision: 1, text: OTRA }), "otra corrección");
      const despues = adv(d);
      expect(note(d, "synthesis").revision).toBe(2);

      const respuestas: CommandResult[] = [denied("REVISION_CONFLICT", "La nota cambió mientras la editabas. Revisa la versión actual."), OK];
      const { edit, ui } = montar(d, { edit: async () => respuestas.shift()! });
      const { rerender } = render(ui(antes));
      fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
      escribir("Corregir la nota", "Mi corrección");
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));

      const alerta = await screen.findByRole("alert");
      expect(alerta.textContent).toMatch(/Esta nota cambió mientras la editabas/);
      expect(alerta.textContent).toMatch(/Tu texto se conserva/);
      expect(campo("Corregir la nota").value).toBe("Mi corrección"); // no se pierde
      expect(edit).toHaveBeenLastCalledWith(id, 1, "Mi corrección");

      // Llega el estado vigente del servidor: se vuelve a guardar sobre la revisión 2.
      rerender(ui(despues));
      expect(campo("Corregir la nota").value).toBe("Mi corrección");
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(screen.queryByLabelText("Corregir la nota")).toBeNull());
      expect(edit).toHaveBeenLastCalledWith(id, 2, "Mi corrección");
      expect(edit).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("otro error del servidor no se confunde con un conflicto y tampoco pierde lo escrito", async () => {
      const { edit, ui } = montar(conSintesis(), { edit: async () => denied("INVALID_PAYLOAD", "El texto puede tener hasta 280 caracteres.") });
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
      escribir("Corregir la nota", "Mi corrección");
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(campo("Corregir la nota").value).toBe("Mi corrección");
    });

    it("las versiones anteriores de una nota corregida quedan a la vista", () => {
      const d = conSintesis();
      d.must(d.admin({ type: "note.edit", noteId: note(d, "synthesis").id, expectedRevision: 1, text: "La distancia y la luz importan" }), "corregir");
      render(montar(d).ui());
      expect(screen.getByText("corregida")).toBeTruthy();
      expect(screen.getByText("Versiones anteriores (1)")).toBeTruthy();
      expect(screen.getByText(/Versión 1:/).closest("li")!.textContent).toContain("La distancia importa");
    });

    // HALLAZGO (ver informe): la corrección se envía con la revisión MÁS RECIENTE que conoce la pantalla (`n.revision` de las props en
    // el momento de guardar), no con la que Vanessa tenía abierta. Si el estado del grupo cambia mientras el formulario está abierto,
    // se guarda encima de una versión que ella nunca vio y `REVISION_CONFLICT` no llega a dispararse.
    it("la corrección se envía con la revisión que se abrió, no con una que llegó mientras se editaba", async () => {
      const d = conSintesis();
      const antes = adv(d);
      const id = note(d, "synthesis").id;
      d.must(d.admin({ type: "note.edit", noteId: id, expectedRevision: 1, text: OTRA }), "otra corrección");
      const { edit, ui } = montar(d);
      const { rerender } = render(ui(antes));
      fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
      escribir("Corregir la nota", "Mi corrección");
      rerender(ui(adv(d))); // llega la revisión 2 mientras el formulario sigue abierto
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
      expect(edit).toHaveBeenCalledWith(id, 1, "Mi corrección");
    });

    // HALLAZGO (ver informe): «La versión vigente es: …» se fija con el texto que había al pulsar «Guardar», que por definición es el
    // anterior al conflicto. Aunque después llegue el estado nuevo, el aviso sigue mostrando la versión vieja como si fuera la vigente.
    it("el aviso de conflicto muestra la versión vigente (la que llegó), no la que se estaba corrigiendo", async () => {
      const d = conSintesis();
      const antes = adv(d);
      const id = note(d, "synthesis").id;
      d.must(d.admin({ type: "note.edit", noteId: id, expectedRevision: 1, text: OTRA }), "otra corrección");
      const { ui } = montar(d, { edit: async () => denied("REVISION_CONFLICT", "La nota cambió mientras la editabas.") });
      const { rerender } = render(ui(antes));
      fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
      escribir("Corregir la nota", "Mi corrección");
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await screen.findByRole("alert");
      rerender(ui(adv(d)));
      expect(screen.getByRole("alert").textContent).toContain(OTRA);
    });
  });
});

// ---- pregunta final ------------------------------------------------------------------------------------------------------------

describe("FinalQuestion", () => {
  type Confirmar = (value: FinalQuestionInput) => Promise<CommandResult>;
  type Corregir = (expectedRevision: number, text: string) => Promise<CommandResult>;
  const montar = (d: Driver, over: { confirm?: Confirmar; correct?: Corregir; busy?: boolean } = {}) => {
    const confirm = vi.fn<Confirmar>(over.confirm ?? (async () => OK));
    const correct = vi.fn<Corregir>(over.correct ?? (async () => OK));
    const ui = (a = adv(d)) => <FinalQuestion config={config} adv={a} busy={over.busy ?? false} confirm={confirm} correct={correct} />;
    return { confirm, correct, ui };
  };
  /** Al cierre con dos preguntas del grupo ya guardadas. */
  const conPreguntas = () => {
    const d = alCierre();
    guardar(d, "question", "¿Qué pasa si movemos el objeto?", "sombras");
    guardar(d, "question", "¿Cómo seguimos investigando con respeto?", "cajas");
    return d;
  };

  describe("antes de confirmar", () => {
    it("sin preguntas guardadas solo se puede escribir, y se recuerda la pregunta del inventor", () => {
      render(montar(alCierre()).ui());
      expect(screen.getByText(config.inventor.prompt)).toBeTruthy();
      expect((screen.getByRole("radio", { name: "Elegir una pregunta guardada" }) as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole("radio", { name: "Escribir una pregunta" }) as HTMLInputElement).checked).toBe(true);
      expect(screen.getByLabelText("Pregunta final del grupo")).toBeTruthy();
    });

    it("con preguntas guardadas ofrece elegirlas, con la primera preseleccionada", () => {
      render(montar(conPreguntas()).ui());
      expect((screen.getByRole("radio", { name: "Elegir una pregunta guardada" }) as HTMLInputElement).checked).toBe(true);
      const lista = screen.getByLabelText("Preguntas guardadas por el grupo") as HTMLSelectElement;
      expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual(["¿Qué pasa si movemos el objeto?", "¿Cómo seguimos investigando con respeto?"]);
      expect(lista.value).toBe(note(conPreguntas(), "question").id);
    });

    it("escribir una pregunta muestra un diálogo de confirmación y NO envía nada hasta confirmarlo", async () => {
      const { confirm, ui } = montar(alCierre());
      render(ui());
      fireEvent.change(screen.getByLabelText("Pregunta final del grupo"), { target: { value: "  ¿Por qué la luna cambia de forma?  " } });
      fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
      const dialogo = screen.getByRole("alertdialog", { name: "¿Esta es la pregunta final?" });
      expect(within(dialogo).getByText("¿Por qué la luna cambia de forma?")).toBeTruthy(); // se muestra tal como quedará
      expect(within(dialogo).getByText(/Quedará impresa en el inventor y la aventura terminará/)).toBeTruthy();
      expect(confirm).not.toHaveBeenCalled();

      fireEvent.click(within(dialogo).getByRole("button", { name: "Sí, imprimirla en el inventor" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(confirm).toHaveBeenCalledTimes(1);
      const [valor] = confirm.mock.calls[0]!;
      expect(valor.kind).toBe("written");
      expect((valor as { text: string }).text.trim()).toBe("¿Por qué la luna cambia de forma?");
    });

    it("cancelar el diálogo no envía nada y conserva lo escrito", () => {
      const { confirm, ui } = montar(alCierre());
      render(ui());
      fireEvent.change(screen.getByLabelText("Pregunta final del grupo"), { target: { value: "¿Por qué?" } });
      fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect((screen.getByLabelText("Pregunta final del grupo") as HTMLTextAreaElement).value).toBe("¿Por qué?");
      expect(confirm).not.toHaveBeenCalled();
    });

    it("elegir una pregunta guardada pide confirmar esa pregunta y envía su nota", async () => {
      const d = conPreguntas();
      const { confirm, ui } = montar(d);
      render(ui());
      const segunda = note(d, "question", 1);
      fireEvent.change(screen.getByLabelText("Preguntas guardadas por el grupo"), { target: { value: segunda.id } });
      fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
      const dialogo = screen.getByRole("alertdialog", { name: "¿Esta es la pregunta final?" });
      expect(within(dialogo).getByText("¿Cómo seguimos investigando con respeto?")).toBeTruthy();
      expect(confirm).not.toHaveBeenCalled();
      fireEvent.click(within(dialogo).getByRole("button", { name: "Sí, imprimirla en el inventor" }));
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm).toHaveBeenCalledWith({ kind: "saved", noteId: segunda.id });
    });

    it("se puede cambiar entre elegir y escribir antes de confirmar", () => {
      render(montar(conPreguntas()).ui());
      fireEvent.click(screen.getByRole("radio", { name: "Escribir una pregunta" }));
      expect(screen.getByLabelText("Pregunta final del grupo")).toBeTruthy();
      expect(screen.queryByLabelText("Preguntas guardadas por el grupo")).toBeNull();
      fireEvent.click(screen.getByRole("radio", { name: "Elegir una pregunta guardada" }));
      expect(screen.getByLabelText("Preguntas guardadas por el grupo")).toBeTruthy();
    });

    it("si el servidor rechaza la confirmación el diálogo sigue abierto para decidir de nuevo", async () => {
      const { confirm, ui } = montar(alCierre(), { confirm: async () => denied("INVALID_STEP", "La pregunta final se confirma en el cierre.") });
      render(ui());
      fireEvent.change(screen.getByLabelText("Pregunta final del grupo"), { target: { value: "¿Por qué?" } });
      fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
      fireEvent.click(screen.getByRole("button", { name: "Sí, imprimirla en el inventor" }));
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect((screen.getByRole("button", { name: "Sí, imprimirla en el inventor" }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByRole("alertdialog")).toBeTruthy();
    });

    it("no permite revisar una pregunta vacía y con la consola ocupada se deshabilita", () => {
      const { unmount } = render(montar(alCierre()).ui());
      expect((screen.getByRole("button", { name: "Revisar y confirmar" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Pregunta final del grupo"), { target: { value: "   " } });
      expect((screen.getByRole("button", { name: "Revisar y confirmar" }) as HTMLButtonElement).disabled).toBe(true);
      unmount();
      render(montar(conPreguntas(), { busy: true }).ui());
      expect((screen.getByRole("button", { name: "Revisar y confirmar" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("después de confirmar", () => {
    const confirmada = () => enEtapa("finished");

    it("muestra la pregunta final y ya no ofrece escribirla ni elegirla otra vez", () => {
      render(montar(confirmada()).ui());
      expect(screen.getByText("Pregunta final del grupo")).toBeTruthy();
      expect(screen.getByText("¿Por qué la luna cambia de forma?")).toBeTruthy();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByRole("button", { name: "Revisar y confirmar" })).toBeNull();
    });

    it("solo permite corregir un error de escritura, con la revisión vigente, y al aceptarlo cierra el formulario", async () => {
      const { correct, ui } = montar(confirmada());
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Corregir un error de escritura" }));
      const area = screen.getByLabelText("Corregir la pregunta final") as HTMLTextAreaElement;
      expect(area.value).toBe("¿Por qué la luna cambia de forma?");
      fireEvent.change(area, { target: { value: "¿Por qué la Luna cambia de forma?" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(screen.queryByLabelText("Corregir la pregunta final")).toBeNull());
      expect(correct).toHaveBeenCalledTimes(1);
      expect(correct).toHaveBeenCalledWith(1, "¿Por qué la Luna cambia de forma?");
    });

    it("si la corrección se rechaza, el formulario sigue abierto con lo escrito", async () => {
      const { correct, ui } = montar(confirmada(), { correct: async () => denied("REVISION_CONFLICT", "La pregunta cambió mientras la editabas.") });
      render(ui());
      fireEvent.click(screen.getByRole("button", { name: "Corregir un error de escritura" }));
      fireEvent.change(screen.getByLabelText("Corregir la pregunta final"), { target: { value: "¿Por qué la Luna cambia?" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(correct).toHaveBeenCalledTimes(1));
      expect((screen.getByLabelText("Corregir la pregunta final") as HTMLTextAreaElement).value).toBe("¿Por qué la Luna cambia?");
    });

    it("una pregunta ya corregida dice cuántas veces y muestra el texto vigente; «Cancelar» no envía", () => {
      const d = confirmada();
      d.must(d.admin({ type: "final.correct", expectedRevision: 1, text: "¿Por qué la Luna cambia de forma?" }), "corregir");
      const { correct, ui } = montar(d);
      render(ui());
      expect(screen.getByText("Se corrigió 1 vez.")).toBeTruthy();
      expect(screen.getByText("¿Por qué la Luna cambia de forma?")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Corregir un error de escritura" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByLabelText("Corregir la pregunta final")).toBeNull();
      expect(correct).not.toHaveBeenCalled();
    });

    it("al corregir otra vez usa la revisión 2", async () => {
      const d = confirmada();
      d.must(d.admin({ type: "final.correct", expectedRevision: 1, text: "¿Por qué la Luna cambia de forma?" }), "corregir");
      const { correct, ui } = montar(d);
      render(ui());
      expect(screen.getByText("Se corrigió 1 vez.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Corregir un error de escritura" }));
      fireEvent.change(screen.getByLabelText("Corregir la pregunta final"), { target: { value: "¿Por qué la Luna cambia de forma hoy?" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar la corrección" }));
      await waitFor(() => expect(correct).toHaveBeenCalledWith(2, "¿Por qué la Luna cambia de forma hoy?"));
    });
  });
});

// ---- proyección ----------------------------------------------------------------------------------------------------------------

describe("ProjectionPanel y ProjectionBadge: lo que se proyecta en cada fase", () => {
  const panel = (d: Driver) => <ProjectionPanel config={config} adv={adv(d)} />;

  it("preparación: la pregunta con la que Vanessa abre la mesa, y nada más", () => {
    const d = enEtapa("preparation");
    const { container } = render(panel(d));
    expect(screen.getByRole("heading", { name: config.activities.sombras!.openingQuestion })).toBeTruthy();
    expect(screen.getByText("Mesa 1 de 3 · Sombras")).toBeTruthy();
    expect(container.querySelector(".comparison, .projection__freire")).toBeNull();
    expect(screen.queryByText(/listos/)).toBeNull();
  });

  it("la pregunta de apertura cambia con la mesa", () => {
    const d = sala();
    d.toExploration(1);
    d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    d.must(d.admin({ type: "round.next" }), "siguiente");
    render(panel(d)); // El observatorio, en preparación
    expect(screen.getByRole("heading", { name: config.activities.cajas!.openingQuestion })).toBeTruthy();
    expect(screen.getByText("Mesa 3 de 3 · El observatorio")).toBeTruthy();
  });

  it("exploración: el panel no proyecta nada y la esquina solo dice «N de M listos»", () => {
    const d = mesaAbierta(0, ["ana"]);
    const { container } = render(
      <>
        {panel(d)}
        <ProjectionBadge config={config} adv={adv(d)} counter={{ ready: 1, total: 2 }} />
      </>,
    );
    expect(container.querySelector(".projection")).toBeNull();
    expect(container.querySelector(".projection-badge")!.textContent).toBe("Sombras · 1 de 2 listos");
    // Ni preguntas, ni resultados de nadie, ni frase de Freire.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector(".comparison, .projection__freire")).toBeNull();
  });

  it("exploración sin contador todavía dice que se está explorando; fuera de la exploración la esquina no existe", () => {
    const d = mesaAbierta(0);
    const { container, rerender } = render(<ProjectionBadge config={config} adv={adv(d)} counter={null} />);
    expect(container.querySelector(".projection-badge")!.textContent).toBe("Sombras · explorando");
    for (const etapa of ["preparation", "conversation", "closing"] as const) {
      rerender(<ProjectionBadge config={config} adv={adv(enEtapa(etapa))} counter={{ ready: 0, total: 2 }} />);
      expect(container.querySelector(".projection-badge"), etapa).toBeNull();
    }
  });

  it("conversación: la pregunta de conversación; sin resultados seleccionados ni frase de Freire", () => {
    const { container } = render(panel(enEtapa("conversation")));
    expect(screen.getByRole("heading", { name: config.activities.sombras!.conversationQuestion })).toBeTruthy();
    expect(screen.getByText("Sombras · conversemos")).toBeTruthy();
    expect(container.querySelector(".comparison")).toBeNull();
    expect(container.querySelector(".projection__freire")).toBeNull();
    expect(screen.queryByText(config.activities.sombras!.freirePhrase)).toBeNull();
  });

  it("conversación: muestra la comparación que Vanessa seleccionó, con el nombre de quien la hizo", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    d.must(d.admin({ type: "present.select", principalId: "beto" }), "proyectar");
    const { container, rerender } = render(panel(d));
    expect(screen.getByText("Resultados de Beto")).toBeTruthy();
    expect(container.querySelector(".comparison")).toBeTruthy();
    d.must(d.admin({ type: "present.clear" }), "quitar");
    rerender(panel(d));
    expect(container.querySelector(".comparison")).toBeNull();
  });

  it("conversación: la frase de Freire aparece solo cuando se muestra (freireShown)", () => {
    const d = enEtapa("conversation");
    const { container, rerender } = render(panel(d));
    expect(container.querySelector(".projection__freire")).toBeNull();
    d.must(d.admin({ type: "round.showFreire" }), "Freire");
    rerender(panel(d));
    expect(container.querySelector(".projection__freire")!.textContent).toBe(config.activities.sombras!.freirePhrase);
  });

  it("una conversación nueva en la mesa siguiente vuelve a ocultar la frase y la comparación", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    d.must(d.admin({ type: "present.select", principalId: "ana" }), "proyectar");
    d.must(d.admin({ type: "round.showFreire" }), "Freire");
    d.must(d.admin({ type: "round.next" }), "siguiente");
    d.must(d.admin({ type: "round.open" }), "abrir");
    for (const id of ["ana", "beto"]) d.readyRamps(id);
    d.must(d.admin({ type: "round.converse" }), "conversar 2");
    const { container } = render(panel(d));
    expect(screen.getByRole("heading", { name: config.activities.rampas!.conversationQuestion })).toBeTruthy();
    expect(container.querySelector(".projection__freire, .comparison")).toBeNull();
  });

  it("cierre sin pregunta final: la pregunta del inventor y sus tres piezas con su mensaje", () => {
    render(panel(alCierre()));
    expect(screen.getByText("El inventor · 3 de 3 piezas")).toBeTruthy();
    expect(screen.getByRole("heading", { name: config.inventor.prompt })).toBeTruthy();
    const piezas = screen.getByRole("list", { name: "Piezas del inventor" });
    expect(within(piezas).getAllByRole("listitem")).toHaveLength(3);
    for (const p of config.inventor.pieces) expect(within(piezas).getByText(p.message, { exact: false })).toBeTruthy();
  });

  it("cierre con la pregunta final: la proyecta y deja la reflexión de cierre", () => {
    const d = enEtapa("finished");
    render(panel(d));
    expect(screen.getByRole("heading", { name: "¿Por qué la luna cambia de forma?" })).toBeTruthy();
    expect(screen.getByText(config.inventor.finalMessage)).toBeTruthy();
    for (const r of config.inventor.reflection) expect(screen.getByText(r)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Piezas del inventor" })).toBeNull();
  });
});

// ---- comparación ----------------------------------------------------------------------------------------------------------------

describe("ComparisonView", () => {
  const de = (d: Driver, quien: string): Comparison => {
    d.must(d.admin({ type: "present.select", principalId: quien }), "proyectar");
    return note(d, "comparison").comparison!;
  };
  /** Lo que lee un lector de pantalla: el texto de la figura sin las barras (decoración, `aria-hidden`). */
  const leido = (container: HTMLElement) => container.querySelector("figure")!.textContent!.replace(/\s+/g, " ");

  it("Sombras: barras proporcionales (la mayor ocupa todo el ancho) y el mismo contenido escrito", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    const c = de(d, "ana");
    const { container } = render(<ComparisonView comparison={c} />);
    expect(screen.getByText("Resultados de Ana")).toBeTruthy();
    const filas = [...container.querySelectorAll(".comparison__rows li")];
    expect(filas).toHaveLength(2);
    expect(filas[0]!.textContent).toContain("Linterna a 20 cm");
    expect(filas[0]!.textContent).toContain(`sombra de ${formatNumber(shadowHeightCm(20, 25, 8), 1)} cm`);
    const anchos = [...container.querySelectorAll<HTMLElement>(".comparison__bar > span")].map((b) => b.style.width);
    expect(anchos[0]).toBe("100%"); // 20 cm da la sombra mayor
    expect(parseInt(anchos[1]!, 10)).toBeLessThan(100);
    // El contenido escrito está en las propias filas: no se repite en un párrafo oculto que el lector leería dos veces.
    expect(container.querySelector("p.visually-hidden")).toBeNull();
    expect(leido(container)).toContain("Linterna a 20 cm");
    expect(leido(container)).toContain(`sombra de ${formatNumber(shadowHeightCm(20, 25, 8), 1)} cm`);
  });

  it("las barras son decoración (aria-hidden): el valor siempre está escrito junto a cada una", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    const { container } = render(<ComparisonView comparison={de(d, "ana")} />);
    for (const barra of container.querySelectorAll(".comparison__bar")) expect(barra.getAttribute("aria-hidden")).toBe("true");
    for (const fila of container.querySelectorAll(".comparison__rows li")) {
      expect(fila.querySelector(".comparison__label")!.textContent).toMatch(/Linterna a \d+ cm/);
      expect(fila.querySelector(".comparison__value")!.textContent).toMatch(/sombra de .* cm/);
    }
  });

  it("Rampas: la prueba más lenta y la más rápida, con inclinación y tiempo de la simulación, y el texto equivalente", () => {
    const d = mesaAbierta(1, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    const c = de(d, "ana");
    const { container } = render(<ComparisonView comparison={c} />);
    const filas = [...container.querySelectorAll(".comparison__rows li")];
    expect(filas).toHaveLength(2);
    expect(filas[0]!.textContent).toContain("Inclinación de 20°");
    expect(filas[0]!.textContent).toContain("en la simulación");
    expect(filas[1]!.textContent).toContain("Inclinación de 40°");
    expect(container.querySelector("p.visually-hidden")).toBeNull();
    expect(leido(container)).toMatch(/Inclinación de 20°.* s en la simulación.*Inclinación de 40°.* s en la simulación/);
  });

  it("los resultados siempre están escritos (no solo dibujados), para cualquier tipo de resultado", () => {
    const d = mesaAbierta(0, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    const sombras = de(d, "beto");
    const casos: Comparison[] = [
      sombras,
      { activityId: "rampas", authorId: "x", authorName: "X", data: { type: "ramps", trials: [{ angleDeg: 15, durationMs: 3200 }] } },
    ];
    for (const c of casos) {
      const { container, unmount } = render(<ComparisonView comparison={c} />);
      expect(leido(container).length, c.data.type).toBeGreaterThan(`Resultados de ${c.authorName}`.length + 10);
      expect(container.querySelector("figure figcaption")!.textContent).toBe(`Resultados de ${c.authorName}`);
      unmount();
    }
  });

  it("una sola prueba de rampa ocupa todo el ancho, y una barra mínima nunca desaparece", () => {
    const una: Comparison = { activityId: "rampas", authorId: "x", authorName: "X", data: { type: "ramps", trials: [{ angleDeg: 15, durationMs: 4000 }] } };
    const { container, rerender } = render(<ComparisonView comparison={una} />);
    expect(container.querySelector<HTMLElement>(".comparison__bar > span")!.style.width).toBe("100%");
    rerender(<ComparisonView comparison={{ ...una, data: { type: "ramps", trials: [{ angleDeg: 15, durationMs: 4000 }, { angleDeg: 45, durationMs: 10 }] } }} />);
    expect(container.querySelectorAll<HTMLElement>(".comparison__bar > span")[1]!.style.width).toBe("8%");
  });
});

// ---- pasos de la ronda ------------------------------------------------------------------------------------------------------------

describe("RoundControls", () => {
  type Demo = { active: boolean; start: () => void; stop: () => void };
  const montar = (d: Driver, over: { counter?: { ready: number; total: number } | null; pending?: string[]; disabled?: boolean; houseDemo?: Demo } = {}) => {
    const admin = vi.fn(async () => OK as unknown);
    const ui = (dd: Driver = d, extra = over) => (
      <RoundControls
        config={config}
        adv={adv(dd)}
        counter={extra.counter === undefined ? { ready: 0, total: 2 } : extra.counter}
        pending={extra.pending ?? []}
        disabled={extra.disabled ?? false}
        admin={admin}
        houseDemo={extra.houseDemo}
      />
    );
    return { admin, ui };
  };
  const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre }) as HTMLButtonElement;

  it("preparación: solo ofrece abrir la mesa, con su nombre", () => {
    const { admin, ui } = montar(enEtapa("preparation"));
    render(ui());
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(boton("Abrir mesa: Sombras"));
    expect(admin).toHaveBeenCalledWith({ type: "round.open" });
  });

  it("exploración: el contador y «Conversemos»; sin contador muestra una raya", () => {
    const { ui } = montar(mesaAbierta(0));
    const { rerender, container } = render(ui());
    expect(container.querySelector(".round-controls__counter")!.textContent).toBe("0 de 2 listos");
    expect(container.querySelector(".round-controls__counter")!.getAttribute("role")).toBe("status");
    rerender(ui(mesaAbierta(0), { counter: null }));
    expect(container.querySelector(".round-controls__counter")!.textContent).toBe("— listos");
    expect(boton("Conversemos")).toBeTruthy();
  });

  it("exploración: avisa cuando todas las personas de la ronda están listas; Vanessa decide cuándo conversar", () => {
    const { ui } = montar(mesaAbierta(0, ["ana"]), { counter: { ready: 1, total: 2 } });
    const { rerender } = render(ui());
    expect(screen.queryByText("✓ Todas las personas están listas")).toBeNull();
    rerender(ui(mesaAbierta(0, ["ana", "beto"]), { counter: { ready: 2, total: 2 } }));
    expect(screen.getByText("✓ Todas las personas están listas")).toBeTruthy();
    rerender(ui(mesaAbierta(0), { counter: { ready: 0, total: 0 } }));
    expect(screen.queryByText("✓ Todas las personas están listas")).toBeNull(); // sin nadie en la ronda no hay nada que avisar
  });

  it("observatorio, conversación: «Mostrar la casa» y «Volver al laboratorio» manejan la demostración sin enviar nada a la sala", () => {
    const d = mesaAbierta(2, ["ana", "beto"]);
    d.must(d.admin({ type: "round.converse" }), "conversar");
    const demo = { active: false, start: vi.fn(), stop: vi.fn() };
    const { admin, ui } = montar(d, { houseDemo: demo });
    const { rerender } = render(ui());
    fireEvent.click(boton("Mostrar la casa"));
    expect(demo.start).toHaveBeenCalledTimes(1);
    rerender(ui(d, { houseDemo: { ...demo, active: true } }));
    expect(screen.queryByRole("button", { name: "Mostrar la casa" })).toBeNull();
    fireEvent.click(boton("Volver al laboratorio"));
    expect(demo.stop).toHaveBeenCalledTimes(1);
    expect(admin).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Espiar/ })).toBeNull();
  });

  it("sin demostración (otras mesas o fuera de la conversación) no aparece «Mostrar la casa»", () => {
    const { ui } = montar(enEtapa("conversation"));
    render(ui());
    expect(screen.queryByRole("button", { name: "Mostrar la casa" })).toBeNull();
  });

  it("exploración sin pendientes envía round.converse directamente, sin withPending", () => {
    const { admin, ui } = montar(mesaAbierta(0, ["ana", "beto"]), { counter: { ready: 2, total: 2 } });
    render(ui());
    fireEvent.click(boton("Conversemos"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(admin.mock.calls).toEqual([[{ type: "round.converse" }]]);
  });

  it("exploración con pendientes: el diálogo enumera sus nombres y solo al confirmar envía withPending: true", async () => {
    const { admin, ui } = montar(mesaAbierta(0, ["ana"]), { counter: { ready: 1, total: 2 }, pending: ["Beto"] });
    render(ui());
    fireEvent.click(boton("Conversemos"));
    const dialogo = screen.getByRole("alertdialog", { name: "Pasar a conversación con pendientes" });
    expect(within(dialogo).getByText(/Faltan 1 persona por terminar: Beto\./)).toBeTruthy();
    expect(within(dialogo).getByText(/las pruebas que estén en marcha se cancelan/)).toBeTruthy();
    expect(admin).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pasar a conversación con pendientes" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(admin.mock.calls).toEqual([[{ type: "round.converse", withPending: true }]]);
  });

  it("conversación: Freire y la siguiente mesa; ya mostrada Freire el botón se deshabilita y lo dice", () => {
    const d = enEtapa("conversation");
    const { ui } = montar(d);
    const { rerender } = render(ui());
    expect(boton("Mostrar la frase de Freire").disabled).toBe(false);
    expect(boton("Abrir siguiente mesa: Rampas")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conversemos" })).toBeNull();
    d.must(d.admin({ type: "round.showFreire" }), "Freire");
    rerender(ui(d));
    expect(boton("Frase de Freire mostrada").disabled).toBe(true);
  });

  it("conversación: avisa con cuántas personas pendientes se pasó a conversar, en singular y en plural", () => {
    const uno = mesaAbierta(0, ["ana"]);
    uno.must(uno.admin({ type: "round.converse", withPending: true }), "conversar");
    const a = montar(uno);
    const { unmount } = render(a.ui());
    expect(screen.getByText("Pasamos a conversar con 1 persona pendiente.")).toBeTruthy();
    unmount();
    const dos = mesaAbierta(0);
    dos.must(dos.admin({ type: "round.converse", withPending: true }), "conversar");
    render(montar(dos).ui());
    expect(screen.getByText("Pasamos a conversar con 2 personas pendientes.")).toBeTruthy();
    const todas = mesaAbierta(0, ["ana", "beto"]);
    todas.must(todas.admin({ type: "round.converse" }), "conversar");
    cleanup();
    render(montar(todas).ui());
    expect(screen.queryByText(/Pasamos a conversar con/)).toBeNull();
  });

  it("el siguiente paso lleva el nombre de la mesa que sigue; tras la última, «Pasar al inventor»", () => {
    const rampas = mesaAbierta(1, ["ana", "beto"]);
    rampas.must(rampas.admin({ type: "round.converse" }), "conversar");
    const a = montar(rampas);
    const { unmount } = render(a.ui());
    expect(boton("Abrir siguiente mesa: El observatorio")).toBeTruthy();
    unmount();
    const observatorio = mesaAbierta(2, ["ana", "beto"]);
    observatorio.must(observatorio.admin({ type: "round.converse" }), "conversar");
    const b = montar(observatorio);
    render(b.ui());
    expect(screen.queryByRole("button", { name: /siguiente mesa/ })).toBeNull();
    fireEvent.click(boton("Pasar al inventor"));
    expect(b.admin).toHaveBeenCalledWith({ type: "round.next" });
  });

  it("en el cierre ya no hay pasos de ronda", () => {
    const { ui } = montar(alCierre());
    const { container } = render(ui());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector(".round-controls")!.children).toHaveLength(0);
  });

  it("deshabilitada (sin conexión o en pausa) ningún paso se puede pulsar", () => {
    const etapas: Array<[string, Driver]> = [
      ["Abrir mesa: Sombras", enEtapa("preparation")],
      ["Conversemos", mesaAbierta(0)],
      ["Mostrar la frase de Freire", enEtapa("conversation")],
      ["Abrir siguiente mesa: Rampas", enEtapa("conversation")],
    ];
    for (const [nombre, d] of etapas) {
      const { admin, ui } = montar(d, { disabled: true });
      const { unmount } = render(ui());
      fireEvent.click(boton(nombre));
      expect(boton(nombre).disabled, nombre).toBe(true);
      expect(admin).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("mientras un paso se envía no se puede enviar dos veces", async () => {
    const d = enEtapa("preparation");
    const { admin, ui } = montar(d);
    let terminar!: () => void;
    admin.mockImplementation(() => new Promise<unknown>((resolve) => (terminar = () => resolve(OK))));
    render(ui());
    fireEvent.click(boton("Abrir mesa: Sombras"));
    fireEvent.click(boton("Abrir mesa: Sombras"));
    expect(admin).toHaveBeenCalledTimes(1);
    expect(boton("Abrir mesa: Sombras").disabled).toBe(true);
    await act(async () => terminar());
    expect(boton("Abrir mesa: Sombras").disabled).toBe(false);
  });

  it("no ofrece «Probar la mesa yo misma» en ninguna fase", () => {
    for (const etapa of ["preparation", "exploration", "conversation", "closing"] as const) {
      const { unmount } = render(montar(enEtapa(etapa)).ui());
      expect(screen.queryByRole("button", { name: /Probar la mesa|Terminar la demostración/ }), etapa).toBeNull();
      unmount();
    }
  });
});

// ---- guía --------------------------------------------------------------------------------------------------------------------------

describe("Guide", () => {
  const guion = (d: Driver) => d.room.phase;

  it("en la bienvenida muestra el guion de la bienvenida aunque ya haya una primera mesa", () => {
    const d = enEtapa("welcome");
    render(<Guide config={config} adv={adv(d)} phase={guion(d)} />);
    for (const linea of config.facilitatorNotes.bienvenida!) expect(screen.getByText(linea)).toBeTruthy();
    for (const linea of config.facilitatorNotes.sombras!) expect(screen.queryByText(linea)).toBeNull();
  });

  it("durante cada mesa muestra el guion de esa mesa", () => {
    for (const [n, id] of [[0, "sombras"], [1, "rampas"], [2, "cajas"]] as const) {
      const d = mesaAbierta(n);
      const { unmount } = render(<Guide config={config} adv={adv(d)} phase={guion(d)} />);
      for (const linea of config.facilitatorNotes[id]!) expect(screen.getByText(linea), id).toBeTruthy();
      unmount();
    }
  });

  it("en el cierre y al terminar muestra el guion del cierre", () => {
    for (const etapa of ["closing", "finished"] as const) {
      const d = enEtapa(etapa);
      const { unmount } = render(<Guide config={config} adv={adv(d)} phase={guion(d)} />);
      for (const linea of config.facilitatorNotes.cierre!) expect(screen.getByText(linea), etapa).toBeTruthy();
      unmount();
    }
  });

  it("las frases de apoyo están siempre a mano, una por momento, con su etiqueta", () => {
    const d = mesaAbierta(0);
    render(<Guide config={config} adv={adv(d)} phase={guion(d)} />);
    expect(screen.getByText("Frases de apoyo")).toBeTruthy();
    const esperadas: Array<[string, string]> = [
      ["Para empezar", config.supportPhrases.inicio!],
      ["Antes de reunir al grupo", config.supportPhrases.antesDeReunir!],
      ["Al explicar con Freire", config.supportPhrases.alExplicar!],
      ["Para cerrar", config.supportPhrases.cierre!],
    ];
    for (const [etiqueta, frase] of esperadas) {
      const termino = screen.getByText(etiqueta);
      expect(termino.tagName).toBe("DT");
      expect(termino.nextElementSibling!.textContent).toBe(frase);
    }
  });
});
