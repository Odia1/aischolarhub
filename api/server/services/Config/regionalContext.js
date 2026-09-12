const compact = (value, max = 160) =>
  String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

const cleanList = (value, maxItems = 8, maxItemLength = 60) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    const item = compact(raw, maxItemLength);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
};

function normalizeRegionalContext(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: input.enabled !== false,
    countryCode: compact(input.countryCode, 2).toUpperCase(),
    country: compact(input.country, 80),
    regionCode: compact(input.regionCode, 12).toUpperCase(),
    region: compact(input.region, 100),
    city: compact(input.city, 100),
    timezone: compact(input.timezone, 80),
    locale: compact(input.locale, 35),
    currency: compact(input.currency, 12).toUpperCase(),
    educationSystem: compact(input.educationSystem, 100),
    languages: cleanList(input.languages),
    developmentContext: compact(input.developmentContext, 40).toUpperCase(),
  };
}

function hasRegionalContext(context) {
  if (!context || context.enabled === false) return false;
  return Boolean(
    context.countryCode || context.country || context.region || context.city ||
    context.timezone || context.locale || context.currency || context.educationSystem ||
    context.languages?.length || context.developmentContext
  );
}

function buildRegionalContextOverlay(institution) {
  const context = normalizeRegionalContext(institution?.regionalContext);
  if (!hasRegionalContext(context)) return '';
  const location = [context.city, context.region, context.country].filter(Boolean).join(', ');
  const facts = [
    location ? `Institution location: ${location}.` : '',
    context.countryCode ? `Country code: ${context.countryCode}.` : '',
    context.timezone ? `Timezone: ${context.timezone}.` : '',
    context.locale ? `Default locale: ${context.locale}.` : '',
    context.currency ? `Default currency: ${context.currency}.` : '',
    context.educationSystem ? `Education system: ${context.educationSystem}.` : '',
    context.languages?.length ? `Institution languages: ${context.languages.join(', ')}.` : '',
    context.developmentContext ? `Resource context: ${context.developmentContext}.` : '',
  ].filter(Boolean);
  return [
    '## REGIONAL AND INSTITUTIONAL CONTEXT',
    ...facts,
    'Use this context only when it materially improves correctness, accessibility, examples, terminology, units, currency, educational structures, institutions, climate, public services, law/policy, or recommendations.',
    'Do not assume United States norms when institution context indicates otherwise.',
    'Do not force regional references into location-independent subjects.',
    'Precedence: an explicit location or jurisdiction in the user request or subject matter overrides institution context; a user-selected context overrides the institutional default; otherwise use institution context, then a generic/global fallback.',
    'When current local law, regulation, policy, eligibility, pricing, schedules, or programs materially affect the answer, verify them with an available current-information tool rather than relying on generic knowledge.',
    'Never infer an individual user’s income, ethnicity, religion, caste, politics, health, or other sensitive traits from institution or regional metadata.',
    'Adapt language examples when useful, but do not change the user’s language merely because institution languages are configured.',
  ].join('\n');
}

module.exports = { normalizeRegionalContext, hasRegionalContext, buildRegionalContextOverlay };
