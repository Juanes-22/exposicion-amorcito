import type { CommandResult } from "../../shared/contracts/actions";
import { INVENTOR_ID } from "../../shared/contracts/config";
import type { Point } from "../../shared/contracts/geometry";
import { allRouteCompleted, playerAt, unlockedActivityIds } from "../../shared/domain/adventure";
import { planDurationMs } from "../../shared/domain/movement";
import type { ProjectBundle } from "../../shared/config/validateProject";
import type { GameBridge } from "../game/bridge/GameBridge";
import type { RoomController } from "./RoomController";

type Controller = Pick<RoomController, "adventure" | "getState" | "notify">;

/** Lo mínimo del proyecto cargado que necesita el enrutador (`LoadedProject` lo cumple). */
export interface ProjectLike {
  bundle: Pick<ProjectBundle, "config" | "map">;
}

export interface IntentRouterOptions {
  bridge: GameBridge;
  controller: Controller;
  project: ProjectLike;
  /** Cada cuánto se comprueba la llegada para abrir la mesa (ms). */
  pollMs?: number;
}

/** Punto de interacción y radio de una mesa o del inventor, tomados del mismo TMJ que usa el servidor. */
export function stationTarget(project: ProjectLike, stationId: string): { point: Point; radius: number } | null {
  const { map } = project.bundle;
  if (stationId === INVENTOR_ID) return map.inventor ? { point: map.inventor.point, radius: map.inventor.interactionRadius } : null;
  const s = map.stations.find((x) => x.activityId === stationId);
  return s ? { point: s.point, radius: s.interactionRadius } : null;
}

/**
 * Traduce las intenciones del mapa en comandos (SPECS 7.2: la escena emite intenciones, la aplicación decide). Permisos y orden
 * del recorrido se comprueban aquí para dar una respuesta inmediata y comprensible, pero la autoridad es siempre el servidor.
 * Devuelve la función que detiene el enrutador y cancela lo pendiente.
 */
export function startIntentRouter({ bridge, controller, project, pollMs = 60 }: IntentRouterOptions): () => void {
  const { config } = project.bundle;
  let seq = 0;
  let pendingOpen: { id: number; timer: ReturnType<typeof setInterval> } | null = null;

  const cancelPendingOpen = () => {
    if (pendingOpen) clearInterval(pendingOpen.timer);
    pendingOpen = null;
  };
  const resolve = (requestId: string, accepted: boolean, reason?: string) => bridge.emit("app:request-result", { requestId, accepted, ...(reason ? { reason } : {}) });
  const deny = (requestId: string, reason: string) => {
    resolve(requestId, false, reason);
    controller.notify("info", reason);
  };
  const outcome = (requestId: string, r: CommandResult) => resolve(requestId, r.ok, r.ok ? undefined : r.message);

  const off = bridge.on("game:action-request", async ({ intent, requestId, token }) => {
    if (!bridge.isActive(token)) return;
    const perms = bridge.permissions;
    // Cualquier toque nuevo reemplaza al anterior: un destino viejo no debe terminar abriendo una mesa.
    cancelPendingOpen();
    if (!perms?.canAct) return deny(requestId, perms?.reason ?? "No tienes el control en este momento.");
    const snap = controller.getState().snapshot?.state;
    if (!snap) return deny(requestId, "Todavía se está cargando la aventura.");
    const adv = snap.adventure;

    if (intent.type === "move") return outcome(requestId, await controller.adventure({ type: "player.moveTo", target: intent.target }));

    // Tocar una mesa: pedir acercarse y abrirla. El orden del recorrido se respeta antes de caminar hacia una mesa bloqueada.
    const target = stationTarget(project, intent.stationId);
    if (!target) return deny(requestId, "Esa mesa no está en el mapa.");
    const unlocked = intent.stationId === INVENTOR_ID ? allRouteCompleted(adv, config) : unlockedActivityIds(adv, config).includes(intent.stationId);
    if (!unlocked) return deny(requestId, intent.stationId === INVENTOR_ID ? "Primero hay que completar las tres mesas." : "Primero hay que completar la mesa anterior.");
    if (adv.view.kind !== "map") return deny(requestId, "Vuelve al mapa para abrir otra mesa.");

    const open = async () => controller.adventure({ type: "station.open", stationId: intent.stationId, origin: "map" });
    const here = playerAt(adv, bridge.clock.now()).feet;
    if (Math.hypot(here.x - target.point.x, here.y - target.point.y) <= target.radius) return outcome(requestId, await open());

    const walk = await controller.adventure({ type: "player.moveTo", target: target.point });
    outcome(requestId, walk);
    if (!walk.ok) return;
    // Esperar la llegada según el RELOJ DE SIMULACIÓN (que se detiene en la pausa), no según un temporizador del dispositivo.
    const id = ++seq;
    const timer = setInterval(() => {
      if (!pendingOpen || pendingOpen.id !== id) return clearInterval(timer);
      const st = controller.getState().snapshot?.state;
      if (!bridge.permissions?.canAct || !st || st.adventure.view.kind !== "map") return cancelPendingOpen(); // perdió el turno o cambió de vista
      const plan = st.adventure.player.plan;
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
