import { useCallback, useEffect, useState } from "react";
import { readPowersuiteState, writePowersuiteState } from "./powersuiteStore";

export function usePowersuiteStore() {
  const [state, setState] = useState(readPowersuiteState);

  useEffect(() => {
    const onUpdate = () => setState(readPowersuiteState());
    window.addEventListener("afilia:powersuite-update", onUpdate);
    return () => window.removeEventListener("afilia:powersuite-update", onUpdate);
  }, []);

  const update = useCallback((patch) => {
    const next = writePowersuiteState(patch);
    setState(next);
    return next;
  }, []);

  return { ...state, update };
}
