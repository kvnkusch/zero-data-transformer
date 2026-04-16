import { expectTypeOf, test } from "vitest";
import { createSchema, type QueryRowType, string, table } from "@rocicorp/zero";
import { customColumnType } from "./column-transforms";
import { createProxyBuilder } from "./query-builders";

const timestamp = customColumnType({
  base: "number" as const,
  encode(value: Date) {
    return value.getTime();
  },
  decode(value: number) {
    void value;
    return {} as Date;
  },
});

const issue = table("issue")
  .columns({
    id: string(),
    createdAt: timestamp(),
  })
  .primaryKey("id");

const schema = createSchema({
  tables: [issue],
  relationships: [],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
});

test("custom columns flow through query result and filter typing", () => {
  const proxyBuilder = createProxyBuilder(schema);

  type ProxyRow = QueryRowType<typeof proxyBuilder.issue>;
  type StartArg = Parameters<typeof proxyBuilder.issue.start>[0];

  expectTypeOf<ProxyRow["createdAt"]>().toEqualTypeOf<Date>();
  expectTypeOf<StartArg["createdAt"]>().toEqualTypeOf<Date | undefined>();
});
