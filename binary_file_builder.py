import os
import json
import numpy as np
import gc
from tqdm import tqdm

DISTANCES = ["intra.short", "intra.long", "inter"]
DISTANCES = ["intra.short"]

STEMS=["ADNP", "AFF4", "AGO1", "AGO2", "AHDC1", "AHR", "AKAP8L", ... , "ZSCAN9", "ZUFSP", "ZXDC", "ZZZ3"]



RES_DIR = "results"
OUT_DIR = "binary"
os.makedirs(OUT_DIR, exist_ok=True)

keymap = {stem: i for i, stem in enumerate(STEMS)}
keymap_json = json.dumps(keymap)
keymap_bytes = keymap_json.encode('utf-8')
keymap_len = len(keymap_bytes)
N = len(STEMS)

MATRIX_SIZE = None  # Will determine from first valid matrix
DTYPE_CODE = 1  # float32

for dist in DISTANCES:
    bin_path = os.path.join(OUT_DIR, f"hic_data_{dist}.bin")
    with open(bin_path, "wb") as bin_file:
        # Pass 1: find matrix size
        for i in range(N):
            for j in range(N):
                fname = f"{RES_DIR}/{dist}/hep_{dist}_{STEMS[i]}_{STEMS[j]}.txt"
                try:
                    matrix = np.loadtxt(fname)
                    MATRIX_SIZE = matrix.shape[0]
                    break
                except Exception:
                    continue
            if MATRIX_SIZE:
                break
        if MATRIX_SIZE is None:
            raise RuntimeError("Could not determine matrix size from any file.")

        # Write header
        header = np.array([keymap_len, MATRIX_SIZE, DTYPE_CODE], dtype=np.uint32).tobytes()
        bin_file.write(header)
        bin_file.write(keymap_bytes)

        # Write matrix data
        for i in tqdm(range(N), desc=f"Processing {dist}"):
            for j in range(N):
                fname = f"{RES_DIR}/{dist}/hep_{dist}_{STEMS[i]}_{STEMS[j]}.txt"
                try:
                    matrix = np.loadtxt(fname)
                    assert matrix.shape == (MATRIX_SIZE, MATRIX_SIZE)
                except Exception:
                    matrix = np.zeros((MATRIX_SIZE, MATRIX_SIZE), dtype=np.float32)
                bin_file.write(matrix.astype(np.float32).tobytes())
                del matrix
            gc.collect()
