import type { CommandResult } from "../../shared/contracts/actions";
import type { Point } from "../../shared/contracts/geometry";
import { planDurationMs } from "../../shared/domain/movement";
import { playerAt } from "../../shared/domain/participant";
import type { ProjectBundle } from "../../shared/config/validateProject";
import type { GameBridge } from "../game/bridge/GameBridge";
import type { RoomPort } from "./RoomController";
import { currentActivity } from "./view";

type Port = Pick<RoomPort, "act" | "getState" | "notify">;

/** Lo mínimo del proyecto cargado que necesita el enrutador (`LoadedProject` lo cumple). */
export interface ProjectLike {
  bundle: Pick<ProjectBundle, "config" | "map">;
}

export interface IntentRouterOptions {
  bridge: GameBridge;
  port: Port;
  project: ProjectLike;
  /** Cada cuánto se comprueba la llegada para abrir la mesa (ms). */
  pollMs?: number;
}

/** Punto de interacción y radio de una mesa, tomados del mismo TMJ que usa el servidor. */
export function stationTarget(project: ProjectLike, stationId: string): { point: Point; radius: number } | null {
  const s = project.bundle.map.stations.find((x) => x.activityId === stationId);
  return s ? { point: s.point, radius: s.interactionRadius } : null;
}

/**
 * Traduce las intenciones del mapa en acciones personales (SPECS 7.2: la escena emite intenciones, la aplicación decide). Permisos y
 * mesa habilitada se comprueban aquí para dar una respuesta inmediata y comprensible, pero la autoridad es siempre el servidor.
 * Devuelve la función que detiene el enrutador y cancela lo pendiente.
 */
export function startIntentRouter({ bridge, port, project, pollMs = 60 }: IntentRouterOptions): () => void {
  const { config } = project.bundle;
  let seq = 0;
  /** Cada toque lleva su número: si mientras espera el acknowledgment llega otro, el viejo ya no puede abrir nada. */
  let latestTap = 0;
  let pendingOpen: { id: number; timer: ReturnType<typeof setInterval> } | null = null;

  const cancelPendingOpen = () => {
    if (pendingOpen) clearInterval(pendingOpen.timer);
    pendingOpen = null;
  };
  const resolve = (requestId: string, accepted: boolean, reason?: string) => bridge.emit("app:request-result", { requestId, accepted, ...(reason ? { reason } : {}) });
  const deny = (requestId: string, reason: string) => {
    resolve(requestId, false, reason);
    port.notify("info", reason);
  };
  const outcome = (requestId: string, r: CommandResult) => resolve(requestId, r.ok, r.ok ? undefined : r.message);

  const off = bridge.on("game:action-request", async ({ intent, requestId, token }) => {
    if (!bridge.isActive(token)) return;
    const perms = bridge.permissions;
    // Cualquier toque nuevo reemplaza al anterior: un destino viejo no debe terminar abriendo una mesa, ni siquiera si su
    // acknowledgment llega después de que la persona ya tocó otro punto.
    const tap = ++latestTap;
    cancelPendingOpen();
    if (!perms?.canMove) return deny(requestId, perms?.reason ?? "Ahora no puedes mover a tu personaje.");
    const st = port.getState();
    const me = st.me?.participant;
    const adv = st.group?.adventure;
    if (!me || !adv) return deny(requestId, "Todavía se está cargando la aventura.");

    if (intent.type === "move") return outcome(requestId, await port.act({ type: "player.moveTo", target: intent.target }));

    // Tocar una mesa: solo la habilitada. Se pide acercarse y abrirla.
    const current = currentActivity(adv, config);
    const target = stationTarget(project, intent.stationId);
    if (!target) return deny(requestId, "Esa mesa no está en el mapa.");
    if (!current || intent.stationId !== current.id) {
      if (!current) return deny(requestId, "La aventura ya pasó por las tres mesas.");
      return deny(requestId, config.route.indexOf(intent.stationId) < adv.round.index ? "Esa mesa ya terminó." : "Esa mesa se habilitará más adelante.");
    }
    if (!perms.canExplore) return deny(requestId, perms.reason ?? "Vanessa abrirá la mesa en un momento.");
    if (me.view.kind !== "map") return deny(requestId, "Ya estás en la mesa. Vuelve al mapa para salir de ella.");

    const open = async () => port.act({ type: "station.open", stationId: intent.stationId, origin: "map" });
    const here = playerAt(me.character, bridge.clock.now()).feet;
    if (Math.hypot(here.x - target.point.x, here.y - target.point.y) <= target.radius) return outcome(requestId, await open());

    const walk = await port.act({ type: "player.moveTo", target: target.point });
    outcome(requestId, walk);
    if (!walk.ok || tap !== latestTap) return;
    // Esperar la llegada según el RELOJ DE SIMULACIÓN (que se detiene en la pausa), no según un temporizador del dispositivo.
    const id = ++seq;
    const timer = setInterval(() => {
      if (!pendingOpen || pendingOpen.id !== id) return clearInterval(timer);
      const cur = port.getState().me?.participant;
      if (!bridge.permissions?.canExplore || !cur || cur.view.kind !== "map") return cancelPendingOpen(); // cambió la fase o la vista
      const plan = cur.character.plan;
      if (plan && bridge.clock.now() < plan.startActiveMs + planDurationMs(plan)) return; // sigue caminando (o en pausa)
      cancelPendingOpen();
      void open();
    }, pollMs);
    pendingOpen = { id, timer };
  });

  return () => {
    off();
    cancelPendingOpen();
  };
}
