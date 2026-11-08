// A probe that imports ONE module and reports whether importing it did anything.
//
// It exists because the import-safety claim cannot be tested in-process: a test that imports the entry point
// to prove it is harmless would reintroduce the very defect it claims to prevent. So the import happens in a
// separate process, where running main() is visible as output and as an exit code rather than as a suite
// failure. The module to import arrives as argv so the probe itself asserts nothing and favours nothing.
const target = process.argv[2];
if (target === undefined || target === "") {
  process.stderr.write("usage: import-probe <module-specifier>\n");
  process.exit(2);
}
await import(target);
process.stdout.write("IMPORTED_CLEANLY\n");
