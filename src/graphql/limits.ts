import {
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  getNamedType,
  isObjectType,
  type FieldNode,
  type GraphQLField,
  type GraphQLNamedType,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from "graphql";
import type { Plugin } from "graphql-yoga";

// A variable page size is costed at the largest page REST will return.
const MAX_PAGE = 100;

function tooComplex(message: string) {
  return new GraphQLError(message, { extensions: { code: "QUERY_TOO_COMPLEX" } });
}

function pageSize(node: FieldNode, field: GraphQLField<unknown, unknown> | undefined) {
  const argument = node.arguments?.find((arg) => arg.name.value === "first");
  if (argument?.value.kind === Kind.INT) return Number(argument.value.value);
  if (argument) return MAX_PAGE;
  const fallback = field?.args.find((arg) => arg.name === "first")?.defaultValue;
  return typeof fallback === "number" ? fallback : 1;
}

/**
 * Walks a selection set with fragments expanded. Returns depth and cost, where each field costs
 * one plus its children multiplied by the requested page size.
 */
function measure(
  context: ValidationContext,
  selectionSet: SelectionSetNode,
  parent: GraphQLNamedType | undefined,
  fragments: ReadonlySet<string>
): { depth: number; cost: number } {
  let depth = 0;
  let cost = 0;
  const add = (result: { depth: number; cost: number }, extraDepth: number, factor: number) => {
    depth = Math.max(depth, result.depth + extraDepth);
    cost += result.cost * factor;
  };
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const field = isObjectType(parent) ? parent.getFields()[selection.name.value] : undefined;
      cost += 1;
      const child = selection.selectionSet
        ? measure(context, selection.selectionSet, field && getNamedType(field.type), fragments)
        : { depth: 0, cost: 0 };
      add(child, 1, pageSize(selection, field));
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
    add(measure(context, fragment.selectionSet, condition ?? undefined, seen), 0, 1);
  }
  return { depth, cost };
}

export function queryLimitRule(maxDepth: number, maxCost: number): ValidationRule {
  return (context) => ({
    OperationDefinition(operation) {
      const root = context.getSchema().getRootType(operation.operation) ?? undefined;
      const { depth, cost } = measure(context, operation.selectionSet, root, new Set());
      if (depth > maxDepth) context.reportError(tooComplex(`Query depth exceeds ${maxDepth}`));
      if (cost > maxCost) context.reportError(tooComplex(`Query cost exceeds ${maxCost}`));
    },
  });
}

/** Adds depth/cost bounds to every operation and blocks introspection unless allowed. */
export function queryLimits(options: {
  maxDepth: number;
  maxCost: number;
  allowIntrospection: boolean;
}): Plugin {
  const limit = queryLimitRule(options.maxDepth, options.maxCost);
  return {
    onValidate({ addValidationRule }) {
      addValidationRule(limit);
      if (!options.allowIntrospection) addValidationRule(NoSchemaIntrospectionCustomRule);
    },
  };
}
