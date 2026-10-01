import {
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  getNamedType,
  isObjectType,
  type FieldNode,
  type GraphQLField,
  type GraphQLNamedType,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
  validate,
} from "graphql";
import type { Plugin } from "graphql-yoga";

// The largest page REST will return; an unknown or invalid page size is costed at this.
const MAX_PAGE = 100;

/** Resolves a variable to its request value, or undefined when it cannot be known. */
type VariableReader = (name: string) => unknown;

const validPage = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PAGE
    ? value
    : MAX_PAGE;

/**
 * Reads variables for one operation: the request value, else the declared literal default.
 * Without request variables every variable is unknown, so validation alone stays conservative.
 */
function variableReader(
  operation: OperationDefinitionNode,
  variables: Readonly<Record<string, unknown>> | undefined
): VariableReader {
  return (name) => {
    if (!variables) return undefined;
    if (Object.hasOwn(variables, name) && variables[name] !== undefined) return variables[name];
    const fallback = operation.variableDefinitions?.find(
      (definition) => definition.variable.name.value === name
    )?.defaultValue;
    return fallback?.kind === Kind.INT ? Number(fallback.value) : undefined;
  };
}

function tooComplex(message: string) {
  return new GraphQLError(message, { extensions: { code: "QUERY_TOO_COMPLEX" } });
}

function pageSize(
  node: FieldNode,
  field: GraphQLField<unknown, unknown> | undefined,
  readVariable: VariableReader
) {
  const argument = node.arguments?.find((arg) => arg.name.value === "first");
  if (argument?.value.kind === Kind.INT) return validPage(Number(argument.value.value));
  if (argument?.value.kind === Kind.VARIABLE)
    return validPage(readVariable(argument.value.name.value));
  if (argument) return MAX_PAGE;
  const fallback = field?.args.find((arg) => arg.name === "first")?.defaultValue;
  return typeof fallback === "number" && Number.isFinite(fallback) && fallback >= 1
    ? Math.min(fallback, MAX_PAGE)
    : 1;
}

/**
 * Walks a selection set with fragments expanded. Returns depth and cost, where each field costs
 * one plus its children multiplied by the requested page size.
 */
function measure(
  context: ValidationContext,
  selectionSet: SelectionSetNode,
  parent: GraphQLNamedType | undefined,
  fragments: ReadonlySet<string>,
  maxDepth: number,
  maxCost: number,
  work: { remaining: number },
  readVariable: VariableReader
): { depth: number; cost: number } {
  let depth = 0;
  let cost = 0;
  const add = (result: { depth: number; cost: number }, extraDepth: number, factor: number) => {
    depth = Math.max(depth, result.depth + extraDepth);
    cost += result.cost * factor;
  };
  for (const selection of selectionSet.selections) {
    if (--work.remaining < 0) return { depth: maxDepth + 1, cost: maxCost + 1 };
    if (selection.kind === Kind.FIELD) {
      const field = isObjectType(parent) ? parent.getFields()[selection.name.value] : undefined;
      cost += 1;
      const child = selection.selectionSet
        ? measure(
            context,
            selection.selectionSet,
            field && getNamedType(field.type),
            fragments,
            maxDepth,
            maxCost,
            work,
            readVariable
          )
        : { depth: 0, cost: 0 };
      add(child, 1, pageSize(selection, field, readVariable));
      if (cost > maxCost || depth > maxDepth) break;
      continue;
    }
    const fragment =
      selection.kind === Kind.INLINE_FRAGMENT
        ? selection
        : context.getFragment(selection.name.value);
    if (
      !fragment ||
      (selection.kind === Kind.FRAGMENT_SPREAD && fragments.has(selection.name.value))
    )
      continue;
    const condition = fragment.typeCondition
      ? context.getSchema().getType(fragment.typeCondition.name.value)
      : parent;
    const seen =
      selection.kind === Kind.FRAGMENT_SPREAD
        ? new Set([...fragments, selection.name.value])
        : fragments;
    add(
      measure(
        context,
        fragment.selectionSet,
        condition ?? undefined,
        seen,
        maxDepth,
        maxCost,
        work,
        readVariable
      ),
      0,
      1
    );
    if (cost > maxCost || depth > maxDepth) break;
  }
  return { depth, cost };
}

/**
 * Bounds depth and cost for each operation. Pass the request variables to cost variable page
 * sizes at their actual value; without them a variable page size counts as the largest page.
 */
export function queryLimitRule(
  maxDepth: number,
  maxCost: number,
  variables?: Readonly<Record<string, unknown>>
): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const root = context.getSchema().getRootType(operation.operation) ?? undefined;
      const { depth, cost } = measure(
        context,
        operation.selectionSet,
        root,
        new Set(),
        maxDepth,
        maxCost,
        { remaining: 1000 },
        variableReader(operation, variables)
      );
      if (depth > maxDepth) context.reportError(tooComplex(`Query depth exceeds ${maxDepth}`));
      if (cost > maxCost) context.reportError(tooComplex(`Query cost exceeds ${maxCost}`));
    },
  });
}

/**
 * Adds depth/cost bounds to every operation and blocks introspection unless allowed. The bounds
 * run before execution rather than during validation: Yoga caches validation per document, and
 * the cost of a paged field depends on the variables of each request.
 */
export function queryLimits(options: {
  maxDepth: number;
  maxCost: number;
  allowIntrospection: boolean;
}): Plugin {
  return {
    onValidate({ addValidationRule }) {
      if (!options.allowIntrospection) addValidationRule(NoSchemaIntrospectionCustomRule);
    },
    onExecute({ args, setResultAndStopExecution }) {
      const errors = validate(args.schema, args.document, [
        queryLimitRule(options.maxDepth, options.maxCost, args.variableValues ?? {}),
      ]);
      if (errors.length > 0) setResultAndStopExecution({ errors });
    },
  };
}
