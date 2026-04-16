import type {Query, Schema, ViewFactory} from "@rocicorp/zero";
import { asQueryInternals } from "@rocicorp/zero/bindings";
import { decodeFormattedValue } from "./query-builders.ts";

export function wrapFactoryWithDecodedViews<S extends Schema, T>(
  schema: S,
  query: Query<any, S, any>,
  factory: ViewFactory<any, S, any, T>,
): ViewFactory<any, S, any, T> {
  const { ast, format } = asQueryInternals(query as Query<any, Schema, any>);
  return (_query, input, passedFormat, onDestroy, onTransactionCommit, queryComplete, updateTTL) =>
    factory(
      query,
      wrapInput(schema, ast.table, format, input) as never,
      passedFormat,
      onDestroy,
      onTransactionCommit,
      queryComplete,
      updateTTL,
    );
}

function wrapInput<S extends Schema>(
  schema: S,
  tableName: string,
  format: ReturnType<typeof asQueryInternals>["format"],
  input: {
    getSchema(): unknown;
    destroy(): void;
    setOutput(output: { push(change: unknown, pusher: unknown): Iterable<unknown> }): void;
    fetch(req: unknown): Iterable<unknown>;
  },
) {
  return {
    getSchema: () => input.getSchema(),
    destroy: () => input.destroy(),
    setOutput(output: { push(change: unknown, pusher: unknown): Iterable<unknown> }) {
      input.setOutput({
        push(change, pusher) {
          return output.push(decodeChange(schema, tableName, format, change), pusher);
        },
      });
    },
    fetch(req: unknown) {
      return decodeNodeStream(schema, tableName, format, input.fetch(req));
    },
  };
}

function* decodeNodeStream<S extends Schema>(
  schema: S,
  tableName: string,
  format: ReturnType<typeof asQueryInternals>["format"],
  stream: Iterable<unknown>,
): Iterable<unknown> {
  for (const item of stream) {
    yield item === "yield" ? item : decodeNode(schema, tableName, format, item);
  }
}

function decodeNode<S extends Schema>(
  schema: S,
  tableName: string,
  format: ReturnType<typeof asQueryInternals>["format"],
  node: unknown,
) {
  if (typeof node !== "object" || node === null) {
    return node;
  }
  const rawNode = node as {
    row: Record<string, unknown>;
    relationships: Record<string, () => Iterable<unknown>>;
  };
  return {
    row: decodeFormattedValue(schema, tableName, { ...format, singular: true }, rawNode.row),
    relationships: Object.fromEntries(
      Object.entries(rawNode.relationships).map(([name, getStream]) => {
        const childFormat = format.relationships[name];
        const childTable = relationDestTable(schema, tableName, name);
        if (!childFormat || !childTable) {
          return [name, getStream] as const;
        }
        return [
          name,
          () => decodeNodeStream(schema, childTable, childFormat, getStream()),
        ] as const;
      }),
    ),
  };
}

function decodeChange<S extends Schema>(
  schema: S,
  tableName: string,
  format: ReturnType<typeof asQueryInternals>["format"],
  change: unknown,
): unknown {
  if (typeof change !== "object" || change === null || !("type" in change)) {
    return change;
  }
  const raw = change as Record<string, unknown>;
  switch (raw.type) {
    case "add":
    case "remove":
      return {
        ...raw,
        node: decodeNode(schema, tableName, format, raw.node),
      };
    case "edit":
      return {
        ...raw,
        node: decodeNode(schema, tableName, format, raw.node),
        oldNode: decodeNode(schema, tableName, format, raw.oldNode),
      };
    case "child": {
      const child = raw.child as Record<string, unknown>;
      const relationshipName = child.relationshipName as string;
      const childFormat = format.relationships[relationshipName];
      const childTable = relationDestTable(schema, tableName, relationshipName);
      return {
        ...raw,
        node: decodeNode(schema, tableName, format, raw.node),
        child:
          childFormat && childTable
            ? {
                ...child,
                change: decodeChange(schema, childTable, childFormat, child.change),
              }
            : child,
      };
    }
    default:
      return raw;
  }
}

function relationDestTable<S extends Schema>(schema: S, tableName: string, relationshipName: string) {
  const relation = schema.relationships[tableName]?.[relationshipName];
  return relation?.[relation.length - 1]?.destSchema;
}
