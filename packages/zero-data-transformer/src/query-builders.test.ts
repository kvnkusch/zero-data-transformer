import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test, vi } from "vitest";
import { createSchema, string, table, type Query, type TypedView } from "@rocicorp/zero";
import { asQueryInternals } from "@rocicorp/zero/bindings";
import { customColumnType } from "./column-transforms";
import { createProxyBuilder } from "./query-builders";
import { createZeroWithDataTransforms } from "./zero-wrapper";
import { createZeroDataTransformer } from "./index";

const timestamp = customColumnType({
  base: "number" as const,
  encode(value: Date) {
    return value.getTime();
  },
  decode(value: number) {
    return new Date(value);
  },
});

const user = table("user")
  .columns({
    id: string(),
    createdAt: timestamp(),
  })
  .primaryKey("id");

const issue = table("issue")
  .columns({
    id: string(),
    title: string(),
    ownerId: string(),
    createdAt: timestamp(),
  })
  .primaryKey("id");

const schema = createSchema({
  tables: [user, issue],
  relationships: [
    {
      name: "issue",
      relationships: {
        owner: [
          {
            sourceField: ["ownerId"],
            destField: ["id"],
            destSchema: "user",
            cardinality: "one",
          },
        ],
      },
    },
    {
      name: "user",
      relationships: {},
    },
  ],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
});

const queryDate = new Date("2025-01-02T03:04:05.000Z");
const queryMillis = queryDate.getTime();

const dateArgsTransformer = {
  serialize(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value instanceof Date) {
      return JSON.stringify({ type: "Date", value: value.toISOString() });
    }
    return JSON.stringify(value);
  },
  deserialize(value: string | undefined): unknown {
    if (value === undefined) {
      return undefined;
    }
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      parsed.type === "Date" &&
      "value" in parsed
    ) {
      return new Date(String(parsed.value));
    }
    return parsed;
  },
};

describe("query builders", () => {
  test("proxy builder encodes where/start values", () => {
    const builder = createProxyBuilder(schema);
    const query = builder.issue
      .where("createdAt", ">=", queryDate)
      .start({ createdAt: queryDate })
      .related("owner", (q) => q.where("createdAt", queryDate));

    const internals = asQueryInternals(query);
    expect(internals.ast.where).toMatchObject({
      type: "simple",
      right: { type: "literal", value: queryMillis },
    });
    expect(internals.ast.start).toMatchObject({
      row: { createdAt: queryMillis },
      exclusive: true,
    });

    const related = internals.ast.related?.[0];
    expect(related).toBeDefined();
    expect(related?.subquery.where).toMatchObject({
      type: "simple",
      right: { type: "literal", value: queryMillis },
    });
  });

  test("proxy builder encodes expression-builder cmp values", () => {
    const builder = createProxyBuilder(schema);
    const query = builder.issue.where(({ cmp }) => cmp("createdAt", ">=", queryDate));

    expect(asQueryInternals(query).ast.where).toMatchObject({
      type: "simple",
      op: ">=",
      right: { type: "literal", value: queryMillis },
    });
  });

  test("proxy builder encodes IN values", () => {
    const builder = createProxyBuilder(schema);
    const secondDate = new Date("2025-01-03T03:04:05.000Z");
    const query = builder.issue.where("createdAt", "IN", [queryDate, secondDate]);

    expect(asQueryInternals(query).ast.where).toMatchObject({
      type: "simple",
      op: "IN",
      right: { type: "literal", value: [queryMillis, secondDate.getTime()] },
    });
  });

  test("proxy builder encodes whereExists callback values", () => {
    const builder = createProxyBuilder(schema);
    const query = builder.issue.whereExists("owner", (q) => q.where("createdAt", queryDate));

    expect(asQueryInternals(query).ast.where).toMatchObject({
      type: "correlatedSubquery",
      op: "EXISTS",
      related: {
        subquery: {
          where: {
            type: "simple",
            right: { type: "literal", value: queryMillis },
          },
        },
      },
    });
  });
});

describe("wrapped zero", () => {
  function makeFakeView<T>(data: T): TypedView<T> {
    return {
      addListener(listener) {
        listener(data as never, "complete");
        return () => {};
      },
      destroy: vi.fn(),
      updateTTL: vi.fn(),
      get data() {
        return data;
      },
    };
  }

  function makeFakeZero() {
    return {
      schema,
      context: undefined,
      clientID: "client-1",
      query: undefined as never,
      run: vi.fn(async (_query: Query<any, typeof schema>) => [
        {
          id: "issue-1",
          title: "First",
          ownerId: "user-1",
          createdAt: queryMillis,
          owner: {
            id: "user-1",
            createdAt: queryMillis,
          },
        },
      ]),
      preload: vi.fn(() => ({
        cleanup: () => {},
        complete: Promise.resolve(),
      })),
      materialize: vi.fn((query: Query<any, typeof schema>, second?: unknown) => {
        const data = [
          {
            id: "issue-1",
            title: "First",
            ownerId: "user-1",
            createdAt: queryMillis,
            owner: {
              id: "user-1",
              createdAt: queryMillis,
            },
          },
        ];

        if (typeof second === "function") {
          return second(
            query,
            {
              getSchema: () => ({ columns: {} }),
              destroy: () => {},
              setOutput: () => {},
              fetch: function* () {
                yield {
                  row: {
                    id: "issue-1",
                    title: "First",
                    ownerId: "user-1",
                    createdAt: queryMillis,
                  },
                  relationships: {
                    owner: function* () {
                      yield {
                        row: {
                          id: "user-1",
                          createdAt: queryMillis,
                        },
                        relationships: {},
                      };
                    },
                  },
                };
              },
            },
            asQueryInternals(query).format,
            () => {},
            () => {},
            true,
            () => {},
          );
        }

        return makeFakeView(data);
      }),
    };
  }

  test("wrapped zero decodes run results and keeps default materialize clone-safe", async () => {
    const rawZero = makeFakeZero();
    const zero = createZeroWithDataTransforms(rawZero as never) as any;
    const query = zero.query.issue.related("owner");

    const result = await zero.run(query);
    expect(result).toEqual([
      {
        id: "issue-1",
        title: "First",
        ownerId: "user-1",
        createdAt: queryDate,
        owner: {
          id: "user-1",
          createdAt: queryDate,
        },
      },
    ]);

    const view = zero.materialize(query);
    expect(view.data).toEqual([
      {
        id: "issue-1",
        title: "First",
        ownerId: "user-1",
        createdAt: queryMillis,
        owner: {
          id: "user-1",
          createdAt: queryMillis,
        },
      },
    ]);

    let listenerData: unknown;
    view.addListener((data: unknown) => {
      listenerData = data;
    });
    expect(listenerData).toEqual(view.data);
    expect(zero.clientID).toBe("client-1");
    expect(zero.context).toBeUndefined();
  });

  test("wrapped zero preserves private-field-backed getters", () => {
    class FakeZeroWithPrivateContext {
      #context = { actorId: "user-1" };

      readonly schema = schema;
      readonly clientID = "client-1";
      readonly query = createProxyBuilder(schema);

      get context() {
        return this.#context;
      }

      async run() {
        return [];
      }

      preload() {
        return { cleanup: () => {}, complete: Promise.resolve() };
      }

      materialize() {
        return makeFakeView<Record<string, never>[]>([]);
      }
    }

    const rawZero = new FakeZeroWithPrivateContext();
    const zero = createZeroWithDataTransforms(rawZero);

    expect(zero.context).toEqual({ actorId: "user-1" });
  });

  test("wrapped zero decodes materialize factory input", () => {
    const rawZero = makeFakeZero();
    const zero = createZeroWithDataTransforms(rawZero as never) as any;
    const query = zero.query.issue.related("owner");

    const rows = zero.materialize(
      query,
      (_query: Query<any, typeof schema>, input: { fetch(req: unknown): Iterable<unknown> }) => {
        const [node] = Array.from(input.fetch({}));
        const owner = (node as { relationships: { owner?: () => Iterable<unknown> } }).relationships
          .owner;
        expect(owner).toBeDefined();
        const ownerStream = owner!();
        const [ownerNode] = Array.from(ownerStream);
        return {
          issue: (node as { row: { createdAt: Date } }).row.createdAt,
          owner: (ownerNode as { row: { createdAt: Date } }).row.createdAt,
        };
      },
    );

    expect(rows).toEqual({
      issue: queryDate,
      owner: queryDate,
    });
  });

  test("existing defineQuery arg transformation remains compatible", async () => {
    const zt = createZeroDataTransformer({
      argsTransformer: dateArgsTransformer,
    });

    let received: Date | undefined;
    const builder = createProxyBuilder(schema);
    const dateValidator: StandardSchemaV1<Date, Date> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate(value) {
          return { value: value as Date };
        },
      },
    };
    const queries = zt.defineQueries({
      issue: {
        byCreatedAt: zt.defineQuery(dateValidator, ({ args }: { args: Date; ctx: undefined }) => {
          received = args;
          return builder.issue.where("createdAt", args);
        }),
      },
    });

    const request = queries.issue.byCreatedAt(queryDate);
    expect(request.args).toBe(
      JSON.stringify({
        type: "Date",
        value: queryDate.toISOString(),
      }),
    );

    const query = request.query.fn({ args: request.args, ctx: undefined });
    expect(received).toEqual(queryDate);
    expect(asQueryInternals(query).ast.where).toMatchObject({
      right: { type: "literal", value: queryMillis },
    });

    const rawZero = makeFakeZero();
    const zero = createZeroWithDataTransforms(rawZero as never) as any;
    const result = await zero.run(request);
    expect(result[0]?.createdAt).toEqual(queryDate);
  });

  test("wrapped zero resolves query requests before preload", () => {
    const rawZero = makeFakeZero();
    const zero = createZeroWithDataTransforms(rawZero as never) as any;

    const zt = createZeroDataTransformer({
      schema,
      argsTransformer: dateArgsTransformer,
    });

    const queries = zt.defineQueries({
      issue: {
        byCreatedAt: zt.defineQuery(
          {
            "~standard": {
              version: 1,
              vendor: "test",
              validate(value) {
                return { value: value as Date };
              },
            },
          },
          ({ args }: { args: Date; ctx: undefined }) =>
            createProxyBuilder(schema).issue.where("createdAt", args),
        ),
      },
    });

    (zero as unknown as { preload: (query: unknown) => unknown }).preload(
      (queries.issue.byCreatedAt as unknown as (value: Date) => unknown)(queryDate),
    );

    expect((rawZero as any).preload).toHaveBeenCalledTimes(1);
    const firstCall = (rawZero as any).preload.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const receivedQuery = firstCall?.[0] as unknown as Query<any, typeof schema>;
    expect(asQueryInternals(receivedQuery).ast.where).toMatchObject({
      right: { type: "literal", value: queryMillis },
    });
  });

  test("wrapped zero resolves query requests before run", async () => {
    const rawZero = makeFakeZero();
    const zero = createZeroWithDataTransforms(rawZero as never) as any;

    const zt = createZeroDataTransformer({
      schema,
      argsTransformer: dateArgsTransformer,
    });

    const queries = zt.defineQueries({
      issue: {
        byCreatedAt: zt.defineQuery(
          {
            "~standard": {
              version: 1,
              vendor: "test",
              validate(value) {
                return { value: value as Date };
              },
            },
          },
          ({ args }: { args: Date; ctx: undefined }) =>
            createProxyBuilder(schema).issue.where("createdAt", args),
        ),
      },
    });

    await (zero as unknown as { run: (query: unknown) => Promise<unknown> }).run(
      (queries.issue.byCreatedAt as unknown as (value: Date) => unknown)(queryDate),
    );

    expect((rawZero as any).run).toHaveBeenCalledTimes(1);
    const firstCall = (rawZero as any).run.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const receivedQuery = firstCall?.[0] as unknown as Query<any, typeof schema>;
    expect(asQueryInternals(receivedQuery).ast.where).toMatchObject({
      right: { type: "literal", value: queryMillis },
    });
  });
});
