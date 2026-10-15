import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { loadDashboard } from "../dashboard";
import { navigate } from "../routes";

// A link to another page of the site that doesn't reload it. A real <a>, so
// that a new tab, a copied address and the keyboard keep their own way: only a
// plain click is taken over. It also warms the dashboard's chunk up when the
// link is pointed at or focused.
export function Link({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const preload = () => {
    loadDashboard().catch(() => {});
  };
  return (
    <a
      {...rest}
      href={href}
      onPointerEnter={preload}
      onFocus={preload}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (rest.target && rest.target !== "_self") return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
