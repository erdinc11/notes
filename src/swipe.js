export const SWIPE_ACTION_WIDTH = 92;
export const SWIPE_OPEN_THRESHOLD = SWIPE_ACTION_WIDTH * .45;

export function clampSwipeOffset(value) {
  return Math.max(-SWIPE_ACTION_WIDTH, Math.min(0, value));
}

export function swipeSettlesOpen(offset) {
  return offset <= -SWIPE_OPEN_THRESHOLD;
}
