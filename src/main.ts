// /src/main.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* ===========================
   Types
   =========================== */

type YearRaw = number | string | null;

type ArchiveRecord = {
    id: number | string;
    title?: string;
    year?: YearRaw;
    repository?: string | null;
    location?: string | null;
    mediaType?: 'image' | 'pdf' | string | null;
    description?: string | null;
    tags?: any;
    hires?: any;
    schoolPrimary?: string | null;
    schoolSecondary?: string | null;
    link?: string | null;
    url?: string | null;
    documentDirect?: string | null;
};

type RenderRecord = ArchiveRecord & {
    id: number;
    title: string;
    year: YearRaw;
    yearLabel: string;
    yearSort: number;
    repository: string | null;
    location: string | null;
    mediaType: string | null;
    description: string | null;
    tags: string[];
    hires: string[];
    hiresLocalUrls: string[];
    hiresRemoteRaw: string[];
    previewKind: 'images' | 'pdf' | 'none';
    previewUrls: string[];
    iconUrl: string;
};

type Doc = {
    id: number;
    title: string;
    year: YearRaw;
    repo: string | null;
    description: string | null;
    tags: string[];
    iconURL: string;
    schoolPrimary: string | null;
};

type SpriteWithMeta = THREE.Sprite & { meta?: Doc };

/* ===========================
   Config / Paths
   =========================== */

const BASE = import.meta.env.BASE_URL || '/';

const BYID_CANDIDATES = [
    BASE + 'data/resources.byId.json',
    '/data/resources.byId.json',
    '../data/resources.byId.json',
    '../../data/resources.byId.json',
];

const CLOUD_CANDIDATES = [
    BASE + 'data/cloud.resources.json',
    '/data/cloud.resources.json',
    '../data/cloud.resources.json',
    '../../data/cloud.resources.json',
];

const HIRES_BASE_CANDIDATES = [
    BASE + 'hires/',
    '/hires/',
    '../hires/',
    '../../hires/',
];

const PERIODS: Record<'precursors' | 'thick' | 'today', [number, number]> = {
    precursors: [1940, 1959],
    thick: [1960, 1989],
    today: [1990, 2100],
};

let activePeriodKey: keyof typeof PERIODS | null = null;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|tiff?|heic)$/i;
const PDF_EXT_RE = /\.pdf$/i;

const isHttpUrl = (s: string) => /^https?:\/\//i.test(String(s || ''));
const encodePath = (p: string) => String(p || '').split('/').map(encodeURIComponent).join('/');

/* ===========================
   DOM refs
   =========================== */

let hoverTip: HTMLDivElement | null = null;
let hintEl: HTMLDivElement | null = null;

let infoCard: HTMLDivElement | null = null;
let infoHeader: HTMLElement | null = null;
let infoThumb: HTMLImageElement | null = null;
let infoTitle: HTMLSpanElement | null = null;
let infoRepo: HTMLSpanElement | null = null;
let infoYear: HTMLSpanElement | null = null;
let tagChips: HTMLDivElement | null = null;
let infoLink: HTMLAnchorElement | null = null;

function initDomRefs() {
    hoverTip = document.getElementById('hoverTip') as HTMLDivElement | null;
    hintEl = document.getElementById('hint') as HTMLDivElement | null;

    infoCard = document.getElementById('infoCard') as HTMLDivElement | null;
    infoThumb = document.getElementById('infoThumb') as HTMLImageElement | null;
    infoTitle = document.getElementById('infoTitle') as HTMLSpanElement | null;
    infoRepo = document.getElementById('infoRepo') as HTMLSpanElement | null;
    infoYear = document.getElementById('infoYear') as HTMLSpanElement | null;
    tagChips = document.getElementById('tagChips') as HTMLDivElement | null;
    infoLink = document.getElementById('infoLink') as HTMLAnchorElement | null;

    // Query after card is found
    if (infoCard) {
        infoHeader = infoCard.querySelector('.info-card__header') as HTMLElement | null;
    }

    // Stop propagation on card clicks
    infoCard?.addEventListener('click', (e) => e.stopPropagation());
}

/* ===========================
   Modal
   =========================== */

let modalCloseBound = false;
let modalPages: string[] = [];
let modalPageIndex = 0;

function bindModalCloseOnce() {
    if (modalCloseBound) return;
    modalCloseBound = true;

    const docPreview = document.getElementById('docPreview') as HTMLDivElement | null;
    const closeBtn = document.getElementById('docPreviewClose') as HTMLButtonElement | null;
    const prevBtn = document.getElementById('docPrevBtn') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('docNextBtn') as HTMLButtonElement | null;
    const frame = document.getElementById('docFrame') as HTMLIFrameElement | null;
    const img = document.getElementById('docImage') as HTMLImageElement | null;
    const imgViewport = document.querySelector('.doc-image-viewport') as HTMLDivElement | null;

    if (!docPreview) {
        console.error('[modal] #docPreview not found');
        return;
    }

    // Reset zoom state
    const resetZoom = () => {
        imgViewport?.classList.remove('is-zoomed');
    };

    const close = () => {
        if (frame) frame.src = 'about:blank';
        if (img) img.src = '';
        modalPages = [];
        modalPageIndex = 0;
        resetZoom();
        docPreview.style.display = 'none';
        docPreview.setAttribute('aria-hidden', 'true');
    };

    closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
    });

    // Navigation buttons
    prevBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalPrevPage();
    });

    nextBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalNextPage();
    });

    docPreview.addEventListener('click', (e) => {
        if (e.target === docPreview) close();
    });

    // Click image to toggle zoom
    img?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        imgViewport?.classList.toggle('is-zoomed');
    });

    window.addEventListener('keydown', (e) => {
        if (docPreview.getAttribute('aria-hidden') !== 'true') {
            if (e.key === 'Escape') {
                close();
                return;
            }

            // Arrow key navigation for multi-page images
            if (modalPages.length > 1) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    modalNextPage();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    modalPrevPage();
                }
            }
        }
    });
}

function hideHint() {
    hintEl?.classList.add('hint--hide');
}

/* ===========================
   Three.js core
   =========================== */

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;

const group = new THREE.Group();
const loader = new THREE.TextureLoader();

const raycaster = new THREE.Raycaster();
raycaster.params.Sprite = raycaster.params.Sprite || {};
raycaster.params.Sprite.threshold = 32;

const mouse = new THREE.Vector2();
const sprites: SpriteWithMeta[] = [];

let autoRotate = true;
let lastInteraction = Date.now();

/* ===========================
   Data state
   =========================== */

let BY_ID: Record<string, ArchiveRecord> = {};
let RENDER_BY_ID: Record<string, RenderRecord> = {};
let DOCS: Doc[] = [];
let HIRES_BASE = BASE + 'hires/';

let searchQuery = '';

/* ===========================
   Helpers
   =========================== */

function numericYear(y: YearRaw): number | null {
    if (typeof y === 'number' && Number.isFinite(y)) return y;
    if (typeof y === 'string') {
        const n = parseInt(y, 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function yearToLabel(y: YearRaw): string {
    if (typeof y === 'number') return String(y);
    if (typeof y === 'string' && y.trim()) return y.trim();
    return '—';
}

function yearToSort(y: YearRaw): number {
    if (typeof y === 'number') return y;
    if (typeof y === 'string') {
        const m = y.match(/\b(18|19|20)\d{2}\b/);
        if (m) return Number(m[0]);
    }
    return Number.POSITIVE_INFINITY;
}

function normalizeByIdShape(raw: any): Record<string, ArchiveRecord> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, ArchiveRecord>;
    if (Array.isArray(raw)) {
        const out: Record<string, ArchiveRecord> = {};
        for (const r of raw) {
            if (!r) continue;
            const id = String((r as any).id);
            if (!id || id === 'undefined') continue;
            out[id] = r as ArchiveRecord;
        }
        return out;
    }
    return {};
}

async function fetchJsonFirst<T>(candidates: string[], label: string): Promise<{ url: string; data: T }> {
    const errs: string[] = [];
    for (const url of candidates) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                errs.push(`${url} -> ${res.status}`);
                continue;
            }
            const data = (await res.json()) as T;
            console.log(`[data] loaded ${label} from`, url);
            return { url, data };
        } catch (e: any) {
            errs.push(`${url} -> ${String(e?.message || e)}`);
        }
    }
    throw new Error(`[data] failed to load ${label}. Tried:\n- ${errs.join('\n- ')}`);
}

async function pickFirstExistingBase(candidates: string[], testFile: string): Promise<string> {
    for (const base of candidates) {
        const url = base + encodePath(testFile);
        try {
            const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            if (res.ok) return base;
        } catch {
            // ignore
        }
    }
    return candidates[0] || (BASE + 'hires/');
}

function cleanFileDisplay(name: string): string {
    const base = String(name || '').split('/').pop() || String(name || '');
    const noExt = base.replace(/\.[a-z0-9]+$/i, '');
    const parts = noExt.split('_');
    const kept = parts.slice(3).join(' ').replace(/[-]+/g, ' ');
    return kept.replace(/\s+/g, ' ').trim();
}

function displayTitleFor(doc: Doc): string {
    const rec = BY_ID[String(doc.id)];
    if (rec?.title && /_/.test(rec.title)) return cleanFileDisplay(rec.title);
    if (doc.title && /_/.test(doc.title)) return cleanFileDisplay(doc.title);
    const fromHires = Array.isArray(rec?.hires) ? String(rec!.hires![0] || '') : '';
    if (fromHires) {
        const base = fromHires.split('/').pop() || '';
        if (/_/.test(base)) return cleanFileDisplay(base);
    }

    // Final cleanup: remove any remaining underscores and replace with spaces
    const title = doc.title || rec?.title || 'Untitled';
    return title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeFilename(raw: string): string {
    let s = String(raw ?? '').trim();
    while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    s = s.replace(/\s+\.(png|jpe?g|webp|gif|avif|tiff?|heic|pdf)\b/gi, '.$1');
    s = s.replace(/\s{2,}/g, ' ');
    s = s.replace(/^hires[\/\\]/i, '').replace(/^\/+/, '');
    return s;
}

function hiresFilenameToUrl(filename: string): string {
    const clean = normalizeFilename(filename);
    return HIRES_BASE + encodePath(clean);
}

function isImageUrl(url: string): boolean {
    const clean = String(url || '').split(/[?#]/)[0];
    return IMAGE_EXT_RE.test(clean);
}

function isPdfUrl(url: string): boolean {
    const clean = String(url || '').split(/[?#]/)[0];
    return PDF_EXT_RE.test(clean);
}

function matchesQuery(doc: Doc, q: string): boolean {
    if (!q.trim()) return true;

    const rec = BY_ID[String(doc.id)];
    const hay = [
        displayTitleFor(doc).toLowerCase(),
        (doc.description || '').toLowerCase(),
        (doc.repo || '').toLowerCase(),
        String(doc.year ?? '').toLowerCase(),
        ...(doc.tags || []).map((t) => String(t).toLowerCase()),
        ...(Array.isArray(rec?.tags) ? (rec!.tags as any[]).map((t) => String(t).toLowerCase()) : []),
    ];

    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const t of tokens) {
        const tagMatch = t.match(/^tag:(.+)$/);
        if (tagMatch) {
            const want = tagMatch[1];
            const pool = new Set(
                [...(doc.tags || []), ...(Array.isArray(rec?.tags) ? (rec!.tags as any[]) : [])].map((x) =>
                    String(x).toLowerCase()
                )
            );
            if (!pool.has(want)) return false;
        } else {
            if (!hay.some((h) => h.includes(t))) return false;
        }
    }
    return true;
}

/* ===========================
   Build render records + docs
   =========================== */

function buildRenderRecords(byId: Record<string, ArchiveRecord>): RenderRecord[] {
    const out: RenderRecord[] = [];

    for (const r0 of Object.values(byId)) {
        if (!r0) continue;

        const idNum = Number((r0 as any).id);
        if (!Number.isFinite(idNum)) continue;

        const title = String((r0 as any).title || 'Untitled');
        const year = ((r0 as any).year ?? null) as YearRaw;

        const hiresArr = Array.isArray((r0 as any).hires) ? ((r0 as any).hires as any[]) : [];
        const hires: string[] = hiresArr.map((h) => String(h ?? '').trim()).filter(Boolean);

        const hiresRemoteRaw: string[] = [];
        const hiresLocalUrls: string[] = [];

        for (const h of hires) {
            if (isHttpUrl(h)) {
                hiresRemoteRaw.push(h);
                continue;
            }
            hiresLocalUrls.push(hiresFilenameToUrl(h));
        }

        const localPdfUrls = hiresLocalUrls.filter((u) => isPdfUrl(u));
        const localImageUrls = hiresLocalUrls.filter((u) => isImageUrl(u));

        let previewKind: RenderRecord['previewKind'] = 'none';
        let previewUrls: string[] = [];

        if (localPdfUrls.length) {
            previewKind = 'pdf';
            previewUrls = localPdfUrls.slice(0, 1);
        } else if (localImageUrls.length) {
            previewKind = 'images';
            previewUrls = localImageUrls;
        }

        const iconUrl = localImageUrls[0] || '';

        out.push({
            ...r0,
            id: idNum,
            title,
            year,
            yearLabel: yearToLabel(year),
            yearSort: yearToSort(year),
            repository: (r0 as any).repository ?? null,
            location: (r0 as any).location ?? null,
            mediaType: (r0 as any).mediaType ?? null,
            description: (r0 as any).description ?? null,
            tags: Array.isArray((r0 as any).tags) ? ((r0 as any).tags as any[]).map(String) : [],
            hires,
            hiresLocalUrls,
            hiresRemoteRaw,
            previewKind,
            previewUrls,
            iconUrl,
        });
    }

    out.sort((a, b) => a.id - b.id);
    return out;
}

function buildDocsFromRender(renderList: RenderRecord[]): Doc[] {
    return renderList.map((r) => ({
        id: r.id,
        title: r.title || 'Untitled',
        year: r.year ?? null,
        repo: r.repository ?? null,
        description: r.description ?? null,
        tags: r.tags ?? [],
        iconURL: r.iconUrl || '',
        schoolPrimary: (r as any).schoolPrimary ?? null,
    }));
}

/* ===========================
   Data loading
   =========================== */

async function loadArchiveData() {
    const byIdResp = await fetchJsonFirst<any>(BYID_CANDIDATES, 'resources.byId.json');
    BY_ID = normalizeByIdShape(byIdResp.data);

    const renderList = buildRenderRecords(BY_ID);
    RENDER_BY_ID = Object.fromEntries(renderList.map((r) => [String(r.id), r]));
    DOCS = buildDocsFromRender(renderList);

    const anyLocal = renderList
        .flatMap((r) => r.hires || [])
        .map((h) => String(h || '').trim())
        .find((h) => h && !isHttpUrl(h));
    if (anyLocal) {
        HIRES_BASE = await pickFirstExistingBase(HIRES_BASE_CANDIDATES, normalizeFilename(anyLocal));
    } else {
        HIRES_BASE = HIRES_BASE_CANDIDATES[0] || (BASE + 'hires/');
    }

    const renderList2 = buildRenderRecords(BY_ID);
    RENDER_BY_ID = Object.fromEntries(renderList2.map((r) => [String(r.id), r]));
    DOCS = buildDocsFromRender(renderList2);

    console.log('[data] BY_ID keys =', Object.keys(BY_ID).length, 'DOCS =', DOCS.length, 'HIRES_BASE =', HIRES_BASE);
    console.log('[data] First 3 DOCS:', DOCS.slice(0, 3).map(d => ({ id: d.id, title: d.title, iconURL: d.iconURL })));
}

/* ===========================
   Sprite visibility
   =========================== */

function setSpriteState(spr: SpriteWithMeta, active: boolean) {
    const mat = spr.material as THREE.SpriteMaterial;

    if (!(spr as any).baseScale) (spr as any).baseScale = spr.scale.clone();
    const base = (spr as any).baseScale as THREE.Vector3;

    mat.transparent = true;

    if (active) {
        mat.opacity = 1.0;
        spr.scale.set(base.x * 1.15, base.y * 1.15, base.z);
        mat.color.setHex(0xfff2e0);

        // CRITICAL FIX: Make sprite clickable
        spr.raycast = THREE.Sprite.prototype.raycast;
    } else {
        mat.opacity = 0.22;
        spr.scale.copy(base);
        mat.color.setHex(0xb0b0b0);

        spr.raycast = () => {}; // Empty function = ignore this sprite
    }
}

function updatePeriodChipUI(key: keyof typeof PERIODS | null) {
    const chips = Array.from(document.querySelectorAll<HTMLAnchorElement>('.timeline-cards .chip'));
    chips.forEach((chip) => {
        const k = (chip.getAttribute('href') || '').replace(/^#/, '');
        if (key && k === key) chip.classList.add('is-active');
        else chip.classList.remove('is-active');
    });
}

function updateVisibility() {
    const [minY, maxY] = activePeriodKey ? PERIODS[activePeriodKey] : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];

    sprites.forEach((spr) => {
        const d = (spr as any).meta as Doc | undefined;
        if (!d) return;

        const y = numericYear(d.year);
        const inPeriod = !activePeriodKey || (y !== null && y >= minY && y <= maxY);
        const searchOk = matchesQuery(d, searchQuery);

        setSpriteState(spr, inPeriod && searchOk);
    });
}

function clearHighlight() {
    activePeriodKey = null;
    updateVisibility();
    updatePeriodChipUI(null);
}

function applyHighlightForPeriod(key: keyof typeof PERIODS) {
    activePeriodKey = key;
    updateVisibility();
    updatePeriodChipUI(key);
}

/* ===========================
   Layout
   =========================== */

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
    const { R = 300, zRange = 140, angleJitter = 0.18, timeAngle = 0.22, timeRadial = 40, liftY = 0 } = opts || {};

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
        const pos = positions[i] || new THREE.Vector3();

        const makeSprite = (mat: THREE.SpriteMaterial) => {
            const sprite = new THREE.Sprite(mat) as SpriteWithMeta;
            sprite.scale.set(60 + Math.random() * 28, (60 + Math.random() * 28) * (0.85 + Math.random() * 0.25), 1);
            sprite.position.copy(pos);
            (sprite as any).meta = doc;
            sprites.push(sprite);
            group.add(sprite);
        };

        if (!doc.iconURL) {
            makeSprite(new THREE.SpriteMaterial({ color: 0x666666, transparent: true, opacity: 0.9 }));
            return;
        }

        loader.load(
            doc.iconURL,
            (texture) => {
                // @ts-ignore
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = maxAniso;
                texture.generateMipmaps = true;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;

                makeSprite(
                    new THREE.SpriteMaterial({
                        map: texture,
                        color: 0xf5e7d6,
                        transparent: true,
                        opacity: 1.0,
                    })
                );
            },
            undefined,
            (err) => {
                console.error('Failed to load icon', doc.iconURL, err);
                makeSprite(new THREE.SpriteMaterial({ color: 0x666666, transparent: true, opacity: 0.9 }));
            }
        );
    });

    scene.add(group);
    group.position.y -= 150;

    console.log('[sprites]', sprites.length);
}

/* ===========================
   Modal open
   =========================== */

// REPLACE the openDocumentForMeta function in main.ts with this version:

async function openDocumentForMeta(meta: Doc) {
    bindModalCloseOnce();

    const docPreview = document.getElementById('docPreview') as HTMLDivElement | null;
    const frame = document.getElementById('docFrame') as HTMLIFrameElement | null;
    const img = document.getElementById('docImage') as HTMLImageElement | null;
    const loaderEl = document.getElementById('docLoader') as HTMLDivElement | null;
    const imgViewport = document.querySelector('.doc-image-viewport') as HTMLDivElement | null;

    if (!docPreview) {
        console.error('[modal] #docPreview not found');
        return;
    }
    if (!frame && !img) {
        console.error('[modal] Neither #docFrame nor #docImage found');
        return;
    }

    docPreview.style.display = 'flex';
    docPreview.setAttribute('aria-hidden', 'false');
    loaderEl?.classList.remove('is-hidden');

    if (imgViewport) imgViewport.style.display = 'none';
    if (img) {
        img.style.display = 'none';
        img.src = '';
        img.classList.remove('is-loaded');
    }
    if (frame) {
        frame.style.display = 'none';
        frame.src = 'about:blank';
    }

    const rr = RENDER_BY_ID[String(meta.id)];
    const imagePages = rr?.previewKind === 'images' ? rr.previewUrls : [];
    const pdfUrl = rr?.previewKind === 'pdf' ? rr.previewUrls[0] : null;

    // CRITICAL FIX: Check if search.ts provided preview URLs FIRST
    const previewUrlsFromSearch = (window as any).__AA_previewUrls;
    if (previewUrlsFromSearch && Array.isArray(previewUrlsFromSearch)) {
        modalPages = previewUrlsFromSearch;
        modalPageIndex = 0;
        (window as any).__AA_previewUrls = null; // Clear it
        console.log('[modal] Using preview URLs from search:', modalPages);
    } else if (imagePages.length) {
        // Only set modalPages if search.ts didn't provide them
        modalPages = imagePages;
        modalPageIndex = 0;
        console.log('[modal] Using preview URLs from archives:', modalPages);
    } else {
        modalPages = [];
        modalPageIndex = 0;
    }

    // Show/hide navigation buttons
    updateModalNavButtons();

    const showImage = (url: string) => {
        if (!img || !imgViewport) return;

        if (frame) {
            frame.style.display = 'none';
            frame.src = 'about:blank';
        }

        imgViewport.style.display = 'block';
        img.style.display = 'block';

        const pre = new Image();
        pre.onload = () => {
            img.src = url;
            loaderEl?.classList.add('is-hidden');
            requestAnimationFrame(() => img.classList.add('is-loaded'));
            updateModalNavButtons();
        };
        pre.onerror = () => {
            console.error('[modal] Failed to load image', url);
            loaderEl?.classList.add('is-hidden');
        };
        pre.src = url;
    };

    const showFrame = (url: string) => {
        if (!frame) return;

        if (imgViewport) imgViewport.style.display = 'none';
        if (img) {
            img.style.display = 'none';
            img.src = '';
            img.classList.remove('is-loaded');
        }

        frame.style.display = 'block';
        frame.src = url;

        loaderEl?.classList.add('is-hidden');
        modalPages = [];
        modalPageIndex = 0;
        updateModalNavButtons();
    };

    // Show the first page
    if (modalPages.length) {
        showImage(modalPages[0]);
        return;
    }

    if (pdfUrl) {
        showFrame(pdfUrl);
        return;
    }

    // Fallback: show thumbnail if available
    if (meta.iconURL && isImageUrl(meta.iconURL)) {
        showImage(meta.iconURL);
        return;
    }

    loaderEl?.classList.add('is-hidden');
}

function updateModalNavButtons() {
    const prevBtn = document.getElementById('docPrevBtn');
    const nextBtn = document.getElementById('docNextBtn');
    const pageIndicator = document.getElementById('docPageIndicator');

    if (!prevBtn || !nextBtn) return;

    if (modalPages.length > 1) {
        prevBtn.style.display = 'block';
        nextBtn.style.display = 'block';

        prevBtn.disabled = modalPageIndex === 0;
        nextBtn.disabled = modalPageIndex === modalPages.length - 1;

        if (pageIndicator) {
            pageIndicator.style.display = 'block';
            pageIndicator.textContent = `${modalPageIndex + 1} / ${modalPages.length}`;
        }
    } else {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        if (pageIndicator) pageIndicator.style.display = 'none';
    }
}

function modalPrevPage() {
    if (modalPageIndex > 0) {
        modalPageIndex--;
        showCurrentModalPage();
    }
}

function modalNextPage() {
    if (modalPageIndex < modalPages.length - 1) {
        modalPageIndex++;
        showCurrentModalPage();
    }
}

function showCurrentModalPage() {
    if (!modalPages.length) return;

    const img = document.getElementById('docImage') as HTMLImageElement | null;
    const imgViewport = document.querySelector('.doc-image-viewport') as HTMLDivElement | null;
    const loaderEl = document.getElementById('docLoader') as HTMLDivElement | null;

    if (!img || !imgViewport) return;

    const url = modalPages[modalPageIndex];

    // Reset zoom when changing pages
    imgViewport.classList.remove('is-zoomed');

    loaderEl?.classList.remove('is-hidden');
    img.classList.remove('is-loaded');

    const pre = new Image();
    pre.onload = () => {
        img.src = url;
        loaderEl?.classList.add('is-hidden');
        requestAnimationFrame(() => img.classList.add('is-loaded'));
        updateModalNavButtons();
    };
    pre.onerror = () => {
        console.error('[modal] Failed to load image', url);
        loaderEl?.classList.add('is-hidden');
    };
    pre.src = url;
}

(window as any).__AA_openDocumentForMeta = (meta: Doc) => openDocumentForMeta(meta);

/* ===========================
   Card selection
   =========================== */

function selectSprite(spr: SpriteWithMeta) {
    const meta = (spr as any).meta as Doc | undefined;

    console.log('[selectSprite] Called with meta:', meta);

    if (!meta) {
        console.error('[selectSprite] No meta on sprite');
        return;
    }

    if (!infoCard || !infoThumb || !infoTitle || !infoYear || !infoRepo || !tagChips || !infoLink) {
        console.error('[selectSprite] Missing DOM elements:', {
            infoCard: !!infoCard,
            infoThumb: !!infoThumb,
            infoTitle: !!infoTitle,
            infoYear: !!infoYear,
            infoRepo: !!infoRepo,
            tagChips: !!tagChips,
            infoLink: !!infoLink,
        });
        return;
    }

    const titleForUi = displayTitleFor(meta);

    console.log('[selectSprite] Setting texts:', {
        header: titleForUi,
        description: meta.description || titleForUi,
        year: meta.year,
        repo: meta.repo
    });

    // Header should be the document title
    if (infoHeader) infoHeader.textContent = titleForUi;

    // Item Description should be the description (or fall back to title if no description)
    infoTitle.textContent = meta.description || titleForUi;

    infoYear.textContent = meta.year != null ? String(meta.year) : '—';
    infoRepo.textContent = meta.repo ?? 'Briscoe Center';

    infoThumb.src = meta.iconURL || '';
    infoThumb.alt = titleForUi;

    tagChips.innerHTML = '';
    (meta.tags || []).forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = String(t);
        tagChips.appendChild(chip);
    });

    infoLink.href = '#';
    infoLink.removeAttribute('target');
    infoLink.textContent = 'Open Document';
    infoLink.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        void openDocumentForMeta(meta);
        return false;
    };

    console.log('[selectSprite] Setting infoCard display to block');
    infoCard.style.display = 'block';

    // Force a reflow to ensure the style change takes effect
    void infoCard.offsetHeight;
}

/* ===========================
   Scene setup
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

    const appEl = document.getElementById('app') as HTMLElement | null;
    if (!appEl) throw new Error('Missing #app');
    appEl.style.position = 'relative';

    const c = renderer.domElement;
    c.style.position = 'fixed';
    c.style.inset = '0';
    c.style.width = '100vw';
    c.style.height = '100vh';
    c.style.zIndex = '1';
    c.style.pointerEvents = 'auto';
    appEl.prepend(c);

    if (hoverTip) hoverTip.style.zIndex = '20';
    if (hintEl) hintEl.style.zIndex = '20';

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    controls.addEventListener('start', () => hideHint());
    controls.addEventListener('change', () => {
        lastInteraction = Date.now();
        autoRotate = false;
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Hover tooltip
    window.addEventListener('mousemove', (e) => {
        if (!hoverTip) return;

        const rect = renderer.domElement.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        mouse.set(nx, ny);

        camera.updateMatrixWorld(true);
        raycaster.setFromCamera(mouse, camera);

        const hits = raycaster.intersectObjects(sprites, false);
        if (hits.length) {
            const spr = hits[0].object as SpriteWithMeta;
            hoverTip.style.display = 'block';
            hoverTip.style.left = `${e.clientX + 12}px`;
            hoverTip.style.top = `${e.clientY + 12}px`;
            hoverTip.textContent = spr.meta ? displayTitleFor(spr.meta) : '—';
        } else {
            hoverTip.style.display = 'none';
        }
    });

    // Click handling with proper detection
    let downX = 0;
    let downY = 0;
    let downAt = 0;

    window.addEventListener(
        'pointerdown',
        (e) => {
            downX = e.clientX;
            downY = e.clientY;
            downAt = Date.now();
        },
        { capture: true }
    );

    window.addEventListener(
        'click',
        (e) => {
            console.log('[click] Event fired');

            // Don't pick if modal is open
            const docPreview = document.getElementById('docPreview') as HTMLDivElement | null;
            const modalOpen = docPreview && docPreview.getAttribute('aria-hidden') !== 'true';

            if (modalOpen) {
                console.log('[click] Modal is open, ignoring');
                return;
            }

            // Don't pick if clicking UI elements
            const target = e.target as HTMLElement | null;
            const uiElement = target?.closest('#infoCard, #searchPanel, header.site-header, nav, footer');
            if (uiElement) {
                console.log('[click] Clicked UI element, ignoring:', uiElement);
                return;
            }

            const dx = Math.abs(e.clientX - downX);
            const dy = Math.abs(e.clientY - downY);
            const dt = Date.now() - downAt;
            const isClick = dx < 6 && dy < 6 && dt < 450;

            console.log('[click] Movement check - dx:', dx, 'dy:', dy, 'dt:', dt, 'isClick:', isClick);

            if (!isClick) return;

            const rect = renderer.domElement.getBoundingClientRect();
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
            mouse.set(nx, ny);

            console.log('[click] Mouse coords:', { x: nx, y: ny });

            camera.updateMatrixWorld(true);
            raycaster.setFromCamera(mouse, camera);

            const hits = raycaster.intersectObjects(sprites, false);

            console.log('[click] sprites.length =', sprites.length, 'hits.length =', hits.length);

            if (!hits.length) {
                if (infoCard) infoCard.style.display = 'none';
                return;
            }

            console.log('[click] Hit sprite, calling selectSprite');
            selectSprite(hits[0].object as SpriteWithMeta);
        },
        { capture: true }
    );

    setTimeout(() => hideHint(), 3500);
}

/* ===========================
   Search + chips wiring
   =========================== */

function wireSearchUI() {
    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    const searchClear = document.getElementById('searchClear') as HTMLButtonElement | null;

    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value || '';
        updateVisibility();
    });

    searchClear?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        searchQuery = '';
        updateVisibility();
    });

    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (searchInput) searchInput.value = '';
            searchQuery = '';
            updateVisibility();
            (document.activeElement as HTMLElement | null)?.blur();
        }
    });
}

function wirePeriodChips() {
    const periodEls = Array.from(document.querySelectorAll<HTMLAnchorElement>('.timeline-cards .chip'));
    periodEls.forEach((el) => {
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            const key = (el.getAttribute('href') || '').replace(/^#/, '') as keyof typeof PERIODS;
            if (!PERIODS[key]) return;

            if (activePeriodKey === key) clearHighlight();
            else applyHighlightForPeriod(key);
        });
    });

    window.addEventListener('hashchange', () => {
        const key = (location.hash || '').replace(/^#/, '') as keyof typeof PERIODS;
        if (PERIODS[key]) applyHighlightForPeriod(key);
        else clearHighlight();
    });
}

/* ===========================
   Animate
   =========================== */

function animate() {
    requestAnimationFrame(animate);

    if (autoRotate || Date.now() - lastInteraction > 4000) {
        group.rotation.y += 0.0005;
    }

    controls.update();
    renderer.render(scene, camera);
}

/* ===========================
   Boot
   =========================== */

let loaderShownAt = Date.now();

function hideArchiveLoader() {
    const loader = document.getElementById('archiveLoader');
    if (loader) {
        // Ensure loader is visible for at least 500ms so it doesn't flash
        const elapsed = Date.now() - loaderShownAt;
        const delay = Math.max(0, 500 - elapsed);
        setTimeout(() => {
            loader.classList.add('is-hidden');
        }, delay);
    }
}

async function init() {
    initDomRefs();
    bindModalCloseOnce();
    setupThree();

    await loadArchiveData();

    const positions = positionsRingTime(DOCS, {
        R: 300,
        zRange: 280,
        angleJitter: 0.26,
        timeAngle: 0.2,
        timeRadial: 36,
        liftY: 0,
    });

    buildSprites(positions, DOCS);

    // Hide the loading indicator once sprites are built
    hideArchiveLoader();

    wireSearchUI();
    wirePeriodChips();
    updateVisibility();

    // ESC: close card else clear highlight (modal ESC handled in bindModalCloseOnce)
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        const docPreview = document.getElementById('docPreview') as HTMLDivElement | null;
        const modalOpen = docPreview && docPreview.getAttribute('aria-hidden') !== 'true';
        if (modalOpen) return;

        const isCardVisible = !!infoCard && infoCard.style.display !== 'none';
        if (isCardVisible) infoCard!.style.display = 'none';
        else clearHighlight();
    });

    animate();
}

function boot() {
    const path = location.pathname;
    const isSearch = path.endsWith('/search.html') || path.includes('/pages/search.html');

    if (isSearch) {
        // Load search module instead
        (async () => {
            const mod = await import('./search');
            await mod.initSearch();
        })().catch((err) => {
            console.error('[boot] Search init error:', err);
        });
    } else {
        // Normal archive page with Three.js
        init().catch((err) => {
            console.error('[boot] Error:', err);
        });
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
