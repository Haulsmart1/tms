import { isNavItemActive, NAV_GROUPS, type NavGroup } from "../../lib/nav/navConfig";

/** Navigation search only narrows links; it never changes permissions or data. */
export function filterOperationNavigation(query: string): NavGroup[] {
  const terms = query.trim().toLocaleLowerCase("en-GB").split(/\s+/).filter(Boolean);
  if (terms.length === 0) return NAV_GROUPS;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const text = `${group.label ?? ""} ${item.label}`.toLocaleLowerCase("en-GB");
      return terms.every((term) => text.includes(term));
    }),
  })).filter((group) => group.items.length > 0);
}

export function operationRouteLabel(pathname: string): string {
  return NAV_GROUPS.flatMap((group) => group.items)
    .find((item) => isNavItemActive(pathname, item.href))?.label ?? "Workspace";
}
