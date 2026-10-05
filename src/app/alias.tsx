import { Navigate, useLocation } from 'react-router';

/** A redirect that keeps the query string and hash: the spec's route names as aliases. */
export function Alias({ to, hash }: { to: string; hash?: string }) {
  const location = useLocation();
  return <Navigate replace to={`${to}${location.search}${hash ?? location.hash}`} />;
}
