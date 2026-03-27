export function readNonEmptyEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readPrimaryOrAliasEnv(
  env: Record<string, string | undefined>,
  primaryName: string,
  aliasName: string,
): string | undefined {
  return readNonEmptyEnv(env, primaryName) ?? readNonEmptyEnv(env, aliasName);
}
