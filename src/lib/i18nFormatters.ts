/**
 * Locale formatting helpers for dates, numbers, and odds
 */

export const getLocaleForFormatting = (lang: string): string => {
  switch (lang) {
    case 'ka':
      return 'ka-GE';
    case 'en':
    default:
      return 'en-US';
  }
};

export const formatDate = (
  date: Date | string | number,
  lang: string,
  options?: Intl.DateTimeFormatOptions
): string => {
  const locale = getLocaleForFormatting(lang);
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  };
  
  return new Intl.DateTimeFormat(locale, defaultOptions).format(dateObj);
};

export const formatOdds = (odds: number, lang: string): string => {
  const locale = getLocaleForFormatting(lang);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(odds);
};

export const formatNumber = (
  num: number,
  lang: string,
  options?: Intl.NumberFormatOptions
): string => {
  const locale = getLocaleForFormatting(lang);
  return new Intl.NumberFormat(locale, options).format(num);
};

export const formatPercentage = (value: number, lang: string): string => {
  const locale = getLocaleForFormatting(lang);
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
};

/**
 * Market label helper for core markets (UI display only)
 * API data (leagues, teams) stays in English
 */
export const formatMarketLabel = (market: string, lang: string): string => {
  if (lang !== 'ka') return market;
  
  const marketMap: Record<string, string> = {
    'goals': 'გოლები',
    'corners': 'კუთხეები',
    'cards': 'ბარათები',
    'fouls': 'დარღვევები',
    'offsides': 'ოფსაიდები',
    '1x2': '1X2',
    'match winner': 'მატჩის გამარჯვებული',
    'both teams to score': 'ორივე გუნდი გაიტანს',
  };
  
  return marketMap[market.toLowerCase()] || market;
};
