export interface ImproductiveArticle {
    id: string;
    desc: string;
}

export type ImproductiveScope = 'all' | 'excludeAssumed' | 'onlyAssumed';

export const IMPRODUCTIVE_ARTICLES: ImproductiveArticle[] = [
    { id: 'IMPR CALIDAD', desc: 'IMPRODUCTIVO DE CALIDAD' },
    { id: 'IMPR CAMION', desc: 'IMPRODUCTIVO DE CAMION' },
    { id: 'IMPR CARRO CADE', desc: 'IMPRODUCTIVO DE CARRO CADE' },
    { id: 'IMPR DESPRENDER', desc: 'IMPRODUCTIVO DE DESPRENDER' },
    { id: 'IMPR EMBALAJE', desc: 'IMPRODUCTIVO DE EMBALAJE' },
    { id: 'IMPR EN ESPERA', desc: 'IMPRODUCTIVO DE EN ESPERA' },
    { id: 'IMPR FORMACION', desc: 'IMPRODUCTIVO FORMACION' },
    { id: 'IMPR LIMPIEZA', desc: 'IMPRODUCTIVO DE LIMPIEZA' },
    { id: 'IMPR MANTENIMIENTO', desc: 'IMPRODUCTIVO DE MANTENIMIENTO' },
    { id: 'IMPR OFERTAS', desc: 'IMPRODUCTIVO DE OFERTAS' },
    { id: 'IMPR ORGANIZACION', desc: 'IMPRODUCTIVO DE ORGANIZACION' },
    { id: 'IMPR PROGRAMACION', desc: 'IMPRODUCTIVO DE PROGRAMACION' },
    { id: 'IMPR PROGRAMACION CORTE', desc: 'IMPRODUCTIVO DE PROGRAMACION CORTE' },
    { id: 'IMPR PROVIS', desc: 'IMPRODUCTIVO DE PROVIS' },
    { id: 'IMPR REPINTAR', desc: 'IMPRODUCTIVO DE REPINTAR' },
    { id: 'IMPR REUNIONES', desc: 'IMPRODUCTIVO DE REUNIONES' },
    { id: 'IMPR TRANSPORTE', desc: 'IMPRODUCTIVO DE TRANSPORTE' },
    { id: 'IMPR UTILLAJE', desc: 'IMPRODUCTIVO DE UTILLAJE' }
];

export const ASSUMED_IMPRODUCTIVE_ARTICLE_IDS = [
    'IMPR CARRO CADE',
    'IMPR FORMACION',
    'IMPR DESPRENDER',
    'IMPR UTILLAJE'
] as const;

export const EMBALAJE_IMPRODUCTIVE_ARTICLE_IDS = [
    'IMPR EMBALAJE'
] as const;

export const normalizeArticleId = (value?: string | null): string => {
    if (!value) return '';
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
};

const ASSUMED_IMPRODUCTIVE_ARTICLE_SET = new Set(
    ASSUMED_IMPRODUCTIVE_ARTICLE_IDS.map((id) => normalizeArticleId(id))
);

const EMBALAJE_IMPRODUCTIVE_ARTICLE_SET = new Set(
    EMBALAJE_IMPRODUCTIVE_ARTICLE_IDS.map((id) => normalizeArticleId(id))
);

const normalizeToken = (value?: string | null): string => {
    if (!value) return '';
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
};

const ASSUMED_IMPRODUCTIVE_HINT_TOKENS = ['CARROCADE', 'FORMACION', 'DESPRENDER', 'DSPR', 'UTILLAJE'];
const ASSUMED_IMPRODUCTIVE_ARTICLE_ID_TOKENS = ASSUMED_IMPRODUCTIVE_ARTICLE_IDS.map((id) => normalizeToken(id));

const EMBALAJE_IMPRODUCTIVE_HINT_TOKENS = ['EMBALAJE'];
const EMBALAJE_IMPRODUCTIVE_ARTICLE_ID_TOKENS = EMBALAJE_IMPRODUCTIVE_ARTICLE_IDS.map((id) => normalizeToken(id));

const IMPRODUCTIVE_ARTICLE_TOKEN_ALIASES = new Map<string, string>([
    [normalizeToken('IMPR DSPR'), normalizeArticleId('IMPR DESPRENDER')],
    [normalizeToken('DSPR'), normalizeArticleId('IMPR DESPRENDER')]
]);

export const IMPRODUCTIVE_ARTICLE_LOOKUP = new Map(
    IMPRODUCTIVE_ARTICLES.map((item) => [normalizeArticleId(item.id), item])
);

const IMPRODUCTIVE_ARTICLE_LOOKUP_BY_ID_TOKEN = new Map(
    IMPRODUCTIVE_ARTICLES.map((item) => [normalizeToken(item.id), item])
);

const IMPRODUCTIVE_ARTICLE_LOOKUP_BY_DESC = new Map(
    IMPRODUCTIVE_ARTICLES.map((item) => [normalizeToken(item.desc), item])
);

export const getImproductiveArticle = (articleId?: string | null, articleDesc?: string | null): ImproductiveArticle | undefined => {
    const key = normalizeArticleId(articleId);
    if (key) {
        const exact = IMPRODUCTIVE_ARTICLE_LOOKUP.get(key);
        if (exact) return exact;

        const keyToken = normalizeToken(key);
        const tokenMatch = IMPRODUCTIVE_ARTICLE_LOOKUP_BY_ID_TOKEN.get(keyToken);
        if (tokenMatch) return tokenMatch;

        const aliasId = IMPRODUCTIVE_ARTICLE_TOKEN_ALIASES.get(keyToken);
        if (aliasId) return IMPRODUCTIVE_ARTICLE_LOOKUP.get(aliasId);
    }

    const descToken = normalizeToken(articleDesc);
    if (descToken) {
        const byDesc = IMPRODUCTIVE_ARTICLE_LOOKUP_BY_DESC.get(descToken);
        if (byDesc) return byDesc;

        const aliasId = IMPRODUCTIVE_ARTICLE_TOKEN_ALIASES.get(descToken);
        if (aliasId) return IMPRODUCTIVE_ARTICLE_LOOKUP.get(aliasId);
    }

    return undefined;
};

export const isAssumedImproductiveArticle = (article?: ImproductiveArticle | string | null): boolean => {
    if (!article) return false;
    const id = typeof article === 'string' ? article : article.id;
    return ASSUMED_IMPRODUCTIVE_ARTICLE_SET.has(normalizeArticleId(id));
};

export const isEmbalajeImproductiveArticle = (article?: ImproductiveArticle | string | null): boolean => {
    if (!article) return false;
    const id = typeof article === 'string' ? article : article.id;
    return EMBALAJE_IMPRODUCTIVE_ARTICLE_SET.has(normalizeArticleId(id));
};

export const shouldIncludeImproductiveArticle = (
    article: ImproductiveArticle | undefined,
    scope: ImproductiveScope = 'all'
): boolean => {
    if (!article) return false;

    const isAssumed = isAssumedImproductiveArticle(article);
    if (scope === 'excludeAssumed') return !isAssumed;
    if (scope === 'onlyAssumed') return isAssumed;
    return true;
};

export const isAssumedImproductiveByRaw = (articleId?: string | null, articleDesc?: string | null): boolean => {
    const idNormalized = normalizeArticleId(articleId);
    if (ASSUMED_IMPRODUCTIVE_ARTICLE_SET.has(idNormalized)) return true;

    const idToken = normalizeToken(articleId);
    const descToken = normalizeToken(articleDesc);

    const hasExactIdTokenMatch = ASSUMED_IMPRODUCTIVE_ARTICLE_ID_TOKENS
        .some((token) => token.length > 0 && (idToken === token || descToken === token));

    if (hasExactIdTokenMatch) return true;

    return ASSUMED_IMPRODUCTIVE_HINT_TOKENS.some((token) =>
        idToken.includes(token) || descToken.includes(token)
    );
};

export const isEmbalajeImproductiveByRaw = (articleId?: string | null, articleDesc?: string | null): boolean => {
    const idNormalized = normalizeArticleId(articleId);
    if (EMBALAJE_IMPRODUCTIVE_ARTICLE_SET.has(idNormalized)) return true;

    const idToken = normalizeToken(articleId);
    const descToken = normalizeToken(articleDesc);

    const hasExactIdTokenMatch = EMBALAJE_IMPRODUCTIVE_ARTICLE_ID_TOKENS
        .some((token) => token.length > 0 && (idToken === token || descToken === token));

    if (hasExactIdTokenMatch) return true;

    return EMBALAJE_IMPRODUCTIVE_HINT_TOKENS.some((token) =>
        idToken.includes(token) || descToken.includes(token)
    );
};

export const shouldIncludeImproductiveByScope = (
    articleId?: string | null,
    articleDesc?: string | null,
    scope: ImproductiveScope = 'all'
): boolean => {
    const article = getImproductiveArticle(articleId, articleDesc);
    const normalizedId = normalizeArticleId(articleId);
    const normalizedDesc = normalizeArticleId(articleDesc);

    const isImproductive = Boolean(article)
        || normalizedId.startsWith('IMPR ')
        || normalizedDesc.startsWith('IMPR ');

    if (!isImproductive) return false;

    const isAssumed = article
        ? isAssumedImproductiveArticle(article)
        : isAssumedImproductiveByRaw(articleId, articleDesc);

    if (scope === 'excludeAssumed') return !isAssumed;
    if (scope === 'onlyAssumed') return isAssumed;
    return true;
};
