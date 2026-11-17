type Cleanup = () => void | Promise<unknown>;
export type SessionScope = {
  uid: string | null;
  isCurrent: () => boolean;
  addCleanup: (cleanup: Cleanup) => void;
};

/** Own every subscription, including ones resolved after an account switch. */
export function createSessionManager(onError: (error: unknown) => void = () => {}) {
  let generation = 0;
  let cleanups: Cleanup[] = [];
  const dispose = (cleanup: Cleanup) => {
    try { Promise.resolve(cleanup()).catch(onError); } catch (error) { onError(error); }
  };
  const invalidate = () => {
    generation += 1;
    const previous = cleanups;
    cleanups = [];
    previous.forEach(dispose);
  };
  return {
    invalidate,
    begin(uid: string | null): SessionScope {
      invalidate();
      const ownGeneration = generation;
      const isCurrent = () => generation === ownGeneration;
      return { uid, isCurrent, addCleanup(cleanup) {
        if (isCurrent()) cleanups.push(cleanup); else dispose(cleanup);
      } };
    },
  };
}
