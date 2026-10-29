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
  { id: "heat",      name: "COASTAL HEAT",    tag: "Lo-fi Miami groove", icon: "🌴", color: "#ff5ea8" },
  { id: "groovy",    name: "GROOVY FM",       tag: "Feel-good grooves",  icon: "💰", color: "#ffd95c" },
  { id: "neon",      name: "NEON NIGHTS",     tag: "Synthwave",          icon: "🌆", color: "#36d7ff" },
  { id: "vice",      name: "VICE 95.6",       tag: "Retro synth-pop",    icon: "📼", color: "#b56bff" },
  { id: "open_live", name: "OPEN LIVE",       tag: "Late-night podcast", icon: "🎙️", color: "#5cff9d" },
  { id: "off",       name: "RADIO OFF",       tag: "Silence the city",   icon: "✕",  color: "#ff5b5b" },
];

const MAX_R = 180;       // Wheel radius on a roomy screen
const MAX_BTN = 72;      // Station button diameter on a roomy screen
const MIN_BTN = 46;      // Smallest still comfortably tappable button
const PAD = 10;          // Gap kept between the wheel and the screen edge

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Wheel geometry for the current viewport. The wheel used to be a fixed
 *  500px square, which spilled off Engine's Popout S (400x225) and phone
 *  portrait sizes. It now fits any screen: a circle where there is room, an
 *  ellipse on short landscape frames, buttons and type scaled to match. */
interface WheelGeom { w: number; h: number; rx: number; ry: number; btn: number; hubW: number; hubFont: number; tagFont: number; }
export function wheelGeometry(vw: number, vh: number): WheelGeom {
  const btn = Math.round(Math.max(MIN_BTN, Math.min(MAX_BTN, Math.min(vw, vh) * 0.15)));
  // Half the selected (scaled 1.25x) button plus its glow.
  const edge = (btn * 1.25) / 2 + 4;
  let rx = Math.min(MAX_R, vw / 2 - edge - PAD);
  let ry = Math.min(MAX_R, vh / 2 - edge - PAD);
  if (ry > rx) ry = rx;                       // portrait: stay a circle
  rx = Math.max(btn, Math.min(rx, ry * 1.8)); // landscape: a gentle ellipse only
  ry = Math.max(btn * 0.75, ry);
  const w = Math.ceil(2 * (rx + edge));
  const h = Math.ceil(2 * (ry + edge));
  const hubW = Math.max(120, Math.min(300, 2 * (rx - btn / 2 - 8)));
  const compact = Math.min(vw, vh) < 420;
  return { w, h, rx, ry, btn, hubW, hubFont: compact ? 16 : 22, tagFont: compact ? 12 : 16 };
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
  #radio-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;
    background:rgba(22,32,22,.85);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
    animation:radioFade .18s ease both;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  #radio-overlay.closing{animation:radioFade .16s ease reverse both;}
  @keyframes radioFade{from{opacity:0}to{opacity:1}}
  .radio-wheel{--btn:72px;position:relative;flex:none;animation:radioPop .26s cubic-bezier(.2,1.4,.4,1) both;}
  @keyframes radioPop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
  
  .station-btn{position:absolute;width:var(--btn);height:var(--btn);margin-left:calc(var(--btn) / -2);margin-top:calc(var(--btn) / -2);
    border-radius:50%;border:2px solid #fff;background:#000;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    cursor:pointer;transition:all .12s ease-out;color:#fff;opacity:0.45;}
  .station-btn:hover{opacity:0.8;}
  .station-btn.sel{border:3px solid #9ae64e;box-shadow:0 0 15px rgba(154,230,78,.3);
    color:#fff;transform:scale(1.25);background:#000;z-index:10;opacity:1;}
  
  .station-icon{font-size:calc(var(--btn) * .36);line-height:1;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.7);}
  .station-label{font-size:max(7px, calc(var(--btn) * .118));letter-spacing:.5px;margin-top:2px;text-align:center;
    pointer-events:none;font-weight:bold;text-transform:uppercase;line-height:1.1;padding:0 4px;}
  
  .radio-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    width:300px;max-width:100%;text-align:center;display:flex;flex-direction:column;align-items:center;
    justify-content:center;text-shadow:0 2px 4px rgba(0,0,0,.8);}
  
  .radio-name{font-size:22px;white-space:nowrap;color:#fff;margin-bottom:6px;letter-spacing:1px;font-weight:bold;}
  .radio-tag{font-size:16px;color:#e0e0e0;margin-bottom:6px;}
  
  .radio-eq{display:flex;gap:3px;height:14px;align-items:flex-end;margin-top:4px;}
  .radio-eq i{width:3px;background:#9ae64e;border-radius:1px;animation:radioEq .8s ease-in-out infinite;}
  .radio-eq i:nth-child(2){animation-delay:.15s}.radio-eq i:nth-child(3){animation-delay:.3s}
  .radio-eq i:nth-child(4){animation-delay:.45s}.radio-eq i:nth-child(5){animation-delay:.1s}
  @keyframes radioEq{0%,100%{height:3px}50%{height:14px}}
  .radio-eq.off i{animation:none;height:3px;background:#5a6680;}
  .radio-close-btn{position:absolute;top:max(8px, min(20px, 3vh));right:max(8px, min(20px, 3vw));background:rgba(0,0,0,0.6);
    border:1px solid rgba(255,255,255,0.3);border-radius:8px;color:#fff;
    font-size:13px;font-weight:700;padding:6px 12px;cursor:pointer;
    display:flex;align-items:center;gap:6px;transition:all .15s ease;z-index:10;}
  .radio-close-btn:hover, .radio-close-btn:active{background:rgba(255,255,255,0.25);border-color:#fff;}
  `;
  document.head.appendChild(s);
}

export class RadioWheel {
  private overlay: HTMLDivElement | null = null;
  private wheel: HTMLDivElement | null = null;
  private hubName: HTMLDivElement | null = null;
  private hubTag: HTMLDivElement | null = null;
  private eq: HTMLDivElement | null = null;
  private currentId: string;

  constructor(
    private readonly onSelect: (id: string) => void,
    initialId = "heat",
    private readonly playClick?: () => void
  ) {
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
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) {
        this.playClick?.();
        this.close();
      }
    });

    const wheel = document.createElement("div");
    wheel.className = "radio-wheel";

    RADIO_STATIONS.forEach((st) => {
      const btn = document.createElement("div");
      btn.className = "station-btn" + (st.id === this.currentId ? " sel" : "");

      const icon = document.createElement("div");
      icon.className = "station-icon";
      icon.textContent = st.icon;
      
      const label = document.createElement("div");
      label.className = "station-label";
      // Split name into lines for better fitting inside the circle
      label.innerHTML = st.name.split(" ").join("<br/>"); 

      btn.appendChild(icon);
      btn.appendChild(label);
      
      btn.addEventListener("pointerenter", () => { this.playClick?.(); this.previewHub(st.id); });
      btn.addEventListener("pointerleave", () => this.previewHub(this.currentId));
      btn.addEventListener("pointerup", () => { this.playClick?.(); this.pick(st.id); });
      
      wheel.appendChild(btn);
    });

    wheel.appendChild(this.buildHub());

    const closeBtn = document.createElement("button");
    closeBtn.className = "radio-close-btn";
    closeBtn.innerHTML = `<span style="border:1px solid rgba(255,255,255,0.4);border-radius:3px;padding:1px 5px;font-size:10px;">Esc</span> ✕`;
    closeBtn.addEventListener("click", () => {
      this.playClick?.();
      this.close();
    });
    overlay.appendChild(closeBtn);

    overlay.appendChild(wheel);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.wheel = wheel;
    this.layout();
    document.addEventListener("keydown", this.onKey);
    window.addEventListener("resize", this.layout);
    this.previewHub(this.currentId);
  }

  /** Fits the wheel to the current viewport (also on resize / rotation). */
  private layout = (): void => {
    const wheel = this.wheel;
    if (!wheel) return;
    const g = wheelGeometry(window.innerWidth, window.innerHeight);
    wheel.style.width = `${g.w}px`;
    wheel.style.height = `${g.h}px`;
    wheel.style.setProperty("--btn", `${g.btn}px`);
    const seg = 360 / RADIO_STATIONS.length;
    wheel.querySelectorAll<HTMLDivElement>(".station-btn").forEach((btn, i) => {
      // 0 degrees is right. Subtract 90 to start at top (12 o'clock).
      const a = rad(-90 + i * seg);
      btn.style.left = `${g.w / 2 + g.rx * Math.cos(a)}px`;
      btn.style.top = `${g.h / 2 + g.ry * Math.sin(a)}px`;
    });
    const hub = wheel.querySelector<HTMLDivElement>(".radio-hub");
    if (hub) hub.style.width = `${g.hubW}px`;
    if (this.hubName) this.hubName.style.fontSize = `${g.hubFont}px`;
    if (this.hubTag) this.hubTag.style.fontSize = `${g.tagFont}px`;
  };

  close(): void {
    if (!this.overlay) return;
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.layout);
    this.wheel = null;
    const o = this.overlay;
    this.overlay = null;
    o.classList.add("closing");
    window.setTimeout(() => o.remove(), 150);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private buildHub(): HTMLDivElement {
    const hub = document.createElement("div");
    hub.className = "radio-hub";
    const name = document.createElement("div");
    name.className = "radio-name";
    const tag = document.createElement("div");
    tag.className = "radio-tag";
    const eq = document.createElement("div");
    eq.className = "radio-eq";
    eq.innerHTML = "<i></i><i></i><i></i><i></i><i></i>";
    hub.append(name, tag, eq);
    this.hubName = name;
    this.hubTag = tag;
    this.eq = eq;
    return hub;
  }

  private previewHub(id: string): void {
    const st = RADIO_STATIONS.find((s) => s.id === id) ?? RADIO_STATIONS[0];
    if (this.hubName) { this.hubName.textContent = st.name; }
    if (this.hubTag) { this.hubTag.textContent = st.tag; }
    if (this.eq) this.eq.classList.toggle("off", id === "off");
  }

  private pick(id: string): void {
    this.currentId = id;
    this.onSelect(id);
    
    // reflect the new selection, then close shortly after
    if (this.overlay) {
      const btns = this.overlay.querySelectorAll(".station-btn");
      btns.forEach((btn, i) => {
        btn.classList.toggle("sel", RADIO_STATIONS[i].id === id);
      });
    }
    
    this.previewHub(id);
    window.setTimeout(() => this.close(), 260);
  }
}
