import { useEffect, useState } from "react";

/** Observa uma media query e reage ao redimensionar ou rotacionar a tela. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** true quando viewport < 768px (breakpoint md do Tailwind). */
export function useIsMobile() {
  return useMediaQuery("(max-width: 767px)");
}
