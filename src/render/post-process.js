export function renderGroupWithPostProcess(renderer, time, group) {
  const state = group.getPostProcessState?.();
  if (!state) {
    renderer.render(time, group, group.getRenderCamera(), group.target, false, true);
    return 0;
  }

  const { scene, camera, sprite, effects, targets } = state;
  renderer.render(time, group, group.getRenderCamera(), targets[0], false, true);
  let source = targets[0];
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    const destination = index === effects.length - 1 ? group.target : (index % 2 === 0 ? targets[1] : targets[0]);
    sprite.setTexture(source, { width: group.width, height: group.height });
    sprite.setFilter(effect.filter, effect.amount);
    renderer.render(time, scene, camera, destination, false, false);
    source = destination;
  }
  return effects.length;
}
