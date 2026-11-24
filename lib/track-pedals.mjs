// One code per point on the sampled outline. Unknown readings and long gaps
// are uncoloured. The brake feed can report a flag over 100 under throttle.
export function trackPedals(samples, outline) {
  let lastDistance = -Infinity;
  const indices = [];
  for (const [i, point] of samples.entries()) {
    if (Number.isFinite(point.X) && Number.isFinite(point.Y) && point.Distance - lastDistance >= 6) {
      indices.push(i);
      lastDistance = point.Distance;
    }
  }
  if (outline.length !== indices.length || indices.some((i, k) =>
    Math.round(samples[i].X) !== outline[k][0] || Math.round(samples[i].Y) !== outline[k][1])) return null;
  const codes = indices.map(i => {
    const p = samples[i];
    const gap = Math.max(i ? p.ElapsedSeconds - samples[i - 1].ElapsedSeconds : 0,
      i + 1 < samples.length ? samples[i + 1].ElapsedSeconds - p.ElapsedSeconds : 0);
    const throttle = p.Throttle, brake = typeof p.Brake === 'boolean' ? Number(p.Brake) : p.Brake;
    if (gap > .6 || p.SourceIntervalSeconds > .6 || !Number.isFinite(throttle) ||
        throttle < 0 || throttle > 100 || !Number.isFinite(brake) || brake < 0 || brake > 100) return '?';
    if (brake > 0 && throttle < 30) return 'b';
    if (throttle >= 98) return 'f';
    if (throttle > 0) return 'p';
    return 'c';
  }).join('');
  return /[fbpc]/.test(codes) ? codes : null;
}
