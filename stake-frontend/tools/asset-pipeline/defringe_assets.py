#!/usr/bin/env python3
"""Precision edge defringing and black halo cleanup script.

Cleans leftover dark background halos from semi-transparent alpha edges
and trapped near-black pixels from background removal tools.
"""

import sys
import glob
from pathlib import Path
from PIL import Image
import numpy as np


def clean_image(img_path: Path, max_dark_rgb: int = 55, alpha_threshold: int = 250) -> bool:
    img = Image.open(img_path).convert("RGBA")
    arr = np.array(img, dtype=np.uint8)
    
    r = arr[:, :, 0].astype(int)
    g = arr[:, :, 1].astype(int)
    b = arr[:, :, 2].astype(int)
    a = arr[:, :, 3].astype(int)
    
    # 1. Clear solid or semi-solid near-black pixels trapped inside/around the art
    # (r < 15, g < 15, b < 15)
    pure_black_mask = (a > 100) & (r < 18) & (g < 18) & (b < 18)
    
    # 2. Semi-transparent edge dark halo pixels: alpha < alpha_threshold and r,g,b < max_dark_rgb
    edge_dark_mask = (a > 0) & (a < alpha_threshold) & (r < max_dark_rgb) & (g < max_dark_rgb) & (b < max_dark_rgb)
    
    # 3. For glow layers (filenames containing 'glow'), semi-transparent pixels with low brightness (r+g+b < 120) are background artifacts
    is_glow = "glow" in img_path.name.lower()
    if is_glow:
        glow_dark_mask = (a > 0) & (a < 240) & ((r + g + b) < 140)
        combined_mask = pure_black_mask | edge_dark_mask | glow_dark_mask
    else:
        combined_mask = pure_black_mask | edge_dark_mask
        
    num_affected = np.sum(combined_mask)
    if num_affected == 0:
        return False
        
    # Clear affected pixels to fully transparent
    arr[combined_mask, 3] = 0
    
    # Additional edge alpha smoothing: for pixels with remaining low alpha (< 30), clear to prevent faint dust
    faint_dust = (arr[:, :, 3] > 0) & (arr[:, :, 3] < 20) & (r < 70) & (g < 70) & (b < 70)
    arr[faint_dust, 3] = 0
    
    out_img = Image.fromarray(arr, mode="RGBA")
    
    # Save depending on file extension
    if img_path.suffix.lower() == ".webp":
        out_img.save(img_path, "WEBP", quality=95, method=6)
    else:
        out_img.save(img_path, "PNG", compress_level=6)
        
    print(f"Cleaned {img_path.name}: {num_affected} dark halo/black pixels cleared.")
    return True


def main():
    paths = sys.argv[1:]
    if not paths:
        print("Usage: python defringe_assets.py <file_or_glob_pattern>...")
        sys.exit(1)
        
    for p_str in paths:
        for p in glob.glob(p_str, recursive=True):
            file_path = Path(p)
            if file_path.is_file() and file_path.suffix.lower() in ('.png', '.webp'):
                clean_image(file_path)

if __name__ == "__main__":
    main()
