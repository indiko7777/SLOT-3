let overlay: HTMLDivElement | null = null;
let bar: HTMLDivElement | null = null;

export function showLoader(): void {
  overlay = document.createElement("div");
  overlay.id = "loading-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    zIndex: "9999",
    background: "#050816",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity 0.5s ease",
    opacity: "1",
  } satisfies Partial<Record<keyof CSSStyleDeclaration, string>>);

  const title = document.createElement("div");
  Object.assign(title.style, {
    fontFamily: "Impact, 'Arial Black', sans-serif",
    fontSize: "48px",
    color: "#ffdf65",
    letterSpacing: "4px",
    textAlign: "center",
    marginBottom: "8px",
  } satisfies Partial<Record<keyof CSSStyleDeclaration, string>>);
  title.textContent = "HEAT CHASE";

  const subtitle = document.createElement("div");
  Object.assign(subtitle.style, {
    fontFamily: "Impact, 'Arial Black', sans-serif",
    fontSize: "22px",
    color: "#ffffff",
    letterSpacing: "6px",
    textAlign: "center",
    marginBottom: "32px",
  } satisfies Partial<Record<keyof CSSStyleDeclaration, string>>);
  subtitle.textContent = "GRAND ESCAPE";

  const track = document.createElement("div");
  Object.assign(track.style, {
    width: "60%",
    height: "4px",
    background: "#1a1e36",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "16px",
  } satisfies Partial<Record<keyof CSSStyleDeclaration, string>>);

  bar = document.createElement("div");
  Object.assign(bar.style, {
    width: "0%",
    height: "100%",
    background: "#ffdf65",
    borderRadius: "2px",
    transition: "width 0.3s ease",
  } satisfies Partial<Record<keyof CSSStyleDeclaration, string>>);
  track.appendChild(bar);

  const label = document.createElement("div");
  Object.assign(label.style, {
    fontFamily: "Impact, 'Arial Black', sans-serif",
    fontSize: "14px",
    color: "#ffdf65",
    letterSpacing: "3px",
    textAlign: "center",
  } satisfies Partial<Record<keyof CSSStyleDeclaration, string>>);
  label.textContent = "LOADING...";

  overlay.appendChild(title);
  overlay.appendChild(subtitle);
  overlay.appendChild(track);
  overlay.appendChild(label);

  const app = document.getElementById("app");
  if (app) {
    app.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }
}

export function updateLoader(progress: number): void {
  if (bar) {
    const clamped = Math.max(0, Math.min(1, progress));
    bar.style.width = `${clamped * 100}%`;
  }
}

export function hideLoader(): void {
  if (!overlay) return;
  overlay.style.opacity = "0";
  const ref = overlay;
  ref.addEventListener("transitionend", () => {
    ref.remove();
  });
  overlay = null;
  bar = null;
}
