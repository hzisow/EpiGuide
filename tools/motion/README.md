# EpiGuide guide-step animations (Remotion)

Source for the animated loops in `media/guide/`. Six compositions in the
official EpiPen instruction-card style (skin-toned hand/leg, blue safety
release, orange tip), rendered as seamless WebM (VP9) + MP4 (H.264) loops.

Regenerate:

    npm install
    npx remotion render step1-confirm out/step1-confirm.webm --codec=vp9 --crf 32
    npx remotion render step1-confirm out/step1-confirm.mp4 --crf 20
    # ...same for step2-cap, step3-thigh, step4-push, step5-hold, step6-remove

Preview interactively: `npx remotion studio`
