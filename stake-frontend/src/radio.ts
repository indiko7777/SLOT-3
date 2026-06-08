/* ═══════════════════════════════════════════════════
   GTA V-style radio wheel — a circular pop-up station selector.
   ═══════════════════════════════════════════════════ */

export interface RadioStation {
  id: string;
  name: string;
  tag: string;
  icon: string;
  color: string;
}

/** Wheel order is clockwise from the top. */
export const RADIO_STATIONS: RadioStation[] = [
  { id: "heat",    name: "LOS SANTOS HEAT", tag: "Lo-fi Miami groove", icon: "🌴", color: "#ff5ea8" },
  { id: "vault",   name: "VAULT FM",        tag: "Heist tension",      icon: "💰", color: "#ffd95c" },
  { id: "neon",    name: "NEON NIGHTS",     tag: "Synthwave",          icon: "🌆", color: "#36d7ff" },
  { id: "vice",    name: "VICE 95.6",       tag: "Retro synth-pop",    icon: "📼", color: "#b56bff" },
  { id: "scanner", name: "LSPD SCANNER",    tag: "Police chatter",     icon: "🚓", color: "#5cff9d" },
  { id: "off",     name: "RADIO OFF",       tag: "Silence the city",   icon: "✕",  color: "#ff5b5b" },
];

const SIZE = 340;        // svg viewport
const C = SIZE / 2;      // centre
const R_OUT = 162;
const R_IN = 74;
const GAP_DEG = 2.2;     // gap between wedges

const rad = (deg: number): number => (deg * Math.PI) / 180;
const pt = (r: number, deg: number): [number, number] => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))];

function wedgePath(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
  #radio-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;
    background:rgba(3,5,12,.66);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);
    animation:radioFade .18s ease both;font-family:Impact,'Arial Black',Arial,sans-serif;}
  #radio-overlay.closing{animation:radioFade .16s ease reverse both;}
  @keyframes radioFade{from{opacity:0}to{opacity:1}}
  .radio-wheel{position:relative;width:${SIZE}px;height:${SIZE}px;animation:radioPop .26s cubic-bezier(.2,1.4,.4,1) both;}
  @keyframes radioPop{from{opacity:0;transform:scale(.62) rotate(-8deg)}to{opacity:1;transform:scale(1) rotate(0)}}
  .radio-wheel svg{position:absolute;inset:0;overflow:visible;}
  .radio-wedge{cursor:pointer;transition:fill-opacity .12s,filter .12s;fill-opacity:.30;
    stroke:#05080f;stroke-width:2.5;}
  .radio-wedge:hover{fill-opacity:.92;filter:drop-shadow(0 0 10px currentColor);}
  .radio-wedge.sel{fill-opacity:.62;}
  .radio-icon{position:absolute;transform:translate(-50%,-50%);font-size:26px;line-height:1;
    pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.7);transition:transform .12s;}
  .radio-iconlabel{position:absolute;transform:translate(-50%,-50%);pointer-events:none;
    font-size:9px;letter-spacing:1px;color:#dfe9ff;text-shadow:0 1px 3px #000;white-space:nowrap;}
  .radio-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${R_IN * 2 - 14}px;height:${R_IN * 2 - 14}px;
    border-radius:50%;background:radial-gradient(circle at 50% 35%,#142036,#070b16);
    border:2px solid #ffd95c;box-shadow:0 0 22px rgba(255,217,92,.25),inset 0 0 18px rgba(0,0,0,.6);
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6px;}
  .radio-now{font-size:9px;letter-spacing:3px;color:#7d8ba6;margin-bottom:3px;}
  .radio-name{font-size:16px;letter-spacing:1px;color:#fff;line-height:1.05;}
  .radio-tag{font-size:9px;letter-spacing:.5px;color:#9fb4d0;margin-top:3px;}
  .radio-eq{display:flex;gap:3px;height:14px;align-items:flex-end;margin-top:7px;}
  .radio-eq i{width:3px;background:#ffd95c;border-radius:1px;animation:radioEq .8s ease-in-out infinite;}
  .radio-eq i:nth-child(2){animation-delay:.15s}.radio-eq i:nth-child(3){animation-delay:.3s}
  .radio-eq i:nth-child(4){animation-delay:.45s}.radio-eq i:nth-child(5){animation-delay:.1s}
  @keyframes radioEq{0%,100%{height:3px}50%{height:14px}}
  .radio-eq.off i{animation:none;height:3px;background:#5a6680;}
  .radio-title{position:absolute;left:50%;top:-30px;transform:translateX(-50%);color:#ffd95c;
    font-size:18px;letter-spacing:6px;text-shadow:0 0 12px rgba(255,217,92,.5);}
  .radio-hint{position:absolute;left:50%;bottom:-30px;transform:translateX(-50%);color:#6b7790;
    font-size:11px;letter-spacing:2px;white-space:nowrap;}
  `;
  document.head.appendChild(s);
}

export class RadioWheel {
  private overlay: HTMLDivElement | null = null;
  private hubName: HTMLDivElement | null = null;
  private hubTag: HTMLDivElement | null = null;
  private eq: HTMLDivElement | null = null;
  private currentId: string;

  constructor(private readonly onSelect: (id: string) => void, initialId = "heat") {
    this.currentId = initialId;
  }

  isOpen(): boolean { return this.overlay !== null; }

  toggle(): void { this.overlay ? this.close() : this.open(); }

  setCurrent(id: string): void {
    this.currentId = id;
    if (this.overlay) this.previewHub(id);
  }

  open(): void {
    if (this.overlay) return;
    injectStyle();

    const overlay = document.createElement("div");
    overlay.id = "radio-overlay";
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) this.close(); });

    const wheel = document.createElement("div");
    wheel.className = "radio-wheel";

    const title = document.createElement("div");
    title.className = "radio-title";
    title.textContent = "RADIO";
    wheel.appendChild(title);

    wheel.appendChild(this.buildSvg());

    // station icons + labels (HTML, crisp, over the wedges)
    const n = RADIO_STATIONS.length;
    const seg = 360 / n;
    RADIO_STATIONS.forEach((st, i) => {
      const center = -90 + i * seg;
      const [ix, iy] = pt((R_IN + R_OUT) / 2 + 6, center);
      const icon = document.createElement("div");
      icon.className = "radio-icon";
      icon.textContent = st.icon;
      icon.style.left = `${ix}px`;
      icon.style.top = `${iy}px`;
      wheel.appendChild(icon);

      const [lx, ly] = pt((R_IN + R_OUT) / 2 - 22, center);
      const label = document.createElement("div");
      label.className = "radio-iconlabel";
      label.textContent = st.name.split(" ")[0];
      label.style.left = `${lx}px`;
      label.style.top = `${ly}px`;
      wheel.appendChild(label);
    });

    wheel.appendChild(this.buildHub());

    const hint = document.createElement("div");
    hint.className = "radio-hint";
    hint.textContent = "PICK A STATION · ESC TO CLOSE";
    wheel.appendChild(hint);

    overlay.appendChild(wheel);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    document.addEventListener("keydown", this.onKey);
    this.previewHub(this.currentId);
  }

  close(): void {
    if (!this.overlay) return;
    document.removeEventListener("keydown", this.onKey);
    const o = this.overlay;
    this.overlay = null;
    o.classList.add("closing");
    window.setTimeout(() => o.remove(), 150);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private buildSvg(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", `${SIZE}`);
    svg.setAttribute("height", `${SIZE}`);
    svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);

    const n = RADIO_STATIONS.length;
    const seg = 360 / n;
    RADIO_STATIONS.forEach((st, i) => {
      const center = -90 + i * seg;
      const a0 = center - seg / 2 + GAP_DEG;
      const a1 = center + seg / 2 - GAP_DEG;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", wedgePath(R_IN, R_OUT, a0, a1));
      path.setAttribute("fill", st.color);
      path.setAttribute("color", st.color);
      path.setAttribute("class", "radio-wedge" + (st.id === this.currentId ? " sel" : ""));
      path.addEventListener("pointerenter", () => this.previewHub(st.id));
      path.addEventListener("pointerleave", () => this.previewHub(this.currentId));
      path.addEventListener("pointerup", () => this.pick(st.id));
      svg.appendChild(path);
    });
    return svg;
  }

  private buildHub(): HTMLDivElement {
    const hub = document.createElement("div");
    hub.className = "radio-hub";
    const now = document.createElement("div");
    now.className = "radio-now";
    now.textContent = "NOW PLAYING";
    const name = document.createElement("div");
    name.className = "radio-name";
    const tag = document.createElement("div");
    tag.className = "radio-tag";
    const eq = document.createElement("div");
    eq.className = "radio-eq";
    eq.innerHTML = "<i></i><i></i><i></i><i></i><i></i>";
    hub.append(now, name, tag, eq);
    this.hubName = name;
    this.hubTag = tag;
    this.eq = eq;
    return hub;
  }

  private previewHub(id: string): void {
    const st = RADIO_STATIONS.find((s) => s.id === id) ?? RADIO_STATIONS[0];
    if (this.hubName) { this.hubName.textContent = st.name; this.hubName.style.color = st.color; }
    if (this.hubTag) this.hubTag.textContent = st.tag;
    if (this.eq) this.eq.classList.toggle("off", id === "off");
  }

  private pick(id: string): void {
    this.currentId = id;
    this.onSelect(id);
    // reflect the new selection, then close shortly after
    this.overlay?.querySelectorAll<SVGPathElement>(".radio-wedge").forEach((w, i) => {
      w.classList.toggle("sel", RADIO_STATIONS[i].id === id);
    });
    this.previewHub(id);
    window.setTimeout(() => this.close(), 260);
  }
}
