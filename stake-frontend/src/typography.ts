import './typography.css';

export const UI_FONT = "'Barlow Semi Condensed', 'Arial Narrow', Arial, sans-serif";

/** Canvas text must wait for the bundled font, otherwise it caches a fallback. */
export async function loadUiFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load("600 18px 'Barlow Semi Condensed'"),
    document.fonts.load("700 18px 'Barlow Semi Condensed'"),
  ]);
}
