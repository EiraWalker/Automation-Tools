// SPDX-License-Identifier: MIT
export function options(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || !Object.hasOwn(allowed, key.slice(2))) throw new Error(`Unknown argument: ${key}`);
    const name = key.slice(2);
    if (Object.hasOwn(result, name)) throw new Error(`Repeated argument: ${key}`);
    if (allowed[name] === 'flag') result[name] = true;
    else {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} needs a value`);
      result[name] = value;
    }
  }
  return result;
}
export function required(value, name) {
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}
export function number(value, fallback, min, max) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`Number must be an integer between ${min} and ${max}`);
  return result;
}
