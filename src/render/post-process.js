// RenderGroup passes clear their targets to transparent black instead of the
// engine background, so a group composites only what its children drew.
export const TRANSPARENT_CLEAR = "transparent";
export const TRANSPARENT_RGBA = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

export function renderGroupWithPostProcess(renderer, time, group) {
  const state = group.getPostProcessState?.();
  if (!state) {
    renderer.render(time, group, group.getRenderCamera(), group.target, false, true, TRANSPARENT_CLEAR);
    return 0;
  }

  const { scene, camera, sprite, effects, targets } = state;
  renderer.render(time, group, group.getRenderCamera(), targets[0], false, true, TRANSPARENT_CLEAR);
  let source = targets[0];
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    const destination = index === effects.length - 1 ? group.target : (index % 2 === 0 ? targets[1] : targets[0]);
    sprite.setTexture(source, { width: group.width, height: group.height });
    sprite.setFilter(effect.filter, effect.amount);
    renderer.render(time, scene, camera, destination, false, false, TRANSPARENT_CLEAR);
    source = destination;
  }
  return effects.length;
}
