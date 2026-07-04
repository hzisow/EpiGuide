import React from "react";

// EpiGuide guide-step art, in the official EpiPen instruction-card style:
// rounded gray panel, thick black line work, skin-toned hand and leg, pale
// device body, BLUE safety release, ORANGE tip. Pure SVG primitives so every
// piece can be frame-animated by the step compositions.

export const INK = "#1A1A1A";
export const RED = "#E03131";
export const BLUE = "#1C7ED6";
export const ORANGE = "#F76707";
export const BODY = "#FBF1DC";
export const SKIN = "#E8B48A"; // warm medium skin tone (single flat fill)
export const PANEL = "#F4F4F4";

export const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    viewBox="0 0 240 240"
    width="100%"
    height="100%"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x={0} y={0} width={240} height={240} fill="#fff" />
    <rect x={6} y={6} width={228} height={228} rx={26} fill={PANEL} stroke={INK} strokeWidth={6} />
    {children}
  </svg>
);

// Vertical device: pale body, white label, ORANGE tip at the bottom.
export const PenBodyV: React.FC<{ cx: number; topY: number }> = ({ cx, topY }) => (
  <g>
    <rect x={cx - 20} y={topY} width={40} height={104} rx={14} fill={BODY} stroke={INK} strokeWidth={5} />
    <rect x={cx - 9} y={topY + 14} width={18} height={42} rx={7} fill="#fff" stroke={INK} strokeWidth={3} />
    <rect x={cx - 15} y={topY + 100} width={30} height={24} rx={9} fill={ORANGE} stroke={INK} strokeWidth={5} />
  </g>
);

export const CapV: React.FC<{ cx: number; y: number; style?: React.CSSProperties }> = ({ cx, y, style }) => (
  <g style={style}>
    <rect x={cx - 13} y={y} width={26} height={24} rx={9} fill={BLUE} stroke={INK} strokeWidth={5} />
  </g>
);

// Horizontal device pointing right; ORANGE tip ends at tipX.
export const PenH: React.FC<{ tipX: number; cy: number }> = ({ tipX, cy }) => (
  <g>
    <rect x={tipX - 142} y={cy - 13} width={22} height={26} rx={9} fill={BLUE} stroke={INK} strokeWidth={5} />
    <rect x={tipX - 120} y={cy - 18} width={100} height={36} rx={14} fill={BODY} stroke={INK} strokeWidth={5} />
    <rect x={tipX - 104} y={cy - 8} width={42} height={16} rx={6} fill="#fff" stroke={INK} strokeWidth={3} />
    <rect x={tipX - 20} y={cy - 14} width={20} height={28} rx={8} fill={ORANGE} stroke={INK} strokeWidth={5} />
  </g>
);

// Fist wrapped around the vertical pen at cy: wrist, palm, four finger bumps.
export const FistV: React.FC<{ cx: number; cy: number }> = ({ cx, cy }) => (
  <g>
    <rect x={cx + 4} y={cy + 26} width={42} height={44} rx={16} fill={SKIN} stroke={INK} strokeWidth={5} />
    <rect x={cx - 34} y={cy - 34} width={66} height={66} rx={24} fill={SKIN} stroke={INK} strokeWidth={5} />
    {[-27, -12, 3, 18].map((dy) => (
      <rect key={dy} x={cx - 30} y={cy + dy} width={56} height={13} rx={6.5} fill={SKIN} stroke={INK} strokeWidth={4} />
    ))}
  </g>
);

// Hand gripping the horizontal pen from above: palm, four fingers, thumb.
export const HandH: React.FC<{ tipX: number; cy: number }> = ({ tipX, cy }) => {
  const px = tipX - 106;
  return (
    <g>
      <rect x={px - 2} y={cy - 68} width={72} height={52} rx={24} fill={SKIN} stroke={INK} strokeWidth={5} />
      {[0, 16, 32, 48].map((dx) => (
        <rect key={dx} x={px + 4 + dx} y={cy - 30} width={13} height={48} rx={6.5} fill={SKIN} stroke={INK} strokeWidth={4} />
      ))}
      <rect x={px - 14} y={cy - 14} width={52} height={15} rx={7.5} fill={SKIN} stroke={INK} strokeWidth={4} />
    </g>
  );
};

// Outer mid-thigh: tall rounded column on the right.
export const Leg: React.FC = () => (
  <rect x={168} y={16} width={58} height={208} rx={29} fill={SKIN} stroke={INK} strokeWidth={6} />
);

export const ArrowUp: React.FC<{ x: number; y1: number; y2: number; style?: React.CSSProperties }> = ({ x, y1, y2, style }) => (
  <g style={style} stroke={INK} strokeWidth={7} fill="none">
    <path d={`M${x} ${y1}V${y2}`} />
    <path d={`M${x - 9} ${y2 + 11}L${x} ${y2}l9 11`} />
  </g>
);

export const ArrowRight: React.FC<{ x1: number; x2: number; y: number; style?: React.CSSProperties }> = ({ x1, x2, y, style }) => (
  <g style={style} stroke={INK} strokeWidth={7} fill="none">
    <path d={`M${x1} ${y}H${x2}`} />
    <path d={`M${x2 - 11} ${y - 9}L${x2} ${y}l-11 9`} />
  </g>
);
