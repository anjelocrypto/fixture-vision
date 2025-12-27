import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Languages } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';
import { syncLanguageFromProfile } from '@/i18n';

const LANGUAGES = [
  { code: 'en', name: 'EN', nativeName: 'English' },
  { code: 'ka', name: 'KA', nativeName: 'ქართული' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [userId, setUserId] = useState<string | null>(null);

  // Sync language from profile on mount
  useEffect(() => {
    // Ensure namespaces are loaded whenever language changes (fixes cases where new keys stay in EN)
    const ensureLoaded = async (lng: string) => {
      const namespaces = (i18n.options.ns || ['common']) as string[];
      await i18n.loadLanguages(lng);
      await i18n.loadNamespaces(namespaces);
      await i18n.reloadResources([lng], namespaces);
    };

    syncLanguageFromProfile().finally(() => {
      void ensureLoaded(i18n.language);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
      if (session?.user?.id) {
        syncLanguageFromProfile();
      }
    });

    const onLangChanged = (lng: string) => {
      void ensureLoaded(lng);
    };
    i18n.on('languageChanged', onLangChanged);

    return () => {
      i18n.off('languageChanged', onLangChanged);
      subscription.unsubscribe();
    };
  }, [i18n]);

  const handleLanguageChange = async (langCode: string) => {
    // Ensure resources for the target language are loaded (http backend)
    // before/after switching so newly added namespaces/keys apply immediately.
    await i18n.loadLanguages(langCode);
    await i18n.changeLanguage(langCode);
    await i18n.reloadResources([langCode]);

    localStorage.setItem('preferredLang', langCode);

    // Update profile if user is authenticated
    if (userId) {
      await supabase
        .from('profiles')
        .update({ preferred_lang: langCode })
        .eq('user_id', userId);
    }
  };

  const currentLanguage = LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">{currentLanguage.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => handleLanguageChange(language.code)}
            className={i18n.language === language.code ? 'bg-accent' : ''}
          >
            <span className="font-medium">{language.name}</span>
            <span className="ml-2 text-muted-foreground">/ {language.nativeName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
