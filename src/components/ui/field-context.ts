import { createContext, useContext } from 'react';

export interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

/** Inputs inside a <Field> pick up their id and aria wiring from here. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}
