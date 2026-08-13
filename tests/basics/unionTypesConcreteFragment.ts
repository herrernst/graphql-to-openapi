import { readFileSync } from 'fs';
import * as path from 'path';
import { graphqlToOpenApi } from '../../index';
import * as assert from 'assert';
import * as stringify from 'json-stable-stringify';

describe('unionTypesConcreteFragment', function () {
  it('should not crash when a concrete-type fragment is spread on a union array field', function () {
    const schema = readFileSync(
      path.join(__dirname, 'unionTypesSchema.graphql')
    ).toString();
    const inputQueryFilename = path.join(
      __dirname,
      'unionTypesConcreteFragment.graphql'
    );
    const query = readFileSync(inputQueryFilename).toString();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expectedOutput = require('./unionTypesConcreteFragment.json');
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
