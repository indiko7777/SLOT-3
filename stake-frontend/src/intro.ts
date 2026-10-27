import { BONUS_START_RESPINS, MAX_WIN_MULTIPLIER } from './domain';
import './splash.css';
/** `onEnter` runs synchronously inside the dismissing click/key — a real user
 *  gesture, so the audio context can be created there (off the first spin). */
export function showIntro(onEnter?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'intro-overlay';
    root.className = 'splash intro';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'intro-title');
    const features = [
      ['diamond.webp', 'MAKE THE CONNECTION', '5+ matching symbols connected horizontally or vertically win. Winning symbols clear; new ones tumble in. Watch for the DRIVE-BY: the getaway car throws Body Armor wilds onto the reels.'],
      ['burner_phone.webp', 'MAKE YOUR GETAWAY', `Fill 5 Wanted stars or land 3+ trucks to start ${BONUS_START_RESPINS} spins. Gold bars stick; only a spin that lands nothing uses one up.`],
      ['cash.webp', 'TURN UP THE HEAT', 'Consecutive cascade wins raise the Wanted level and upgrade the grid. Fill all 20 bonus cells for the Grand Escape.'],
      ['wild_symbole.webp', 'EARN YOUR GOLD STARS', 'Wilds reveal character pieces. Complete a silhouette to earn a gold star and unlock its head-start mode for later base spins.'],
    ];
    root.innerHTML = `<div class="intro-content"><span class="splash-eyebrow">WELCOME TO THE CITY</span><h1 id="intro-title">HEAT CHASE<span class="splash-period">.</span></h1><p class="splash-subtitle">GRAND ESCAPE</p><p class="intro-headline">One chase. A win of up to <strong>${MAX_WIN_MULTIPLIER.toLocaleString('en-US')}×</strong> your play amount.</p><div class="intro-features">${features.map(([art,title,copy]) => `<section class="intro-feature"><img src="assets/symbols/${art}" alt=""><div><h2>${title}</h2><p>${copy}</p></div></section>`).join('')}</div><button class="intro-enter" type="button">ENTER THE CITY &nbsp; →</button><p class="intro-foot">96% RTP · HIGH VOLATILITY · MAX WIN ${MAX_WIN_MULTIPLIER.toLocaleString('en-US')}×</p></div>`;
    document.body.appendChild(root);
    let done = false;
    // One screen, never a scrollbar: when the page is taller (or wider) than
    // the viewport, zoom the whole block down until it fits. Zoom reflows, so
    // the layout keeps its format and the flex centring still works.
    const content = root.querySelector<HTMLElement>('.intro-content')!;
    const fits = (): boolean => root.scrollHeight <= root.clientHeight && root.scrollWidth <= root.clientWidth;
    const fit = (): void => {
      content.style.zoom = '';
      if (fits()) return;
      let lo = 0.35, hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        content.style.zoom = String(mid);
        if (fits()) lo = mid; else hi = mid;
      }
      content.style.zoom = String(lo);
    };
    fit();
    window.addEventListener('resize', fit);
    void document.fonts?.ready.then(() => { if (!done) fit(); });
    const close = (): void => {
      if (done) return;
      done = true;
      try { onEnter?.(); } catch { /* never block entering the game */ }
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      root.classList.add('splash-leaving');
      window.setTimeout(() => { root.remove(); resolve(); }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (['Enter', ' ', 'Escape'].includes(event.key)) { event.preventDefault(); close(); }
      if (event.key === 'Tab') { event.preventDefault(); button.focus(); }
    };
    const button = root.querySelector<HTMLButtonElement>('button')!;
    button.addEventListener('click', close);
    button.focus({ preventScroll: true });
    window.addEventListener('keydown', onKey);
  });
}
