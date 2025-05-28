const HEADER_BYTES = 12;
const FLOAT_SIZE = 4;

class HeatmapViewer {
    constructor() {
        this.keymap = {};
        this.matrixSize = 0;
        this.N = 0;
        this.dataOffset = 0;
        this.app = null;
        this.stemList = [];
        this.selectedStems = [];
        this.suggestions = [];
        this.activeSuggestion = -1;
        this.maxTags = 10;
        this.renderToken = 0;
        this.initializeUI();
    }

    initializeUI() {
        this.binUrlInput = document.getElementById('binUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.randomBtn = document.getElementById('randomBtn');
        this.canvasContainer = document.getElementById('canvasContainer');
        this.stemTagInput = document.getElementById('stemTagInput');
        this.stemTags = document.getElementById('stemTags');
        this.stemAutocomplete = document.getElementById('stemAutocomplete');

        this.loadBtn.addEventListener('click', () => this.loadData());
        this.randomBtn.addEventListener('click', () => this.selectRandomStems());
        this.stemTagInput.addEventListener('input', (e) => this.onInput(e));
        this.stemTagInput.addEventListener('keydown', (e) => this.onKeyDown(e));
        this.stemAutocomplete.addEventListener('mousedown', (e) => this.onAutocompleteClick(e));
        this.stemTagInput.addEventListener('blur', () => setTimeout(() => this.hideAutocomplete(), 100));
    }

    async loadData() {
        try {
            await this.loadHeader();
            this.stemList = Object.keys(this.keymap);
            this.selectedStems = [];
            this.renderTags();
            this.stemTagInput.value = '';
            this.stemTagInput.disabled = false;
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

    // --- Tag Input Logic ---
    renderTags() {
        this.stemTags.innerHTML = '';
        this.selectedStems.forEach(stem => {
            const tag = document.createElement('span');
            tag.className = 'stem-tag';
            tag.textContent = stem;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-tag';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => this.removeTag(stem));
            tag.appendChild(removeBtn);
            this.stemTags.appendChild(tag);
        });
        this.renderHeatmaps();
    }

    addTag(stem) {
        if (!stem || this.selectedStems.includes(stem) || !this.stemList.includes(stem) || this.selectedStems.length >= this.maxTags) return;
        this.selectedStems.push(stem);
        this.renderTags();
        this.stemTagInput.value = '';
        this.hideAutocomplete();
    }

    removeTag(stem) {
        this.selectedStems = this.selectedStems.filter(s => s !== stem);
        this.renderTags();
    }

    onInput(e) {
        const value = e.target.value.trim();
        if (!value) {
            this.hideAutocomplete();
            return;
        }
        this.suggestions = this.stemList.filter(stem =>
            stem.toLowerCase().includes(value.toLowerCase()) &&
            !this.selectedStems.includes(stem)
        ).slice(0, 10);
        this.activeSuggestion = -1;
        this.showAutocomplete();
    }

    onKeyDown(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (this.suggestions.length > 0 && this.activeSuggestion >= 0) {
                this.addTag(this.suggestions[this.activeSuggestion]);
            } else {
                this.addTag(this.stemTagInput.value.trim());
            }
        } else if (e.key === 'ArrowDown') {
            if (this.suggestions.length > 0) {
                this.activeSuggestion = (this.activeSuggestion + 1) % this.suggestions.length;
                this.showAutocomplete();
            }
        } else if (e.key === 'ArrowUp') {
            if (this.suggestions.length > 0) {
                this.activeSuggestion = (this.activeSuggestion - 1 + this.suggestions.length) % this.suggestions.length;
                this.showAutocomplete();
            }
        } else if (e.key === 'Backspace' && this.stemTagInput.value === '') {
            this.selectedStems.pop();
            this.renderTags();
        }
    }

    showAutocomplete() {
        this.stemAutocomplete.innerHTML = '';
        if (this.suggestions.length === 0) {
            this.stemAutocomplete.style.display = 'none';
            return;
        }
        this.suggestions.forEach((stem, idx) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item' + (idx === this.activeSuggestion ? ' active' : '');
            item.textContent = stem;
            item.dataset.stem = stem;
            this.stemAutocomplete.appendChild(item);
        });
        this.stemAutocomplete.style.display = 'block';
    }

    hideAutocomplete() {
        this.stemAutocomplete.style.display = 'none';
    }

    onAutocompleteClick(e) {
        if (e.target.classList.contains('autocomplete-item')) {
            this.addTag(e.target.dataset.stem);
        }
    }

    selectRandomStems() {
        if (!this.stemList.length) return;
        const stems = [...this.stemList];
        const selected = [];
        while (selected.length < Math.min(this.maxTags, stems.length)) {
            const idx = Math.floor(Math.random() * stems.length);
            selected.push(stems.splice(idx, 1)[0]);
        }
        this.selectedStems = selected;
        this.renderTags();
        this.stemTagInput.value = '';
        this.hideAutocomplete();
    }

    // --- Heatmap Logic ---
    getColorLimit(matrix) {
        const r = matrix.length;
        const buffer = Math.floor(r / 4);
        const cornerMean = this.mean(
            matrix.slice(0, buffer).map(row => this.mean(row.slice(-buffer)))
        );
        return 3 * cornerMean;
    }

    getScore(matrix, res = 100) {
        const r = matrix.length;
        if (r === 0) return 0;
        const center_peak_width = (res === 10) ? 5 : 2;
        const buffer = Math.floor(r / 4);
        const rc = Math.floor(r / 2);

        // Center region: matrix[rc - cpw : rc + cpw + 1, rc - cpw : rc + cpw + 1]
        const start = Math.max(0, rc - center_peak_width);
        const end = Math.min(r, rc + center_peak_width + 1);
        let centerVals = [];
        for (let i = start; i < end; i++) {
            for (let j = start; j < end; j++) {
                centerVals.push(matrix[i][j]);
            }
        }
        const center = this.mean(centerVals);

        // Lower-left region: matrix[-buffer:, :buffer]
        let llVals = [];
        for (let i = r - buffer; i < r; i++) {
            for (let j = 0; j < buffer; j++) {
                if (i >= 0 && j < r) llVals.push(matrix[i][j]);
            }
        }
        const ll = this.mean(llVals);

        if (!isFinite(center) || !isFinite(ll) || ll === 0) return 0;
        return center / ll;
    }

    mean(arr) {
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
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
        const myToken = ++this.renderToken;
        if (this.app) {
            try {
                // Defensive: remove resize plugin if it exists and has no cancelResize
                const resizePlugin = this.app.renderer?.plugins?.resize;
                if (resizePlugin && typeof resizePlugin.cancelResize !== 'function') {
                    delete this.app.renderer.plugins.resize;
                }
                this.app.destroy(true, { children: true, texture: true, baseTexture: true });
            } catch (e) {
                // Swallow known PixiJS destroy errors
                console.warn('PixiJS destroy error:', e);
            }
        }
        const stems = this.selectedStems;
        if (!stems.length) {
            this.canvasContainer.innerHTML = '<div style="color:#888;padding:20px;">No STEMs selected.</div>';
            return;
        }
        const matrices = [];
        const labels = [];
        const scores = [];
        for (let i = 0; i < stems.length; i++) {
            for (let j = 0; j < stems.length; j++) {
                if (myToken !== this.renderToken) return;
                const matrix = await this.fetchMatrix(
                    this.keymap[stems[i]], 
                    this.keymap[stems[j]]
                );
                if (myToken !== this.renderToken) return;
                matrices.push(matrix);
                labels.push(`${stems[i]} - ${stems[j]}`);
                scores.push(this.getScore(matrix).toFixed(2));
            }
        }
        if (myToken !== this.renderToken) return;
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
        let tooltip = document.getElementById('heatmap-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'heatmap-tooltip';
            tooltip.style.position = 'fixed';
            tooltip.style.pointerEvents = 'none';
            tooltip.style.background = 'rgba(30,40,80,0.95)';
            tooltip.style.color = '#fff';
            tooltip.style.padding = '6px 12px';
            tooltip.style.borderRadius = '6px';
            tooltip.style.fontSize = '13px';
            tooltip.style.zIndex = 1000;
            tooltip.style.display = 'none';
            document.body.appendChild(tooltip);
        }
        matrices.forEach((mat, idx) => {
            if (myToken !== this.renderToken) return;
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
            sprite.interactive = true;
            sprite.on('pointerover', (event) => {
                tooltip.innerHTML = `<b>${labels[idx]}</b><br>APA score: <b>${scores[idx]}</b>`;
                tooltip.style.display = 'block';
            });
            sprite.on('pointermove', (event) => {
                const mouse = event.data.global;
                tooltip.style.left = (window.scrollX + this.canvasContainer.getBoundingClientRect().left + mouse.x + 10) + 'px';
                tooltip.style.top = (window.scrollY + this.canvasContainer.getBoundingClientRect().top + mouse.y + 10) + 'px';
            });
            sprite.on('pointerout', () => {
                tooltip.style.display = 'none';
            });
        });
    }
}

// Initialize the viewer when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new HeatmapViewer();
}); 