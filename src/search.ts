// /src/search.ts

/* ===========================
   Types (matching main.ts)
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
    rawTitle: string;
    year: YearRaw;
    repo: string | null;
    description: string | null;
    tags: string[];
    iconURL: string;
    schoolPrimary: string | null;
};

/* ===========================
   Config
   =========================== */

const BASE = import.meta.env.BASE_URL || '/';

const BYID_CANDIDATES = [
    BASE + 'data/resources.byId.json',
    '/data/resources.byId.json',
];

const HIRES_BASE_CANDIDATES = [
    BASE + 'hires/',
    '/hires/',
];

const PERIODS: Record<'precursors' | 'thick' | 'today', [number, number]> = {
    precursors: [1940, 1959],
    thick: [1960, 1989],
    today: [1990, 2100],
};

type EraKey = keyof typeof PERIODS;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|tiff?|heic)$/i;
const PDF_EXT_RE = /\.pdf$/i;

const isHttpUrl = (s: string) => /^https?:\/\//i.test(String(s || ''));
const encodePath = (p: string) => String(p || '').split('/').map(encodeURIComponent).join('/');

/* ===========================
   State
   =========================== */

let BY_ID: Record<string, ArchiveRecord> = {};
let RENDER_BY_ID: Record<string, RenderRecord> = {};
let DOCS: Doc[] = [];
let HIRES_BASE = BASE + 'hires/';

let searchQuery = '';
const activeTags = new Set<string>();
let allTags: string[] = [];
let activeEra: EraKey | null = null;

/* ===========================
   Modal state (NEW)
   =========================== */

let modalCloseBound = false;
let modalPages: string[] = [];
let modalPageIndex = 0;
let docClickBound = false;

/* ===========================
   DOM refs
   =========================== */

const els = {
    q: null as HTMLInputElement | null,
    clear: null as HTMLButtonElement | null,
    tagList: null as HTMLDivElement | null,
    meta: null as HTMLDivElement | null,
    results: null as HTMLDivElement | null,
    sort: null as HTMLSelectElement | null,
    eraChips: null as HTMLDivElement | null,
};

/* ===========================
   Utilities (from main.ts)
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

function cleanFileDisplay(name: string): string {
    const base = String(name || '').split('/').pop() || String(name || '');
    const noExt = base.replace(/\.[a-z0-9]+$/i, '');
    const parts = noExt.split('_');
    const kept = parts.slice(3).join(' ').replace(/[-]+/g, ' ');
    return kept.replace(/\s+/g, ' ').trim();
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
            console.log(`[search] loaded ${label} from`, url);
            return { url, data };
        } catch (e: any) {
            errs.push(`${url} -> ${String(e?.message || e)}`);
        }
    }
    throw new Error(`[search] failed to load ${label}. Tried:\n- ${errs.join('\n- ')}`);
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
    return renderList.map((r) => {
        const rawTitle = r.title || 'Untitled';
        const displayTitle = /_/.test(rawTitle) ? cleanFileDisplay(rawTitle) : rawTitle.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

        return {
            id: r.id,
            title: displayTitle,
            rawTitle,
            year: r.year ?? null,
            repo: r.repository ?? null,
            description: r.description ?? null,
            tags: r.tags ?? [],
            iconURL: r.iconUrl || '',
            schoolPrimary: (r as any).schoolPrimary ?? null,
        };
    });
}

function buildTagSet(docs: Doc[]): string[] {
    const tagSet = new Set<string>();
    docs.forEach(d => {
        (d.tags || []).forEach(t => tagSet.add(String(t)));
    });
    return Array.from(tagSet).sort();
}

/* ===========================
   Data loading
   =========================== */

async function loadSearchData() {
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

    // Rebuild with correct HIRES_BASE
    const renderList2 = buildRenderRecords(BY_ID);
    RENDER_BY_ID = Object.fromEntries(renderList2.map((r) => [String(r.id), r]));
    DOCS = buildDocsFromRender(renderList2);

    console.log('[search] Loaded', DOCS.length, 'documents');
}

/* ===========================
   Modal functions (NEW)
   =========================== */

function bindModalCloseOnce() {
    if (modalCloseBound) return;
    modalCloseBound = true;

    const docPreview = document.getElementById('docPreview') as HTMLDivElement | null;
    const closeBtn = document.getElementById('docPreviewClose') as HTMLButtonElement | null;
    const prevBtn = document.getElementById('docPrevBtn') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('docNextBtn') as HTMLButtonElement | null;
    const frame = document.getElementById('docFrame') as HTMLIFrameElement | null;
    const img = document.getElementById('docImage') as HTMLImageElement | null;

    if (!docPreview) {
        console.error('[modal] #docPreview not found');
        return;
    }

    const close = () => {
        if (frame) frame.src = 'about:blank';
        if (img) img.src = '';
        modalPages = [];
        modalPageIndex = 0;
        docPreview.style.display = 'none';
        docPreview.setAttribute('aria-hidden', 'true');
    };

    closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
    });

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

    window.addEventListener('keydown', (e) => {
        if (docPreview.getAttribute('aria-hidden') !== 'true') {
            if (e.key === 'Escape') {
                close();
                return;
            }

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

function updateModalNavButtons() {
    const prevBtn = document.getElementById('docPrevBtn');
    const nextBtn = document.getElementById('docNextBtn');
    const pageIndicator = document.getElementById('docPageIndicator');

    if (!prevBtn || !nextBtn) return;

    if (modalPages.length > 1) {
        prevBtn.style.display = 'block';
        nextBtn.style.display = 'block';

        (prevBtn as HTMLButtonElement).disabled = modalPageIndex === 0;
        (nextBtn as HTMLButtonElement).disabled = modalPageIndex === modalPages.length - 1;

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

/* ===========================
   Modal binding (MODIFIED - THIS IS THE KEY FIX)
   =========================== */

function bindDocOpen() {
    if (docClickBound) return;
    docClickBound = true;

    document.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('a[data-doc-id]') as HTMLAnchorElement | null;
        if (!a) return;

        e.preventDefault();

        const id = a.dataset.docId!;
        const d = DOCS.find(x => String(x.id) === id);
        if (!d) return;

        // Get the render record to access previewUrls
        const rr = RENDER_BY_ID[String(d.id)];

        // CRITICAL FIX: Store preview URLs on window so main.ts can access them
        if (rr?.previewKind === 'images' && rr.previewUrls.length > 0) {
            (window as any).__AA_previewUrls = rr.previewUrls;
            console.log('[search] Setting preview URLs:', rr.previewUrls);
        } else {
            (window as any).__AA_previewUrls = null;
        }

        const open = (window as any).__AA_openDocumentForMeta as ((meta: any) => Promise<void> | void) | undefined;
        if (!open) {
            console.warn('[search] __AA_openDocumentForMeta not found on window');
            return;
        }

        const meta = {
            id: d.id,
            title: d.rawTitle || d.title || 'Untitled',
            year: d.year ?? null,
            tags: d.tags ?? [],
            repo: d.repo ?? null,
            iconURL: d.iconURL,
            description: d.description ?? null,
            schoolPrimary: d.schoolPrimary ?? null,
        };

        void open(meta);
    });
}

/* ===========================
   UI wiring
   =========================== */

function initDomRefs() {
    els.q = document.getElementById('q') as HTMLInputElement | null;
    els.clear = document.getElementById('clear') as HTMLButtonElement | null;
    els.tagList = document.getElementById('tagList') as HTMLDivElement | null;
    els.meta = document.getElementById('meta') as HTMLDivElement | null;
    els.results = document.getElementById('results') as HTMLDivElement | null;
    els.sort = document.getElementById('sort') as HTMLSelectElement | null;
    els.eraChips = document.getElementById('eraChips') as HTMLDivElement | null;

    if (!els.results || !els.q || !els.sort || !els.tagList) {
        console.error('[search] Missing required DOM elements');
        return false;
    }
    return true;
}

function bindUI() {
    els.q!.addEventListener('input', () => {
        searchQuery = els.q!.value;
        applyFilters();
    });

    els.clear?.addEventListener('click', () => {
        searchQuery = '';
        els.q!.value = '';
        applyFilters();
    });

    els.sort!.addEventListener('change', applyFilters);
}

function readParams() {
    const p = new URLSearchParams(location.search);
    const pq = p.get('q');
    if (pq) {
        searchQuery = pq;
        els.q!.value = pq;
    }

    const ptags = (p.get('tags') || '').split(',').filter(Boolean);
    ptags.forEach(t => activeTags.add(t));

    const s = p.get('sort');
    if (s && ['relevance', 'year-desc', 'year-asc', 'title-asc'].includes(s)) {
        els.sort!.value = s;
    }

    const era = p.get('era') as EraKey | null;
    if (era && PERIODS[era]) {
        activeEra = era;
    }
}

function syncParams(list: Doc[]) {
    if (!els.meta) return;

    const p = new URLSearchParams();
    if (searchQuery) p.set('q', searchQuery);
    if (activeTags.size) p.set('tags', Array.from(activeTags).join(','));
    if (activeEra) p.set('era', activeEra);
    p.set('sort', els.sort!.value);

    history.replaceState({}, '', `${location.pathname}?${p}`);
    els.meta.textContent = `${list.length} result${list.length === 1 ? '' : 's'}`;
}

/* ===========================
   Render functions
   =========================== */

function renderTagList(tags: string[]) {
    els.tagList!.innerHTML = '';
    tags.forEach(t => {
        const id = `tag-${t.replace(/\W+/g, '-')}`;
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = id;
        box.value = t;
        box.checked = activeTags.has(t);
        box.addEventListener('change', () => {
            if (box.checked) activeTags.add(t);
            else activeTags.delete(t);
            applyFilters();
        });
        const span = document.createElement('span');
        span.textContent = t;
        label.appendChild(box);
        label.appendChild(span);
        els.tagList!.appendChild(label);
    });
}

function renderEraChips() {
    if (!els.eraChips) return;
    els.eraChips.innerHTML = '';

    const defs: { key: EraKey; title: string; sub: string }[] = [
        { key: 'precursors', title: 'Precursors', sub: '1940s–1950s' },
        { key: 'thick', title: 'In the Thick of the Struggle', sub: '1960s–1980s' },
        { key: 'today', title: 'Student Organizing Today', sub: '1990s–present' },
    ];

    defs.forEach(def => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        if (activeEra === def.key) btn.classList.add('is-active');
        btn.setAttribute('data-era', def.key);
        btn.innerHTML = `<span class="chip__title">${def.title}</span><span class="chip__sub">${def.sub}</span>`;
        btn.addEventListener('click', () => {
            activeEra = (activeEra === def.key) ? null : def.key;
            Array.from(els.eraChips!.querySelectorAll('.chip')).forEach(el => el.classList.remove('is-active'));
            if (activeEra) btn.classList.add('is-active');
            applyFilters();
        });
        els.eraChips.appendChild(btn);
    });
}

/* ===========================
   Filtering / Sorting
   =========================== */

function matchesText(d: Doc, query: string): boolean {
    if (!query.trim()) return true;
    const hay = [
        (d.title || '').toLowerCase(),
        (d.description || '').toLowerCase(),
        (d.repo || '').toLowerCase(),
        ...(d.tags || []).map(t => String(t).toLowerCase()),
    ];
    const toks = query.toLowerCase().split(/\s+/).filter(Boolean);
    return toks.every(t => hay.some(h => h.includes(t)));
}

function matchesTags(d: Doc): boolean {
    if (!activeTags.size) return true;
    const set = new Set((d.tags || []).map(x => String(x).toLowerCase()));
    for (const t of activeTags) {
        if (!set.has(String(t).toLowerCase())) return false;
    }
    return true;
}

function matchesEra(d: Doc): boolean {
    if (!activeEra) return true;
    const [minY, maxY] = PERIODS[activeEra];
    const y = numericYear(d.year);
    return y !== null && y >= minY && y <= maxY;
}

function scoreRelevance(d: Doc, query: string): number {
    if (!query.trim()) return 0;
    const ql = query.toLowerCase();
    let score = 0;
    const title = (d.title || '').toLowerCase();
    const desc = (d.description || '').toLowerCase();
    if (title.includes(ql)) score += 5;
    if (desc.includes(ql)) score += 2;
    (d.tags || []).forEach(t => {
        if (String(t).toLowerCase().includes(ql)) score += 1;
    });
    return score;
}

function applyFilters() {
    const filtered = DOCS.filter(d =>
        matchesText(d, searchQuery) &&
        matchesTags(d) &&
        matchesEra(d)
    );

    const sort = els.sort!.value;
    filtered.sort((a, b) => {
        if (sort === 'year-desc') return (numericYear(b.year) ?? -1) - (numericYear(a.year) ?? -1);
        if (sort === 'year-asc') return (numericYear(a.year) ?? 1) - (numericYear(b.year) ?? 1);
        if (sort === 'title-asc') return (a.title || '').localeCompare(b.title || '');
        return scoreRelevance(b, searchQuery) - scoreRelevance(a, searchQuery);
    });

    syncParams(filtered);
    renderResults(filtered);
}

function renderResults(list: Doc[]) {
    els.results!.innerHTML = '';
    list.forEach(d => {
        const card = document.createElement('article');
        card.className = 'card';

        const h = document.createElement('h4');
        h.textContent = d.title || 'Untitled';

        const yr = document.createElement('div');
        yr.className = 'year';
        yr.textContent = d.year != null ? String(d.year) : '—';

        const img = document.createElement('img');
        img.className = 'thumb';
        img.alt = d.title || 'thumbnail';
        img.src = d.iconURL;

        const tags = document.createElement('div');
        tags.className = 'tags';
        (d.tags || []).slice(0, 10).forEach(t => {
            const pill = document.createElement('span');
            pill.className = 'pill';
            pill.textContent = String(t);
            tags.appendChild(pill);
        });

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = 'Open document';
        link.dataset.docId = String(d.id);

        card.appendChild(h);
        card.appendChild(yr);
        card.appendChild(img);
        card.appendChild(tags);
        card.appendChild(link);
        els.results!.appendChild(card);
    });
}

/* ===========================
   Public init
   =========================== */

export async function initSearch() {
    if (!initDomRefs()) return;

    await loadSearchData();

    allTags = buildTagSet(DOCS);

    readParams();
    renderTagList(allTags);
    renderEraChips();

    bindUI();
    bindModalCloseOnce();  // Set up modal controls
    bindDocOpen();
    applyFilters();
}
