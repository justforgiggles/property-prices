# Coding standards

Adapted from the referenced core `CODING_STANDARDS.md` RFC for this repository. The source RFC governs named TypeScript callables; its unrelated API/core/engine package names, React conventions, and workspace commands do not apply here.

## Named TypeScript functions and methods

- Use named function declarations for application contracts. Export only public module functions. Every named function and concrete class method declares a precise return type; a class method explicitly declares `public` or `private`, with public methods before private methods.
- Name the caller-visible action or value. `find` means expected singular absence (`null`), collection reads return arrays including `[]`, `get` does not return routine absence, `parse` interprets data, and `toX` builds a local value. Persistence writes use `insert`, `upsert`, `replace`, `update`, `setX`, or `delete` when a repository is actually needed.
- Name parameters for their domain role and order broad context before target, payload, then controls. Use positional arguments while readable; do not add one-use options types, result wrappers, status unions, custom error classes, or speculative layers.
- Use `async` only when sequencing awaited work or intentionally translating a synchronous failure into a promise. Return an existing promise directly otherwise. Keep the happy path shallow with braced guard clauses and logical blank lines.
- Do not mutate parameters, create aliases that merely rename them, or put comments inside named function declarations or bodies. Use plain `Error` for terminal failures. Expected absence is a direct value; unexpected network, file, model, and dependency failures propagate rather than becoming `null` or `false`.
- Mechanical style is two-space indentation, double quotes, semicolons, and trailing commas on multiline constructs. Keep source readable after formatting.

## Repository checks

Run the touched package's smallest runnable test plus its build/type check. For data and function packages, use their `npm test` and `npm run build` scripts; for the model, run Python unit tests, train on current data, and verify the generated ONNX bundle independently in Node. Review changed callable names, signatures, error behavior, and comments against the source RFC, not just the compiler.
