import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import Joyride, { Step, CallBackProps, STATUS, ACTIONS, EVENTS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { useAccess } from '@/hooks/useAccess';
import { supabase } from '@/integrations/supabase/client';

interface TutorialContextType {
  startTutorial: () => void;
  isTutorialActive: boolean;
  hasCompletedTutorial: boolean;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export const useTutorial = () => {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return context;
};

interface TutorialProviderProps {
  children: ReactNode;
}

const TUTORIAL_COMPLETED_KEY = 'ticketai_tutorial_completed';
const FIRST_PAYMENT_KEY = 'ticketai_first_payment_tutorial';

export const TutorialProvider = ({ children }: TutorialProviderProps) => {
  const { t, i18n } = useTranslation(['common', 'tutorial']);
  const { hasAccess } = useAccess();
  const [runTutorial, setRunTutorial] = useState(false);
  const [hasCompletedTutorial, setHasCompletedTutorial] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Check if tutorial was completed before AND check for first payment trigger
  useEffect(() => {
    const checkTutorialStatus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const key = `${TUTORIAL_COMPLETED_KEY}_${session.user.id}`;
        const firstPaymentKey = `${FIRST_PAYMENT_KEY}_${session.user.id}`;
        const completed = localStorage.getItem(key) === 'true';
        const shouldStartAfterPayment = localStorage.getItem(firstPaymentKey) === 'true';
        
        setHasCompletedTutorial(completed);
        
        // Auto-start tutorial after first payment
        if (shouldStartAfterPayment && hasAccess && !completed) {
          localStorage.removeItem(firstPaymentKey);
          setTimeout(() => {
            setRunTutorial(true);
          }, 1500); // Delay to let page load
        }
      }
    };
    checkTutorialStatus();
  }, [hasAccess]);

  const markTutorialCompleted = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      const key = `${TUTORIAL_COMPLETED_KEY}_${session.user.id}`;
      localStorage.setItem(key, 'true');
      setHasCompletedTutorial(true);
    }
  };

  const startTutorial = useCallback(() => {
    if (!hasAccess) return;
    setStepIndex(0);
    setRunTutorial(true);
  }, [hasAccess]);

  // Get translated steps
  const getSteps = useCallback((): Step[] => {
    return [
      {
        target: 'body',
        content: t('tutorial_welcome'),
        placement: 'center',
        disableBeacon: true,
        title: t('tutorial_welcome_title'),
      },
      {
        target: '[data-tutorial="safe-zone"]',
        content: t('tutorial_safe_zone'),
        title: t('tutorial_safe_zone_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="btts-index"]',
        content: t('tutorial_btts_index'),
        title: t('tutorial_btts_index_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="who-concedes"]',
        content: t('tutorial_who_concedes'),
        title: t('tutorial_who_concedes_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="card-war"]',
        content: t('tutorial_card_war'),
        title: t('tutorial_card_war_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="filterizer"]',
        content: t('tutorial_filterizer'),
        title: t('tutorial_filterizer_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="team-totals"]',
        content: t('tutorial_team_totals'),
        title: t('tutorial_team_totals_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="winner"]',
        content: t('tutorial_winner'),
        title: t('tutorial_winner_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="ticket-creator"]',
        content: t('tutorial_ticket_creator'),
        title: t('tutorial_ticket_creator_title'),
        disableBeacon: true,
      },
      {
        target: '[data-tutorial="my-ticket"]',
        content: t('tutorial_my_ticket'),
        title: t('tutorial_my_ticket_title'),
        disableBeacon: true,
      },
      {
        target: 'body',
        content: t('tutorial_complete'),
        placement: 'center',
        disableBeacon: true,
        title: t('tutorial_complete_title'),
      },
    ];
  }, [t, i18n.language]);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, action, index, type } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRunTutorial(false);
      markTutorialCompleted();
    } else if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      // Update step index for next step
      setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
    }
  };

  return (
    <TutorialContext.Provider value={{ startTutorial, isTutorialActive: runTutorial, hasCompletedTutorial }}>
      {children}
      <Joyride
        steps={getSteps()}
        run={runTutorial}
        stepIndex={stepIndex}
        continuous
        showSkipButton
        showProgress
        scrollToFirstStep
        disableOverlayClose
        callback={handleJoyrideCallback}
        locale={{
          back: t('tutorial_back'),
          close: t('tutorial_close'),
          last: t('tutorial_finish'),
          next: t('tutorial_next'),
          skip: t('tutorial_skip'),
        }}
        styles={{
          options: {
            primaryColor: 'hsl(var(--primary))',
            backgroundColor: 'hsl(var(--card))',
            textColor: 'hsl(var(--foreground))',
            arrowColor: 'hsl(var(--card))',
            overlayColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: 10000,
          },
          tooltip: {
            borderRadius: 12,
            padding: 20,
          },
          tooltipTitle: {
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 8,
          },
          tooltipContent: {
            fontSize: 14,
            lineHeight: 1.6,
          },
          buttonNext: {
            borderRadius: 8,
            padding: '10px 20px',
            fontWeight: 600,
          },
          buttonBack: {
            borderRadius: 8,
            marginRight: 10,
          },
          buttonSkip: {
            color: 'hsl(var(--muted-foreground))',
          },
          spotlight: {
            borderRadius: 8,
          },
        }}
        floaterProps={{
          styles: {
            floater: {
              filter: 'drop-shadow(0 4px 20px rgba(0, 0, 0, 0.3))',
            },
          },
        }}
      />
    </TutorialContext.Provider>
  );
};
