import { createContext, useContext, useMemo, useState } from "react";

const PageToolbarContext = createContext(null);

export function PageToolbarProvider({ children }) {
  const [toolbar, setToolbar] = useState(null);
  const value = useMemo(() => ({ toolbar, setToolbar }), [toolbar]);
  return (
    <PageToolbarContext.Provider value={value}>
      {children}
    </PageToolbarContext.Provider>
  );
}

export function usePageToolbar() {
  const ctx = useContext(PageToolbarContext);
  if (!ctx) {
    throw new Error("usePageToolbar must be used within PageToolbarProvider");
  }
  return ctx;
}
