import { BONUS_START_RESPINS, MAX_WIN_MULTIPLIER } from './domain';
import './splash.css';
export function showIntro(): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'intro-overlay';
    root.className = 'splash intro';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'intro-title');
    const features = [
      ['diamond.webp', 'MAKE THE CONNECTION', '5+ matching symbols connected horizontally or vertically win. Winning symbols clear; new ones tumble in.'],
      ['burner_phone.webp', 'MAKE YOUR GETAWAY', `Fill 5 Wanted stars or land 3+ trucks to start ${BONUS_START_RESPINS} spins. Gold bars stick; only an empty spin costs a spin.`],
      ['cash.webp', 'TURN UP THE HEAT', 'Consecutive cascade wins raise the Wanted level and upgrade the grid. Fill all 20 bonus cells for the Grand Escape.'],
      ['wild_symbole.webp', 'EARN YOUR GOLD STARS', 'Wilds reveal character pieces. Complete a silhouette to earn a gold star and unlock its head-start mode for later base spins.'],
    ];
    root.innerHTML = `<div class="intro-content"><span class="splash-eyebrow">WELCOME TO THE CITY</span><h1 id="intro-title">HEAT CHASE<span class="splash-period">.</span></h1><p class="splash-subtitle">GRAND ESCAPE</p><p class="intro-headline">One chase. A win of up to <strong>${MAX_WIN_MULTIPLIER.toLocaleString()}×</strong> your play amount.</p><div class="intro-features">${features.map(([art,title,copy]) => `<section class="intro-feature"><img src="assets/symbols/${art}" alt=""><div><h2>${title}</h2><p>${copy}</p></div></section>`).join('')}</div><button class="intro-enter" type="button">ENTER THE CITY &nbsp; →</button><p class="intro-foot">96% RTP · HIGH VOLATILITY · MAX WIN ${MAX_WIN_MULTIPLIER.toLocaleString()}×</p></div>`;
    document.body.appendChild(root);
    let done = false;
    const close = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
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
