import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  ArrowRight, ArrowUp, CapV, FistV, HandH, INK, Leg, PenBodyV, PenH, RED, Scene,
} from "./art";

// Six seamless loops (each ends on its starting pose). 30 fps.
// Easing choices per the Remotion skill: bezier(0.16,1,0.3,1) for entrances,
// Easing.in(cubic) for the jab, linear only for the clock.

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const pop = Easing.bezier(0.34, 1.56, 0.64, 1);
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

// 1 — Confirm and grab it (60f): grip squeeze + confirm check pop.
export const Step1Confirm: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Scene>
        <g
          style={{
            scale: String(interpolate(frame, [0, 30, 60], [1, 0.982, 1], { ...clamp, easing: Easing.inOut(Easing.sin) })),
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
        >
          <CapV cx={104} y={30} />
          <PenBodyV cx={104} topY={54} />
          <FistV cx={104} cy={106} />
        </g>
        <g
          style={{
            scale: String(interpolate(frame, [6, 16], [0, 1], { ...clamp, easing: pop })),
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
        >
          <circle cx={182} cy={174} r={26} fill="#fff" stroke={RED} strokeWidth={6} />
          <path d="M170 174l9 9 16-18" stroke={RED} strokeWidth={7} fill="none" />
        </g>
      </Scene>
    </AbsoluteFill>
  );
};

// 2 — Pull off the blue cap (72f): cap slides up, fades, resets; arrow cycles.
export const Step2Cap: React.FC = () => {
  const frame = useCurrentFrame();
  const capUp = frame < 50 ? interpolate(frame, [6, 32], [0, -16], { ...clamp, easing: easeOut }) : 0;
  const capOpacity = interpolate(frame, [0, 40, 48, 56, 62, 72], [1, 1, 0, 0, 1, 1], clamp);
  const arrowOpacity = interpolate(frame, [4, 12, 36, 44], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill>
      <Scene>
        <PenBodyV cx={110} topY={66} />
        <FistV cx={110} cy={118} />
        <CapV cx={110} y={40} style={{ translate: `0px ${capUp}px`, opacity: capOpacity }} />
        <ArrowUp x={158} y1={86} y2={46} style={{ opacity: arrowOpacity }} />
      </Scene>
    </AbsoluteFill>
  );
};

// 3 — Place against outer thigh (78f): hand slides the orange end to the leg,
// rests, then eases back for a seamless loop.
export const Step3Thigh: React.FC = () => {
  const frame = useCurrentFrame();
  const inX = interpolate(frame, [0, 27], [-28, 0], { ...clamp, easing: easeOut });
  const outX = interpolate(frame, [62, 77], [0, -28], { ...clamp, easing: Easing.in(Easing.cubic) });
  const tx = frame < 64 ? inX : outX;
  return (
    <AbsoluteFill>
      <Scene>
        <Leg />
        <g style={{ translate: `${tx}px 0px` }}>
          <PenH tipX={168} cy={126} />
          <HandH tipX={168} cy={126} />
        </g>
      </Scene>
    </AbsoluteFill>
  );
};

// 4 — Push firmly until it clicks (54f): sharp jab, click burst, push arrow.
export const Step4Push: React.FC = () => {
  const frame = useCurrentFrame();
  const jabIn = interpolate(frame, [14, 19], [-6, 4], { ...clamp, easing: Easing.in(Easing.cubic) });
  const jabOut = interpolate(frame, [32, 46], [4, -6], { ...clamp, easing: easeOut });
  const tx = frame < 32 ? jabIn : jabOut;
  const burstOpacity = interpolate(frame, [16, 19, 30, 40], [0, 1, 1, 0], clamp);
  const burstScale = interpolate(frame, [16, 26], [0.6, 1.1], { ...clamp, easing: easeOut });
  const arrowOpacity = interpolate(frame, [2, 9, 24, 32], [0, 1, 1, 0], clamp);
  const arrowX = interpolate(frame, [2, 20], [-8, 2], { ...clamp, easing: easeOut });
  return (
    <AbsoluteFill>
      <Scene>
        <Leg />
        <ArrowRight x1={22} x2={52} y={126} style={{ opacity: arrowOpacity, translate: `${arrowX}px 0px` }} />
        <g style={{ translate: `${tx}px 0px` }}>
          <PenH tipX={172} cy={126} />
          <HandH tipX={172} cy={126} />
        </g>
        <g
          style={{
            opacity: burstOpacity,
            scale: String(burstScale),
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
          stroke={RED}
          strokeWidth={6}
          fill="none"
        >
          <path d="M180 98l9-12M192 126h15M180 154l9 12" />
        </g>
      </Scene>
    </AbsoluteFill>
  );
};

// 5 — Hold for 3 seconds (90f): everything still; the red clock hand sweeps
// exactly one turn. The stillness is the message.
export const Step5Hold: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Scene>
        <Leg />
        <PenH tipX={168} cy={150} />
        <HandH tipX={168} cy={150} />
        <circle cx={56} cy={52} r={26} fill="#fff" stroke={INK} strokeWidth={6} />
        <g
          style={{
            rotate: `${interpolate(frame, [0, 90], [0, 360])}deg`,
            transformBox: "view-box",
            transformOrigin: "56px 52px",
          }}
        >
          <path d="M56 52V36" stroke={RED} strokeWidth={6} />
        </g>
        <circle cx={56} cy={52} r={4} fill={RED} />
      </Scene>
    </AbsoluteFill>
  );
};

// 6 — Remove, then call 911 (78f): device lifts away and returns; phone rings.
export const Step6Remove: React.FC = () => {
  const frame = useCurrentFrame();
  const liftIn = interpolate(frame, [6, 28], [0, 1], { ...clamp, easing: easeOut });
  const liftOut = interpolate(frame, [56, 74], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const t = liftIn - liftOut;
  const ring = interpolate(frame, [30, 34, 38, 42, 46, 50], [0, -3, 3, -2, 1, 0], clamp);
  return (
    <AbsoluteFill>
      <Scene>
        <g
          style={{
            translate: `${t * -8}px ${t * -14}px`,
            rotate: `${t * -6}deg`,
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
        >
          <g transform="rotate(-18 78 120)">
            <PenBodyV cx={78} topY={50} />
            <FistV cx={78} cy={102} />
          </g>
        </g>
        <path d="M104 62c10-10 22-13 34-9" stroke={RED} strokeWidth={6} strokeDasharray="2 11" />
        <g
          style={{ rotate: `${ring}deg`, transformBox: "fill-box", transformOrigin: "center" }}
        >
          <rect x={152} y={62} width={66} height={116} rx={18} fill="#fff" stroke={INK} strokeWidth={6} />
          <path
            d="M174 94c-2 0-4 2-4 4 0 14 11 25 25 25 2 0 4-2 4-4v-6c0-2-1-3-3-3-2 0-4 0-6-1-1 0-2 0-3 1l-3 3c-5-3-8-6-11-11l3-3c1-1 1-2 1-3-1-2-1-4-1-6 0-2-1-3-3-3h-6Z"
            fill={RED}
          />
          <text
            x={185}
            y={158}
            textAnchor="middle"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            fontSize={28}
            fontWeight={700}
            fill={INK}
          >
            911
          </text>
        </g>
      </Scene>
    </AbsoluteFill>
  );
};
