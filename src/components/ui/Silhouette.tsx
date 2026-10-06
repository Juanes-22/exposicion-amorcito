import { PARTICIPANT_COLORS } from "../../../shared/contracts/limits";

export const colorHex = (id: string | null): string => PARTICIPANT_COLORS.find((c) => c.id === id)?.hex ?? "#8b7b66";
export const colorLabel = (id: string | null): string => PARTICIPANT_COLORS.find((c) => c.id === id)?.label ?? "Sin color";

/** Una misma silueta simple coloreable para todas las personas del público; no hay retratos ni fotos (SPECS 10.3). */
export function Silhouette({ color, size = 56, title }: { color: string | null; size?: number; title?: string }) {
  return (
    <svg className="silhouette" width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle cx="32" cy="32" r="31" fill="var(--paper)" stroke="var(--wood)" strokeWidth="2" />
      <circle cx="32" cy="24" r="10" fill={colorHex(color)} />
      <path d="M12 54c2-12 10-18 20-18s18 6 20 18a31 31 0 0 1-40 0z" fill={colorHex(color)} />
    </svg>
  );
}
