/**
 * DEV-only feature tester. A floating on-screen panel of buttons that fire every
 * win / combination / bonus animation on demand, so features can be eyeballed
 * without spinning for a real outcome. Mounted only when import.meta.env.DEV
 * (see main.ts) and therefore stripped from production builds.
 */

type Group = { title: string; buttons: { label: string; action: string }[] };

const GROUPS: Group[] = [
  {
    title: "Win animation (per symbol)",
    buttons: [
      { label: "Brass", action: "win:BRASS" },
      { label: "Knife", action: "win:KNIFE" },
      { label: "Pistol", action: "win:PISTOL" },
      { label: "Ammo", action: "win:AMMO" },
      { label: "Duffel", action: "win:DUFFEL" },
      { label: "Cash", action: "win:CASH" },
      { label: "Watch", action: "win:WATCH" },
      { label: "Diamond", action: "win:DIAMOND" },
      { label: "Bike", action: "win:BIKE" },
      { label: "Car (Wild)", action: "win:CAR_WILD" },
      { label: "Phone (Scatter)", action: "win:PHONE_SCATTER" },
      { label: "Gold (Safe)", action: "win:SAFE" },
      { label: "Key (Dynamite)", action: "win:MASTER_KEY" },
    ],
  },
  {
    title: "Win tier (banner + shaders)",
    buttons: [
      { label: "BIG WIN", action: "tier:mid" },
      { label: "MEGA WIN", action: "tier:high" },
      { label: "GRAND WIN 5000x", action: "tier:grand" },
    ],
  },
  {
    title: "Combination FX",
    buttons: [
      { label: "Cluster link", action: "fx:clusterLink" },
      { label: "Cascade (tumble)", action: "cascade" },
      { label: "Cash spray", action: "fx:cashSpray" },
      { label: "Coin burst", action: "fx:coinBurst" },
      { label: "Screen shake", action: "fx:shake" },
      { label: "Key beam", action: "fx:keyBeam" },
      { label: "Scatter tease", action: "fx:scatterTease" },
    ],
  },
  {
    title: "Heat features",
    buttons: [
      { label: "Heat transform", action: "heat:transform" },
      { label: "Mega wild", action: "heat:megawild" },
    ],
  },
  {
    title: "Getaway bonus",
    buttons: [
      { label: "Intro", action: "bonus:intro" },
      { label: "Spin — HIT", action: "bonus:hit" },
      { label: "Spin — DEAD (no hit)", action: "bonus:dead" },
      { label: "Dynamite crack", action: "bonus:crack" },
      { label: "Grand Escape", action: "bonus:grand" },
      { label: "Busted", action: "bonus:bust" },
      { label: "Hide bonus", action: "bonus:hide" },
    ],
  },
];

export function mountDebugPanel(onAction: (action: string) => void): void {
  const root = document.createElement("div");
  root.id = "feature-tester";
  root.style.cssText = [
    "position:fixed", "top:8px", "left:8px", "z-index:99999",
    "width:208px", "max-height:92vh", "overflow:auto",
    "font:11px/1.3 system-ui,sans-serif", "color:#e7eefc",
    "background:rgba(8,12,24,.92)", "border:1px solid #2b3b5e",
    "border-radius:10px", "padding:8px", "box-shadow:0 6px 24px rgba(0,0,0,.5)",
    "backdrop-filter:blur(4px)", "user-select:none",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:pointer";
  const title = document.createElement("strong");
  title.textContent = "🎰 Feature tester";
  title.style.cssText = "font-size:12px;color:#ffd95c;letter-spacing:.3px";
  const toggle = document.createElement("span");
  toggle.textContent = "▾";
  toggle.style.cssText = "color:#9fb4d0";
  header.append(title, toggle);
  root.appendChild(header);

  const body = document.createElement("div");
  root.appendChild(body);

  let collapsed = false;
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "block";
    toggle.textContent = collapsed ? "▸" : "▾";
  });

  const mkBtn = (label: string, action: string, accent = false): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = [
      "display:block", "width:100%", "margin:2px 0", "padding:5px 6px",
      "text-align:left", "cursor:pointer", "border-radius:6px",
      `border:1px solid ${accent ? "#7a5a13" : "#2b3b5e"}`,
      `background:${accent ? "#3a2c08" : "#141d33"}`,
      "color:#e7eefc", "font:11px system-ui,sans-serif",
    ].join(";");
    b.addEventListener("mouseenter", () => (b.style.background = accent ? "#5a4310" : "#1d2a47"));
    b.addEventListener("mouseleave", () => (b.style.background = accent ? "#3a2c08" : "#141d33"));
    b.addEventListener("click", () => onAction(action));
    return b;
  };

  // Reset button up top.
  body.appendChild(mkBtn("↺ Reset to idle board", "reset", true));

  for (const g of GROUPS) {
    const h = document.createElement("div");
    h.textContent = g.title;
    h.style.cssText = "margin:8px 0 2px;color:#7fa0d6;font-weight:600;text-transform:uppercase;font-size:9px;letter-spacing:.6px";
    body.appendChild(h);
    for (const btn of g.buttons) body.appendChild(mkBtn(btn.label, btn.action));
  }

  document.body.appendChild(root);
}
