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
    syncLanguageFromProfile();
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
      if (session?.user?.id) {
        syncLanguageFromProfile();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLanguageChange = async (langCode: string) => {
    await i18n.changeLanguage(langCode);
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
