/** Icono sencillo de cada pieza colectiva. Siempre va con su nombre en texto: el dibujo no es lo único que la identifica. */
export function PieceIcon({ id, size = 36, collected = true }: { id: string; size?: number; collected?: boolean }) {
  const stroke = "#5e3b1f";
  const fill = collected ? { lupa: "#9fd3f2", dialogo: "#fff3c4", corazon: "#e5646b" }[id] ?? "#cfc3a8" : "none";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" opacity={collected ? 1 : 0.55}>
      {id === "lupa" ? (
        <>
          <circle cx="20" cy="20" r="13" fill={fill} stroke={stroke} strokeWidth="3" strokeDasharray={collected ? undefined : "4 3"} />
          <line x1="30" y1="30" x2="43" y2="43" stroke={stroke} strokeWidth="5" strokeLinecap="round" />
        </>
      ) : id === "dialogo" ? (
        <path d="M6 9h36a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H22l-9 8v-8H6a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeDasharray={collected ? undefined : "4 3"} />
      ) : id === "corazon" ? (
        <path d="M24 42S5 30 5 17a10 10 0 0 1 19-4 10 10 0 0 1 19 4c0 13-19 25-19 25z" fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeDasharray={collected ? undefined : "4 3"} />
      ) : (
        <circle cx="24" cy="24" r="16" fill={fill} stroke={stroke} strokeWidth="3" strokeDasharray={collected ? undefined : "4 3"} />
      )}
    </svg>
  );
}
