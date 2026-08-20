/**
 * jstat ships no type definitions, and `@types/jstat` does not track 1.9.x.
 *
 * Only the members `lib/distributions.ts` actually calls are declared here, so
 * reaching for anything else in the library is a compile error rather than a
 * silent `any` — the point of adding this dependency was to stop approximating
 * three specific distributions, not to open the whole surface.
 *
 * Declared as a DEFAULT export on purpose. jstat is CommonJS that builds its
 * exports dynamically, so Node's own ESM loader cannot see a named `jStat`
 * binding even though webpack can — and the repo's check scripts
 * (`lib/__checks__/*.check.mts`) run under raw Node. `module.exports` is the
 * jStat object itself, so the default import is the form both loaders agree on.
 */
declare module 'jstat' {
  interface JStatDistributions {
    /** Student's t. `dof` may be non-integer (Welch-style df). */
    studentt: {
      cdf(x: number, dof: number): number;
      inv(p: number, dof: number): number;
    };
    chisquare: {
      cdf(x: number, dof: number): number;
    };
    normal: {
      cdf(x: number, mean: number, std: number): number;
    };
  }
  const jstat: JStatDistributions;
  export default jstat;
}
