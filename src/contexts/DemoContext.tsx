import { createContext, useContext, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { DEMO_FIXTURES, DEMO_FIXTURE_IDS, DemoFixture } from "@/config/demoFixtures";

interface DemoContextType {
  isDemo: boolean;
  demoFixtures: DemoFixture[];
  demoFixtureIds: number[];
  isDemoFixture: (fixtureId: number) => boolean;
}

const DemoContext = createContext<DemoContextType>({
  isDemo: false,
  demoFixtures: [],
  demoFixtureIds: [],
  isDemoFixture: () => false,
});

export function DemoProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isDemo = location.pathname.startsWith('/demo');

  const isDemoFixture = (fixtureId: number) => {
    return DEMO_FIXTURE_IDS.includes(fixtureId);
  };

  return (
    <DemoContext.Provider 
      value={{ 
        isDemo, 
        demoFixtures: DEMO_FIXTURES,
        demoFixtureIds: DEMO_FIXTURE_IDS,
        isDemoFixture
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

export function useDemoContext() {
  return useContext(DemoContext);
}

export { DemoContext };
