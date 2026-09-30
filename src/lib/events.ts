/**
 * A minimal typed event emitter. Used to connect framework-free modules (the token
 * manager, the API client) to the parts of the app that react to them, without
 * those modules importing React, the router or the query client.
 */
export function createEmitter<Events extends Record<string, unknown>>() {
  const listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  return {
    on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as (payload: never) => void);
      return () => {
        set.delete(handler as (payload: never) => void);
      };
    },
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          (handler as (payload: Events[K]) => void)(payload);
        } catch (error) {
          console.error(`[events] listener for "${String(event)}" failed`, error);
        }
      }
    },
  };
}
