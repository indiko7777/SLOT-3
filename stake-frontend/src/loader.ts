import './splash.css';
let overlay: HTMLDivElement | null = null;
let bar: HTMLElement | null = null;
let label: HTMLElement | null = null;
let track: HTMLElement | null = null;
export function showLoader(): void {
  overlay?.remove();
  overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.className = 'splash loader';
  overlay.innerHTML = `<div class="splash-brand"><span class="splash-eyebrow">A COASTAL GETAWAY</span><h1>HEAT<br>CHASE<span class="splash-period">.</span></h1><p class="splash-subtitle">GRAND ESCAPE</p></div><div class="loader-footer"><div class="loader-caption"><span>WELCOME TO THE CITY</span><span data-load-label>PREPARING THE SCENE</span></div><div class="loader-track" role="progressbar" aria-label="Loading game" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="loader-fill"></div></div><p>CLUSTER WINS · WANTED LEVEL · THE GETAWAY</p></div>`;
  bar = overlay.querySelector('.loader-fill');
  label = overlay.querySelector('[data-load-label]');
  track = overlay.querySelector('.loader-track');
  (document.getElementById('app') ?? document.body).appendChild(overlay);
}
export function updateLoader(progress: number): void {
  const value = Number.isFinite(progress) ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : 0;
  if (bar) bar.style.width = `${value}%`;
  track?.setAttribute('aria-valuenow', String(value));
  if (label) label.textContent = value < 55 ? 'PREPARING THE SCENE' : value < 100 ? 'CONNECTING TO THE CITY' : 'READY';
}
export function hideLoader(): void {
  if (!overlay) return;
  const ref = overlay;
  ref.classList.add('splash-leaving');
  ref.addEventListener('transitionend', () => ref.remove(), { once: true });
  // Also remove with reduced motion or a background tab (no transitionend).
  window.setTimeout(() => ref.remove(), 500);
  overlay = null; bar = null; label = null; track = null;
}
