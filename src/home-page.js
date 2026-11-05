// Dedicated favorites, separate from the favorite tiles and their ordering.
export const CONTROL_FAVORITES = [
  { kind: 'home', id: 'arclet-home', title: 'Home', icon: 'house', urlKey: 'homeUrl', titleKey: 'homeTitle' },
  { kind: 'email', id: 'arclet-email', title: 'Email', icon: 'mail', urlKey: 'emailUrl', titleKey: 'emailTitle' },
  { kind: 'calendar', id: 'arclet-calendar', title: 'Calendar', icon: 'calendar-days', urlKey: 'calendarUrl', titleKey: 'calendarTitle' }
];
export const HOME_PAGE_ID = CONTROL_FAVORITES[0].id;
export function controlFavorite(data, kind) {
  const definition = CONTROL_FAVORITES.find(item => item.kind === kind);
  return definition && data[definition.urlKey] ? { id: definition.id, url: data[definition.urlKey],
    title: data[definition.titleKey] || definition.title, icon: definition.icon, iconColor: null } : null;
}
export const controlFavorites = data => CONTROL_FAVORITES.map(item => controlFavorite(data, item.kind)).filter(Boolean);
export const homePage = data => controlFavorite(data, 'home');
export const navigationMode = data => !data.showSearchBar ? 'hidden' : data.showUrlBar === false ? 'controls' : 'full';
