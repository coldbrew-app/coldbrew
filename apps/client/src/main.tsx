import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { TooltipProvider } from "./components/ui/tooltip";
import { I18nProvider } from "./lib/i18n";
import { queryClient } from "./lib/trpc";
import { router } from "./router";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
