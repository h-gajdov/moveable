import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Politeness = 'polite' | 'assertive';
const Ctx = createContext<(msg: string, politeness?: Politeness) => void>(() => {});

/**
 * Screen-reader announcements for meaningful changes (route found, step changed,
 * errors). Two persistent live regions; text is cleared first so that repeating
 * the same message is still announced.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timer = useRef<number | undefined>(undefined);

  const announce = useCallback((msg: string, politeness: Politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite;
    set('');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set(msg), 60);
  }, []);

  return (
    <Ctx.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </Ctx.Provider>
  );
}

export const useAnnounce = () => useContext(Ctx);
