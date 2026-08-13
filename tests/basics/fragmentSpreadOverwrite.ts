import { readFileSync } from 'fs';
import * as path from 'path';
import { graphqlToOpenApi } from '../../index';
import * as assert from 'assert';
import * as stringify from 'json-stable-stringify';

// TODO: This test is expected to FAIL until the fragment-spread overwrite bug
// is fixed. When multiple fragment spreads target the same field, each spread
// currently overwrites the previous one's properties instead of merging them.
// The expected output below reflects the correct, merged behaviour.
describe('fragmentSpreadOverwrite', function () {
  it('should merge properties from multiple fragment spreads on the same field', function () {
    const schema = readFileSync(
      path.join(__dirname, 'unionTypesSchema.graphql')
    ).toString();
    const inputQueryFilename = path.join(
      __dirname,
      'fragmentSpreadOverwrite.graphql'
    );
    const query = readFileSync(inputQueryFilename).toString();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expectedOutput = require('./fragmentSpreadOverwrite.json');
    const actualOutput = graphqlToOpenApi({
      schema,
      query,
    }).openApiSchema;
    const normalizedActualOutput = stringify(actualOutput, { space: '  ' });
    const normalizedExpectedOutput = stringify(expectedOutput, { space: '  ' });
    assert.ok(!!actualOutput);
    assert.equal(normalizedActualOutput, normalizedExpectedOutput);
  });
});
