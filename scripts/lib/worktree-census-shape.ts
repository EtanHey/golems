import Ajv2020 from 'ajv/dist/2020';
import schema from './contracts/cmux-current-census/v1/schema.json';

export type CensusShapeIssue = {
  code: 'SCHEMA'; path: string; keyword: string; schemaPath: string;
};
export type CensusShapeResult = {
  valid: boolean; scope: 'shape-resource';
  digestVerification: 'UNVERIFIED'; issues: CensusShapeIssue[];
};

// strictTypes only relaxes linting of conditional subschemas. AJV's default
// validation does not coerce values, add defaults or remove unknown members.
const shape = new Ajv2020({ strictTypes: false }).compile(schema);

/** Ordinary parsed JSON only; bounded strict lexical decoding is required upstream.
 * Enforces the unchanged v1 shape and schema array/policy caps, not original wire
 * size/keys/Unicode, core relations, ESRCH, digest, provenance or completeness.
 * Returns no trust brand or operational authority; the input is never rewritten.
 */
export function validateCensusShape(value: unknown): CensusShapeResult {
  const valid = shape(value);
  // Copy AJV's shared errors immediately, without retaining input-bearing params.
  const issues: CensusShapeIssue[] = (shape.errors ?? []).map(error => ({
    code: 'SCHEMA', path: error.instancePath, keyword: error.keyword, schemaPath: error.schemaPath,
  }));
  return { valid, scope: 'shape-resource', digestVerification: 'UNVERIFIED', issues };
}
