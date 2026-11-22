// Environment access for the job sandbox.
//
// The sandbox grants an explicit env allowlist (--allow-env=<names>) and
// `Deno.env.get` THROWS NotCapable for unlisted names instead of returning
// undefined (issue #243 pattern). A raw read can therefore crash a job
// mid-run. A missing permission is equivalent to an unset variable: this
// helper treats both as `undefined`.

type EnvGetter = (key: string) => string | undefined;

const defaultGetter: EnvGetter = (key) => {
	if (typeof Deno !== 'undefined') return Deno.env.get(key);
	if (typeof process !== 'undefined' && process.env) return process.env[key];
	return undefined;
};

export function safeGetEnv(key: string, getter: EnvGetter = defaultGetter): string | undefined {
	try {
		return getter(key);
	} catch {
		/* NotCapable: name not in the runtime allowlist — treat as unset */
		return undefined;
	}
}
