const HEADER_BYTES = 12;
const FLOAT_SIZE = 4;

const PREDEFINED_URLS = {
    'Short Range': 'https://s3.us-central-1.wasabisys.com/aiden-encode-hic-mirror/apa-heatmaps/v27-1/hic_data_intra.short.bin',
    'Long Range': 'https://s3.us-central-1.wasabisys.com/aiden-encode-hic-mirror/apa-heatmaps/v27-1/hic_data_intra.long.bin',
    'Inter-chromosomal': 'https://s3.us-central-1.wasabisys.com/aiden-encode-hic-mirror/apa-heatmaps/v27-1/hic_data_inter.bin'
};

class HeatmapViewer {
    constructor() {
        this.datasets = {};
        this.activeDataset = null;
        this.keymap = {};
        this.matrixSize = 0;
        this.N = 0;
        this.dataOffset = 0;
        this.app = null;
        this.stemList = [];
        this.selectedStems = [];
        this.suggestions = [];
        this.activeSuggestion = -1;
        this.maxTags = 4;
        this.renderToken = 0;
        this.matrixCache = {};
        this.initializeUI();
        this.loadAllDatasets();
    }

    initializeUI() {
        this.binUrlInput = document.getElementById('binUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.randomBtn = document.getElementById('randomBtn');
        this.canvasContainer = document.getElementById('canvasContainer');
        this.stemTagInput = document.getElementById('stemTagInput');
        this.stemTags = document.getElementById('stemTags');
        this.stemAutocomplete = document.getElementById('stemAutocomplete');

        // Create dataset tabs
        const tabContainer = document.createElement('div');
        tabContainer.className = 'dataset-tabs';
        Object.keys(PREDEFINED_URLS).forEach(label => {
            const tab = document.createElement('button');
            tab.textContent = label;
            tab.className = 'dataset-tab';
            tab.dataset.dataset = label;
            tab.addEventListener('click', () => this.switchDataset(label));
            tabContainer.appendChild(tab);
        });
        this.binUrlInput.parentNode.insertBefore(tabContainer, this.binUrlInput);

        // Hide the URL input and load button since we're using tabs
        this.binUrlInput.style.display = 'none';
        this.loadBtn.style.display = 'none';

        this.randomBtn.addEventListener('click', () => this.selectRandomStems());
        this.stemTagInput.addEventListener('input', (e) => this.onInput(e));
        this.stemTagInput.addEventListener('keydown', (e) => this.onKeyDown(e));
        this.stemAutocomplete.addEventListener('mousedown', (e) => this.onAutocompleteClick(e));
        this.stemTagInput.addEventListener('blur', () => setTimeout(() => this.hideAutocomplete(), 100));
    }

    async loadAllDatasets() {
        const loadingContainer = document.createElement('div');
        loadingContainer.className = 'loading-container';
        loadingContainer.innerHTML = '<div class="loading-text">Loading datasets...</div>';
        this.canvasContainer.appendChild(loadingContainer);

        try {
            for (const [label, url] of Object.entries(PREDEFINED_URLS)) {
                const dataset = {
                    url,
                    keymap: {},
                    matrixSize: 0,
                    N: 0,
                    dataOffset: 0,
                    matrixCache: {}
                };

                // Load header
                const headerResp = await fetch(url, { headers: { Range: 'bytes=0-11' } });
                const headerBuf = await headerResp.arrayBuffer();
                const view = new DataView(headerBuf);
                const keymapLen = view.getUint32(0, true);
                dataset.matrixSize = view.getUint32(4, true);
                const dtype = view.getUint32(8, true);

                // Load keymap
                const keymapResp = await fetch(url, {
                    headers: { Range: `bytes=12-${11 + keymapLen}` }
                });
                const keymapText = await keymapResp.text();
                dataset.keymap = JSON.parse(keymapText);
                dataset.N = Object.keys(dataset.keymap).length;
                dataset.dataOffset = HEADER_BYTES + keymapLen;

                this.datasets[label] = dataset;
            }

            // Set initial dataset and stem list
            const firstDataset = Object.keys(PREDEFINED_URLS)[0];
            this.switchDataset(firstDataset);
            this.stemList = Object.keys(this.datasets[firstDataset].keymap);
            this.stemTagInput.disabled = false;
            this.selectRandomStems();
        } catch (error) {
            console.error('Error loading datasets:', error);
            loadingContainer.innerHTML = '<div class="error-text">Error loading datasets. Please refresh the page.</div>';
        }
    }

    switchDataset(label) {
        if (!this.datasets[label]) return;
        
        // Update active dataset
        this.activeDataset = label;
        const dataset = this.datasets[label];
        this.keymap = dataset.keymap;
        this.matrixSize = dataset.matrixSize;
        this.N = dataset.N;
        this.dataOffset = dataset.dataOffset;
        this.matrixCache = dataset.matrixCache;

        // Update UI
        document.querySelectorAll('.dataset-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.dataset === label);
        });

        // Re-render heatmaps with current stems
        this.renderHeatmaps();
    }

    async fetchMatrix(i, j) {
        const dataset = this.datasets[this.activeDataset];
        const cacheKey = `${dataset.url}|${i},${j}`;
        if (dataset.matrixCache[cacheKey]) {
            return dataset.matrixCache[cacheKey];
        }
        const matrixBytes = dataset.matrixSize * dataset.matrixSize * FLOAT_SIZE;
        const offset = dataset.dataOffset + (i * dataset.N + j) * matrixBytes;
        const resp = await fetch(dataset.url, {
            headers: { Range: `bytes=${offset}-${offset + matrixBytes - 1}` }
        });
        const buffer = await resp.arrayBuffer();
        const floatArray = new Float32Array(buffer);
        const matrix = [];
        for (let r = 0; r < dataset.matrixSize; r++) {
            matrix.push(floatArray.slice(r * dataset.matrixSize, (r + 1) * dataset.matrixSize));
        }
        dataset.matrixCache[cacheKey] = matrix;
        return matrix;
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
        if (!stem || this.selectedStems.includes(stem) || !this.stemList.includes(stem)) return;
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
        const center_peak_width = (res === 10) ? 5 : 1;
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
        return (center + 1) / (ll + 1);
    }

    mean(arr) {
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
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
                const rect = this.canvasContainer.getBoundingClientRect();
                tooltip.style.left = (rect.left + mouse.x + 2) + 'px';
                tooltip.style.top = (rect.top + mouse.y + 2) + 'px';
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