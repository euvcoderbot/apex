// Geometry follows the precision printed beside a bar. Never inflate tiny
// differences to a minimum width, or mutate the underlying measurement.
export function visibleBarValue(value, digits = 3) {
  return Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
}
