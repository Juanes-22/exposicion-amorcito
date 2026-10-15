import { describe, expect, it } from "vitest";
import { desiredScene } from "../game/scenes/sceneKeys";
import { config, enEtapa, mesaAbierta } from "../testing/clientState";
import { tableShowcase } from "./tableShowcase";

describe("la proyección muestra la mesa abierta mientras se explora", () => {
  const escena = (d: ReturnType<typeof enEtapa>) =>
    desiredScene({ phase: d.room.phase, group: d.room.adventure, viewer: { kind: "projection", demo: tableShowcase(d.room.adventure, config) }, characters: [] }, config.activities);

  it("cada mesa abierta se ve en su escena, en su estado inicial y sin las pruebas de nadie", () => {
    for (const [n, id, scene] of [[0, "sombras", "ShadowsScene"], [1, "rampas", "RampsScene"], [2, "cajas", "TelescopeScene"]] as const) {
      const d = mesaAbierta(n, ["ana"]);
      const p = tableShowcase(d.room.adventure, config)!;
      expect(p.view).toEqual({ kind: "activity", activityId: id });
      expect(Object.keys(p.activities)).toEqual([id]);
      expect(JSON.stringify(p.activities[id])).not.toContain("t1"); // ni siquiera las pruebas de Ana
      expect(escena(d)).toBe(scene);
    }
    expect(tableShowcase(mesaAbierta(0, ["ana"]).room.adventure, config)!.activities.sombras).toEqual({ type: "shadows", samples: [] });
  });

  it("fuera de la exploración no hay nada que mostrar: la proyección vuelve al laboratorio (o al inventor)", () => {
    for (const etapa of ["welcome", "preparation", "conversation", "closing"] as const) {
      const d = enEtapa(etapa);
      expect(tableShowcase(d.room.adventure, config), etapa).toBeNull();
      expect(escena(d), etapa).toBe("LaboratoryScene");
    }
  });
});
