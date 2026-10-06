import { useCallback, useEffect, useState } from "react";

/** Rutas sencillas sin biblioteca: `/`, `/sala/:code` y `/demo` (SPECS 2.1). El servidor devuelve la app en todas. */
export type Route = { name: "home" } | { name: "room"; code: string } | { name: "demo" } | { name: "notFound" };

export function parseRoute(pathname: string, base = import.meta.env.BASE_URL): Route {
  const path = pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return { name: "home" };
  if (clean === "/demo") return { name: "demo" };
  const room = /^\/sala\/([A-Za-z0-9]{3,12})$/.exec(clean);
  if (room) return { name: "room", code: room[1]!.toUpperCase() };
  return { name: "notFound" };
}

export function roomPath(code: string, base = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/$/, "")}/sala/${code}`;
}

export function useRoute(): [Route, (to: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setRoute(parseRoute(window.location.pathname));
  }, []);
  return [route, navigate];
}
