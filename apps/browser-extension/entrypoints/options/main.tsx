import { createRoot } from "react-dom/client";

import { CockpitExtensionSurface } from "../../src/ui/CockpitExtensionSurface";
import "../../src/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <CockpitExtensionSurface surface="options" />,
);
