// Explicit "unset" convention for ExiEngine caches and mirrors.
//
// Historically each subsystem picked its own sentinel for "no cached value yet":
// -1 for versions, NaN for float mirrors, null/undefined for objects, Infinity for
// "no hit". Sentinel comparisons across types ("NaN !== NaN", "undefined !== 0") made
// the "never built" vs "built with empty value" distinction fragile.
//
// The convention is now:
//   UNINITIALIZED - a cache slot that was never built or was invalidated.
//   NONE          - a valid, built state meaning "nothing selected/hit/attached".
//   CONSUMED      - a one-shot flag that has been produced-and-consumed (producer sets, consumer clears).
//
// All three are unique frozen symbols: identity comparison with !== never collides with
// numbers, strings, objects, or booleans. Subsystems that previously compared against
// -1/NaN/null keep those sentinels only where they cross a public API boundary; internal
// slots use these markers.
export const UNINITIALIZED = Symbol("exi.uninitialized");
export const NONE = Symbol("exi.none");
export const CONSUMED = Symbol("exi.consumed");

export function isSentinel(value) {
  return value === UNINITIALIZED || value === NONE || value === CONSUMED;
}
