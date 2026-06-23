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

const SIZE = 500;        // Wheel container size
const C = SIZE / 2;      // Center coordinate
const R = 180;           // Radius for the circle of buttons

const rad = (deg: number): number => (deg * Math.PI) / 180;
const pt = (r: number, deg: number): [number, number] => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))];

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
  .radio-wheel{position:relative;width:${SIZE}px;height:${SIZE}px;animation:radioPop .26s cubic-bezier(.2,1.4,.4,1) both;}
  @keyframes radioPop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
  
  .station-btn{position:absolute;width:72px;height:72px;margin-left:-36px;margin-top:-36px;
    border-radius:50%;border:2px solid #fff;background:#000;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    cursor:pointer;transition:all .12s ease-out;color:#fff;opacity:0.45;}
  .station-btn:hover{opacity:0.8;}
  .station-btn.sel{border:3px solid #c2f58e;box-shadow:0 0 15px rgba(194,245,142,.3);
    color:#fff;transform:scale(1.25);background:#000;z-index:10;opacity:1;}
  
  .station-icon{font-size:26px;line-height:1;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.7);}
  .station-label{font-size:8.5px;letter-spacing:.5px;margin-top:2px;text-align:center;
    pointer-events:none;font-weight:bold;text-transform:uppercase;line-height:1.1;padding:0 4px;}
  
  .radio-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    width:300px;text-align:center;display:flex;flex-direction:column;align-items:center;
    justify-content:center;text-shadow:0 2px 4px rgba(0,0,0,.8);}
  
  .radio-name{font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:1px;font-weight:bold;}
  .radio-tag{font-size:16px;color:#e0e0e0;margin-bottom:6px;}
  
  .radio-eq{display:flex;gap:3px;height:14px;align-items:flex-end;margin-top:4px;}
  .radio-eq i{width:3px;background:#c2f58e;border-radius:1px;animation:radioEq .8s ease-in-out infinite;}
  .radio-eq i:nth-child(2){animation-delay:.15s}.radio-eq i:nth-child(3){animation-delay:.3s}
  .radio-eq i:nth-child(4){animation-delay:.45s}.radio-eq i:nth-child(5){animation-delay:.1s}
  @keyframes radioEq{0%,100%{height:3px}50%{height:14px}}
  .radio-eq.off i{animation:none;height:3px;background:#5a6680;}
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

    const n = RADIO_STATIONS.length;
    const seg = 360 / n;
    
    RADIO_STATIONS.forEach((st, i) => {
      // 0 degrees is right. Subtract 90 to start at top (12 o'clock).
      const center = -90 + i * seg;
      const [bx, by] = pt(R, center);

      const btn = document.createElement("div");
      btn.className = "station-btn" + (st.id === this.currentId ? " sel" : "");
      btn.style.left = `${bx}px`;
      btn.style.top = `${by}px`;
      
      const icon = document.createElement("div");
      icon.className = "station-icon";
      icon.textContent = st.icon;
      
      const label = document.createElement("div");
      label.className = "station-label";
      // Split name into lines for better fitting inside the circle
      label.innerHTML = st.name.split(" ").join("<br/>"); 

      btn.appendChild(icon);
      btn.appendChild(label);
      
      btn.addEventListener("pointerenter", () => this.previewHub(st.id));
      btn.addEventListener("pointerleave", () => this.previewHub(this.currentId));
      btn.addEventListener("pointerup", () => this.pick(st.id));
      
      wheel.appendChild(btn);
    });

    wheel.appendChild(this.buildHub());

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
