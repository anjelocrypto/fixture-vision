import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { supabase } from '@/integrations/supabase/client';

const languageDetector = new LanguageDetector();

// Custom language detection that prioritizes: profile > URL > localStorage > browser
// Note: Since we can't use async in detector, we'll handle profile loading separately
languageDetector.addDetector({
  name: 'customDetector',
  lookup: () => {
    // 1. Check URL parameter (?lang=ka)
    const searchParams = new URLSearchParams(window.location.search);
    const langParam = searchParams.get('lang');
    if (langParam) {
      localStorage.setItem('preferredLang', langParam);
      return langParam;
    }
    
    // 2. Check localStorage
    const storedLang = localStorage.getItem('preferredLang');
    if (storedLang) {
      return storedLang;
    }
    
    // 3. Fall back to default (will use browser detection)
    return undefined;
  },
  cacheUserLanguage: (lng: string) => {
    localStorage.setItem('preferredLang', lng);
  }
});

// Helper to load and sync language from user profile
export const syncLanguageFromProfile = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) {
    const { data } = await supabase
      .from('profiles')
      .select('preferred_lang')
      .eq('user_id', session.user.id)
      .maybeSingle();
    
    if (data?.preferred_lang && data.preferred_lang !== i18n.language) {
      await i18n.changeLanguage(data.preferred_lang);
      localStorage.setItem('preferredLang', data.preferred_lang);
    }
  }
};

i18n
  .use(HttpBackend)
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ka'],
    ns: ['common', 'filterizer', 'ticket', 'winner', 'admin', 'account', 'filters', 'fixtures', 'optimizer', 'tutorial', 'markets', 'team_totals', 'tooltips'],
    defaultNS: 'common',
    debug: false,
    
    detection: {
      order: ['customDetector', 'querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'preferredLang',
    },
    
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    
    interpolation: {
      escapeValue: false,
    },
    
    react: {
      useSuspense: false,
    },
  });

export default i18n;
