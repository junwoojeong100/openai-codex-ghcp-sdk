function parts(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

export function versionAtLeast(value, minimum) {
  const actual = parts(value);
  const required = parts(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

export function supportedNodeVersion(value) {
  const version = parts(value);
  return Boolean(version && ((version[0] === 20 && versionAtLeast(value, "20.19.0")) || versionAtLeast(value, "22.12.0")));
}
