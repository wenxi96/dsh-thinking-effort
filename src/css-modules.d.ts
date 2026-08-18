/**
 * Type shim for CSS Modules (tsdown / lightningcss at bundle time).
 * Each `.module.css` file yields an object of class-name mappings.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
