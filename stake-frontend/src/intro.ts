/**
 * Game intro / feature-preview splash — the screen high-tier slots show once
 * the loader finishes, before the reels are touched. It states the paying
 * mechanic, the feature, and the headline numbers in one read, so a first-time
 * player is never guessing what the game does.
 *
 * DOM (like loader.ts) rather than Pixi: it is pure typography and static art,
 * needs crisp text at any DPI, and must not wait on the renderer.
 *
 * Every number here is sourced from the math, not invented:
 *   RTP 96%              stake-math config target.rtp
 *   max win 5000x        MAX_WIN_MULTIPLIER
 *   Getaway 5 spins      BONUS_START_RESPINS
 *   buy 100x / 500x      MODES.getaway.cost / MODES.super_getaway.cost
 */
import { BONUS_START_RESPINS, MAX_WIN_MULTIPLIER } from "./domain";

const GOLD = "#ffdf65";
const AMBER = "#ffb000";
const CYAN = "#3ad4ff";
const MAGENTA = "#ff2fa0";
const INK = "#050816";
const IMPACT = "Impact, 'Arial Black', Arial, sans-serif";
const BODY = "'Archivo Narrow','Arial Narrow','Helvetica Neue',Helvetica,Arial,sans-serif";

interface Feature {
  art: string;
  accent: string;
  title: string;
  lines: string[];
}

function features(): Feature[] {
  return [
    {
      art: "assets/symbols/diamond.webp",
      accent: MAGENTA,
      title: "CLUSTER PAYS",
      lines: [
        "Land 5 or more matching symbols touching",
        "left, right, up or down — anywhere on the grid.",
        "Winners vanish and new symbols drop in, so one",
        "spin can pay again and again.",
      ],
    },
    {
      art: "assets/wanted_star.webp",
      accent: AMBER,
      title: "WANTED LEVEL",
      lines: [
        "Every win in a row raises your wanted level.",
        "The hotter it gets, the stronger the grid turns —",
        "low symbols upgrade and multipliers climb.",
      ],
    },
    {
      art: "assets/symbols/burner_phone.webp",
      accent: CYAN,
      title: "THE GETAWAY",
      lines: [
        "3 or more armored trucks trigger the feature.",
        `You get ${BONUS_START_RESPINS} spins. Every gold bar that sticks`,
        "HOLDS your spins — only an empty spin costs one.",
        "Fill all 20 slots for the Grand Escape.",
      ],
    },
    {
      art: "assets/symbols/wild_symbole.webp",
      accent: GOLD,
      title: "WILDS & THE DECK",
      lines: [
        "Wilds substitute for any paying symbol.",
        "Each one also reveals a part of your Beach Girl",
        "card — complete her to keep the reward for good.",
      ],
    },
  ];
}

/** Chamfered neon plate, matching the in-game HUD panels. */
function plate(accent: string): string {
  return [
    `background: linear-gradient(180deg, ${accent}1f 0%, rgba(8,10,18,0.62) 55%, rgba(8,10,18,0.72) 100%)`,
    `border: 1px solid ${accent}`,
    `box-shadow: 0 0 18px ${accent}44, inset 0 1px 0 rgba(255,255,255,0.18)`,
    "clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))",
  ].join(";");
}

/**
 * Show the intro. Resolves when the player enters the game.
 * Never blocks: if anything in here throws, boot continues.
 */
export function showIntro(): Promise<void> {
  return new Promise<void>((resolve) => {
    const root = document.createElement("div");
    root.id = "intro-overlay";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9998",
      background:
        `radial-gradient(120% 90% at 50% 0%, #1a1030 0%, ${INK} 62%), ${INK}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      boxSizing: "border-box",
      opacity: "0",
      transition: "opacity 320ms ease",
      overflowY: "auto",
      fontFamily: BODY,
      // the city art sits behind everything at low strength
      backgroundBlendMode: "screen",
    });

    // Faint skyline wash so it belongs to the game, not a generic modal.
    const wash = document.createElement("div");
    Object.assign(wash.style, {
      position: "absolute",
      inset: "0",
      backgroundImage: "url('assets/slot3_bg.webp')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      opacity: "0.16",
      filter: "saturate(1.2)",
      pointerEvents: "none",
    });
    root.appendChild(wash);

    const stack = document.createElement("div");
    Object.assign(stack.style, {
      position: "relative",
      width: "100%",
      maxWidth: "980px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "14px",
    });
    root.appendChild(stack);

    // ── Title block ────────────────────────────────────────────────────
    const title = document.createElement("div");
    title.textContent = "HEAT CHASE";
    Object.assign(title.style, {
      fontFamily: IMPACT,
      fontSize: "clamp(34px, 6vw, 58px)",
      color: GOLD,
      letterSpacing: "5px",
      lineHeight: "1",
      textShadow: `0 0 22px ${AMBER}88, 0 3px 0 #00000066`,
    });
    stack.appendChild(title);

    const sub = document.createElement("div");
    sub.textContent = "GRAND ESCAPE";
    Object.assign(sub.style, {
      fontFamily: IMPACT,
      fontSize: "clamp(14px, 2.4vw, 22px)",
      color: "#ffffff",
      letterSpacing: "10px",
      marginTop: "-4px",
      opacity: "0.9",
    });
    stack.appendChild(sub);

    const maxWin = document.createElement("div");
    maxWin.innerHTML =
      `<span style="color:#c9d3e4">WIN UP TO</span> ` +
      `<span style="color:${GOLD};font-size:1.5em">${MAX_WIN_MULTIPLIER.toLocaleString()}x</span> ` +
      `<span style="color:#c9d3e4">YOUR BET</span>`;
    Object.assign(maxWin.style, {
      fontFamily: IMPACT,
      fontSize: "clamp(13px, 2vw, 19px)",
      letterSpacing: "3px",
      marginTop: "2px",
    });
    stack.appendChild(maxWin);

    // ── Feature grid ───────────────────────────────────────────────────
    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))",
      gap: "10px",
      width: "100%",
      marginTop: "6px",
    });
    stack.appendChild(grid);

    for (const f of features()) {
      const cell = document.createElement("div");
      cell.setAttribute("style", plate(f.accent));
      Object.assign(cell.style, {
        padding: "13px 14px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        minWidth: "0",
      });

      const head = document.createElement("div");
      Object.assign(head.style, { display: "flex", alignItems: "center", gap: "9px" });

      const img = document.createElement("img");
      img.src = f.art;
      img.alt = "";
      Object.assign(img.style, {
        width: "38px",
        height: "38px",
        objectFit: "contain",
        filter: `drop-shadow(0 0 8px ${f.accent}aa)`,
        flex: "0 0 auto",
      });
      // A missing image must never leave a broken-icon box in the splash.
      img.onerror = () => { img.style.display = "none"; };
      head.appendChild(img);

      const h = document.createElement("div");
      h.textContent = f.title;
      Object.assign(h.style, {
        fontFamily: IMPACT,
        fontSize: "16px",
        color: f.accent,
        letterSpacing: "2px",
      });
      head.appendChild(h);
      cell.appendChild(head);

      const body = document.createElement("div");
      body.textContent = f.lines.join(" ");
      Object.assign(body.style, {
        fontSize: "13.5px",
        lineHeight: "1.45",
        color: "#d5dde9",
      });
      cell.appendChild(body);

      grid.appendChild(cell);
    }

    // ── Buy-feature note ───────────────────────────────────────────────
    const buys = document.createElement("div");
    buys.innerHTML =
      `<span style="color:${AMBER}">THE GETAWAY 100x</span>` +
      `<span style="opacity:.45"> — buy the feature straight away</span>` +
      `<span style="opacity:.3"> &nbsp;|&nbsp; </span>` +
      `<span style="color:${MAGENTA}">SUPER GETAWAY 500x</span>` +
      `<span style="opacity:.45"> — richer bars, far more likely to fill</span>`;
    Object.assign(buys.style, {
      fontSize: "12.5px",
      letterSpacing: "0.6px",
      textAlign: "center",
      color: "#c9d3e4",
      marginTop: "2px",
    });
    stack.appendChild(buys);

    // ── Enter button ───────────────────────────────────────────────────
    const btn = document.createElement("button");
    btn.textContent = "ENTER THE CITY";
    Object.assign(btn.style, {
      marginTop: "8px",
      padding: "13px 42px",
      fontFamily: IMPACT,
      fontSize: "20px",
      letterSpacing: "3px",
      color: INK,
      background: `linear-gradient(180deg, ${GOLD} 0%, ${AMBER} 100%)`,
      border: "none",
      cursor: "pointer",
      clipPath: "polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 13px 100%, 0 calc(100% - 13px))",
      boxShadow: `0 0 26px ${AMBER}77`,
      transition: "transform 120ms ease, box-shadow 200ms ease",
    });
    btn.onmouseenter = () => {
      btn.style.transform = "scale(1.04)";
      btn.style.boxShadow = `0 0 38px ${AMBER}bb`;
    };
    btn.onmouseleave = () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = `0 0 26px ${AMBER}77`;
    };
    stack.appendChild(btn);

    const foot = document.createElement("div");
    foot.textContent = "RTP 96%  •  HIGH VOLATILITY  •  ALL WINS PAY IN CLUSTERS";
    Object.assign(foot.style, {
      fontSize: "11px",
      letterSpacing: "2px",
      color: "#6f7889",
      marginTop: "2px",
      textAlign: "center",
    });
    stack.appendChild(foot);

    document.body.appendChild(root);
    requestAnimationFrame(() => { root.style.opacity = "1"; });

    let done = false;
    const close = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey);
      root.style.opacity = "0";
      window.setTimeout(() => { root.remove(); resolve(); }, 320);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") close();
    };
    btn.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
  });
}
