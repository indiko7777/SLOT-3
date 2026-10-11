import "./tutorial.css";

/**
 * Guided first-run tour: the whole game blurs except one spotlighted control,
 * a glass card explains it, and the spotlight glides to the next. The Beach
 * Girl step waits for the player to actually tap her (the deck opens), then
 * explains the gold Wanted star inside the deck.
 *
 * Shown once per player (localStorage) after the loader and the ENTER THE CITY
 * page; replayable from the menu. DOM-only, above the canvas: four blurred
 * panels frame the spotlight, which follows its control every frame, so the
 * highlighted control is always crisp at any screen size; taps inside the
 * spotlight reach the game only on the step that asks for one.
 */

export interface TourRect { x: number; y: number; width: number; height: number }

export interface TourHooks {
  /** Page-pixel rect of a game control ("spin", "bet", "mute", "stars", "crew", "buy"). */
  anchor(name: string): TourRect | null;
  isGalleryOpen(): boolean;
  closeGallery(): void;
  social: boolean;
  portrait(): boolean;
  click?(): void;
}

interface Step {
  target: string | null;
  shape?: "circle" | "rect";
  kicker: string;
  title: string;
  body: string;
  /** Advance on its own when this turns true (polled); hides NEXT. */
  until?: () => boolean;
  hint?: string;
  /** Let taps inside the spotlight reach the game. */
  open?: boolean;
  /** Hide the blur (e.g. while the deck is open). */
  noVeil?: boolean;
  /** Card position when there is no target. */
  /** "corner": top-left on wide screens (clear of the deck's art and tabs), low on phones. */
  dock?: "center" | "corner";
  next?: string;
  onLeave?: () => void;
}

const KEY = "heatchase.tour.v1";
let open = false;

export function isTourOpen(): boolean { return open; }

export function tourSeen(): boolean {
  try { return localStorage.getItem(KEY) === "done"; } catch { return false; }
}

function markSeen(): void {
  try { localStorage.setItem(KEY, "done"); } catch { /* private mode: show again next time */ }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function steps(h: TourHooks): Step[] {
  return [
    {
      target: "stars",
      kicker: "1 / 3 · Wanted level",
      title: "TURN UP THE HEAT",
      body: "Every winning tumble in a spin lights a star and raises the win multiplier. Light all <b>five</b> and <b>The Getaway</b> starts.",
    },
    {
      target: "mute", shape: "circle",
      kicker: "2 / 3 · Radio",
      title: "PICK YOUR STATION",
      body: "Tap here to switch the <b>radio station</b> — or turn the sound off completely.",
    },
    {
      target: "crew", open: true,
      kicker: "3 / 3 · The Beach Girls",
      title: "COLLECT THE CREW",
      body: h.portrait()
        ? "Every Beach Girl <b>Wild</b> you land reveals one piece of her. <b>Tap the bar</b> to open the deck."
        : "Every Beach Girl <b>Wild</b> you land reveals one piece of her. <b>Tap her</b> to open the deck.",
      until: () => h.isGalleryOpen(),
      hint: h.portrait() ? "TAP THE BAR ↑" : "TAP HER →",
    },
    {
      target: null, dock: "corner", noVeil: true,
      kicker: "3 / 3 · Gold stars",
      title: "ONE STAR PER GIRL",
      body: "Complete a girl and you earn a <b>gold Wanted star</b>. It stays lit on every base spin — a head start toward The Getaway — until a natural Getaway uses it.",
      until: () => !h.isGalleryOpen(),
      next: "GOT IT",
      onLeave: () => h.closeGallery(),
    },
  ];
}

export function runTour(h: TourHooks): Promise<void> {
  if (open) return Promise.resolve();
  open = true;
  const list = steps(h);

  const root = document.createElement("div");
  root.className = "hc-tour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Game tour");
  // Four blurred panels frame the spotlight: the highlighted control sits in a
  // real gap with nothing over it, so it is always crisp (a single blurred
  // sheet with a clip-path hole is not honoured by every browser's
  // backdrop-filter).
  const veils = [0, 1, 2, 3].map(() => {
    const v = document.createElement("div");
    v.className = "hc-tour-veil";
    return v;
  });
  const block = document.createElement("div");
  block.className = "hc-tour-block";
  const ring = document.createElement("div");
  ring.className = "hc-tour-ring";
  const card = document.createElement("div");
  card.className = "hc-tour-card";
  card.innerHTML =
    `<span class="hc-tour-caret" aria-hidden="true"></span>` +
    `<div class="hc-tour-kicker"></div><div class="hc-tour-title" role="heading" aria-level="2"></div><p class="hc-tour-body"></p>` +
    `<div class="hc-tour-foot"><div class="hc-tour-dots" aria-hidden="true">${list.map(() => "<i></i>").join("")}</div>` +
    `<button type="button" class="hc-tour-skip">SKIP</button><span class="hc-tour-hint"></span><button type="button" class="hc-tour-next">NEXT</button></div>`;
  root.append(...veils, block, ring, card);
  document.body.appendChild(root);

  const q = <T extends HTMLElement>(sel: string) => card.querySelector(sel) as T;
  const kicker = q<HTMLDivElement>(".hc-tour-kicker");
  const title = q<HTMLDivElement>(".hc-tour-title");
  const body = q<HTMLParagraphElement>(".hc-tour-body");
  const dots = [...card.querySelectorAll<HTMLElement>(".hc-tour-dots i")];
  const skip = q<HTMLButtonElement>(".hc-tour-skip");
  const next = q<HTMLButtonElement>(".hc-tour-next");
  const hint = q<HTMLSpanElement>(".hc-tour-hint");
  const caret = q<HTMLSpanElement>(".hc-tour-caret");

  // ── spotlight ─────────────────────────────────────────────────────────
  type Hole = { x: number; y: number; w: number; h: number; r: number };
  let hole: Hole | null = null;
  let anim = 0;
  const box = (el: HTMLElement, x: number, y: number, w: number, hh: number): void => {
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, hh)}px` });
  };
  const paint = (H: Hole | null): void => {
    const W = window.innerWidth, Ht = window.innerHeight;
    const [top, bottom, left, right] = veils as unknown as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    if (H && H.w > 1 && H.h > 1) {
      const x = Math.round(H.x), y = Math.round(H.y), w = Math.round(H.w), hh = Math.round(H.h);
      const r = Math.min(H.r, w / 2, hh / 2);
      box(top, 0, 0, W, y);
      box(bottom, 0, y + hh, W, Ht - (y + hh));
      box(left, 0, y, x, hh);
      box(right, x + w, y, W - (x + w), hh);
      box(ring, x, y, w, hh);
      ring.style.borderRadius = `${r}px`;
      box(block, x, y, w, hh);
      ring.classList.add("show");
    } else {
      box(top, 0, 0, W, Ht);
      box(bottom, 0, 0, 0, 0);
      box(left, 0, 0, 0, 0);
      box(right, 0, 0, 0, 0);
      ring.classList.remove("show");
      box(block, 0, 0, 0, 0);
    }
  };
  const moveHole = (to: Hole | null, ms: number): Promise<void> => {
    cancelAnimationFrame(anim);
    const from = hole ?? (to ? { x: to.x + to.w / 2, y: to.y + to.h / 2, w: 0, h: 0, r: to.r } : null);
    hole = to;
    if (!to || !from || ms <= 0) { paint(to); return Promise.resolve(); }
    const t0 = performance.now();
    return new Promise((res) => {
      const f = (now: number) => {
        const p = easeInOut(Math.min(1, (now - t0) / ms));
        paint({ x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, w: from.w + (to.w - from.w) * p, h: from.h + (to.h - from.h) * p, r: from.r + (to.r - from.r) * p });
        if (p < 1) anim = requestAnimationFrame(f); else res();
      };
      anim = requestAnimationFrame(f);
    });
  };
  const holeFor = (st: Step): Hole | null => {
    if (!st.target) return null;
    const r = h.anchor(st.target);
    if (!r) return null;
    if (st.shape === "circle") {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2, R = Math.max(r.width, r.height) / 2 + 8;
      return { x: cx - R, y: cy - R, w: R * 2, h: R * 2, r: R };
    }
    const p = 10;
    return { x: r.x - p, y: r.y - p, w: r.width + p * 2, h: r.height + p * 2, r: 16 };
  };

  // ── card placement (next to the spotlight, caret pointing at it) ──────
  const place = (st: Step, H: Hole | null): void => {
    const W = window.innerWidth, Ht = window.innerHeight, m = 16;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    caret.style.display = H ? "block" : "none";
    card.classList.remove("nudge");
    if (!H) {
      if (st.dock === "corner" && !h.portrait()) {
        card.style.left = `${m + 8}px`;
        card.style.top = `${Math.max(m, Ht * 0.09)}px`;
      } else if (st.dock === "corner") {
        // phones: over her (top half) so the deck's name / progress stay readable
        card.style.left = `${(W - cw) / 2}px`;
        card.style.top = `${Math.max(m + 44, Ht * 0.1)}px`;
      } else {
        card.style.left = `${(W - cw) / 2}px`;
        card.style.top = `${(Ht - ch) / 2}px`;
      }
      return;
    }
    const above = H.y - m, below = Ht - (H.y + H.h) - m, left = H.x - m, right = W - (H.x + H.w) - m;
    const tall = H.h > Ht * 0.42;
    const cx = H.x + H.w / 2, cy = H.y + H.h / 2;
    let x: number, y: number, side: "top" | "bottom" | "left" | "right";
    if (!tall && Math.max(above, below) >= ch + 14) {
      side = below >= above ? "bottom" : "top";
      x = Math.min(W - cw - m, Math.max(m, cx - cw / 2));
      y = side === "bottom" ? H.y + H.h + 18 : H.y - ch - 18;
    } else {
      side = right >= left ? "right" : "left";
      x = side === "right" ? H.x + H.w + 18 : H.x - cw - 18;
      x = Math.min(W - cw - m, Math.max(m, x));
      y = Math.min(Ht - ch - m, Math.max(m, cy - ch / 2));
    }
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    const c = caret.style;
    c.left = c.top = c.right = c.bottom = "";
    if (side === "bottom") { c.top = "-8px"; c.left = `${Math.min(cw - 24, Math.max(16, cx - x - 8))}px`; c.transform = "rotate(45deg)"; }
    else if (side === "top") { c.bottom = "-8px"; c.left = `${Math.min(cw - 24, Math.max(16, cx - x - 8))}px`; c.transform = "rotate(225deg)"; }
    else if (side === "right") { c.left = "-8px"; c.top = `${Math.min(ch - 24, Math.max(16, cy - y - 8))}px`; c.transform = "rotate(-45deg)"; }
    else { c.right = "-8px"; c.top = `${Math.min(ch - 24, Math.max(16, cy - y - 8))}px`; c.transform = "rotate(135deg)"; }
    const n = 5;
    card.style.setProperty("--nx", side === "right" ? `-${n}px` : side === "left" ? `${n}px` : "0px");
    card.style.setProperty("--ny", side === "bottom" ? `-${n}px` : side === "top" ? `${n}px` : "0px");
    card.classList.add("nudge");
  };

  return new Promise<void>((resolve) => {
    let i = -1;
    let poll = 0;
    let track = 0;
    const same = (a: Hole | null, b: Hole | null): boolean =>
      (!a && !b) || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);
    /** Follow the spotlighted control every frame: window resizes, rotation and
     *  HUD redraws move it (the radio button sits elsewhere on phones). */
    const follow = (): void => {
      cancelAnimationFrame(track);
      const tick = (): void => {
        const st = list[i];
        if (finished || !st) return;
        const want = holeFor(st);
        if (!same(want, hole)) { hole = want; paint(want); place(st, want); }
        track = requestAnimationFrame(tick);
      };
      track = requestAnimationFrame(tick);
    };
    let busy = false;
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      window.clearInterval(poll);
      cancelAnimationFrame(anim);
      cancelAnimationFrame(track);
      markSeen();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      root.classList.remove("on");
      card.classList.remove("show");
      window.setTimeout(() => { root.remove(); open = false; resolve(); }, 380);
    };

    const go = async (to: number): Promise<void> => {
      if (busy || finished) return;
      busy = true;
      window.clearInterval(poll);
      cancelAnimationFrame(track);
      list[i]?.onLeave?.();
      if (to >= list.length) { busy = false; finish(); return; }
      card.classList.remove("show");
      await sleep(i < 0 ? 60 : 150);
      i = to;
      const st = list[i]!;
      kicker.textContent = st.kicker;
      title.textContent = st.title;
      body.innerHTML = st.body;
      dots.forEach((d, k) => d.classList.toggle("on", k === i));
      next.style.display = st.until && !st.next ? "none" : "";
      next.textContent = st.next ?? "NEXT";
      hint.textContent = st.hint ?? "";
      hint.style.display = st.hint ? "" : "none";
      skip.style.display = i === list.length - 1 ? "none" : "";
      // the last stop's own button finishes the tour
      root.classList.toggle("no-veil", !!st.noVeil);
      card.classList.toggle("narrow", st.dock === "corner" && !h.portrait());
      block.classList.toggle("open", !!st.open);
      const H = holeFor(st);
      const moving = moveHole(H, hole || H ? 480 : 0);
      place(st, H);
      card.classList.add("show");
      busy = false;
      if (st.until) poll = window.setInterval(() => { if (st.until!()) void go(i + 1); }, 120);
      await moving;
      if (!finished && list[i] === st) { place(st, holeFor(st)); follow(); }
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(); return; }
      if ((e.key === "Enter" || e.key === "ArrowRight") && next.style.display !== "none") {
        e.preventDefault(); e.stopImmediatePropagation(); h.click?.(); void go(i + 1);
      }
    };
    const onResize = (): void => {
      const st = list[i];
      if (!st) return;
      cancelAnimationFrame(anim);
      hole = holeFor(st);
      paint(hole);
      place(st, hole);
    };

    next.addEventListener("click", (e) => { e.stopPropagation(); h.click?.(); void go(i + 1); });
    skip.addEventListener("click", (e) => { e.stopPropagation(); h.click?.(); list[i]?.onLeave?.(); finish(); });
    for (const v of veils) v.addEventListener("pointerdown", (e) => e.stopPropagation());
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    paint(null);
    requestAnimationFrame(() => { root.classList.add("on"); void go(0); });
  });
}
