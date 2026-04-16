import {
  boolean as zeroBoolean,
  json as zeroJson,
  number as zeroNumber,
  string as zeroString,
  type ColumnBuilder,
  type Schema,
} from "@rocicorp/zero";

export const columnTransformSymbol = Symbol.for(
  "zero-data-transformer/column-transform",
);

type BaseValueMap = {
  string: string;
  number: number;
  boolean: boolean;
  json: unknown;
};

export type TransformBaseType = keyof BaseValueMap;

export interface ColumnTransform<TBase extends TransformBaseType, TData> {
  readonly base: TBase;
  encode(value: TData): BaseValueMap[TBase];
  decode(value: BaseValueMap[TBase]): TData;
}

type SchemaValueFor<TBase extends TransformBaseType, TData> = {
  readonly type: TBase;
  readonly optional: false;
  readonly customType: TData;
  readonly serverName?: string;
};

export type TransformedColumnBuilder<TBase extends TransformBaseType, TData> = ColumnBuilder<
  SchemaValueFor<TBase, TData>
>;

export function customColumnType<TBase extends TransformBaseType, TData>(definition: {
  base: TBase;
  encode(value: TData): BaseValueMap[TBase];
  decode(value: BaseValueMap[TBase]): TData;
}): () => TransformedColumnBuilder<TBase, TData>;
export function customColumnType<TBase extends TransformBaseType, TData, TConfig>(definition: {
  base: TBase;
  encode(value: TData, config: TConfig): BaseValueMap[TBase];
  decode(value: BaseValueMap[TBase], config: TConfig): TData;
}): (config: TConfig) => TransformedColumnBuilder<TBase, TData>;
export function customColumnType<TBase extends TransformBaseType, TData, TConfig>(definition: {
  base: TBase;
  encode(value: TData, config?: TConfig): BaseValueMap[TBase];
  decode(value: BaseValueMap[TBase], config?: TConfig): TData;
}) {
  return (config?: TConfig) => {
    const builder = makeBaseBuilder<TBase, TData>(definition.base);
    const transform: ColumnTransform<TBase, TData> = {
      base: definition.base,
      encode(value) {
        return definition.encode(value, config);
      },
      decode(value) {
        return definition.decode(value, config);
      },
    };
    attachColumnTransform(builder, transform);
    return builder;
  };
}

export function getColumnTransform(
  schema: Schema,
  tableName: string,
  columnName: string,
): ColumnTransform<TransformBaseType, unknown> | undefined {
  const table = schema.tables[tableName];
  if (!table) {
    return undefined;
  }
  return getColumnTransformFromValue(table.columns[columnName]);
}

export function getColumnTransformFromValue(
  value: unknown,
): ColumnTransform<TransformBaseType, unknown> | undefined {
  if (!hasColumnTransform(value)) {
    return undefined;
  }
  return value[columnTransformSymbol];
}

function attachColumnTransform<TBase extends TransformBaseType, TData>(
  builder: ColumnBuilder<SchemaValueFor<TBase, TData>>,
  transform: ColumnTransform<TBase, TData>,
) {
  Object.defineProperty(builder.schema, columnTransformSymbol, {
    value: transform,
    enumerable: true,
    configurable: true,
  });
}

function makeBaseBuilder<TBase extends TransformBaseType, TData>(
  base: TBase,
): ColumnBuilder<SchemaValueFor<TBase, TData>> {
  switch (base) {
    case "string":
      return zeroString() as ColumnBuilder<SchemaValueFor<TBase, TData>>;
    case "number":
      return zeroNumber() as ColumnBuilder<SchemaValueFor<TBase, TData>>;
    case "boolean":
      return zeroBoolean() as ColumnBuilder<SchemaValueFor<TBase, TData>>;
    case "json":
      return zeroJson() as ColumnBuilder<SchemaValueFor<TBase, TData>>;
  }
  throw new Error(`Unsupported base column type: ${String(base)}`);
}

function hasColumnTransform(
  value: unknown,
): value is Record<typeof columnTransformSymbol, ColumnTransform<TransformBaseType, unknown>> {
  return typeof value === "object" && value !== null && columnTransformSymbol in value;
}
