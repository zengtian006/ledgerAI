// Single source of truth for country -> default currency (served to the web app via GET /api/countries)
export const COUNTRIES = [
  ['GB', 'United Kingdom', 'GBP'], ['US', 'United States', 'USD'], ['CA', 'Canada', 'CAD'],
  ['AU', 'Australia', 'AUD'], ['NZ', 'New Zealand', 'NZD'], ['IE', 'Ireland', 'EUR'],
  ['DE', 'Germany', 'EUR'], ['FR', 'France', 'EUR'], ['ES', 'Spain', 'EUR'], ['IT', 'Italy', 'EUR'],
  ['NL', 'Netherlands', 'EUR'], ['BE', 'Belgium', 'EUR'], ['AT', 'Austria', 'EUR'],
  ['PT', 'Portugal', 'EUR'], ['FI', 'Finland', 'EUR'], ['GR', 'Greece', 'EUR'],
  ['CH', 'Switzerland', 'CHF'], ['SE', 'Sweden', 'SEK'], ['NO', 'Norway', 'NOK'], ['DK', 'Denmark', 'DKK'],
  ['PL', 'Poland', 'PLN'], ['CZ', 'Czechia', 'CZK'], ['HU', 'Hungary', 'HUF'], ['RO', 'Romania', 'RON'],
  ['TR', 'Türkiye', 'TRY'], ['JP', 'Japan', 'JPY'], ['CN', 'China', 'CNY'], ['HK', 'Hong Kong', 'HKD'],
  ['TW', 'Taiwan', 'TWD'], ['KR', 'South Korea', 'KRW'], ['SG', 'Singapore', 'SGD'], ['MY', 'Malaysia', 'MYR'],
  ['TH', 'Thailand', 'THB'], ['ID', 'Indonesia', 'IDR'], ['PH', 'Philippines', 'PHP'], ['VN', 'Vietnam', 'VND'],
  ['IN', 'India', 'INR'], ['AE', 'United Arab Emirates', 'AED'], ['SA', 'Saudi Arabia', 'SAR'],
  ['IL', 'Israel', 'ILS'], ['ZA', 'South Africa', 'ZAR'], ['NG', 'Nigeria', 'NGN'], ['KE', 'Kenya', 'KES'],
  ['EG', 'Egypt', 'EGP'], ['BR', 'Brazil', 'BRL'], ['MX', 'Mexico', 'MXN'], ['AR', 'Argentina', 'ARS'],
  ['CL', 'Chile', 'CLP'], ['CO', 'Colombia', 'COP'],
].map(([code, name, currency]) => ({ code, name, currency }));

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
export const CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))].sort();
