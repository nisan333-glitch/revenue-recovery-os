// NH Validator Stage A — minimal JSON-Schema-SUBSET validator (zero dependency).
//
// SCOPE (Table A): supports exactly the keywords used by the 8 NH-ROP schemas:
//   type, required, properties, additionalProperties(false), enum, pattern,
//   format("date" only), items, minItems, minLength, minimum, maximum, allOf, if, then.
// Annotations ignored: $schema, $id, title, description.
// This is NOT a full JSON Schema Draft 2020-12 validator. Any other validation-
// affecting keyword (or a format other than "date") is UNSUPPORTED and causes a
// fail-closed error via compileSchema() — never a silent ignore.

export const SUPPORTED_KEYWORDS = new Set([
  "type", "required", "properties", "additionalProperties", "enum", "pattern",
  "format", "items", "minItems", "minLength", "minimum", "maximum",
  "allOf", "if", "then",
]);
const ANNOTATION_KEYWORDS = new Set(["$schema", "$id", "title", "description"]);
const SUPPORTED_FORMATS = new Set(["date"]);

// Walk a schema and return the list of unsupported keywords/features (fail-closed).
export function compileSchema(schema, path = "#") {
  const unsupported = [];
  walk(schema, path, unsupported);
  return unsupported; // empty array = fully supported
}

function walk(node, path, out) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (ANNOTATION_KEYWORDS.has(k)) continue;
    if (!SUPPORTED_KEYWORDS.has(k)) {
      out.push({ keyword: k, path });
      continue;
    }
    if (k === "format" && !SUPPORTED_FORMATS.has(v)) {
      out.push({ keyword: `format:${v}`, path });
    }
    // recurse into sub-schema positions
    if (k === "items" || k === "if" || k === "then" || k === "additionalProperties") {
      if (v && typeof v === "object") walk(v, `${path}/${k}`, out);
    } else if (k === "properties") {
      for (const [pk, pv] of Object.entries(v)) walk(pv, `${path}/properties/${pk}`, out);
    } else if (k === "allOf") {
      if (Array.isArray(v)) v.forEach((s, i) => walk(s, `${path}/allOf/${i}`, out));
    }
  }
}

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function jsTypeMatches(type, value) {
  switch (type) {
    case "object": return isObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Validate an instance against a (supported) schema. Returns error strings.
export function validate(schema, instance, path = "$") {
  const errors = [];
  _validate(schema, instance, path, errors);
  return errors;
}

function _validate(schema, instance, path, errors) {
  if (!isObject(schema)) return;

  if ("type" in schema) {
    if (!jsTypeMatches(schema.type, instance)) {
      errors.push(`${path}: expected type ${schema.type}, got ${describe(instance)}`);
      // type mismatch: skip keyword checks that assume the type, but still allow enum
    }
  }

  if ("enum" in schema) {
    if (!schema.enum.some((e) => deepEqual(e, instance))) {
      errors.push(`${path}: value ${JSON.stringify(instance)} not in enum [${schema.enum.join(", ")}]`);
    }
  }

  if (typeof instance === "string") {
    if ("pattern" in schema && !new RegExp(schema.pattern).test(instance)) {
      errors.push(`${path}: '${instance}' does not match pattern ${schema.pattern}`);
    }
    if ("minLength" in schema && instance.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.format === "date" && !isValidDate(instance)) {
      errors.push(`${path}: '${instance}' is not a valid date (YYYY-MM-DD)`);
    }
  }

  if (typeof instance === "number") {
    if ("minimum" in schema && instance < schema.minimum) {
      errors.push(`${path}: ${instance} < minimum ${schema.minimum}`);
    }
    if ("maximum" in schema && instance > schema.maximum) {
      errors.push(`${path}: ${instance} > maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(instance)) {
    if ("minItems" in schema && instance.length < schema.minItems) {
      errors.push(`${path}: array shorter than minItems ${schema.minItems}`);
    }
    if ("items" in schema) {
      instance.forEach((el, i) => _validate(schema.items, el, `${path}[${i}]`, errors));
    }
  }

  if (isObject(instance)) {
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in instance)) errors.push(`${path}: missing required property '${req}'`);
      }
    }
    if (isObject(schema.properties)) {
      for (const [pk, pv] of Object.entries(schema.properties)) {
        if (pk in instance) _validate(pv, instance[pk], `${path}.${pk}`, errors);
      }
    }
    if (schema.additionalProperties === false && isObject(schema.properties)) {
      for (const key of Object.keys(instance)) {
        if (!(key in schema.properties)) errors.push(`${path}: additional property '${key}' not allowed`);
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) _validate(sub, instance, path, errors);
  }

  if ("if" in schema) {
    const condErrors = [];
    _validate(schema.if, instance, path, condErrors);
    if (condErrors.length === 0 && "then" in schema) {
      _validate(schema.then, instance, path, errors);
    }
  }
}

function describe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
