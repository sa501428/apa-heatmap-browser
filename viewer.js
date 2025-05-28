const HEADER_BYTES = 12;
const FLOAT_SIZE = 4;

class HeatmapViewer {
    constructor() {
        this.keymap = {};
        this.matrixSize = 0;
        this.N = 0;
        this.dataOffset = 0;
        this.app = null;
        this.selectedStems = new Set();
        
        this.initializeUI();
    }

    initializeUI() {
        this.binUrlInput = document.getElementById('binUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.stemSelect = document.getElementById('stemSelect');
        this.randomBtn = document.getElementById('randomBtn');
        this.canvasContainer = document.getElementById('canvasContainer');

        this.loadBtn.addEventListener('click', () => this.loadData());
        this.randomBtn.addEventListener('click', () => this.selectRandomStems());
        this.stemSelect.addEventListener('change', () => this.updateSelectedStems());
    }

    async loadData() {
        try {
            await this.loadHeader();
            this.populateStemSelect();
            this.selectRandomStems();
        } catch (error) {
            console.error('Error loading data:', error);
            alert('Error loading data. Please check the URL and try again.');
        }
    }

    async loadHeader() {
        const headerResp = await fetch(this.binUrlInput.value, { 
            headers: { Range: 'bytes=0-11' } 
        });
        const headerBuf = await headerResp.arrayBuffer();
        const view = new DataView(headerBuf);
        
        const keymapLen = view.getUint32(0, true);
        this.matrixSize = view.getUint32(4, true);
        const dtype = view.getUint32(8, true);

        const keymapResp = await fetch(this.binUrlInput.value, {
            headers: { Range: `bytes=12-${11 + keymapLen}` }
        });
        const keymapText = await keymapResp.text();
        this.keymap = JSON.parse(keymapText);
        this.N = Object.keys(this.keymap).length;
        this.dataOffset = HEADER_BYTES + keymapLen;
    }

    populateStemSelect() {
        this.stemSelect.innerHTML = '';
        Object.keys(this.keymap).forEach(stem => {
            const option = document.createElement('option');
            option.value = stem;
            option.textContent = stem;
            this.stemSelect.appendChild(option);
        });
    }

    selectRandomStems() {
        const stems = Object.keys(this.keymap);
        const numToSelect = Math.min(10, stems.length);
        const selected = new Set();
        
        while (selected.size < numToSelect) {
            const randomIndex = Math.floor(Math.random() * stems.length);
            selected.add(stems[randomIndex]);
        }

        Array.from(this.stemSelect.options).forEach(option => {
            option.selected = selected.has(option.value);
        });
        
        this.updateSelectedStems();
    }

    updateSelectedStems() {
        this.selectedStems = new Set(
            Array.from(this.stemSelect.selectedOptions).map(option => option.value)
        );
        this.renderHeatmaps();
    }

    getColorLimit(matrix) {
        const r = matrix.length;
        const buffer = Math.floor(r / 4);
        const cornerMean = this.mean(
            matrix.slice(0, buffer).map(row => this.mean(row.slice(-buffer)))
        );
        return 3 * cornerMean;
    }

    getScore(matrix) {
        const r = matrix.length;
        const buffer = Math.floor(r / 4);
        const rc = Math.floor(r / 2);
        const cpw = 2; // res = 100
        const center = this.mean(
            matrix.slice(rc - cpw, rc + cpw + 1).flat()
        );
        const corner = this.mean(
            matrix.slice(-buffer).map(row => this.mean(row.slice(0, buffer)))
        );
        return corner !== 0 ? center / corner : 0;
    }

    mean(arr) {
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    async fetchMatrix(i, j) {
        const matrixBytes = this.matrixSize * this.matrixSize * FLOAT_SIZE;
        const offset = this.dataOffset + (i * this.N + j) * matrixBytes;
        const resp = await fetch(this.binUrlInput.value, {
            headers: { Range: `bytes=${offset}-${offset + matrixBytes - 1}` }
        });
        const buffer = await resp.arrayBuffer();
        const floatArray = new Float32Array(buffer);

        const matrix = [];
        for (let r = 0; r < this.matrixSize; r++) {
            matrix.push(floatArray.slice(r * this.matrixSize, (r + 1) * this.matrixSize));
        }
        return matrix;
    }

    matrixToTexture(matrix, colorLimit) {
        const size = matrix.length;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Avoid division by zero: if colorLimit is 0, set to 1
        const safeColorLimit = colorLimit === 0 ? 1 : colorLimit;

        const imgData = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const val = matrix[y][x];
                const red = Math.min(255, Math.floor((val / safeColorLimit) * 255));
                const i = (y * size + x) * 4;
                imgData.data[i + 0] = 255;        // R
                imgData.data[i + 1] = 255 - red;  // G
                imgData.data[i + 2] = 255 - red;  // B
                imgData.data[i + 3] = 255;        // A
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return PIXI.Texture.from(canvas);
    }

    async renderHeatmaps() {
        if (this.app) {
            this.app.destroy(true);
        }

        const stems = Array.from(this.selectedStems);
        const matrices = [];
        const labels = [];

        for (let i = 0; i < stems.length; i++) {
            for (let j = 0; j < stems.length; j++) {
                const matrix = await this.fetchMatrix(
                    this.keymap[stems[i]], 
                    this.keymap[stems[j]]
                );
                matrices.push(matrix);
                labels.push(`${stems[i]}-${stems[j]}`);
            }
        }

        const gridSize = Math.ceil(Math.sqrt(matrices.length));
        const cellSize = 40;
        const margin = 4;
        const totalSize = gridSize * (cellSize + margin);

        this.app = new PIXI.Application({ 
            width: totalSize, 
            height: totalSize, 
            backgroundColor: 0xffffff 
        });
        this.canvasContainer.innerHTML = '';
        this.canvasContainer.appendChild(this.app.view);

        const colorMaps = matrices.map(mat => this.getColorLimit(mat));

        matrices.forEach((mat, idx) => {
            const lim = colorMaps[idx];
            const tex = this.matrixToTexture(mat, lim);
            const sprite = new PIXI.Sprite(tex);
            const row = Math.floor(idx / gridSize);
            const col = idx % gridSize;
            sprite.x = col * (cellSize + margin);
            sprite.y = row * (cellSize + margin);
            sprite.width = cellSize;
            sprite.height = cellSize;
            this.app.stage.addChild(sprite);

            // Add label
            const label = new PIXI.Text(labels[idx], {
                fontSize: 8,
                fill: 0x000000
            });
            label.x = sprite.x;
            label.y = sprite.y - 12;
            this.app.stage.addChild(label);
        });
    }
}

// Initialize the viewer when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new HeatmapViewer();
}); 