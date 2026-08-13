import { readFileSync } from 'fs';
import * as path from 'path';
import { graphqlToOpenApi } from '../../index';
import * as assert from 'assert';
import * as stringify from 'json-stable-stringify';

describe('unionTypesConcreteFragmentSingular', function () {
  it('should not drop fields when a concrete-type fragment is spread on a union field', function () {
    const schema = readFileSync(
      path.join(__dirname, 'unionTypesSchema.graphql')
    ).toString();
    const inputQueryFilename = path.join(
      __dirname,
      'unionTypesConcreteFragmentSingular.graphql'
    );
    const query = readFileSync(inputQueryFilename).toString();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expectedOutput = require('./unionTypesConcreteFragmentSingular.json');
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
