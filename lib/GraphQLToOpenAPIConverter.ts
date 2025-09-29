// eslint-disable @typescript-eslint/ban-types
import { visit, BREAK } from 'graphql/language';
import { visitWithTypeInfo } from 'graphql/utilities/TypeInfo';
import { validate } from 'graphql/validation';
import { parse } from 'graphql/language/parser';
import {
  GraphQLEnumType,
  GraphQLError,
  GraphQLInputObjectType,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLSchema,
  IntrospectionQuery,
  Source,
  TypeInfo,
  buildClientSchema,
  buildSchema,
} from 'graphql';
import {
  GraphQLList,
  GraphQLObjectType,
  GraphQLUnionType,
} from 'graphql/type/definition';

export class NoOperationNameError extends Error {
  constructor(message: string) {
    super(message) /* istanbul ignore next */;
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
    this.name = NoOperationNameError.name;
  }
}

export class MissingSchemaError extends Error {
  constructor(message: string) {
    super(message) /* istanbul ignore next */;
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
    this.name = MissingSchemaError.name;
  }
}

export class UnknownScalarError extends Error {
  constructor(message: string) {
    super(message) /* istanbul ignore next */;
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
    this.name = UnknownScalarError.name;
  }
}

export interface GraphQLToOpenAPIResult {
  readonly queryErrors?: readonly GraphQLError[];
  readonly error?: NoOperationNameError;
  readonly schemaError?: GraphQLError;
  openApiSchema?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const typeMap = {
  ID: {
    type: 'string',
  },
  '[ID]': {
    type: 'array',
    items: {
      type: ['string', 'null'],
    },
  },
  '[ID!]': {
    type: 'array',
    items: {
      type: 'string',
    },
  },
  String: {
    type: 'string',
  },
  '[String!]': {
    type: 'array',
    items: {
      type: 'string',
    },
  },
  '[String]': {
    type: 'array',
    items: {
      type: ['string', 'null'],
    },
  },
  '[Int]': {
    type: 'array',
    items: {
      type: ['integer', 'null'],
    },
  },
  '[Int!]': {
    type: 'array',
    items: {
      type: 'integer',
    },
  },
  '[Float]': {
    type: 'array',
    items: {
      type: ['number', 'null'],
    },
  },
  '[Float!]': {
    type: 'array',
    items: {
      type: 'number',
    },
  },
  '[Boolean]': {
    type: 'array',
    items: {
      type: ['boolean', 'null'],
    },
  },
  '[Boolean!]': {
    type: 'array',
    items: {
      type: 'boolean',
    },
  },
  Int: { type: 'integer' },
  Float: { type: 'number' },
  Boolean: { type: 'boolean' },
};

function getScalarType(
  typeName: string,
  scalarConfig: { [key: string]: object }, // eslint-disable-line @typescript-eslint/ban-types
  onUnknownScalar: (s: string) => object // eslint-disable-line @typescript-eslint/ban-types
  // eslint-disable-next-line @typescript-eslint/ban-types
): object {
  if (scalarConfig[typeName]) {
    return scalarConfig[typeName];
  }
  const r = onUnknownScalar(typeName);
  if (r) {
    scalarConfig[typeName] = r;
    return r;
  }
  throw new UnknownScalarError('Unknown scalar: ' + typeName);
}

function fieldDefToOpenApiField(
  typeInfo: TypeInfo,
  scalarConfig: { [key: string]: object }, // eslint-disable-line @typescript-eslint/ban-types
  onUnknownScalar: (s: string) => object // eslint-disable-line @typescript-eslint/ban-types
) {
  const fieldDef = typeInfo.getFieldDef();
  const typeName = fieldDef.type.toString();
  const description = fieldDef.description || undefined;
  let nullable;
  let type = fieldDef.type;
  if (type instanceof GraphQLNonNull) {
    nullable = false;
    type = type.ofType;
  } else {
    nullable = true;
  }
  const openApiType = {
    items: undefined,
    properties: undefined,
    type: undefined,
    enum: undefined,
    anyOf: undefined,
    description,
  };
  const typeNameWithoutBang = typeName.replace(/[!]$/, '');
  if (typeMap[typeNameWithoutBang]) {
    const retVal = Object.assign({}, typeMap[typeNameWithoutBang]);
    if (nullable) {
      retVal.type = [retVal.type, 'null'];
    }
    return {
      ...retVal,
      description,
    };
  }
  if (type instanceof GraphQLList) {
    openApiType.type = 'array';
    let itemType = type.ofType;
    if (itemType instanceof GraphQLNonNull) {
      itemType = itemType.ofType;
    }
    if (itemType instanceof GraphQLObjectType) {
      openApiType.items = {
        type: ['object', 'null'],
        properties: {},
      };
    }
    if (itemType instanceof GraphQLUnionType) {
      openApiType.items = {
        anyOf: [], // Maybe ref to null ?!?
      };
    }
    if (itemType instanceof GraphQLScalarType) {
      openApiType.items = getScalarType(
        itemType.name,
        scalarConfig,
        onUnknownScalar
      );
      openApiType.items.type = [openApiType.items.type, 'null'];
    }
    return openApiType;
  }
  if (type instanceof GraphQLObjectType) {
    openApiType.type = 'object';
    openApiType.properties = {};
    return openApiType;
  }
  if (type instanceof GraphQLEnumType) {
    openApiType.type = nullable ? ['string', 'null'] : 'string';
    openApiType.enum = type.getValues().map((v) => v.value);
    return openApiType;
  }
  if (type instanceof GraphQLUnionType) {
    openApiType.anyOf = []; // Maybe ref to null ?!?
    return openApiType;
  }
  const scalarType = type as GraphQLScalarType;
  const t = getScalarType(scalarType.name, scalarConfig, onUnknownScalar);
  return {
    ...t,
    description,
  };
}

type InputType =
  | GraphQLInputObjectType
  | GraphQLScalarType
  | GraphQLEnumType
  | GraphQLList<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  | GraphQLNonNull<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function recurseInputType(
  obj: InputType,
  depth: number,
  scalarConfig: { [key: string]: object }, // eslint-disable-line @typescript-eslint/ban-types
  onUnknownScalar: (s: string) => object // eslint-disable-line @typescript-eslint/ban-types
) {
  // istanbul ignore next
  if (depth > 50) {
    // istanbul ignore next
    throw new Error('depth limit exceeded: ' + depth);
  }
  if (obj instanceof GraphQLInputObjectType) {
    const inputObjectType = obj as GraphQLInputObjectType;
    const properties = Object.entries(inputObjectType.getFields()).reduce(
      (properties, [name, f]) => {
        properties[name] = recurseInputType(
          f.type,
          depth + 1,
          scalarConfig,
          onUnknownScalar
        );
        properties[name].description = f.description;
        return properties;
      },
      {}
    );
    return {
      type: ['object', 'null'],
      description: inputObjectType.description || undefined,
      properties,
    };
  }
  if (obj instanceof GraphQLList) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = obj as GraphQLList<any>;
    return {
      type: ['array', 'null'],
      items: recurseInputType(
        list.ofType,
        depth + 1,
        scalarConfig,
        onUnknownScalar
      ),
    };
  }
  if (obj instanceof GraphQLScalarType) {
    const { name } = obj;
    if (name === 'Float') {
      return {
        type: ['number', 'null'],
      };
    }
    if (name === 'Int') {
      return {
        type: ['integer', 'null'],
      };
    }
    if (name === 'String') {
      return {
        type: ['string', 'null'],
      };
    }
    if (name === 'Boolean') {
      return {
        type: ['boolean', 'null'],
      };
    }
    // istanbul ignore else
    if (name === 'ID') {
      return {
        type: ['string', 'null'],
      };
    }
    return getScalarType(name, scalarConfig, onUnknownScalar);
  }
  if (obj instanceof GraphQLEnumType) {
    const enumValues = obj.getValues();
    return {
      type: ['string', 'null'],
      description: obj.description || undefined,
      enum: enumValues.map(({ name }) => name),
    };
  }
  // istanbul ignore else
  if (obj instanceof GraphQLNonNull) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nonNull = obj as GraphQLNonNull<any>;
    const retVal = {
      ...recurseInputType(
        nonNull.ofType,
        depth + 1,
        scalarConfig,
        onUnknownScalar
      ),
    };
    if (Array.isArray(retVal.type)) {
      retVal.type = retVal.type.filter((entry) => entry !== 'null');
      if (retVal.type.length === 1) {
        retVal.type = retVal.type[0];
      }
    }
    return retVal;
  }
  // istanbul ignore next
  throw new Error(`Unexpected InputType: ${obj}`);
}

export class GraphQLToOpenAPIConverter {
  private graphqlSchema: GraphQLSchema;
  private schemaError: GraphQLError;
  constructor(
    private schema?: string | Source,
    private introspectionSchema?: IntrospectionQuery,
    private onUnknownScalar?: (s: string) => object, // eslint-disable-line @typescript-eslint/ban-types
    private scalarConfig?: { [key: string]: object } // eslint-disable-line @typescript-eslint/ban-types
  ) {
    if (!onUnknownScalar) {
      this.onUnknownScalar = () => {
        return null;
      };
    }
    if (!scalarConfig) {
      this.scalarConfig = {};
    }
    if (schema) {
      try {
        this.graphqlSchema = buildSchema(this.schema);
      } catch (err) {
        this.schemaError = err;
      }
    } else if (introspectionSchema) {
      try {
        this.graphqlSchema = buildClientSchema(this.introspectionSchema);
      } catch (err) {
        this.schemaError = err;
      }
    } else {
      throw new MissingSchemaError(
        'neither schema nor introspection schema supplied'
      );
    }
  }

  public toOpenAPI(query: string | Source): GraphQLToOpenAPIResult {
    const { schemaError, onUnknownScalar, scalarConfig } = this;
    if (schemaError) {
      return {
        schemaError,
      };
    }
    const { graphqlSchema } = this;
    let parsedQuery;
    try {
      parsedQuery = parse(query);
    } catch (err) {
      return { queryErrors: [err] };
    }
    const queryErrors = validate(graphqlSchema, parsedQuery);
    if (queryErrors.length > 0) {
      return {
        queryErrors,
      };
    }
    let openApiSchema = {
      openapi: '3.1.0',
      info: {
        title: 'Not specified',
        license: {
          name: 'Not specified',
        },
        version: 'Not specified',
      },
      servers: [
        {
          url: '/',
        },
      ],
      paths: {},
    };

    let error;
    let operationDef;
    const currentSelection = [];
    const typeInfo = new TypeInfo(graphqlSchema);
    const fragments = [];
    openApiSchema = visit(
      parsedQuery,
      visitWithTypeInfo(typeInfo, {
        Document: {
          leave() {
            return openApiSchema;
          },
        },
        FragmentDefinition: {
          enter(node) {
            const fragmentType = typeInfo.getType();
            let openApiType;
            if (fragmentType instanceof GraphQLUnionType) {
              openApiType = {
                anyOf: [],
              };
            } else {
              openApiType = {
                type:
                  fragmentType instanceof GraphQLNonNull
                    ? 'object'
                    : ['object', 'null'],
                properties: {},
              };
            }
            currentSelection.unshift({
              node,
              openApiType,
            });
          },
          leave(node) {
            const result = currentSelection.shift().openApiType;
            fragments[node.name.value] = result;
            return result;
          },
        },
        OperationDefinition: {
          enter(node) {
            const openApiType = {
              type: 'object',
              properties: {
                // To be filled by Field visitor
              },
            };
            if (!node.name) {
              error = new NoOperationNameError(
                'GraphQLToOpenAPIConverter requires a named ' +
                  `operation on line ${node.loc.source.locationOffset.line} ` +
                  'of input query'
              );
              return BREAK;
            }
            openApiSchema.paths['/' + node.name.value] = operationDef = {
              get: {
                parameters: [],
                responses: {
                  '200': {
                    description: 'response',
                    content: {
                      'application/json': {
                        schema: openApiType,
                      },
                    },
                  },
                },
              },
            };
            currentSelection.unshift({
              node,
              openApiType,
            });
          },
          leave() {
            return openApiSchema;
          },
        },
        VariableDefinition({ variable }) {
          const t = recurseInputType(
            typeInfo.getInputType(),
            0,
            scalarConfig,
            onUnknownScalar
          );
          if (
            isOfTypeOrContains(t.type, 'object') ||
            isOfTypeOrContains(t.type, 'array')
          ) {
            operationDef.get.parameters.push({
              name: variable.name.value,
              in: 'query',
              required: !isOfTypeOrContains(t.type, 'null'),
              schema: {
                type: t.type,
                items: t.items,
                properties: t.properties,
              },
              description: t.description || undefined,
            });
          } else {
            operationDef.get.parameters.push({
              name: variable.name.value,
              in: 'query',
              required: !isOfTypeOrContains(t.type, 'null'),
              schema: {
                type: t.type,
              },
              description: t.description || undefined,
            });
          }
        },
        FragmentSpread: {
          enter(node) {
            const openApiType = currentSelection[0].openApiType;
            const fragment = fragments[node.name.value];
            if (openApiType.anyOf) {
              openApiType.anyOf = fragment.anyOf;
            } else if (openApiType.items) {
              openApiType.items.properties = fragment.properties;
            } else {
              openApiType.properties = fragment.properties;
            }
          },
        },
        Field: {
          enter(node) {
            let name;
            if (node.alias) {
              name = node.alias.value;
            } else {
              name = node.name.value;
            }
            const openApiType = fieldDefToOpenApiField(
              typeInfo,
              scalarConfig,
              onUnknownScalar
            );
            const parentObj = currentSelection[0].openApiType;
            if (isOfTypeOrContains(parentObj.type, 'object')) {
              parentObj.properties[name] = openApiType;
            } else {
              // array
              parentObj.items.properties[name] = openApiType;
            }
            if (
              isOfTypeOrContains(openApiType.type, 'array') &&
              isOfTypeOrContains(openApiType.items?.type, 'object')
            ) {
              currentSelection.unshift({
                node,
                openApiType,
              });
            } else if (
              isOfTypeOrContains(openApiType.type, 'array') &&
              openApiType.items?.anyOf
            ) {
              currentSelection.unshift({
                node,
                openApiType,
              });
            } else if (openApiType.anyOf) {
              currentSelection.unshift({
                node,
                openApiType,
              });
            } else if (isOfTypeOrContains(openApiType.type, 'object')) {
              currentSelection.unshift({
                node,
                openApiType,
              });
            }
          },
          leave(node) {
            // raw reference comparison doesn't work here. Using
            // loc as a proxy instead.
            if (currentSelection[0].node.loc === node.loc) {
              const result = currentSelection.shift().openApiType;
              return result;
            }
          },
        },
        InlineFragment: {
          enter(node) {
            const openApiType = {
              type: 'object',
              properties: {},
            };
            const topOfStack = currentSelection[0].openApiType;
            if (topOfStack.items?.anyOf) {
              topOfStack.items.anyOf.push(openApiType);
            } else {
              topOfStack.anyOf.push(openApiType);
            }
            currentSelection.unshift({
              node,
              openApiType,
            });
          },
          leave() {
            return currentSelection.shift().openApiType;
          },
        },
      })
    );
    if (error) {
      return {
        error,
      };
    }
    return {
      openApiSchema,
    };
  }
}

function isOfTypeOrContains(typeDef, typeName): boolean {
  if (!typeDef) return false;
  if (typeof typeDef === 'string') {
    return typeName === typeDef;
  } else if (Array.isArray(typeDef)) {
    return typeDef.includes(typeName);
  }
  return false;
}
