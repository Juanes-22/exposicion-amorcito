import type { ConnectionStatus } from "../../app/RoomController";

const TEXT: Record<string, { title: string; body: string }> = {
  closed: { title: "La aventura terminó", body: "Gracias por participar. Esta sala ya no admite más acciones." },
  expired: { title: "La sala venció", body: "Pasó mucho tiempo sin actividad y la sala ya no está disponible." },
  replaced: { title: "Esta pestaña quedó desactivada", body: "Abriste la sala en otra pestaña o ventana. Sigue desde allí." },
  unauthorized: { title: "Tu acceso ya no es válido", body: "Vuelve a entrar a la sala con su código." },
};

/** Estado terminal: sin controles ni reconexión indefinida (SPECS 2.1). */
export function TerminalView({ reason, onHome }: { reason: ConnectionStatus | "closed" | "expired"; onHome: () => void }) {
  const t = TEXT[reason] ?? TEXT.closed!;
  return (
    <main className="screen screen--center">
      <div className="card stack" role="status">
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        <button type="button" className="btn" onClick={onHome}>Ir al inicio</button>
      </div>
    </main>
  );
}
