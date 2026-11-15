// Two sides of the shop, like a real dukan: the front (selling) and the back (managing).
// A phone bottom bar holds at most 5 buttons, so a manager sees one side at a time plus one big switch button.
// Cashiers only ever see the front.
export const SIDES = {
  front: { label: 'جلوی دکان', short: 'جلوی دکان', icon: 'cart', views: ['register', 'qarz', 'shift'] },
  back: { label: 'پشت دکان', short: 'پشت دکان', icon: 'box', views: ['receive', 'products', 'reports', 'settings'] }
};

export function sideOf(view) {
  return SIDES.back.views.includes(view) ? 'back' : 'front';
}

/** What the nav bar shows for this role on this screen. */
export function navFor(role, view) {
  const admin = role === 'admin';
  const side = admin ? sideOf(view) : 'front';
  return { side, tabs: [...SIDES[side].views], switchTo: admin ? (side === 'front' ? 'back' : 'front') : null };
}

/** Where switching to a side lands: the last screen used there, else its first screen. */
export function firstViewOf(side, last = {}) {
  const v = last[side];
  return SIDES[side].views.includes(v) ? v : SIDES[side].views[0];
}
