/** Analytic critically damped spring; seconds, no frame-count dependence. */
export function dampedStep(
  value: number,
  velocity: number,
  target: number,
  seconds: number,
  omega = 12,
) {
  const dt = Math.max(0, Math.min(seconds, 0.25)),
    offset = value - target,
    decay = Math.exp(-omega * dt),
    impulse = velocity + omega * offset;
  return {
    value: target + (offset + impulse * dt) * decay,
    velocity: (velocity - omega * impulse * dt) * decay,
  };
}
export function deadZoneTarget(
  projected: number,
  center: number,
  radius: number,
) {
  const delta = projected - center;
  return Math.abs(delta) <= radius ? 0 : delta - Math.sign(delta) * radius;
}
