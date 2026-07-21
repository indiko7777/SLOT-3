import os
import cv2
import numpy as np
from PIL import Image
from rembg import remove

# Input paths
ASSETS_DIR = r"c:\Users\indik\dice spin stake\SLOT-3\stake-frontend\public\assets"
ORIGINAL_FRAME = os.path.join(ASSETS_DIR, "brinks_truck_frame.webp")

BRAIN_DIR = r"C:\Users\indik\.gemini\antigravity\brain\7b9a8e63-8cb7-4403-81c2-c30058a17731"
GEN_FRAME_NO_DOORS = os.path.join(BRAIN_DIR, "truck_frame_no_doors_1784577623486.png")
GEN_LEFT_DOOR = os.path.join(BRAIN_DIR, "truck_left_door_1784577667244.png")
GEN_RIGHT_DOOR = os.path.join(BRAIN_DIR, "truck_right_door_1784577685805.png")

def clean_bg(img_path):
    img = Image.open(img_path).convert("RGBA")
    # Run rembg to strip non-transparent background
    out = remove(img)
    return out

def get_foreground_bbox(pil_img):
    arr = np.array(pil_img)
    alpha = arr[:, :, 3]
    y_idx, x_idx = np.where(alpha > 10)
    if len(y_idx) == 0:
        return 0, 0, pil_img.width, pil_img.height
    return x_idx.min(), y_idx.min(), x_idx.max(), y_idx.max()

def process_all():
    print("Loading original reference frame...")
    orig_img = Image.open(ORIGINAL_FRAME).convert("RGBA")
    W, H = orig_img.size
    print(f"Original frame dimensions: {W}x{H}")

    # -------------------------------------------------------------
    # 1. PROCESS TRUCK FRAME WITH NO DOORS
    # -------------------------------------------------------------
    print("Processing doorless truck frame...")
    gen_frame = clean_bg(GEN_FRAME_NO_DOORS)
    gen_frame_resized = gen_frame.resize((W, H), Image.Resampling.LANCZOS)
    
    # We create a composite frame:
    # Use high-res original for top roof, bottom bumper with cash & taillights, and pillar textures.
    # Replace left open door region (X < 750) and right open door region (X > 2005) with clean doorless frame.
    orig_arr = np.array(orig_img)
    gen_arr = np.array(gen_frame_resized)
    
    # Create empty 2750x1536 canvas
    no_doors_arr = np.zeros((H, W, 4), dtype=np.uint8)
    
    # Copy generated doorless frame
    no_doors_arr[:, :] = gen_arr
    
    # Blend high-res original roof and bumper onto the doorless frame for ultra crisp quality
    # Roof area: Y < 260
    # Bumper area: Y > 1060
    # Center pillars: X in [750, 930] and X in [1820, 2005]
    
    # Roof mask
    roof_mask = np.zeros((H, W), dtype=bool)
    roof_mask[:260, :] = True
    
    # Bumper mask
    bumper_mask = np.zeros((H, W), dtype=bool)
    bumper_mask[1060:, :] = True
    
    # Combine original roof and bumper where orig alpha > 0
    orig_alpha_mask = orig_arr[:, :, 3] > 20
    roof_combine = roof_mask & orig_alpha_mask
    bumper_combine = bumper_mask & orig_alpha_mask
    
    no_doors_arr[roof_combine] = orig_arr[roof_combine]
    no_doors_arr[bumper_combine] = orig_arr[bumper_combine]
    
    # Ensure cargo opening interior (X: 929..1826, Y: 266..1068) has empty dark opening / transparent opening
    # The prompt asked for: 'empty dark cargo opening'
    # We fill the opening with dark cargo box interior, and leave alpha = 255 (or transparent option)
    # Let's make it a dark cargo interior (#0f1115) with subtle shading, matching game opening
    cargo_y1, cargo_y2 = 266, 1068
    cargo_x1, cargo_x2 = 929, 1826
    
    # Make cargo opening inside empty dark
    cargo_region = no_doors_arr[cargo_y1:cargo_y2, cargo_x1:cargo_x2]
    # Set RGB to dark cargo interior (#0c0e12) where alpha is non-zero
    dark_mask = gen_arr[cargo_y1:cargo_y2, cargo_x1:cargo_x2, 3] > 0
    cargo_region[dark_mask, 0] = 12
    cargo_region[dark_mask, 1] = 14
    cargo_region[dark_mask, 2] = 18
    cargo_region[dark_mask, 3] = 255
    
    no_doors_img = Image.fromarray(no_doors_arr)
    
    # Save Image 1
    out_no_doors_path = os.path.join(ASSETS_DIR, "brinks_truck_no_doors.webp")
    out_no_doors_alt = os.path.join(ASSETS_DIR, "brinks_truck_frame_no_doors.webp")
    no_doors_img.save(out_no_doors_path, "WEBP", quality=95)
    no_doors_img.save(out_no_doors_alt, "WEBP", quality=95)
    print(f"Saved Image 1: {out_no_doors_path}")

    # -------------------------------------------------------------
    # 2. PROCESS LEFT DOOR ALONE (FLAT / CLOSED, '6' SHIELD)
    # -------------------------------------------------------------
    print("Processing left door alone...")
    gen_left = clean_bg(GEN_LEFT_DOOR)
    x1, y1, x2, y2 = get_foreground_bbox(gen_left)
    left_crop = gen_left.crop((x1, y1, x2, y2))
    
    # Target closed position for left door over rear opening:
    # Left door closed spans from left pillar inner edge (X: ~900) to center seam (X: ~1378), Y: ~260 to ~1070
    door_w = 1378 - 900
    door_h = 1070 - 260
    
    # Canvas 2750x1536
    left_door_canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    left_door_placed = left_crop.resize((door_w, door_h), Image.Resampling.LANCZOS)
    left_door_canvas.paste(left_door_placed, (900, 260), left_door_placed)
    
    # Save Image 2
    out_left_path = os.path.join(ASSETS_DIR, "brinks_truck_left_door.webp")
    out_left_alt = os.path.join(ASSETS_DIR, "brinks_truck_door_left.webp")
    left_door_canvas.save(out_left_path, "WEBP", quality=95)
    left_door_canvas.save(out_left_alt, "WEBP", quality=95)
    print(f"Saved Image 2: {out_left_path}")

    # -------------------------------------------------------------
    # 3. PROCESS RIGHT DOOR ALONE (FLAT / CLOSED)
    # -------------------------------------------------------------
    print("Processing right door alone...")
    gen_right = clean_bg(GEN_RIGHT_DOOR)
    rx1, ry1, rx2, ry2 = get_foreground_bbox(gen_right)
    right_crop = gen_right.crop((rx1, ry1, rx2, ry2))
    
    # Target closed position for right door over rear opening:
    # Right door closed spans from center seam (X: ~1377) to right pillar inner edge (X: ~1855), Y: ~260 to ~1070
    r_door_w = 1855 - 1377
    r_door_h = 1070 - 260
    
    # Canvas 2750x1536
    right_door_canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    right_door_placed = right_crop.resize((r_door_w, r_door_h), Image.Resampling.LANCZOS)
    right_door_canvas.paste(right_door_placed, (1377, 260), right_door_placed)
    
    # Save Image 3
    out_right_path = os.path.join(ASSETS_DIR, "brinks_truck_right_door.webp")
    out_right_alt = os.path.join(ASSETS_DIR, "brinks_truck_door_right.webp")
    right_door_canvas.save(out_right_path, "WEBP", quality=95)
    right_door_canvas.save(out_right_alt, "WEBP", quality=95)
    print(f"Saved Image 3: {out_right_path}")

    print("ALL 3 TRUCK ASSETS PROCESSED AND SAVED SUCCESSFULLY!")

if __name__ == "__main__":
    process_all()
