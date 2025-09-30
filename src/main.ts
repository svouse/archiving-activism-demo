import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* ===========================
   Types
   =========================== */
type CloudItem = {
    id: string | number;
    title: string;
    year: number | null;
    repository: string | null;
    mediaType: string | null;
    description: string | null;
    schoolPrimary: string | null;
    schoolSecondary: string | null;
    tags: string[];
    link: string | null;
    previewLocal: string;
    documentDirect?: string | null;
};

type FullRecord = {
    id: string | number;
    title: string;
    year?: number | null;
    repository?: string | null;
    location?: string | null;
    mediaType?: string | null;
    description?: string | null;
    schoolPrimary?: string | null;
    schoolSecondary?: string | null;
    tags?: string[];
    url?: string | null;
    hires?: string[];
    permissions?: boolean;
    thumbSource?: string | null;
    topics?: string[]; // present in your manifest
};

type Doc = {
    id: string | number;
    title: string;
    year?: string | number | null;
    url?: string | null;
    // Kept for legacy, but ring color now keys off school
    topic?: 'protest' | 'flyer' | 'surveillance' | 'policy' | 'media' | 'other';
    tags?: string[];
    repo?: string | null;
    iconURL: string;
    schoolPrimary?: string | null;
    description?: string | null;
    topicTitle?: string | null; // first entry of manifest.topics
};

type SpriteWithMeta = THREE.Sprite & { meta?: Doc };

/* ===========================
   Config
   =========================== */
const SCHOOL_LANES = [
    'Direct Activism & Advocacy',
    'University-Based Politics',
    'Public Education',
    'Pedagogy & Training',
    null, // unknown
];

const SCHOOL_COLOR: Record<string, number> = {
    'Direct Activism & Advocacy': 0xef6f6c,
    'University-Based Politics': 0x7ca982,
    'Public Education': 0xb284be,
    'Pedagogy & Training': 0xd2c7b1,
    other: 0xa0a0a0,
};

const TOPIC_COLOR: Record<string, number> = {
    protest: 0xef6f6c,
    flyer: 0xc85e3a,
    surveillance: 0x8a8a8a,
    policy: 0xd2c7b1,
    media: 0x426a5a,
    other: 0xaaaaaa,
};

// --- Period highlighting helpers ---
function numericYear(y: string | number | null | undefined): number | null {
    if (typeof y === 'number' && Number.isFinite(y)) return y;
    if (typeof y === 'string') {
        const n = parseInt(y, 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

const PERIODS: Record<'precursors' | 'thick' | 'today', [number, number]> = {
    precursors: [1940, 1959],
    thick: [1960, 1989],
    today: [1990, 2100],
};

let activePeriodKey: keyof typeof PERIODS | null = null;

/* ===========================
   DOM
   =========================== */
const hoverTip = document.getElementById('hoverTip') as HTMLDivElement;
const card = document.getElementById('infoCard') as HTMLDivElement;
const cardHeader = document.querySelector('.info-card__header') as HTMLDivElement;
const cardTitle = document.getElementById('infoTitle') as HTMLSpanElement;
const cardYear = document.getElementById('infoYear') as HTMLSpanElement;
const cardRepo = document.getElementById('infoRepo') as HTMLSpanElement;
const cardThumb = document.getElementById('infoThumb') as HTMLImageElement;
const cardLink = document.getElementById('infoLink') as HTMLAnchorElement;
const tagChips = document.getElementById('tagChips') as HTMLDivElement;
const hintEl = document.getElementById('hint') as HTMLDivElement;

/* ===========================
   Three.js
   =========================== */
let scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
const group = new THREE.Group();
const loader = new THREE.TextureLoader();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let selectionRing: THREE.Mesh | null = null;
let selectedObj: THREE.Sprite | null = null;
const sprites: SpriteWithMeta[] = [];

let autoRotate = true;
let lastInteraction = Date.now();

const _worldPos = new THREE.Vector3();
const _worldScale = new THREE.Vector3();
const _camDir = new THREE.Vector3();

/* ===========================
   Data state
   =========================== */
let DOCS: Doc[] = [];
let CLOUD: CloudItem[] = [];
let BY_ID: Record<string, FullRecord> = {};

/* ===========================
   Boot
   =========================== */
init();

async function init() {
    setupThree();

    await loadArchiveData();
    DOCS = buildDocsFromData(CLOUD, BY_ID);

    const positions = positionsRingTime(DOCS, {
        R: 300,
        zRange: 280,
        angleJitter: 0.26,
        timeAngle: 0.2,
        timeRadial: 36,
        liftY: 0, // visual center handled by full-viewport canvas
    });

    buildSprites(positions, DOCS);

    // Search UI wiring
    const searchToggle = document.getElementById('searchToggle') as HTMLButtonElement | null;
    const searchPanel  = document.getElementById('searchPanel')  as HTMLDivElement | null;
    const searchInput  = document.getElementById('searchInput')  as HTMLInputElement | null;
    const searchClear  = document.getElementById('searchClear')  as HTMLButtonElement | null;

    searchToggle?.addEventListener('click', () => {
        if (!searchPanel) return;
        const hidden = searchPanel.hasAttribute('hidden');
        if (hidden) searchPanel.removeAttribute('hidden'); else searchPanel.setAttribute('hidden', '');
        if (!hidden) return;
        setTimeout(() => searchInput?.focus(), 0);
    });

    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value || "";
        updateVisibility();
    });

    searchClear?.addEventListener('click', () => {
        if (searchInput) searchInput.value = "";
        searchQuery = "";
        updateVisibility();
    });

// ENTER to apply (already applies on input), ESC to close the panel
    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchPanel?.setAttribute('hidden', '');
            (document.activeElement as HTMLElement)?.blur();
        }
    });

    // Period chips: #precursors, #thick, #today live in .timeline-cards
    const periodEls = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('.timeline-cards .chip')
    );
    periodEls.forEach((el) => {
        el.addEventListener('click', (ev) => {
            ev.preventDefault(); // don't jump the page
            const key = (el.getAttribute('href') || '').replace(/^#/, '') as keyof typeof PERIODS;
            if (!PERIODS[key]) return;

            // toggle behavior: click the same chip again to clear
            if (activePeriodKey === key) {
                clearHighlight();
            } else {
                applyHighlightForPeriod(key);
            }
        });
    });

    // Also support hash changes
    window.addEventListener('hashchange', () => {
        const key = (location.hash || '').replace(/^#/, '') as keyof typeof PERIODS;
        if (PERIODS[key]) applyHighlightForPeriod(key);
        else clearHighlight();
    });

    // Single ESC handler: close card else clear highlight
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const isCardVisible = card && card.style.display !== 'none';
            if (isCardVisible) {
                card.style.display = 'none';
            } else {
                clearHighlight();
                updatePeriodCardUI(null);
            }
        }
    });

    animate();
}

/* ===========================
   Data loading + mapping
   =========================== */
async function loadArchiveData() {
    const [cloud, byId] = await Promise.all([
        fetch(new URL('../public/data/cloud.resources.json', import.meta.url)).then((r) => r.json()),
        fetch(new URL('../public/data/resources.byId.json', import.meta.url)).then((r) => r.json()),
    ]);
    CLOUD = cloud as CloudItem[];
    BY_ID = byId as Record<string, FullRecord>;
}

// Base search state
let searchQuery = "";

// Remove first 3 underscore-delimited parts and extension; tidy spaces
function cleanFileDisplay(name: string): string {
    const base = name.split('/').pop() || name;
    const noExt = base.replace(/\.[a-z0-9]+$/i, '');
    const parts = noExt.split('_');
    const kept = parts.slice(3).join(' ').replace(/[-]+/g, ' ');
    return kept.replace(/\s+/g, ' ').trim();
}

// Decide what to show as title in UI (does not mutate the manifest)
function displayTitleFor(meta: Doc): string {
    const rec = BY_ID[String(meta.id)];
    // If meta.title looks like a filename pattern (contains underscores and an extension inside), clean it.
    if (rec?.title && /_/.test(rec.title)) return cleanFileDisplay(rec.title);
    if (meta.title && /_/.test(meta.title)) return cleanFileDisplay(meta.title);
    // Else try cleaning from URL/hires filename if title is missing
    const fromUrl = rec?.hires?.[0] || meta.url || "";
    if (fromUrl) {
        const base = fromUrl.split('/').pop() || "";
        if (/_/.test(base)) return cleanFileDisplay(base);
    }
    return meta.title || rec?.title || "Untitled";
}

// Tokenize, support tag:foo filters (AND across tokens)
function matchesQuery(meta: Doc, q: string): boolean {
    if (!q.trim()) return true;
    const rec = BY_ID[String(meta.id)];
    const hay = [
        displayTitleFor(meta).toLowerCase(),
        (meta.description || "").toLowerCase(),
        ...(meta.tags || []).map(t => String(t).toLowerCase()),
        ...(rec?.tags || []).map(t => String(t).toLowerCase()),
    ];

    // parse tokens
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    let ok = true;
    for (const t of tokens) {
        const tagMatch = t.match(/^tag:(.+)$/);
        if (tagMatch) {
            const want = tagMatch[1];
            const tagPool = new Set([...(meta.tags || []), ...(rec?.tags || [])].map(x => String(x).toLowerCase()));
            if (!tagPool.has(want)) { ok = false; break; }
        } else {
            // plain term must appear in any hay entry
            if (!hay.some(h => h.includes(t))) { ok = false; break; }
        }
    }
    return ok;
}

// Combined filter (period chip + search). Controls sprite visibility styling.
function updateVisibility() {
    const [minY, maxY] = activePeriodKey ? PERIODS[activePeriodKey] : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    sprites.forEach((spr) => {
        const meta = (spr as any).meta as Doc;
        const y = numericYear(meta?.year as any);
        const inPeriod = !activePeriodKey || (y !== null && y >= minY && y <= maxY);
        const searchOk = matchesQuery(meta, searchQuery);
        setSpriteState(spr, inPeriod && searchOk);
    });
}

function buildDocsFromData(
    cloud: CloudItem[],
    byId: Record<string, FullRecord>
): Doc[] {
    return cloud.map((it) => {
        const rec = byId[String(it.id)];
        const url = it.documentDirect || rec?.url || it.link || null;

        // topic label from manifest.topics[0]
        const topicTitle =
            Array.isArray(rec?.topics) && rec!.topics!.length ? String(rec!.topics![0]) : null;

        // rough topic bucket (optional tinting)
        const mt = (it.mediaType || rec?.mediaType || '').toLowerCase();
        let topic: Doc['topic'] = 'other';
        if (mt.includes('protest')) topic = 'protest';
        else if (mt.includes('flyer')) topic = 'flyer';
        else if (mt.includes('surveillance')) topic = 'surveillance';
        else if (mt.includes('policy')) topic = 'policy';
        else if (mt.includes('media') || mt.includes('newspaper') || mt.includes('press')) topic = 'media';

        return {
            id: it.id,
            title: it.title || rec?.title || 'Untitled',
            year: it.year ?? rec?.year ?? null,
            url,
            topic,
            tags: (rec?.tags && rec.tags.length ? rec.tags : it.tags) || [],
            repo: rec?.repository ?? it.repository ?? null,
            iconURL: it.previewLocal,
            schoolPrimary: rec?.schoolPrimary ?? it.schoolPrimary ?? null,
            description: rec?.description ?? it.description ?? null,
            topicTitle,
        };
    });
}

/* ===========================
   Scene
   =========================== */
function setupThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 6000);
    camera.position.z = 900;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // @ts-ignore
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Mount canvas inside #app, behind UI
    const appEl = document.getElementById('app') as HTMLElement;
    appEl.style.position = 'relative';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.zIndex = '0';
    appEl.prepend(renderer.domElement);

    // Keep clicks on the card from bubbling to canvas
    card.addEventListener('click', (e) => e.stopPropagation());

    // “Open Document” default behavior if not intercepted later
    cardLink.addEventListener('click', (e) => {
        e.stopPropagation();
        cardLink.target = '_blank';
        cardLink.rel = 'noopener';
    });

    const c = renderer.domElement;
    c.style.position = 'fixed';
    c.style.inset = '0';
    c.style.width = '100vw';
    c.style.height = '100vh';
    c.style.zIndex = '0';
    c.style.pointerEvents = 'auto'; // allow orbit/picking

    if (hoverTip) hoverTip.style.zIndex = '20';
    if (hintEl) hintEl.style.zIndex = '20';

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.addEventListener('start', () => hideHint());
    controls.addEventListener('change', () => {
        lastInteraction = Date.now();
        autoRotate = false;
    });

    scene.fog = new THREE.FogExp2(0x000000, 0.0009);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('mousemove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(group.children);
        if (hits.length) {
            const spr = hits[0].object as THREE.Sprite;
            const meta: Doc = (spr as any).meta || {};
            hoverTip.style.display = 'block';
            hoverTip.style.left = `${e.clientX + 12}px`;
            hoverTip.style.top = `${e.clientY + 12}px`;
            hoverTip.textContent = meta.title || '—';
        } else {
            hoverTip.style.display = 'none';
        }
    });

    // Click in empty space clears; clicking a sprite selects
    window.addEventListener('click', () => {
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(group.children);
        if (!hits.length) {
            clearSelection();
            return;
        }
        selectSprite(hits[0].object as THREE.Sprite);
    });

    setTimeout(() => hideHint(), 3500);
}

/* ===========================
   Layout helpers
   =========================== */
// OG ring with subtle time influence (angle + radius), organic but clean
function positionsRingTime(
    docs: Doc[],
    opts?: {
        R?: number;
        zRange?: number;
        angleJitter?: number;
        timeAngle?: number;
        timeRadial?: number;
        liftY?: number;
    }
): THREE.Vector3[] {
    const { R = 300, zRange = 140, angleJitter = 0.18, timeAngle = 0.22, timeRadial = 40, liftY = 0 } =
    opts || {};

    const ys = docs
        .map((d) => (typeof d.year === 'number' ? d.year : parseInt(String(d.year ?? ''), 10)))
        .filter((n) => Number.isFinite(n)) as number[];
    const yMin = Math.min(...(ys.length ? ys : [1960]));
    const yMax = Math.max(...(ys.length ? ys : [1999]));
    const span = Math.max(1, yMax - yMin);

    const PHI = Math.PI * (3 - Math.sqrt(5));
    const n = docs.length;
    const pts: THREE.Vector3[] = [];

    for (let i = 0; i < n; i++) {
        const d = docs[i];
        const yVal = typeof d.year === 'number' ? d.year : parseInt(String(d.year ?? ''), 10);
        const t = Number.isFinite(yVal) ? (yVal - yMin) / span : 0.5;

        let a = i * PHI;
        a += (t - 0.5) * timeAngle;
        a += (Math.sin(i * 1.27) * 0.5 + Math.cos(i * 0.73) * 0.5) * angleJitter;

        let r = R + (t - 0.5) * timeRadial;
        r += (Math.sin(i * 0.91) * 0.5 + Math.cos(i * 1.11) * 0.5) * 12;

        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r + liftY;
        const z = ((Math.sin(i * 0.37) + Math.cos(i * 0.19)) * 0.5) * zRange;

        pts.push(new THREE.Vector3(x, y, z));
    }

    return pts;
}

/* ===========================
   Sprites
   =========================== */
function buildSprites(positions: THREE.Vector3[], docs: Doc[]) {
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    docs.forEach((doc, i) => {
        loader.load(
            doc.iconURL,
            (texture) => {
                // @ts-ignore
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = maxAniso;
                texture.generateMipmaps = true;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;

                const mat = new THREE.SpriteMaterial({
                    map: texture,
                    color: 0xf5e7d6,
                    transparent: true,
                    opacity: 1.0,
                });

                const sprite = new THREE.Sprite(mat) as SpriteWithMeta;

                sprite.scale.set(60 + Math.random() * 28, (60 + Math.random() * 28) * (0.85 + Math.random() * 0.25), 1);
                sprite.position.copy(positions[i] || new THREE.Vector3());
                (sprite as any).meta = doc;
                (sprite as any).userData = { id: doc.id };

                sprites.push(sprite);
                group.add(sprite);
            },
            undefined,
            (err) => console.error('Failed to load icon', doc.iconURL, err)
        );
    });

    scene.add(group);
    group.position.y -= 150;
}

/* ===========================
   Selection / Card
   =========================== */
function setSpriteState(spr: SpriteWithMeta, active: boolean) {
    const mat = spr.material as THREE.SpriteMaterial;
    // store base scale once
    if (!(spr as any).baseScale) {
        (spr as any).baseScale = spr.scale.clone();
    }
    mat.transparent = true;

    if (active) {
        mat.opacity = 1.0;
        const s = (spr as any).baseScale as THREE.Vector3;
        spr.scale.set(s.x * 1.15, s.y * 1.15, s.z);
        mat.color.setHex(0xfff2e0);
    } else {
        mat.opacity = 0.22;
        const s = (spr as any).baseScale as THREE.Vector3;
        spr.scale.copy(s);
        mat.color.setHex(0xb0b0b0);
    }
}

function selectSprite(spr: THREE.Sprite) {
    if (selectionRing) {
        scene.remove(selectionRing);
        selectionRing.geometry.dispose();
        (selectionRing.material as THREE.Material).dispose();
        selectionRing = null;
    }

    selectedObj = spr;

    spr.updateWorldMatrix(true, false);
    spr.getWorldScale(_worldScale);

    const meta = (spr as any).meta as Doc;
    const school = (meta.schoolPrimary as string) || 'other';
    const color = SCHOOL_COLOR[school] ?? SCHOOL_COLOR.other;

    const worldWidth = _worldScale.x;
    const outer = worldWidth * 0.68;
    const inner = outer * 0.78;

    const ringGeo = new THREE.RingGeometry(inner, outer, 48);
    const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false, // draw on top
    });

    selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.renderOrder = 999;
    scene.add(selectionRing);

    // Card content
    cardHeader.textContent = displayTitleFor(meta);
    cardTitle.textContent  = meta.description || displayTitleFor(meta);
    cardYear.textContent = meta.year != null ? String(meta.year) : '—';
    cardRepo.textContent = meta.repo ?? '—';
    cardThumb.src = meta.iconURL;
    cardLink.href = meta.url || '#';

// DEMO MODE: just open the link in a new tab, no modal
    cardLink.target = '_blank';
    cardLink.rel = 'noopener noreferrer';
    cardLink.onclick = (e) => {
        // if there's no URL, do nothing
        if (!meta.url) {
            e.preventDefault();
            return false;
        }
        // let the browser handle it (new tab via target)
        // still stop bubbling so clicks on link don't close the card
        e.stopPropagation();
        return true;
    };

    // Close preview button (if panel already exists)
    const closeBtn = document.getElementById('docPreviewClose') as HTMLButtonElement | null;
    const docPreview = document.getElementById('docPreview') as HTMLDivElement | null;
    closeBtn?.addEventListener('click', () => {
        const frame = document.getElementById('docFrame') as HTMLIFrameElement;
        if (frame) frame.src = 'about:blank';
        if (docPreview) docPreview.style.display = 'none';
    });

    // Tags
    tagChips.innerHTML = '';
    (meta.tags ?? []).forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = String(t);
        tagChips.appendChild(chip);
    });

    card.style.display = 'block';
}

function clearSelection() {
    if (selectionRing) {
        scene.remove(selectionRing);
        selectionRing.geometry.dispose();
        (selectionRing.material as THREE.Material).dispose();
        selectionRing = null;
    }
    selectedObj = null;
    card.style.display = 'none';
}

function clearHighlight() {
    activePeriodKey = null;
    updateVisibility();
    updatePeriodCardUI(null);
}

function applyHighlightForPeriod(key: keyof typeof PERIODS) {
    activePeriodKey = key;
    updateVisibility();
    updatePeriodCardUI(key);
}


// Selected state on the chips
function updatePeriodCardUI(key: keyof typeof PERIODS | null) {
    const chips = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('.timeline-cards .chip')
    );
    chips.forEach((chip) => {
        const k = (chip.getAttribute('href') || '').replace(/^#/, '');
        if (key && k === key) chip.classList.add('is-active');
        else chip.classList.remove('is-active');
    });
}

/* ===========================
   Animate
   =========================== */
function animate() {
    requestAnimationFrame(animate);

    if (autoRotate || Date.now() - lastInteraction > 4000) {
        // gentle 3D turn for parallax
        group.rotation.y += 0.0005;
    }

    if (selectionRing && selectedObj) {
        selectedObj.updateWorldMatrix(true, false);
        selectedObj.getWorldPosition(_worldPos);
        selectionRing.position.copy(_worldPos);
        selectionRing.quaternion.copy(camera.quaternion);
        camera.getWorldDirection(_camDir).normalize();
        selectionRing.position.addScaledVector(_camDir, 2);
    }

    controls.update();
    renderer.render(scene, camera);
}

function hideHint() {
    hintEl?.classList.add('hint--hide');
}
