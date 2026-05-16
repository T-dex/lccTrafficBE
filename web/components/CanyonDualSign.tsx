"use client";

import type { CanyonEstimate } from "@/lib/types";
import type { SignVisualState } from "@/lib/fullTripUtils";

function lineClass(base: string, opts: { hero?: boolean; sub?: boolean }) {
  return [base, opts.hero && "sign-line--hero", opts.sub && "sign-line--sub"].filter(Boolean).join(" ");
}

export function CanyonDualSign({
  prefix,
  state,
  line1,
  line2,
  line3,
}: {
  prefix: "lcc";
  state: SignVisualState;
  line1: string;
  line2: string;
  line3: string;
}) {
  return (
    <div className="road-sign road-sign--dual" data-state={state}>
      <div className="sign-bezel">
        <div className="sign-face">
          <div className={lineClass(`sign-line ${prefix}-l1`, {})}>{line1}</div>
          <div className={lineClass(`sign-line ${prefix}-l2`, { hero: true })}>{line2}</div>
          <div className={lineClass(`sign-line ${prefix}-l3`, { sub: true })}>{line3}</div>
        </div>
      </div>
    </div>
  );
}

export function homeMinutesLines(data: CanyonEstimate | undefined, name: string): [string, string, string] {
  if (!data?.segments) return [name, "— —", "UNAVAILABLE"];
  const mins = Math.round(data.minutes_to_top ?? 0);
  const udot = data.segments.udot_top_min;
  const sub = udot != null ? `CANYON TOP · UDOT ${udot} MIN` : "CANYON TOP";
  return [name, `${mins} MIN`, sub];
}
