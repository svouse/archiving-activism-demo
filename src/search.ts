// ---------- Types ----------
type FullRecord = {
    id: string | number;
    title?: string;
    year?: number | null;
    description?: string | null;
    repository?: string | null;
    tags?: string[] | string | null;
    url?: string | null;
    previewLocal?: string;
    topics?: string[] | string | null;
    hires?: string[];
    schoolPrimary?: string | null;
};

type CloudItem = {
    id: string | number;
    title: string;
    year: number | null;
    repository: string | null;
    mediaType: string | null;
    description: string | null;
    schoolPrimary: string | null;
    schoolSecondary: string | null;
    tags: string[] | string;
    link: string | null;
    previewLocal: string;
    documentDirect?: string | null;
};

type Doc = {
    id: string | number;
    title: string;
    rawTitle: string;
    year?: number | null;
    url?: string | null;
    tags: string[];
    repo?: string | null;
    iconURL: string;
    description?: string | null;
};

// ---------- Era ranges ----------
const PERIODS: Record<'precursors' | 'thick' | 'today', [number, number]> = {
    precursors: [1940, 1959],
    thick: [1960, 1989],
    today: [1990, 2100],
};
type EraKey = keyof typeof PERIODS;

// ---------- Utilities ----------
const base = import.meta.env.BASE_URL || '/';

function numericYear(y: unknown): number | null {
    if (typeof y === 'number' && Number.isFinite(y)) return y;
    if (typeof y === 'string') {
        const n = parseInt(y, 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function cleanFileDisplay(name: string): string {
    const base = name.split('/').pop() || name;
    const noExt = base.replace(/\.[a-z0-9]+$/i, '');
    const parts = noExt.split('_');
    const kept = parts.slice(3).join(' ').replace(/[-]+/g, ' ');
    return kept.replace(/\s+/g, ' ').trim();
}

function coerceTags(recTags: any, itemTags: any, topics?: any): string[] {
    const out: string[] = [];
    const pushAny = (val: any) => {
        if (!val) return;
        if (Array.isArray(val)) {
            val.forEach(v => typeof v === 'string' && out.push(v));
        } else if (typeof val === 'string') {
            val.split(/[;,]/).forEach(s => out.push(s));
        }
    };
    pushAny(recTags);
    pushAny(itemTags);
    if (out.length === 0) pushAny(topics);

    const cleaned = out
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .filter(t => t.length <= 40 && t.split(/\s+/).length <= 5)
        .reduce<string[]>((acc, cur) => {
            const key = cur.toLowerCase();
            if (!acc.some(x => x.toLowerCase() === key)) acc.push(cur);
            return acc;
        }, []);
    return cleaned;
}

// ---------- Data / State ----------
let CLOUD: CloudItem[] = [];
let BY_ID: Record<string, FullRecord> = {};
let DOCS: Doc[] = [];

let q = '';
const activeTags = new Set<string>();
let allTags: string[] = [];
let activeEra: EraKey | null = null;

// ---------- DOM (queried at init time) ----------
const els = {
    q: null as HTMLInputElement | null,
    clear: null as HTMLButtonElement | null,
    tagList: null as HTMLDivElement | null,
    meta: null as HTMLDivElement | null,
    results: null as HTMLDivElement | null,
    sort: null as HTMLSelectElement | null,
    eraChips: null as HTMLDivElement | null,
};

// ---------- Public init (called from main.ts) ----------
export async function initSearch() {
    // Get elements (IDs must exist in search.html)
    els.q       = document.getElementById('q') as HTMLInputElement | null;
    els.clear   = document.getElementById('clear') as HTMLButtonElement | null;
    els.tagList = document.getElementById('tagList') as HTMLDivElement | null;
    els.meta    = document.getElementById('meta') as HTMLDivElement | null;
    els.results = document.getElementById('results') as HTMLDivElement | null;
    els.sort    = document.getElementById('sort') as HTMLSelectElement | null;
    els.eraChips= document.getElementById('eraChips') as HTMLDivElement | null;

    // Hard guard: if core elements missing, don’t continue
    if (!els.results || !els.q || !els.sort || !els.tagList) {
        console.warn('[search] Missing required DOM (#results, #q, #sort, #tagList). Check search.html IDs.');
        return;
    }

    // Load data
    const { cloud, byId } = await loadSearchData();
    CLOUD = cloud;
    BY_ID = byId;

    // Build model + UI
    DOCS = buildDocs(CLOUD, BY_ID);
    allTags = buildTagSet(DOCS);
    renderTagList(allTags);
    renderEraChips();
    readParams();
    bindUI();
    applyFilters();
}

// ---------- Data loader (from /public/data) ----------
async function loadSearchData() {
    const [cloud, byId] = await Promise.all([
        fetch(base + 'data/cloud.resources.json').then(r => r.json()),
        fetch(base + 'data/resources.byId.json').then(r => r.json()),
    ]);
    return { cloud, byId };
}

// ---------- Build docs ----------
function buildDocs(cloud: CloudItem[], byId: Record<string, FullRecord>): Doc[] {
    return cloud.map(it => {
        const rec = byId[String(it.id)];
        const url = it.documentDirect || rec?.url || it.link || null;
        const rawTitle = rec?.title || it.title || 'Untitled';
        const display = /_/.test(rawTitle) ? cleanFileDisplay(rawTitle) : rawTitle;
        const tags = coerceTags(rec?.tags, it.tags, rec?.topics);

        return {
            id: it.id,
            title: display,
            rawTitle,
            year: (numericYear(it.year) ?? numericYear(rec?.year)) ?? null,
            url,
            tags,
            repo: rec?.repository ?? it.repository ?? null,
            iconURL: it.previewLocal,
            description: rec?.description ?? it.description ?? null,
        };
    });
}

function buildTagSet(docs: Doc[]): string[] {
    const s = new Set<string>();
    docs.forEach(d => (d.tags || []).forEach(t => s.add(String(t))));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
}

// ---------- UI wiring ----------
function bindUI() {
    els.q!.addEventListener('input', () => { q = els.q!.value; applyFilters(); });
    els.clear && els.clear.addEventListener('click', () => { q = ''; els.q!.value = ''; applyFilters(); });
    els.sort!.addEventListener('change', applyFilters);
}

function readParams() {
    const p = new URLSearchParams(location.search);
    const pq = p.get('q'); if (pq){ q = pq; els.q!.value = pq; }
    const ptags = (p.get('tags') || '').split(',').filter(Boolean);
    ptags.forEach(t => activeTags.add(t));
    const s = p.get('sort');
    if (s && ['relevance','year-desc','year-asc','title-asc'].includes(s)) els.sort!.value = s as any;
    const era = p.get('era') as EraKey | null;
    if (era && PERIODS[era]) activeEra = era;
}

function syncParams(list: Doc[]) {
    if (!els.meta) return;
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (activeTags.size) p.set('tags', Array.from(activeTags).join(','));
    if (activeEra) p.set('era', activeEra);
    p.set('sort', els.sort!.value);
    history.replaceState({}, '', `${location.pathname}?${p}`);
    els.meta.textContent = `${list.length} result${list.length === 1 ? '' : 's'}`;
}

// ---------- Renderers ----------
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
            if (box.checked) activeTags.add(t); else activeTags.delete(t);
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

    const defs: {key: EraKey, title: string, sub: string}[] = [
        { key: 'precursors', title: 'Precursors',               sub: '1940s–1950s' },
        { key: 'thick',      title: 'In the Thick of the Struggle', sub: '1960s–1980s' },
        { key: 'today',      title: 'Student Organizing Today', sub: '1990s–present' },
    ];

    defs.forEach(def => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        if (activeEra === def.key) btn.classList.add('is-active');
        btn.setAttribute('data-era', def.key);
        btn.innerHTML = `<span>${def.title}</span><span class="sub">${def.sub}</span>`;
        btn.addEventListener('click', () => {
            activeEra = (activeEra === def.key) ? null : def.key;
            Array.from(els.eraChips!.querySelectorAll('.chip')).forEach(el => el.classList.remove('is-active'));
            if (activeEra) btn.classList.add('is-active');
            applyFilters();
        });
        els.eraChips.appendChild(btn);
    });
}

// ---------- Filtering / Sorting ----------
function matchesText(d: Doc, query: string): boolean {
    if (!query.trim()) return true;
    const hay = [
        (d.title || '').toLowerCase(),
        (d.description || '').toLowerCase(),
        ...(d.tags || []).map(t => String(t).toLowerCase()),
    ];
    const toks = query.toLowerCase().split(/\s+/).filter(Boolean);
    return toks.every(t => hay.some(h => h.includes(t)));
}

function matchesTags(d: Doc): boolean {
    if (!activeTags.size) return true;
    const set = new Set((d.tags || []).map(x => String(x).toLowerCase()));
    for (const t of activeTags) if (!set.has(String(t).toLowerCase())) return false;
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
    const desc  = (d.description || '').toLowerCase();
    if (title.includes(ql)) score += 5;
    if (desc.includes(ql))  score += 2;
    (d.tags || []).forEach(t => { if (String(t).toLowerCase().includes(ql)) score += 1; });
    return score;
}

function applyFilters() {
    const filtered = DOCS.filter(d =>
        matchesText(d, q) &&
        matchesTags(d) &&
        matchesEra(d)
    );

    const sort = els.sort!.value;
    filtered.sort((a, b) => {
        if (sort === 'year-desc') return (numericYear(b.year) ?? -1) - (numericYear(a.year) ?? -1);
        if (sort === 'year-asc')  return (numericYear(a.year) ??  1) - (numericYear(b.year) ??  1);
        if (sort === 'title-asc') return (a.title || '').localeCompare(b.title || '');
        return scoreRelevance(b, q) - scoreRelevance(a, q);
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
        (d.tags || []).slice(0, 10).forEach(t => {
            const pill = document.createElement('span');
            pill.className = 'pill';
            pill.textContent = String(t);
            tags.appendChild(pill);
        });

        const link = document.createElement('a');
        link.href = d.url || '#';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = d.url ? 'Open document' : 'No link available';

        card.appendChild(h);
        card.appendChild(yr);
        card.appendChild(img);
        card.appendChild(tags);
        card.appendChild(link);
        els.results!.appendChild(card);
    });
}
