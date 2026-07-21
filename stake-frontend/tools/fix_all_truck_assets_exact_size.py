import os
import cv2
import numpy as np
from PIL import Image
from rembg import remove

ASSETS_DIR = r"c:\Users\indik\dice spin stake\SLOT-3\stake-frontend\public\assets"
ORIGINAL_FRAME = os.path.join(ASSETS_DIR, "brinks_truck_frame.webp")

BRAIN_DIR = r"C:\Users\indik\.gemini\antigravity\brain\7b9a8e63-8cb7-4403-81c2-c30058a17731"
GEN_FRAME_NO_DOORS = os.path.join(BRAIN_DIR, "truck_frame_no_doors_1784577623486.png")
GEN_LEFT_DOOR = os.path.join(BRAIN_DIR, "truck_left_door_1784577667244.png")
GEN_RIGHT_DOOR = os.path.join(BRAIN_DIR, "truck_right_door_1784577685805.png")

def get_bbox(pil_img):
    arr = np.array(pil_img)
    alpha = arr[:, :, 3]
    y_idx, x_idx = np.where(alpha > 10)
    if len(y_idx) == 0:
        return 0, 0, pil_img.width, pil_img.height
    return x_idx.min(), y_idx.min(), x_idx.max(), y_idx.max()

def process_exact_size():
    orig_img = Image.open(ORIGINAL_FRAME).convert("RGBA")
    W, H = orig_img.size
    print(f"Target dimensions: {W} x {H}")

    # 1. Doorless Frame
    gen_frame = Image.open(GEN_FRAME_NO_DOORS).convert("RGBA")
    clean_frame = remove(gen_frame)
    
    # Bounding box of original truck body in brinks_truck_frame.webp
    # Original truck height: Y = 85 to 1445 (height = 1360 px)
    # Original truck width: X = 740 to 2010 (width = 1270 px without doors)
    
    fx1, fy1, fx2, fy2 = get_bbox(clean_frame)
    cropped_frame = clean_frame.crop((fx1, fy1, fx2, fy2))
    
    # Target size for the main truck body on 2750x1536 canvas:
    target_h = 1445 - 85   # 1360 px
    target_w = int(cropped_frame.width * (target_h / cropped_frame.height))
    
    resized_frame = cropped_frame.resize((target_w, target_h), Image.Resampling.LANCZOS)
    
    # Place in center horizontally, top aligned at Y=85
    pos_x = (W - target_w) // 2
    pos_y = 85
    
    frame_canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    frame_canvas.paste(resized_frame, (pos_x, pos_y), resized_frame)
    
    # Save Image 1
    out_no_doors_1 = os.path.join(ASSETS_DIR, "brinks_truck_no_doors.webp")
    out_no_doors_2 = os.path.join(ASSETS_DIR, "brinks_truck_frame_no_doors.webp")
    frame_canvas.save(out_no_doors_1, "WEBP", quality=95)
    frame_canvas.save(out_no_doors_2, "WEBP", quality=95)
    print("Saved Image 1 (2750x1536 doorless frame)")

    # Measure the exact opening coordinates of frame_canvas
    fc_arr = np.array(frame_canvas)
    fc_alpha = fc_arr[:, :, 3]
    
    # 2. Left Door (Flat/Closed with '6' Shield)
    gen_left = Image.open(GEN_LEFT_DOOR).convert("RGBA")
    clean_left = remove(gen_left)
    lx1, ly1, lx2, ly2 = get_bbox(clean_left)
    cropped_left = clean_left.crop((lx1, ly1, lx2, ly2))
    
    # Calculate door target position inside cargo opening
    # The cargo opening on frame_canvas is at X: pos_x + ~160 to pos_x + ~target_w//2
    # Cargo opening height: ~790 px
    door_target_h = int(target_h * 0.58)  # ~789 px
    door_target_w = int(cropped_left.width * (door_target_h / cropped_left.height))
    
    resized_left = cropped_left.resize((door_target_w, door_target_h), Image.Resampling.LANCZOS)
    
    # Position over left opening half
    left_x = pos_x + int(target_w * 0.175)
    left_y = pos_y + int(target_h * 0.135)
    
    left_canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    left_canvas.paste(resized_left, (left_x, left_y), resized_left)
    
    out_left_1 = os.path.join(ASSETS_DIR, "brinks_truck_left_door.webp")
    out_left_2 = os.path.join(ASSETS_DIR, "brinks_truck_door_left.webp")
    left_canvas.save(out_left_1, "WEBP", quality=95)
    left_canvas.save(out_left_2, "WEBP", quality=95)
    print("Saved Image 2 (2750x1536 left door)")

    # 3. Right Door (Flat/Closed)
    gen_right = Image.open(GEN_RIGHT_DOOR).convert("RGBA")
    clean_right = remove(gen_right)
    rx1, ry1, rx2, ry2 = get_bbox(clean_right)
    cropped_right = clean_right.crop((rx1, ry1, rx2, ry2))
    
    r_door_target_h = door_target_h
    r_door_target_w = int(cropped_right.width * (r_door_target_h / cropped_right.height))
    
    resized_right = cropped_right.resize((r_door_target_w, r_door_target_h), Image.Resampling.LANCZOS)
    
    # Position over right opening half
    right_x = left_x + door_target_w - 6  # seam overlap
    right_y = left_y
    
    right_canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    right_canvas.paste(resized_right, (right_x, right_y), resized_right)
    
    out_right_1 = os.path.join(ASSETS_DIR, "brinks_truck_right_door.webp")
    out_right_2 = os.path.join(ASSETS_DIR, "brinks_truck_door_right.webp")
    right_canvas.save(out_right_1, "WEBP", quality=95)
    right_canvas.save(out_right_2, "WEBP", quality=95)
    print("Saved Image 3 (2750x1536 right door)")

    # Save a combined preview to verify alignment!
    combo = Image.alpha_composite(frame_canvas, left_canvas)
    combo = Image.alpha_composite(combo, right_canvas)
    preview_path = os.path.join(ASSETS_DIR, "brinks_truck_doors_closed_preview.webp")
    combo.save(preview_path, "WEBP", quality=95)
    print(f"Saved combined closed-doors preview to {preview_path}")

if __name__ == "__main__":
    process_exact_size()
