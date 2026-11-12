/** Validator names: the name in a blueprint title, and the logic names of a track. */
import type { PlutusValidator } from "../plutus-json";

/** "module.name.else" -> "name"; the module prefix and a trailing else/spend are dropped. */
export const validatorName = (title: string): string => {
  const parts = title.split(".");
  const last = parts[parts.length - 1];
  return (
    last === "else" || last === "spend" ? parts.slice(1, -1) : parts.slice(1)
  ).join(".");
};

/** Whether `name` is a logic of `track`: `<track>_logic`, or `<track>_logic_v<N>` for any N from 2 up. */
export const isTrackLogic = (track: string, name: string): boolean =>
  name === `${track}_logic` ||
  new RegExp(`^${track}_logic_v([2-9]|[1-9][0-9]+)$`).test(name);

/** The distinct names of these validators, in order. */
export const namesOf = (validators: readonly PlutusValidator[]): string[] => [
  ...new Set(validators.map((v) => validatorName(v.title))),
];
