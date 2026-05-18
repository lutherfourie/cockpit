"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const CockpitCopilotAvailabilityContext = createContext(false);

export function CockpitCopilotProvider({
  children,
  runtimeEnabled,
}: {
  children: ReactNode;
  runtimeEnabled: boolean;
}) {
  if (!runtimeEnabled) {
    return (
      <CockpitCopilotAvailabilityContext.Provider value={false}>
        {children}
      </CockpitCopilotAvailabilityContext.Provider>
    );
  }

  return (
    <CockpitCopilotAvailabilityContext.Provider value>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        useSingleEndpoint
        enableInspector={false}
        showDevConsole={false}
      >
        {children}
      </CopilotKit>
    </CockpitCopilotAvailabilityContext.Provider>
  );
}

export function useCockpitCopilotAvailable() {
  return useContext(CockpitCopilotAvailabilityContext);
}
