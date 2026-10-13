/** Persona-style animated menu backdrop: pure CSS/SVG, transform-only motion. */
function burstPoints(cx: number, cy: number, r1: number, r2: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (Math.PI * i) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

export function MenuBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden bg-[#0a0a0a]" aria-hidden>
      {/* drifting diagonal slashes */}
      <div className="p5-stripes absolute -inset-[140px] opacity-60" />
      {/* black overlay to keep contrast on edges */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#0a0a0a_78%)]" />
      {/* spinning starbursts */}
      <svg className="p5-spin-slow absolute -top-40 -right-40 h-[480px] w-[480px] opacity-80" viewBox="0 0 400 400">
        <polygon points={burstPoints(200, 200, 195, 120, 14)} fill="#E10600" />
        <polygon points={burstPoints(200, 200, 120, 70, 14)} fill="#0a0a0a" />
      </svg>
      <svg className="p5-spin-rev absolute -bottom-48 -left-48 h-[560px] w-[560px] opacity-70" viewBox="0 0 400 400">
        <polygon points={burstPoints(200, 200, 195, 130, 12)} fill="#fff" />
        <polygon points={burstPoints(200, 200, 110, 60, 12)} fill="#E10600" />
      </svg>
      {/* drifting halftone */}
      <div className="p5-dots absolute -inset-[140px] opacity-25" />
      {/* spotlight sweeps */}
      <div className="p5-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white to-transparent opacity-10" />
      <div
        className="p5-sweep absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-[#E10600] to-transparent opacity-25"
        style={{ animationDelay: "3.2s" }}
      />
      {/* floating verdict chips */}
      <div className="p5-float absolute top-[16%] left-[7%] hidden border-4 border-white bg-black px-4 py-2 font-display text-2xl text-white sm:block">
        YES
      </div>
      <div
        className="p5-float absolute right-[8%] bottom-[18%] hidden border-4 border-black bg-[#E10600] px-4 py-2 font-display text-2xl text-white sm:block"
        style={{ animationDelay: "1.6s" }}
      >
        NO
      </div>
      <div
        className="p5-flicker absolute top-[10%] right-[12%] hidden border-[3px] border-[#E10600] bg-black px-3 py-1 text-xs font-black tracking-[0.3em] text-[#E10600] lg:block"
      >
        TRUST NO ONE
      </div>
      {/* film grain-ish vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.75)_100%)]" />
    </div>
  );
}
