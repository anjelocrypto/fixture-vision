import { useLocation } from "react-router-dom";
import { DEMO_FIXTURES, DEMO_FIXTURE_IDS, DemoFixture, DEMO_METADATA } from "@/config/demoFixtures";

interface UseDemoModeReturn {
  isDemo: boolean;
  demoFixtures: DemoFixture[];
  demoFixtureIds: number[];
  demoMetadata: typeof DEMO_METADATA;
  isDemoFixture: (fixtureId: number) => boolean;
}

/**
 * Hook to check if the app is in Demo Mode
 * Returns demo state and related utilities
 */
export function useDemoMode(): UseDemoModeReturn {
  const location = useLocation();
  const isDemo = location.pathname.startsWith('/demo');

  const isDemoFixture = (fixtureId: number) => {
    return DEMO_FIXTURE_IDS.includes(fixtureId);
  };

  return {
    isDemo,
    demoFixtures: DEMO_FIXTURES,
    demoFixtureIds: DEMO_FIXTURE_IDS,
    demoMetadata: DEMO_METADATA,
    isDemoFixture,
  };
}
