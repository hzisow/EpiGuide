import "./index.css";
import { Composition } from "remotion";
import {
  Step1Confirm, Step2Cap, Step3Thigh, Step4Push, Step5Hold, Step6Remove,
} from "./steps";

// Six seamless instructional loops, 480x480 @ 30fps. Durations match each
// scene's loop cycle (step 5 is exactly 3s — it paces the real 3s hold).
const SIZE = 480;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="step1-confirm" component={Step1Confirm} durationInFrames={60} fps={FPS} width={SIZE} height={SIZE} />
      <Composition id="step2-cap" component={Step2Cap} durationInFrames={72} fps={FPS} width={SIZE} height={SIZE} />
      <Composition id="step3-thigh" component={Step3Thigh} durationInFrames={78} fps={FPS} width={SIZE} height={SIZE} />
      <Composition id="step4-push" component={Step4Push} durationInFrames={54} fps={FPS} width={SIZE} height={SIZE} />
      <Composition id="step5-hold" component={Step5Hold} durationInFrames={90} fps={FPS} width={SIZE} height={SIZE} />
      <Composition id="step6-remove" component={Step6Remove} durationInFrames={78} fps={FPS} width={SIZE} height={SIZE} />
    </>
  );
};
