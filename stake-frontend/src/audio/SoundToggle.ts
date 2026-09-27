import './soundToggle.css';

/** Audio remains reachable while the chase hides the base-game HUD. */
export class SoundToggle {
  private readonly button = document.createElement('button');

  constructor(onToggle: () => Promise<void>) {
    this.button.className = 'hc-sound-toggle';
    this.button.type = 'button';
    this.button.hidden = true;
    this.button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z"/><path class="hc-sound-waves" d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="hc-sound-slash" d="m3 3 18 18"/></svg>`;
    // A focused audio button must not also slam a win counter or spin the reels.
    this.button.addEventListener('keydown', event => {
      if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
    });
    this.button.addEventListener('click', event => {
      event.stopPropagation();
      void onToggle();
    });
    document.body.appendChild(this.button);
  }

  update(visible: boolean, muted: boolean): void {
    this.button.hidden = !visible;
    this.button.classList.toggle('muted', muted);
    this.button.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    this.button.setAttribute('aria-pressed', String(muted));
    this.button.title = muted ? 'Sound off' : 'Sound on';
  }
}
